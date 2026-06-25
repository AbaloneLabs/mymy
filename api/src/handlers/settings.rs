//! Settings HTTP handlers.

use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::Json;
use axum::Router;

use crate::error::AppResult;
use crate::models::settings::{SettingsResponse, UpdateSettingsRequest};
use crate::services::settings as settings_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/settings", get(get_settings).patch(update_settings))
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
