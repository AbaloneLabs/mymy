//! Preview endpoint HTTP handlers.

use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Request, StatusCode};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::preview::{
    CreatePreviewEndpointRequest, DeletePreviewEndpointResponse, PreviewEndpointResponse,
    PreviewEndpointsResponse, PreviewQuery,
};
use crate::services::previews as preview_service;
use crate::state::AppState;

const MAX_PROXY_BODY_BYTES: usize = 25 * 1024 * 1024;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/preview-endpoints",
            get(list_previews).post(create_preview),
        )
        .route(
            "/api/preview-endpoints/{id}",
            axum::routing::delete(delete_preview),
        )
        .route(
            "/api/previews/{token}",
            get(proxy_preview).post(proxy_preview),
        )
        .route(
            "/api/previews/{token}/{*path}",
            get(proxy_preview).post(proxy_preview),
        )
}

pub async fn list_previews(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PreviewQuery>,
) -> AppResult<Json<PreviewEndpointsResponse>> {
    Ok(Json(
        preview_service::list_previews(&state, query.agent_profile.as_deref()).await?,
    ))
}

pub async fn create_preview(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePreviewEndpointRequest>,
) -> AppResult<Json<PreviewEndpointResponse>> {
    Ok(Json(preview_service::create_preview(&state, req).await?))
}

pub async fn delete_preview(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeletePreviewEndpointResponse>> {
    Ok(Json(preview_service::delete_preview(&state, id).await?))
}

async fn proxy_preview(
    State(state): State<Arc<AppState>>,
    Path(path): Path<PreviewProxyPath>,
    req: Request<Body>,
) -> AppResult<Response> {
    let endpoint = preview_service::active_preview_by_token(&state, &path.token).await?;
    let target = preview_service::proxied_target_url(
        &endpoint,
        path.path.as_deref().unwrap_or(""),
        req.uri().query(),
        &state.config.sandbox_preview_host,
    )?;
    let method = reqwest::Method::from_bytes(req.method().as_str().as_bytes())
        .map_err(|err| AppError::BadRequest(format!("unsupported preview method: {err}")))?;
    let headers = filtered_request_headers(req.headers());
    let body = to_bytes(req.into_body(), MAX_PROXY_BODY_BYTES)
        .await
        .map_err(|err| AppError::BadRequest(format!("preview request body failed: {err}")))?;

    let client = reqwest::Client::new();
    let mut upstream = client.request(method, target);
    for (name, value) in headers.iter() {
        upstream = upstream.header(name.as_str(), value.as_bytes());
    }
    let upstream_response =
        upstream.body(body).send().await.map_err(|err| {
            AppError::BadRequest(format!("preview upstream request failed: {err}"))
        })?;
    let status = StatusCode::from_u16(upstream_response.status().as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let response_headers = filtered_response_headers(upstream_response.headers());
    let bytes = upstream_response
        .bytes()
        .await
        .map_err(|err| AppError::BadRequest(format!("preview upstream body failed: {err}")))?;

    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = status;
    for (name, value) in response_headers.iter() {
        response.headers_mut().insert(name, value.clone());
    }
    Ok(response)
}

#[derive(Debug, Deserialize)]
struct PreviewProxyPath {
    token: String,
    #[serde(default)]
    path: Option<String>,
}

fn filtered_request_headers(headers: &HeaderMap) -> HeaderMap {
    let mut filtered = HeaderMap::new();
    for (name, value) in headers {
        if is_hop_by_hop(name.as_str())
            || name == header::HOST
            || name == header::COOKIE
            || name == header::AUTHORIZATION
        {
            continue;
        }
        filtered.insert(name.clone(), value.clone());
    }
    filtered
}

fn filtered_response_headers(headers: &reqwest::header::HeaderMap) -> HeaderMap {
    let mut filtered = HeaderMap::new();
    for (name, value) in headers {
        if is_hop_by_hop(name.as_str()) || name.as_str().eq_ignore_ascii_case("set-cookie") {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_str().as_bytes()),
            HeaderValue::from_bytes(value.as_bytes()),
        ) {
            filtered.insert(name, value);
        }
    }
    filtered
}

fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}
