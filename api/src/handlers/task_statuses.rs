//! Task custom status HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch, post};
use axum::Json;
use axum::Router;

use crate::error::AppResult;
use crate::models::project::DeleteResponse;
use crate::models::task_status::{
    CreateTaskStatusRequest, ReorderTaskStatusesRequest, TaskStatusResponse, TaskStatusesResponse,
    UpdateTaskStatusRequest,
};
use crate::services::task_statuses::{self as task_statuses_service, DeleteTaskStatusQuery};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/task-statuses",
            get(list_task_statuses).post(create_task_status),
        )
        .route("/api/task-statuses/reorder", post(reorder_task_statuses))
        .route(
            "/api/task-statuses/{slug}",
            patch(update_task_status).delete(delete_task_status),
        )
}

pub async fn list_task_statuses(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<TaskStatusesResponse>> {
    Ok(Json(
        task_statuses_service::list_task_statuses(&state).await?,
    ))
}

pub async fn create_task_status(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTaskStatusRequest>,
) -> AppResult<Json<TaskStatusResponse>> {
    Ok(Json(
        task_statuses_service::create_task_status(&state, req).await?,
    ))
}

pub async fn update_task_status(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
    Json(req): Json<UpdateTaskStatusRequest>,
) -> AppResult<Json<TaskStatusResponse>> {
    Ok(Json(
        task_statuses_service::update_task_status(&state, slug, req).await?,
    ))
}

pub async fn reorder_task_statuses(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ReorderTaskStatusesRequest>,
) -> AppResult<Json<TaskStatusesResponse>> {
    Ok(Json(
        task_statuses_service::reorder_task_statuses(&state, req).await?,
    ))
}

pub async fn delete_task_status(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
    Query(req): Query<DeleteTaskStatusQuery>,
) -> AppResult<Json<DeleteResponse>> {
    let success = task_statuses_service::delete_task_status(&state, slug, req).await?;
    Ok(Json(DeleteResponse { success }))
}
