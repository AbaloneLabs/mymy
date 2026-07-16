//! Durable Decision transport models.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionView {
    pub id: String,
    pub run_id: String,
    pub session_id: Option<String>,
    pub cron_job_id: Option<String>,
    pub kind: String,
    pub context: String,
    pub reason: String,
    pub question: String,
    pub choices: Value,
    pub suspend: bool,
    pub status: String,
    pub answer: Option<Value>,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionsQuery {
    pub status: Option<String>,
    pub kind: Option<String>,
    pub blocking: Option<bool>,
    pub run_id: Option<uuid::Uuid>,
    pub session_id: Option<uuid::Uuid>,
    pub agent_profile: Option<String>,
    pub project_id: Option<uuid::Uuid>,
    pub cursor: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    50
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionsResponse {
    pub decisions: Vec<DecisionView>,
    pub next_cursor: Option<String>,
    pub filtered_pending_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionPendingCountResponse {
    pub count: i64,
    pub observed_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionResponse {
    pub decision: DecisionView,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveDecisionRequest {
    pub answer: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveDecisionResponse {
    pub decision: DecisionView,
    pub applied: bool,
}
