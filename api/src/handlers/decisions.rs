//! Durable Decision commands and projections.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::decision::{
    DecisionResponse, DecisionsQuery, DecisionsResponse, ResolveDecisionRequest,
    ResolveDecisionResponse,
};
use crate::services::decisions;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/decisions", get(list_decisions))
        .route("/api/decisions/{id}", get(get_decision))
        .route("/api/decisions/{id}/resolve", post(resolve_decision))
        .route("/api/decisions/{id}/dismiss", post(dismiss_decision))
}

async fn list_decisions(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DecisionsQuery>,
) -> AppResult<Json<DecisionsResponse>> {
    Ok(Json(DecisionsResponse {
        decisions: decisions::list_decisions(&state, query).await?,
    }))
}

async fn get_decision(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DecisionResponse>> {
    Ok(Json(DecisionResponse {
        decision: decisions::get_decision(&state, id).await?,
    }))
}

async fn resolve_decision(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(request): Json<ResolveDecisionRequest>,
) -> AppResult<Json<ResolveDecisionResponse>> {
    Ok(Json(
        decisions::resolve_decision(&state, id, request.answer, "user").await?,
    ))
}

async fn dismiss_decision(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ResolveDecisionResponse>> {
    Ok(Json(decisions::dismiss_decision(&state, id, "user").await?))
}
