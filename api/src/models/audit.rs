//! Audit log models — DB row, API response, and query params.
//!
//! All API-facing types use `#[serde(rename_all = "camelCase")]` so that
//! snake_case Rust fields map to camelCase JSON (e.g. `actor_type` ->
//! `actorType`), matching the frontend TypeScript interfaces.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Raw `audit_logs` table row.
#[derive(Debug, FromRow)]
pub struct AuditLogRow {
    pub id: Uuid,
    pub actor_type: String,
    pub actor_id: String,
    pub action: String,
    pub entity_type: String,
    pub entity_id: Option<String>,
    pub changes: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

/// A single audit log entry as exposed over the API.
///
/// Serialized as camelCase to match the frontend `AuditLog` interface.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLog {
    pub id: String,
    pub actor_type: String,
    pub actor_id: String,
    pub action: String,
    pub entity_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes: Option<serde_json::Value>,
    /// RFC3339 timestamp.
    pub created_at: String,
}

/// Paginated audit log list response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogsResponse {
    pub logs: Vec<AuditLog>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

/// Query params for GET /api/audit-logs.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogQuery {
    pub actor_type: Option<String>,
    pub entity_type: Option<String>,
    pub action: Option<String>,
    /// Inclusive start (ISO 8601). Optional.
    pub start_date: Option<String>,
    /// Exclusive end (ISO 8601). Optional.
    pub end_date: Option<String>,
    /// Max results per page (default 50, clamped to 200).
    pub limit: Option<i64>,
    /// Pagination offset (default 0).
    pub offset: Option<i64>,
}
