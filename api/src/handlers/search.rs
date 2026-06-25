//! OmniSearch HTTP handler.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::Json;
use axum::Router;

use crate::error::AppResult;
use crate::models::search::{SearchQuery, SearchResponse};
use crate::services::search as search_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/search", get(search_all))
}

pub async fn search_all(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<SearchResponse>> {
    Ok(Json(search_service::search_all(&state, q).await?))
}
