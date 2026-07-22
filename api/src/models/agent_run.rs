//! Durable agent-run API models.
//!
//! These types keep transport details independent from the worker repository.
//! Run events remain versioned JSON projections so reconnecting clients can
//! replay an ordered history without owning the underlying execution future.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentRunsQuery {
    pub status: Option<String>,
    pub trigger_type: Option<String>,
    pub project_id: Option<uuid::Uuid>,
    pub agent_profile: Option<String>,
    #[serde(default = "default_run_limit")]
    pub limit: i64,
}

fn default_run_limit() -> i64 {
    50
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunView {
    pub id: String,
    pub session_id: Option<String>,
    pub agent_profile: String,
    pub trigger_type: String,
    pub trigger_ref: Option<String>,
    pub parent_run_id: Option<String>,
    pub parent_event_id: Option<String>,
    pub delegate_index: Option<i32>,
    pub project_id: Option<String>,
    pub status: String,
    pub objective: String,
    pub prompt_version: String,
    pub llm_provider_id: Option<String>,
    pub llm_provider_label: Option<String>,
    pub llm_model: Option<String>,
    pub llm_selection_source: Option<String>,
    pub lease_epoch: i64,
    pub latest_sequence: i64,
    pub lease_expires_at: Option<String>,
    pub cancel_requested_at: Option<String>,
    pub started_at: Option<String>,
    pub heartbeat_at: Option<String>,
    pub next_attempt_at: Option<String>,
    pub provider_retry_count: i32,
    pub completed_at: Option<String>,
    pub error_code: Option<String>,
    pub usage: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunEventView {
    pub id: String,
    pub run_id: String,
    pub sequence: i64,
    pub event_type: String,
    pub payload_version: i32,
    pub visibility: String,
    pub payload: Value,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResponse {
    pub run: AgentRunView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunChildrenResponse {
    pub children: Vec<AgentRunView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunsResponse {
    pub runs: Vec<AgentRunView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunEventsResponse {
    pub run: AgentRunView,
    pub events: Vec<AgentRunEventView>,
    pub latest_sequence: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentRunEventsQuery {
    #[serde(default, alias = "after_sequence")]
    pub after_sequence: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnqueueChatRunRequest {
    pub client_request_id: String,
    pub text: String,
    #[serde(default)]
    pub use_moa: bool,
    #[serde(default)]
    pub moa_preset_id: Option<uuid::Uuid>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRunInputView {
    pub id: String,
    pub session_id: String,
    pub client_request_id: String,
    pub target_run_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub options: Value,
    pub status: String,
    pub sequence: i64,
    pub created_at: String,
    pub applied_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueChatRunResponse {
    pub input: SessionRunInputView,
    pub run: Option<AgentRunView>,
    pub deduplicated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRuntimeResponse {
    pub active_run: Option<AgentRunView>,
    pub queued_inputs: Vec<SessionRunInputView>,
    pub latest_sequence: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateSessionRunInputRequest {
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRunInputResponse {
    pub input: SessionRunInputView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAgentRunResponse {
    pub accepted: bool,
    pub terminal: bool,
    pub status: String,
}
