use std::time::Duration;

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::version::EntityVersionSummary;

/// Coalescing window: skip creating a new checkpoint if the most recent
/// version for this entity is younger than this. Keeps autosave flows from
/// generating a version per keystroke batch.
const COALESCE_WINDOW: Duration = Duration::from_secs(5 * 60);

/// Hard cap on the number of versions retained per entity. When exceeded,
/// the oldest versions are pruned.
const MAX_VERSIONS_PER_ENTITY: i64 = 50;

/// Conditionally create a version checkpoint, honoring the coalescing window.
///
/// Called after every successful entity UPDATE. If the most recent version
/// for this entity is younger than [`COALESCE_WINDOW`], the checkpoint is
/// skipped (returns `Ok(None)`). Otherwise a new checkpoint is inserted and
/// overflow is pruned.
///
/// Use [`create_version_checkpoint`] when a checkpoint must always be
/// recorded (e.g. entity creation, restore).
pub async fn maybe_create_version(
    db: &PgPool,
    entity_type: &str,
    entity_id: Uuid,
    snapshot: &serde_json::Value,
    actor_type: &str,
    actor_label: Option<&str>,
    change_summary: &str,
) -> AppResult<Option<EntityVersionSummary>> {
    let last = sqlx::query!(
        r#"SELECT created_at FROM entity_versions
           WHERE entity_type = $1 AND entity_id = $2
           ORDER BY created_at DESC LIMIT 1"#,
        entity_type,
        entity_id,
    )
    .fetch_optional(db)
    .await?;

    if let Some(row) = last {
        let age = chrono::Utc::now() - row.created_at;
        if age < chrono::Duration::from_std(COALESCE_WINDOW).unwrap_or_default() {
            return Ok(None);
        }
    }

    let version = create_version_checkpoint(
        db,
        entity_type,
        entity_id,
        snapshot,
        actor_type,
        actor_label,
        change_summary,
    )
    .await?;
    Ok(Some(version))
}

/// Unconditionally insert a new version checkpoint and prune overflow.
///
/// Allocates the next `version_num` (MAX + 1), stores the snapshot, and
/// trims to [`MAX_VERSIONS_PER_ENTITY`].
pub async fn create_version_checkpoint(
    db: &PgPool,
    entity_type: &str,
    entity_id: Uuid,
    snapshot: &serde_json::Value,
    actor_type: &str,
    actor_label: Option<&str>,
    change_summary: &str,
) -> AppResult<EntityVersionSummary> {
    let snapshot_size = snapshot.to_string().len() as i32;

    let row = sqlx::query!(
        r#"WITH next_num AS (
               SELECT COALESCE(MAX(version_num), 0) + 1 AS n
               FROM entity_versions
               WHERE entity_type = $1 AND entity_id = $2
           )
           INSERT INTO entity_versions
             (entity_type, entity_id, version_num, snapshot, actor_type,
              actor_label, change_summary, snapshot_size)
           SELECT $1, $2, n, $3, $4, $5, $6, $7 FROM next_num
           RETURNING id, version_num, actor_type, actor_label,
                     change_summary, created_at"#,
        entity_type,
        entity_id,
        snapshot,
        actor_type,
        actor_label,
        change_summary,
        snapshot_size,
    )
    .fetch_one(db)
    .await?;

    prune_versions(db, entity_type, entity_id).await?;

    Ok(EntityVersionSummary {
        id: row.id.to_string(),
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
        version_num: row.version_num,
        actor_type: row.actor_type,
        actor_label: row.actor_label,
        change_summary: row.change_summary,
        created_at: row.created_at.to_rfc3339(),
    })
}

/// Delete the note's versions (application-level cascade). Called by
/// `delete_note` since `entity_id` is intentionally not a FK.
pub async fn delete_entity_versions(
    db: &PgPool,
    entity_type: &str,
    entity_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM entity_versions
           WHERE entity_type = $1 AND entity_id = $2"#,
        entity_type,
        entity_id,
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Delete the oldest versions beyond [`MAX_VERSIONS_PER_ENTITY`] for an
/// entity.
async fn prune_versions(
    db: &PgPool,
    entity_type: &str,
    entity_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM entity_versions
           WHERE entity_type = $1 AND entity_id = $2 AND id IN (
               SELECT id FROM entity_versions
               WHERE entity_type = $1 AND entity_id = $2
               ORDER BY version_num DESC
               OFFSET $3
           )"#,
        entity_type,
        entity_id,
        MAX_VERSIONS_PER_ENTITY,
    )
    .execute(db)
    .await?;
    Ok(())
}
