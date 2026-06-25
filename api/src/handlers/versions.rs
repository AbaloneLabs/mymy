//! Version history HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::version::{
    EntityVersionResponse, EntityVersionsResponse, RestoreVersionRequest, RestoreVersionResponse,
    VersionQuery,
};
use crate::services::versions as versions_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/versions", get(list_versions))
        .route("/api/versions/{versionId}", get(get_version))
        .route("/api/versions/{versionId}/restore", post(restore_version))
}

pub async fn list_versions(
    State(state): State<Arc<AppState>>,
    Query(q): Query<VersionQuery>,
) -> AppResult<Json<EntityVersionsResponse>> {
    Ok(Json(versions_service::list_versions(&state, q).await?))
}

pub async fn get_version(
    State(state): State<Arc<AppState>>,
    Path(version_id): Path<Uuid>,
) -> AppResult<Json<EntityVersionResponse>> {
    Ok(Json(
        versions_service::get_version(&state, version_id).await?,
    ))
}

pub async fn restore_version(
    State(state): State<Arc<AppState>>,
    Path(version_id): Path<Uuid>,
    Json(req): Json<RestoreVersionRequest>,
) -> AppResult<Json<RestoreVersionResponse>> {
    Ok(Json(
        versions_service::restore_version(&state, version_id, req).await?,
    ))
}
