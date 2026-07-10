//! Opt-in proactive settings and candidate actions.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::proactive::{
    ProactiveCandidate, ProactiveCandidatesQuery, ProactiveCandidatesResponse,
    ProactiveSettingsResponse, UpdateProactiveSettings,
};
use crate::services::proactive;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/proactive/settings/{profile}",
            get(get_settings).put(update_settings),
        )
        .route("/api/proactive/candidates", get(list_candidates))
        .route(
            "/api/proactive/candidates/{id}/approve",
            post(approve_candidate),
        )
        .route(
            "/api/proactive/candidates/{id}/ignore",
            post(ignore_candidate),
        )
}

async fn get_settings(
    State(state): State<Arc<AppState>>,
    Path(profile): Path<String>,
) -> AppResult<Json<ProactiveSettingsResponse>> {
    Ok(Json(proactive::get_settings(&state, &profile).await?))
}

async fn update_settings(
    State(state): State<Arc<AppState>>,
    Path(profile): Path<String>,
    Json(request): Json<UpdateProactiveSettings>,
) -> AppResult<Json<ProactiveSettingsResponse>> {
    Ok(Json(
        proactive::update_settings(&state, &profile, request).await?,
    ))
}

async fn list_candidates(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ProactiveCandidatesQuery>,
) -> AppResult<Json<ProactiveCandidatesResponse>> {
    Ok(Json(proactive::list_candidates(&state, query).await?))
}

async fn approve_candidate(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ProactiveCandidate>> {
    Ok(Json(proactive::approve_candidate(&state, id).await?))
}

async fn ignore_candidate(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ProactiveCandidate>> {
    Ok(Json(proactive::ignore_candidate(&state, id).await?))
}
