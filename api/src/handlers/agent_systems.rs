//! Agent system HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::{get, patch, post};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::agent_system::{
    AgentSystemResponse, AgentSystemsResponse, CreateAgentSystemRequest, DeleteResponse,
    DiscoverResponse, UpdateAgentSystemRequest,
};
use crate::services::agent_systems as agent_systems_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/agent-systems",
            get(list_instances).post(create_instance),
        )
        .route("/api/agent-systems/discover", post(discover))
        .route(
            "/api/agent-systems/{id}",
            patch(update_instance).delete(delete_instance),
        )
}

pub async fn discover(State(state): State<Arc<AppState>>) -> AppResult<Json<DiscoverResponse>> {
    Ok(Json(agent_systems_service::discover(&state).await?))
}

pub async fn list_instances(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<AgentSystemsResponse>> {
    Ok(Json(agent_systems_service::list_instances(&state).await?))
}

pub async fn create_instance(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateAgentSystemRequest>,
) -> AppResult<Json<AgentSystemResponse>> {
    Ok(Json(
        agent_systems_service::create_instance(&state, req).await?,
    ))
}

pub async fn update_instance(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateAgentSystemRequest>,
) -> AppResult<Json<AgentSystemResponse>> {
    Ok(Json(
        agent_systems_service::update_instance(&state, id, req).await?,
    ))
}

pub async fn delete_instance(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = agent_systems_service::delete_instance(&state, id).await?;
    Ok(Json(DeleteResponse { success }))
}
