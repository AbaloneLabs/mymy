//! Settings HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::header::COOKIE;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::Json;
use axum::Router;

use crate::error::AppError;
use crate::error::AppResult;
use crate::models::content_security::{
    ApproveQuarantineRequest, DeleteQuarantineRequest, QuarantineDecisionResponse,
    QuarantineListQuery, QuarantineListResponse,
};
use crate::models::settings::{SecurityStatusResponse, SettingsResponse, UpdateSettingsRequest};
use crate::services::content_quarantine;
use crate::services::settings as settings_service;
use crate::state::AppState;
use uuid::Uuid;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/settings", get(get_settings).patch(update_settings))
        .route("/api/settings/security", get(security_status))
        .route("/api/settings/security/quarantine", get(list_quarantine))
        .route(
            "/api/settings/security/quarantine/{id}/approve",
            axum::routing::post(approve_quarantine),
        )
        .route(
            "/api/settings/security/quarantine/{id}",
            axum::routing::delete(delete_quarantine),
        )
}

pub async fn list_quarantine(
    State(state): State<Arc<AppState>>,
    Query(query): Query<QuarantineListQuery>,
) -> AppResult<Json<QuarantineListResponse>> {
    Ok(Json(content_quarantine::list(&state, query).await?))
}

pub async fn approve_quarantine(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<ApproveQuarantineRequest>,
) -> AppResult<Json<QuarantineDecisionResponse>> {
    let token = headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            crate::services::auth::extract_cookie_value(
                value,
                crate::services::auth::SESSION_COOKIE_NAME,
            )
        })
        .ok_or_else(|| AppError::Unauthorized("authentication required".to_string()))?;
    if !crate::services::auth::verify_recent_session_token(&state.db, token, 15).await? {
        return Err(AppError::Coded {
            code: "step_up_required",
            status: StatusCode::FORBIDDEN,
            message: "sign in again before approving suspicious content".to_string(),
            retryable: false,
        });
    }
    let id = Uuid::parse_str(&id)
        .map_err(|_| AppError::BadRequest("invalid content review identifier".to_string()))?;
    Ok(Json(
        content_quarantine::approve(&state, id, request).await?,
    ))
}

pub async fn delete_quarantine(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<DeleteQuarantineRequest>,
) -> AppResult<Json<QuarantineDecisionResponse>> {
    let id = Uuid::parse_str(&id)
        .map_err(|_| AppError::BadRequest("invalid content review identifier".to_string()))?;
    Ok(Json(content_quarantine::delete(&state, id, request).await?))
}

pub async fn get_settings(State(state): State<Arc<AppState>>) -> AppResult<Json<SettingsResponse>> {
    Ok(Json(settings_service::get_settings(&state).await?))
}

pub async fn update_settings(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateSettingsRequest>,
) -> AppResult<Json<SettingsResponse>> {
    Ok(Json(settings_service::update_settings(&state, req).await?))
}

pub async fn security_status(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<SecurityStatusResponse>> {
    Ok(Json(settings_service::security_status(&state).await?))
}
