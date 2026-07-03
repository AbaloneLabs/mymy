//! Native agents handler.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};

use crate::error::AppResult;
use crate::models::agent::{
    AgentResponse, AgentsResponse, CreateAgentRequest, DeleteAgentResponse,
};
use crate::services::agents as agents_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/agents", get(list_agents).post(create_agent))
        .route("/api/agents/{profile}", axum::routing::delete(delete_agent))
}

pub async fn list_agents(State(state): State<Arc<AppState>>) -> AppResult<Json<AgentsResponse>> {
    Ok(Json(agents_service::list_agents(&state).await?))
}

pub async fn create_agent(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateAgentRequest>,
) -> AppResult<Json<AgentResponse>> {
    Ok(Json(agents_service::create_agent(&state, req).await?))
}

pub async fn delete_agent(
    State(state): State<Arc<AppState>>,
    Path(profile): Path<String>,
) -> AppResult<Json<DeleteAgentResponse>> {
    Ok(Json(agents_service::delete_agent(&state, &profile).await?))
}
