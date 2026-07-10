//! Runtime recap and durable-memory projections.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummaryView {
    pub run_id: String,
    pub agent_profile: String,
    pub project_id: Option<String>,
    pub objective: String,
    pub outcome: String,
    pub summary_text: String,
    pub key_topics: Vec<String>,
    pub source_event_start: Option<i64>,
    pub source_event_end: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryView {
    pub id: String,
    pub source_run_id: Option<String>,
    pub source_run_snapshot_id: Option<String>,
    pub source_decision_id: Option<String>,
    pub agent_profile: String,
    pub project_id: Option<String>,
    pub memory_type: String,
    pub origin: String,
    pub content: String,
    pub confidence: f64,
    pub status: String,
    pub sensitivity: String,
    pub valid_from: String,
    pub valid_until: Option<String>,
    pub superseded_by: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchQuery {
    pub q: Option<String>,
    pub agent_profile: Option<String>,
    pub scope: Option<String>,
    pub project_id: Option<String>,
    pub status: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoriesResponse {
    pub memories: Vec<AgentMemoryView>,
    pub search_mode: String,
    pub embedding_provider: Option<String>,
    pub remote_data_shared: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRecapResponse {
    pub summaries: Vec<RunSummaryView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewMemoryRequest {
    pub action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEmbeddingSettingsView {
    pub agent_profile: String,
    pub enabled: bool,
    pub provider: String,
    pub include_private: bool,
    pub include_financial: bool,
    pub remote_data_shared: bool,
    pub disclosure: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateMemoryEmbeddingSettings {
    pub enabled: bool,
    #[serde(default)]
    pub include_private: bool,
    #[serde(default)]
    pub include_financial: bool,
}

fn default_limit() -> i64 {
    50
}
