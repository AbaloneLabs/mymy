//! Read and review endpoints for provenance-aware runtime memory.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::runtime_memory::{
    AgentMemoryView, MemoriesResponse, MemoryEmbeddingSettingsView, MemorySearchQuery,
    RecentRecapResponse, ReviewMemoryRequest, UpdateMemoryEmbeddingSettings,
};
use crate::models::scope::ScopeFilter;
use crate::services::runtime_memory;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/runtime-memory", get(list_memories))
        .route("/api/runtime-memory/{id}/review", post(review_memory))
        .route("/api/run-summaries", get(list_summaries))
        .route(
            "/api/runtime-memory/settings/{profile}",
            get(get_embedding_settings).put(update_embedding_settings),
        )
}

async fn get_embedding_settings(
    State(state): State<Arc<AppState>>,
    Path(profile): Path<String>,
) -> AppResult<Json<MemoryEmbeddingSettingsView>> {
    Ok(Json(
        runtime_memory::get_embedding_settings(&state, &profile).await?,
    ))
}

async fn update_embedding_settings(
    State(state): State<Arc<AppState>>,
    Path(profile): Path<String>,
    Json(request): Json<UpdateMemoryEmbeddingSettings>,
) -> AppResult<Json<MemoryEmbeddingSettingsView>> {
    Ok(Json(
        runtime_memory::update_embedding_settings(&state, &profile, request).await?,
    ))
}

async fn list_memories(
    State(state): State<Arc<AppState>>,
    Query(query): Query<MemorySearchQuery>,
) -> AppResult<Json<MemoriesResponse>> {
    Ok(Json(runtime_memory::search_memories(&state, query).await?))
}

async fn review_memory(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(request): Json<ReviewMemoryRequest>,
) -> AppResult<Json<AgentMemoryView>> {
    Ok(Json(
        runtime_memory::review_memory(&state, id, request).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryQuery {
    agent_profile: Option<String>,
    scope: Option<String>,
    project_id: Option<String>,
    q: Option<String>,
    #[serde(default = "default_summary_limit")]
    limit: i64,
}

async fn list_summaries(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SummaryQuery>,
) -> AppResult<Json<RecentRecapResponse>> {
    let scope = ScopeFilter::parse(query.scope.as_deref(), query.project_id.as_deref())?;
    Ok(Json(
        runtime_memory::recent_recap(
            &state,
            query.agent_profile.as_deref(),
            scope,
            query.q.as_deref(),
            query.limit,
        )
        .await?,
    ))
}

fn default_summary_limit() -> i64 {
    25
}
