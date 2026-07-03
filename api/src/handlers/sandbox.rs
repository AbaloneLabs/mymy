//! Sandbox runtime HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::sandbox::{
    SandboxProcessLogsResponse, SandboxProcessQuery, SandboxProcessResponse,
    SandboxProcessesResponse, SandboxRuntimeResponse, StartSandboxProcessRequest,
    StopSandboxProcessResponse,
};
use crate::services::sandbox as sandbox_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/sandbox/runtime", get(runtime_status))
        .route(
            "/api/sandbox/processes",
            get(list_processes).post(start_process),
        )
        .route(
            "/api/sandbox/processes/{id}/stop",
            axum::routing::post(stop_process),
        )
        .route("/api/sandbox/processes/{id}/logs", get(process_logs))
}

pub async fn runtime_status(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<SandboxRuntimeResponse>> {
    Ok(Json(sandbox_service::runtime_status(&state).await?))
}

pub async fn list_processes(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SandboxProcessQuery>,
) -> AppResult<Json<SandboxProcessesResponse>> {
    Ok(Json(
        sandbox_service::list_processes(
            &state,
            query.agent_profile.as_deref(),
            query.project_id.as_deref(),
        )
        .await?,
    ))
}

pub async fn start_process(
    State(state): State<Arc<AppState>>,
    Json(req): Json<StartSandboxProcessRequest>,
) -> AppResult<Json<SandboxProcessResponse>> {
    Ok(Json(sandbox_service::start_process(&state, req).await?))
}

pub async fn stop_process(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<StopSandboxProcessResponse>> {
    Ok(Json(sandbox_service::stop_process(&state, id).await?))
}

pub async fn process_logs(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<SandboxProcessLogsResponse>> {
    Ok(Json(sandbox_service::process_logs(&state, id).await?))
}
