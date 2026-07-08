//! Version history domain operations.
//!
//! Versions are full JSONB snapshots of an entity captured at checkpoints.
//! Checkpoint creation, restore flows, and entity snapshot helpers live in
//! focused submodules so callers can use a stable service facade without
//! carrying the storage details for every versioned entity.

use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::version::{
    EntityVersion, EntityVersionResponse, EntityVersionSummary, EntityVersionsResponse,
    VersionQuery,
};
use crate::state::AppState;

mod checkpoints;
mod restore;
mod snapshots;
mod validation;

pub use checkpoints::{create_version_checkpoint, delete_entity_versions, maybe_create_version};
pub use restore::restore_version;
pub use snapshots::{
    compute_knowledge_article_change_summary, compute_note_change_summary,
    knowledge_article_to_snapshot, note_to_snapshot,
};

use validation::{parse_uuid, validate_entity_type};

/// GET /api/versions?entityType=note&entityId={id}
///
/// Returns version summaries (no snapshot) newest-first.
pub async fn list_versions(state: &AppState, q: VersionQuery) -> AppResult<EntityVersionsResponse> {
    validate_entity_type(&q.entity_type)?;
    let entity_id = parse_uuid(&q.entity_id, "entityId")?;

    let rows = sqlx::query!(
        r#"SELECT id, version_num, actor_type, actor_label, change_summary, created_at
           FROM entity_versions
           WHERE entity_type = $1 AND entity_id = $2
           ORDER BY version_num DESC"#,
        q.entity_type,
        entity_id,
    )
    .fetch_all(&state.db)
    .await?;

    let entity_id_str = entity_id.to_string();
    let entity_type = q.entity_type;
    let versions = rows
        .into_iter()
        .map(|r| EntityVersionSummary {
            id: r.id.to_string(),
            entity_type: entity_type.clone(),
            entity_id: entity_id_str.clone(),
            version_num: r.version_num,
            actor_type: r.actor_type,
            actor_label: r.actor_label,
            change_summary: r.change_summary,
            created_at: r.created_at.to_rfc3339(),
        })
        .collect();
    Ok(EntityVersionsResponse { versions })
}

/// GET /api/versions/{versionId}
///
/// Returns a single version including its full JSONB snapshot.
pub async fn get_version(state: &AppState, version_id: Uuid) -> AppResult<EntityVersionResponse> {
    let row = sqlx::query!(
        r#"SELECT id, entity_type, entity_id, version_num, snapshot,
                  actor_type, actor_label, change_summary, snapshot_size,
                  created_at
           FROM entity_versions
           WHERE id = $1"#,
        version_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("version {version_id} not found")))?;

    Ok(EntityVersionResponse {
        version: EntityVersion {
            id: row.id.to_string(),
            entity_type: row.entity_type,
            entity_id: row.entity_id.to_string(),
            version_num: row.version_num,
            snapshot: row.snapshot,
            actor_type: row.actor_type,
            actor_label: row.actor_label,
            change_summary: row.change_summary,
            snapshot_size: row.snapshot_size,
            created_at: row.created_at.to_rfc3339(),
        },
    })
}
