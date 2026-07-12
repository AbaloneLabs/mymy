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
    pub source_session_id: Option<String>,
    pub source_message_start: Option<String>,
    pub source_message_end: Option<String>,
    pub agent_profile: String,
    pub project_id: Option<String>,
    pub memory_type: String,
    pub origin: String,
    pub scope_kind: String,
    pub scope_id: Option<String>,
    pub tier: String,
    pub evidence_role: String,
    pub content: String,
    pub confidence: f64,
    pub status: String,
    pub sensitivity: String,
    pub valid_from: String,
    pub valid_until: Option<String>,
    pub superseded_by: Option<String>,
    pub created_at: String,
    pub content_revision: i64,
    pub lifecycle_revision: i64,
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
pub struct MemoryExportResponse {
    pub schema_version: String,
    pub generated_at: String,
    pub agent_profile: String,
    pub memories: Vec<AgentMemoryView>,
    pub deleted_content_retained: bool,
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
    pub expected_content_revision: i64,
    pub expected_lifecycle_revision: i64,
    pub idempotency_key: Option<String>,
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
    #[serde(default)]
    pub include_private: bool,
    #[serde(default)]
    pub include_financial: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRuntimeSettingsView {
    pub agent_profile: String,
    pub automatic_recall_enabled: bool,
    pub inferred_extraction_enabled: bool,
    pub semantic_indexing_enabled: bool,
    pub settings_revision: i64,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateMemoryRuntimeSettings {
    pub automatic_recall_enabled: bool,
    pub inferred_extraction_enabled: bool,
    pub semantic_indexing_enabled: bool,
    pub expected_settings_revision: i64,
}

fn default_limit() -> i64 {
    50
}
