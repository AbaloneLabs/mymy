//! Agent operational data handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{delete, get};
use axum::Json;
use axum::Router;
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::agent_ops::{
    CronResponse, EnvironmentResponse, IdentityResponse, MemoryResponse, SessionsResponse,
    SkillsResponse, StatusResponse,
};
use crate::services::agent_ops as agent_ops_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/agent-systems/{id}/cron", get(get_cron))
        .route("/api/agent-systems/{id}/status", get(get_status))
        .route("/api/agent-systems/{id}/sessions", get(get_sessions))
        .route(
            "/api/agent-systems/{id}/sessions/{sessionId}",
            delete(delete_session),
        )
        .route("/api/agent-systems/{id}/skills", get(get_skills))
        .route("/api/agent-systems/{id}/memory", get(get_memory))
        .route("/api/agent-systems/{id}/identity", get(get_identity))
        .route("/api/agent-systems/{id}/environment", get(get_environment))
}

#[derive(Debug, Default, Deserialize)]
pub struct ProfileParam {
    profile: Option<String>,
}

impl ProfileParam {
    fn as_deref(&self) -> Option<&str> {
        self.profile.as_deref().filter(|s| !s.is_empty())
    }
}

pub async fn get_cron(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(profile): Query<ProfileParam>,
) -> AppResult<Json<CronResponse>> {
    Ok(Json(
        agent_ops_service::get_cron(&state, id, profile.as_deref()).await?,
    ))
}

pub async fn get_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(profile): Query<ProfileParam>,
) -> AppResult<Json<StatusResponse>> {
    Ok(Json(
        agent_ops_service::get_status(&state, id, profile.as_deref()).await?,
    ))
}

pub async fn get_sessions(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(profile): Query<ProfileParam>,
) -> AppResult<Json<SessionsResponse>> {
    Ok(Json(
        agent_ops_service::get_sessions(&state, id, profile.as_deref()).await?,
    ))
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path((id, session_id)): Path<(Uuid, String)>,
    Query(profile): Query<ProfileParam>,
) -> AppResult<()> {
    agent_ops_service::delete_session(&state, id, &session_id, profile.as_deref()).await
}

pub async fn get_skills(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(profile): Query<ProfileParam>,
) -> AppResult<Json<SkillsResponse>> {
    Ok(Json(
        agent_ops_service::get_skills(&state, id, profile.as_deref()).await?,
    ))
}

pub async fn get_memory(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(profile): Query<ProfileParam>,
) -> AppResult<Json<MemoryResponse>> {
    Ok(Json(
        agent_ops_service::get_memory(&state, id, profile.as_deref()).await?,
    ))
}

pub async fn get_identity(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(_profile): Query<ProfileParam>,
) -> AppResult<Json<IdentityResponse>> {
    Ok(Json(agent_ops_service::get_identity(&state, id).await?))
}

pub async fn get_environment(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(profile): Query<ProfileParam>,
) -> AppResult<Json<EnvironmentResponse>> {
    Ok(Json(
        agent_ops_service::get_environment(&state, id, profile.as_deref()).await?,
    ))
}
