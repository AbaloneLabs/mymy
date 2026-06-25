//! Task / to-do CRUD handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch};
use axum::Json;
use axum::Router;
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::project::DeleteResponse;
use crate::models::task::{CreateTaskRequest, TaskResponse, TasksResponse, UpdateTaskRequest};
use crate::services::tasks as task_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/tasks", get(list_tasks).post(create_task))
        .route("/api/tasks/{id}", patch(update_task).delete(delete_task))
}

/// Query params for GET /api/tasks.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskQuery {
    /// Filter by project (null/absent = all tasks including general).
    pub project_id: Option<String>,
    /// Filter by status (null/absent = all statuses).
    pub status: Option<String>,
}

/// GET /api/tasks
///
/// Open tasks first, then by priority (urgent first), soonest due date,
/// then newest created.
pub async fn list_tasks(
    State(state): State<Arc<AppState>>,
    Query(q): Query<TaskQuery>,
) -> AppResult<Json<TasksResponse>> {
    let project_id = q
        .project_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|e| crate::error::AppError::BadRequest(format!("invalid projectId: {e}")))?;
    let tasks = task_service::list_tasks(
        &state.db,
        task_service::TaskFilter {
            project_id,
            status: q.status,
        },
    )
    .await?;
    Ok(Json(TasksResponse { tasks }))
}

/// POST /api/tasks
pub async fn create_task(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTaskRequest>,
) -> AppResult<Json<TaskResponse>> {
    let task = task_service::create_task(&state.db, req).await?;
    Ok(Json(TaskResponse { task }))
}

/// PATCH /api/tasks/{id}
///
/// COALESCE patch for project_id/title/description/status/priority.
/// `due_date` uses a tri-state convention: absent (None) preserves the
/// existing value, an empty string clears it (set NULL), and an ISO
/// string sets the value. `completed_at` is derived from `status`: set
/// to now() when status becomes "done", cleared otherwise, and left
/// untouched when status is unchanged.
pub async fn update_task(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateTaskRequest>,
) -> AppResult<Json<TaskResponse>> {
    let task = task_service::update_task(&state.db, id, req).await?;
    Ok(Json(TaskResponse { task }))
}

/// DELETE /api/tasks/{id}
pub async fn delete_task(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = task_service::delete_task(&state.db, id).await?;
    Ok(Json(DeleteResponse { success }))
}
