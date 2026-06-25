//! Version history models — DB row, API responses, and request types.
//!
//! All API-facing types use `#[serde(rename_all = "camelCase")]` so that
//! snake_case Rust fields map to camelCase JSON (e.g. `entity_type` ->
//! `entityType`), matching the frontend TypeScript interfaces.

use serde::{Deserialize, Serialize};

use crate::models::knowledge::KnowledgeArticle;
use crate::models::note::Note;

/// A lightweight version entry for list/timeline display (no snapshot).
///
/// Serialized as camelCase to match the frontend `EntityVersionSummary`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityVersionSummary {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub version_num: i32,
    pub actor_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_label: Option<String>,
    pub change_summary: String,
    /// RFC3339 timestamp.
    pub created_at: String,
}

/// A full version entry including the JSONB snapshot (for detail/diff view).
///
/// Serialized as camelCase to match the frontend `EntityVersion`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityVersion {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub version_num: i32,
    pub snapshot: serde_json::Value,
    pub actor_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_label: Option<String>,
    pub change_summary: String,
    pub snapshot_size: i32,
    /// RFC3339 timestamp.
    pub created_at: String,
}

/// Paginated version list response (summaries, newest-first).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityVersionsResponse {
    pub versions: Vec<EntityVersionSummary>,
}

/// Single version detail response (includes snapshot).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityVersionResponse {
    pub version: EntityVersion,
}

/// Restore result — the restored entity plus the new checkpoint version.
///
/// Exactly one of `note` / `article` is populated, depending on the
/// entity type of the restored version.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreVersionResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<Note>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub article: Option<KnowledgeArticle>,
    pub version: EntityVersionSummary,
}

/// Query params for GET /api/versions.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionQuery {
    pub entity_type: String,
    pub entity_id: String,
}

/// Optional body for POST /api/versions/{versionId}/restore.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestoreVersionRequest {
    pub actor_type: Option<String>,
    pub actor_label: Option<String>,
}
