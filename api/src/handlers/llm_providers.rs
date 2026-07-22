//! LLM provider configuration handlers.
//!
//! - GET    /api/llm-providers            → list all providers
//! - POST   /api/llm-providers            → create a provider
//! - PATCH  /api/llm-providers/{id}        → update a provider
//! - DELETE /api/llm-providers/{id}        → delete a provider
//! - POST   /api/llm-providers/{id}/test   → test connection
//! - POST   /api/llm-providers/{id}/default → set as default

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::llm_provider::{
    AgentCredentialsResponse, CreateAgentCredentialRequest, CreateLlmProviderRequest,
    FetchModelsRequest, FetchModelsResponse, LlmProviderResponse, LlmProvidersResponse,
    RateLimitStatusResponse, TestConnectionResponse, UpdateAgentCredentialRequest,
    UpdateLlmProviderRequest,
};
use crate::services::llm_providers as svc;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/llm-providers/models", post(fetch_models))
        .route("/api/llm-providers/rate-limits", get(rate_limits))
        .route(
            "/api/llm-providers",
            get(list_providers).post(create_provider),
        )
        .route(
            "/api/llm-providers/{id}",
            patch(update_provider).delete(delete_provider),
        )
        .route(
            "/api/llm-providers/{id}/credentials",
            get(list_credentials).post(create_credential),
        )
        .route(
            "/api/llm-providers/{id}/credentials/{credential_id}",
            patch(update_credential).delete(delete_credential),
        )
        .route("/api/llm-providers/{id}/test", post(test_provider))
        .route("/api/llm-providers/{id}/models", get(fetch_saved_models))
        .route("/api/llm-providers/{id}/default", post(set_default))
}

/// GET /api/llm-providers
pub async fn list_providers(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<LlmProvidersResponse>> {
    let resp = svc::list_providers(&state).await?;
    Ok(Json(resp))
}

/// POST /api/llm-providers
pub async fn create_provider(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateLlmProviderRequest>,
) -> AppResult<Json<LlmProviderResponse>> {
    let resp = svc::create_provider(&state, req).await?;
    Ok(Json(resp))
}

/// PATCH /api/llm-providers/:id
pub async fn update_provider(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateLlmProviderRequest>,
) -> AppResult<Json<LlmProviderResponse>> {
    let resp = svc::update_provider(&state, id, req).await?;
    Ok(Json(resp))
}

/// DELETE /api/llm-providers/:id
pub async fn delete_provider(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let resp = svc::delete_provider(&state, id).await?;
    Ok(Json(serde_json::to_value(resp).unwrap_or_default()))
}

/// POST /api/llm-providers/:id/test
pub async fn test_provider(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<TestConnectionResponse>> {
    let resp = svc::test_connection(&state, id).await?;
    Ok(Json(resp))
}

pub async fn fetch_saved_models(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<FetchModelsResponse>> {
    Ok(Json(svc::fetch_saved_models(&state, id).await?))
}

/// POST /api/llm-providers/:id/default
pub async fn set_default(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let resp = svc::set_default(&state, id).await?;
    Ok(Json(serde_json::to_value(resp).unwrap_or_default()))
}

pub async fn list_credentials(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<AgentCredentialsResponse>> {
    Ok(Json(svc::list_credentials(&state, id).await?))
}

pub async fn rate_limits(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<RateLimitStatusResponse>> {
    Ok(Json(svc::list_rate_limit_status(&state).await?))
}

pub async fn create_credential(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateAgentCredentialRequest>,
) -> AppResult<Json<AgentCredentialsResponse>> {
    Ok(Json(svc::create_credential(&state, id, req).await?))
}

pub async fn update_credential(
    State(state): State<Arc<AppState>>,
    Path((id, credential_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateAgentCredentialRequest>,
) -> AppResult<Json<AgentCredentialsResponse>> {
    Ok(Json(
        svc::update_credential(&state, id, credential_id, req).await?,
    ))
}

pub async fn delete_credential(
    State(state): State<Arc<AppState>>,
    Path((id, credential_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let resp = svc::delete_credential(&state, id, credential_id).await?;
    Ok(Json(serde_json::to_value(resp).unwrap_or_default()))
}

/// POST /api/llm-providers/models
pub async fn fetch_models(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FetchModelsRequest>,
) -> AppResult<Json<FetchModelsResponse>> {
    let resp = svc::fetch_models(&state, req).await?;
    Ok(Json(resp))
}
