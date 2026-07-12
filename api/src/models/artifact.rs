//! Session-scoped artifact summaries and stable open resolution.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionArtifactsQuery {
    pub cursor: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    50
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionArtifactSummary {
    pub id: String,
    pub resource_id: String,
    pub artifact_type: String,
    pub title: String,
    pub mime_type: String,
    pub lifecycle_state: String,
    pub lifecycle_sequence: i64,
    pub relationship_kind: String,
    pub producing_agent: Option<String>,
    pub current_path: Option<String>,
    pub wiki_links: Vec<ArtifactWikiLink>,
    pub last_activity_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactWikiLink {
    pub knowledge_id: String,
    pub title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionArtifactsResponse {
    pub artifacts: Vec<SessionArtifactSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactOpenResponse {
    pub artifact_id: String,
    pub resource_id: String,
    pub path: String,
    pub mime_type: String,
    pub lifecycle_sequence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResourceEffectView {
    pub id: String,
    pub resource_id: String,
    pub artifact_id: Option<String>,
    pub effect_kind: String,
    pub before_reference: Option<String>,
    pub after_reference: Option<String>,
    pub observed_revision: Option<String>,
    pub resource_sequence: i64,
    pub lifecycle_state: String,
    pub current_path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunArtifactView {
    pub id: String,
    pub resource_id: String,
    pub title: String,
    pub artifact_type: String,
    pub mime_type: String,
    pub lifecycle_state: String,
    pub lifecycle_sequence: i64,
    pub current_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProvenanceResponse {
    pub effects: Vec<RunResourceEffectView>,
    pub artifacts: Vec<RunArtifactView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRunLinkView {
    pub run_id: String,
    pub session_id: Option<String>,
    pub agent_profile: String,
    pub effect_kind: String,
    pub resource_sequence: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProvenanceResponse {
    pub resource_id: String,
    pub lifecycle_state: String,
    pub current_path: Option<String>,
    pub runs: Vec<ResourceRunLinkView>,
}
