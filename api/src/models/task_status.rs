//! Task custom status (category) models.
//!
//! See: web/src/types/task-statuses.ts (TaskStatus interface)
//!
//! `slug` is the primary key and the value stored on `tasks.status`.
//! `is_done` controls whether a status updates `completed_at`.

use serde::{Deserialize, Serialize};

/// A task status / category as exposed over the API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatus {
    pub slug: String,
    pub label: String,
    pub color: String,
    pub sort_order: i32,
    pub is_done: bool,
    pub is_system: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusesResponse {
    pub statuses: Vec<TaskStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusResponse {
    pub status: TaskStatus,
}

/// Payload for creating a new status.
///
/// `slug` is optional; if omitted, the server derives one from the label.
/// `color` must be one of the supported palette tokens.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskStatusRequest {
    pub slug: Option<String>,
    pub label: String,
    pub color: Option<String>,
    pub is_done: Option<bool>,
}

/// Payload for patching a status. `slug` cannot be changed (PK).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskStatusRequest {
    pub label: Option<String>,
    pub color: Option<String>,
    pub is_done: Option<bool>,
}

/// Body for reordering statuses. The full ordered list of slugs is sent
/// and `sort_order` is rewritten to match.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderTaskStatusesRequest {
    pub slugs: Vec<String>,
}
