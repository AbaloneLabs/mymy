//! Task / to-do models — mirrors frontend `Task`.
//!
//! See: web/src/types/index.ts (Task interface)
//!
//! All id/timestamp fields are `String` (serialized from DB `Uuid`/`timestamptz`
//! in the handler's `row_to_task`), matching the notes pattern.

use crate::models::scope::PatchField;
use serde::{Deserialize, Serialize};

/// A task as exposed over the API.
///
/// Serialized as camelCase to match the frontend `Task` interface
/// (projectId, dueDate, completedAt, createdAt, updatedAt).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksResponse {
    pub tasks: Vec<Task>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResponse {
    pub task: Task,
}

/// Payload for creating a new task.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub project_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<String>,
}

/// Payload for patching a task (all fields optional, COALESCE patch).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    #[serde(default)]
    pub project_id: PatchField<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<String>,
}
