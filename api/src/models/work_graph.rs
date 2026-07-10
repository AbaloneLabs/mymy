//! API projections for durable run-to-task relationships.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedTaskRun {
    pub run_id: String,
    pub session_id: Option<String>,
    pub agent_profile: String,
    pub status: String,
    pub trigger_type: String,
    pub link_kind: String,
    pub operation: Option<String>,
    pub outcome: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRuntimeResponse {
    pub task_id: String,
    pub task_deleted: bool,
    pub active_run_count: i64,
    pub runs: Vec<RelatedTaskRun>,
}
