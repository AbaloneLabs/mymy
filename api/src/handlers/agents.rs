//! Agents handler.
//!
//! - GET /api/agents → list all agents from enabled local hermes instances

use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::Json;
use axum::Router;

use crate::error::AppResult;
use crate::models::agent::AgentsResponse;
use crate::services::agents as agents_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/agents", get(list_agents))
}

/// GET /api/agents
///
/// Discovers agents from all enabled agent system instances.
/// Currently supports local hermes via direct file reads.
pub async fn list_agents(State(state): State<Arc<AppState>>) -> AppResult<Json<AgentsResponse>> {
    Ok(Json(agents_service::list_agents(&state).await?))
}
