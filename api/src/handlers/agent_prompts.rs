//! Native agent prompt file HTTP API.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};

use crate::error::AppResult;
use crate::services::agent_prompts::{
    self as agent_prompts_service, AgentPromptQuery, AgentPromptsResponse,
    UpdateAgentPromptsRequest,
};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/agent-prompts", get(get_prompts).put(update_prompts))
}

pub async fn get_prompts(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AgentPromptQuery>,
) -> AppResult<Json<AgentPromptsResponse>> {
    Ok(Json(
        agent_prompts_service::get_prompts(&state, query).await?,
    ))
}

pub async fn update_prompts(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AgentPromptQuery>,
    Json(req): Json<UpdateAgentPromptsRequest>,
) -> AppResult<Json<AgentPromptsResponse>> {
    Ok(Json(
        agent_prompts_service::update_prompts(&state, query, req).await?,
    ))
}
