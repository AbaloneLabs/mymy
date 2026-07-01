//! MoA preset HTTP API.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::moa::{
    CreateMoaPresetRequest, DeleteMoaPresetResponse, MoaPresetResponse, MoaPresetsResponse,
    UpdateMoaPresetRequest,
};
use crate::services::moa as moa_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/moa/presets", get(list_presets).post(create_preset))
        .route(
            "/api/moa/presets/{id}",
            patch(update_preset).delete(delete_preset),
        )
}

pub async fn list_presets(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<MoaPresetsResponse>> {
    Ok(Json(moa_service::list_presets(&state).await?))
}

pub async fn create_preset(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateMoaPresetRequest>,
) -> AppResult<Json<MoaPresetResponse>> {
    Ok(Json(moa_service::create_preset(&state, req).await?))
}

pub async fn update_preset(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateMoaPresetRequest>,
) -> AppResult<Json<MoaPresetResponse>> {
    Ok(Json(moa_service::update_preset(&state, id, req).await?))
}

pub async fn delete_preset(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteMoaPresetResponse>> {
    Ok(Json(moa_service::delete_preset(&state, id).await?))
}
