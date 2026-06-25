//! Goal / OKR HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch, post};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::goal::{
    CreateGoalRequest, CreateKeyResultRequest, GoalResponse, GoalsResponse, KeyResultResponse,
    UpdateGoalRequest, UpdateKeyResultRequest,
};
use crate::models::project::DeleteResponse;
use crate::services::goals::{self as goals_service, GoalQuery};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/goals", get(list_goals).post(create_goal))
        .route(
            "/api/goals/{id}",
            get(get_goal).patch(update_goal).delete(delete_goal),
        )
        .route("/api/goals/{id}/key-results", post(create_key_result))
        .route(
            "/api/goals/{id}/key-results/{krId}",
            patch(update_key_result).delete(delete_key_result),
        )
}

pub async fn list_goals(
    State(state): State<Arc<AppState>>,
    Query(q): Query<GoalQuery>,
) -> AppResult<Json<GoalsResponse>> {
    Ok(Json(goals_service::list_goals(&state, q).await?))
}

pub async fn get_goal(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<GoalResponse>> {
    Ok(Json(goals_service::get_goal(&state, id).await?))
}

pub async fn create_goal(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateGoalRequest>,
) -> AppResult<Json<GoalResponse>> {
    Ok(Json(goals_service::create_goal(&state, req).await?))
}

pub async fn update_goal(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateGoalRequest>,
) -> AppResult<Json<GoalResponse>> {
    Ok(Json(goals_service::update_goal(&state, id, req).await?))
}

pub async fn delete_goal(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = goals_service::delete_goal(&state, id).await?;
    Ok(Json(DeleteResponse { success }))
}

pub async fn create_key_result(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateKeyResultRequest>,
) -> AppResult<Json<KeyResultResponse>> {
    Ok(Json(
        goals_service::create_key_result(&state, id, req).await?,
    ))
}

pub async fn update_key_result(
    State(state): State<Arc<AppState>>,
    Path((id, kr_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateKeyResultRequest>,
) -> AppResult<Json<KeyResultResponse>> {
    Ok(Json(
        goals_service::update_key_result(&state, id, kr_id, req).await?,
    ))
}

pub async fn delete_key_result(
    State(state): State<Arc<AppState>>,
    Path((id, kr_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<DeleteResponse>> {
    let success = goals_service::delete_key_result(&state, id, kr_id).await?;
    Ok(Json(DeleteResponse { success }))
}
