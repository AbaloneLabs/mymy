//! Native extension registry HTTP API.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::AppResult;
use crate::services::extensions::{
    self as extension_service, CreateExtensionRequest, DeleteExtensionResponse, ExtensionsResponse,
    TestExtensionRequest, TestExtensionResponse, UpdateExtensionRequest,
};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/extensions",
            get(list_extensions).post(create_extension),
        )
        .route(
            "/api/extensions/{id}",
            patch(update_extension).delete(delete_extension),
        )
        .route("/api/extensions/{id}/test", post(test_extension))
}

pub async fn list_extensions(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<ExtensionsResponse>> {
    Ok(Json(extension_service::list_extensions(&state).await?))
}

pub async fn create_extension(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateExtensionRequest>,
) -> AppResult<Json<ExtensionsResponse>> {
    Ok(Json(
        extension_service::create_extension(&state, req).await?,
    ))
}

pub async fn update_extension(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateExtensionRequest>,
) -> AppResult<Json<ExtensionsResponse>> {
    Ok(Json(
        extension_service::update_extension(&state, id, req).await?,
    ))
}

pub async fn delete_extension(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteExtensionResponse>> {
    Ok(Json(extension_service::delete_extension(&state, id).await?))
}

pub async fn test_extension(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<TestExtensionRequest>,
) -> AppResult<Json<TestExtensionResponse>> {
    Ok(Json(
        extension_service::test_extension(&state, id, req).await?,
    ))
}
