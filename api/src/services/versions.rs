//! Version history domain operations.
//!
//! Versions are full JSONB snapshots of an entity captured at checkpoints.
//! The `maybe_create_version()` helper applies a 5-minute coalescing window
//! so the 800ms-debounced note autosave does not flood the version table.
//! `create_version_checkpoint()` is the force variant used by create/restore
//! flows where a checkpoint is always required.

use std::time::Duration;

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::knowledge::KnowledgeArticle;
use crate::models::note::Note;
use crate::models::version::{
    EntityVersion, EntityVersionResponse, EntityVersionSummary, EntityVersionsResponse,
    RestoreVersionRequest, RestoreVersionResponse, VersionQuery,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

#[derive(Debug, FromRow)]
struct RestoredNoteRow {
    id: Uuid,
    project_id: Option<Uuid>,
    title: String,
    content: String,
    tags: Vec<String>,
    pinned: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

/// Coalescing window: skip creating a new checkpoint if the most recent
/// version for this entity is younger than this. Keeps the 800ms autosave
/// from generating a version per keystroke-batch.
const COALESCE_WINDOW: Duration = Duration::from_secs(5 * 60);

/// Hard cap on the number of versions retained per entity. When exceeded,
/// the oldest versions are pruned.
const MAX_VERSIONS_PER_ENTITY: i64 = 50;

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

/// POST /api/versions/{versionId}/restore
///
/// Restores an entity to the state captured in the given version. For note
/// entities the flow is:
///   1. Back up the current note state as a new version.
///   2. Apply the target snapshot to the note row.
///   3. Record the restored state as a new version.
///
/// An audit log entry is written after the operation completes.
pub async fn restore_version(
    state: &AppState,
    version_id: Uuid,
    req: RestoreVersionRequest,
) -> AppResult<RestoreVersionResponse> {
    let actor_type = req.actor_type.as_deref().unwrap_or("user");
    let actor_label = req.actor_label.as_deref();
    validate_actor_type(actor_type)?;

    // Fetch the target version snapshot.
    let target = sqlx::query!(
        r#"SELECT entity_type, entity_id, version_num, snapshot
           FROM entity_versions WHERE id = $1"#,
        version_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("version {version_id} not found")))?;

    if target.entity_type != "note" && target.entity_type != "knowledge_article" {
        return Err(AppError::BadRequest(format!(
            "restore for entity type '{}' is not supported",
            target.entity_type
        )));
    }

    match target.entity_type.as_str() {
        "note" => {
            restore_note(
                state,
                version_id,
                target.version_num,
                target.entity_id,
                target.snapshot,
                actor_type,
                actor_label,
            )
            .await
        }
        "knowledge_article" => {
            restore_knowledge_article(
                state,
                version_id,
                target.version_num,
                target.entity_id,
                target.snapshot,
                actor_type,
                actor_label,
            )
            .await
        }
        other => Err(AppError::BadRequest(format!(
            "restore for entity type '{other}' is not supported"
        ))),
    }
}

/// Restore a note from a version snapshot.
async fn restore_note(
    state: &AppState,
    version_id: Uuid,
    target_num: i32,
    note_id: Uuid,
    snapshot: serde_json::Value,
    actor_type: &str,
    actor_label: Option<&str>,
) -> AppResult<RestoreVersionResponse> {
    let note_id_str = note_id.to_string();
    let target_num_owned = target_num;

    // 1. Read the current note (to back it up before overwriting).
    let current = sqlx::query!(
        r#"SELECT id, project_id, title, content, tags, pinned
           FROM notes WHERE id = $1"#,
        note_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("note {note_id} not found")))?;

    let current_snapshot = serde_json::json!({
        "title": current.title,
        "content": current.content,
        "tags": current.tags,
        "pinned": current.pinned,
        "projectId": current.project_id.map(|u| u.to_string()),
    });

    // 2. Back up the current state as a checkpoint.
    create_version_checkpoint(
        &state.db,
        "note",
        note_id,
        &current_snapshot,
        actor_type,
        actor_label,
        &format!("Before restore to v{target_num_owned}"),
    )
    .await?;

    // 3. Parse the target snapshot and apply it to the note row.
    let title = snapshot["title"].as_str().unwrap_or("").to_string();
    let content = snapshot["content"].as_str().unwrap_or("").to_string();
    let tags: Vec<String> = snapshot["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let pinned = snapshot["pinned"].as_bool().unwrap_or(false);
    let project_uuid = snapshot["projectId"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok());

    sqlx::query!(
        r#"UPDATE notes SET
             project_id = $2,
             title = $3,
             content = $4,
             tags = $5,
             pinned = $6,
             updated_at = now()
           WHERE id = $1"#,
        note_id,
        project_uuid,
        title,
        content,
        &tags as &[String],
        pinned,
    )
    .execute(&state.db)
    .await?;

    // 4. Re-read the restored note to build an accurate snapshot + response.
    let restored_row = sqlx::query_as!(
        RestoredNoteRow,
        r#"SELECT id, project_id, title, content, tags, pinned,
                  created_at, updated_at
           FROM notes WHERE id = $1"#,
        note_id,
    )
    .fetch_one(&state.db)
    .await?;

    let restored_note = Note {
        id: restored_row.id.to_string(),
        project_id: restored_row.project_id.map(|u| u.to_string()),
        title: restored_row.title,
        content: restored_row.content,
        tags: restored_row.tags,
        pinned: restored_row.pinned,
        created_at: restored_row.created_at.to_rfc3339(),
        updated_at: restored_row.updated_at.to_rfc3339(),
    };

    // 5. Record the restored state as a new checkpoint.
    let restored_snapshot = note_to_snapshot(&restored_note);
    let restored_version = create_version_checkpoint(
        &state.db,
        "note",
        note_id,
        &restored_snapshot,
        actor_type,
        actor_label,
        &format!("Restored from v{target_num_owned}"),
    )
    .await?;

    // Audit log (fire-and-forget).
    log_audit_safe(
        &state.db,
        actor_type,
        actor_label.unwrap_or("user"),
        "update",
        "note",
        Some(&note_id_str),
        Some(serde_json::json!({
            "restoredFromVersion": version_id.to_string(),
            "targetVersionNum": target_num_owned,
        })),
    )
    .await;

    Ok(RestoreVersionResponse {
        note: Some(restored_note),
        article: None,
        version: restored_version,
    })
}

/// Restore a knowledge article from a version snapshot.
async fn restore_knowledge_article(
    state: &AppState,
    version_id: Uuid,
    target_num: i32,
    article_id: Uuid,
    snapshot: serde_json::Value,
    actor_type: &str,
    actor_label: Option<&str>,
) -> AppResult<RestoreVersionResponse> {
    let article_id_str = article_id.to_string();

    // 1. Read the current article (to back it up before overwriting).
    let current = sqlx::query!(
        r#"SELECT id, parent_id, project_id, node_type, title, slug, content,
                  excerpt, tags, status, sort_order
           FROM knowledge_articles WHERE id = $1"#,
        article_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("knowledge article {article_id} not found")))?;

    let current_snapshot = serde_json::json!({
        "title": current.title,
        "slug": current.slug,
        "content": current.content,
        "excerpt": current.excerpt,
        "tags": current.tags,
        "status": current.status,
        "nodeType": current.node_type,
        "parentId": current.parent_id.map(|u| u.to_string()),
        "projectId": current.project_id.map(|u| u.to_string()),
        "sortOrder": current.sort_order,
    });

    // 2. Back up the current state as a checkpoint.
    create_version_checkpoint(
        &state.db,
        "knowledge_article",
        article_id,
        &current_snapshot,
        actor_type,
        actor_label,
        &format!("Before restore to v{target_num}"),
    )
    .await?;

    // 3. Parse the target snapshot and apply it to the article row.
    let title = snapshot["title"].as_str().unwrap_or("").to_string();
    let slug = snapshot["slug"].as_str().unwrap_or("").to_string();
    let content = snapshot["content"].as_str().unwrap_or("").to_string();
    let excerpt = snapshot["excerpt"].as_str().unwrap_or("").to_string();
    let tags: Vec<String> = snapshot["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let status = snapshot["status"].as_str().unwrap_or("draft").to_string();
    let node_type = snapshot["nodeType"]
        .as_str()
        .unwrap_or("article")
        .to_string();
    let sort_order = snapshot["sortOrder"].as_i64().unwrap_or(0) as i32;
    let parent_uuid = snapshot["parentId"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok());
    let project_uuid = snapshot["projectId"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok());

    sqlx::query!(
        r#"UPDATE knowledge_articles SET
             parent_id = $2,
             project_id = $3,
             node_type = $4,
             title = $5,
             slug = $6,
             content = $7,
             excerpt = $8,
             tags = $9,
             status = $10,
             sort_order = $11,
             updated_at = now()
           WHERE id = $1"#,
        article_id,
        parent_uuid,
        project_uuid,
        node_type,
        title,
        slug,
        content,
        excerpt,
        &tags as &[String],
        status,
        sort_order,
    )
    .execute(&state.db)
    .await?;

    // 4. Re-read the restored article.
    let restored_article = fetch_knowledge_article_for_restore(&state.db, article_id).await?;

    // 5. Record the restored state as a new checkpoint.
    let restored_snapshot = knowledge_article_to_snapshot(&restored_article);
    let restored_version = create_version_checkpoint(
        &state.db,
        "knowledge_article",
        article_id,
        &restored_snapshot,
        actor_type,
        actor_label,
        &format!("Restored from v{target_num}"),
    )
    .await?;

    // Audit log (fire-and-forget).
    log_audit_safe(
        &state.db,
        actor_type,
        actor_label.unwrap_or("user"),
        "update",
        "knowledge_article",
        Some(&article_id_str),
        Some(serde_json::json!({
            "restoredFromVersion": version_id.to_string(),
            "targetVersionNum": target_num,
        })),
    )
    .await;

    Ok(RestoreVersionResponse {
        note: None,
        article: Some(restored_article),
        version: restored_version,
    })
}

// ---- checkpoint helpers (reusable by notes.rs) ----

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
    // Most recent checkpoint for this entity.
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
            // Within the coalescing window — skip this checkpoint.
            return Ok(None);
        }
    }

    let v = create_version_checkpoint(
        db,
        entity_type,
        entity_id,
        snapshot,
        actor_type,
        actor_label,
        change_summary,
    )
    .await?;
    Ok(Some(v))
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

    // Prune overflow (keep the newest N).
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

/// Build a JSONB snapshot of a note's editable state.
pub fn note_to_snapshot(note: &Note) -> serde_json::Value {
    serde_json::json!({
        "title": note.title,
        "content": note.content,
        "tags": note.tags,
        "pinned": note.pinned,
        "projectId": note.project_id,
    })
}

/// Build a JSONB snapshot of a knowledge article's editable state.
pub fn knowledge_article_to_snapshot(article: &KnowledgeArticle) -> serde_json::Value {
    serde_json::json!({
        "title": article.title,
        "slug": article.slug,
        "content": article.content,
        "excerpt": article.excerpt,
        "tags": article.tags,
        "status": article.status,
        "nodeType": article.node_type,
        "parentId": article.parent_id,
        "projectId": article.project_id,
        "sortOrder": article.sort_order,
    })
}

/// Compare two note states and produce a human-readable change summary
/// (e.g. "Changed: title, tags").
pub fn compute_note_change_summary(old: &Note, new: &Note) -> String {
    let mut changes = Vec::new();
    if old.title != new.title {
        changes.push("title");
    }
    if old.content != new.content {
        changes.push("content");
    }
    if old.tags != new.tags {
        changes.push("tags");
    }
    if old.pinned != new.pinned {
        changes.push("pinned");
    }
    if changes.is_empty() {
        "No changes".to_string()
    } else {
        format!("Changed: {}", changes.join(", "))
    }
}

/// Compare two knowledge article states and produce a human-readable change
/// summary.
pub fn compute_knowledge_article_change_summary(
    old: &KnowledgeArticle,
    new: &KnowledgeArticle,
) -> String {
    let mut changes = Vec::new();
    if old.title != new.title {
        changes.push("title");
    }
    if old.content != new.content {
        changes.push("content");
    }
    if old.tags != new.tags {
        changes.push("tags");
    }
    if old.slug != new.slug {
        changes.push("slug");
    }
    if old.excerpt != new.excerpt {
        changes.push("excerpt");
    }
    if old.status != new.status {
        changes.push("status");
    }
    if old.node_type != new.node_type {
        changes.push("nodeType");
    }
    if old.parent_id != new.parent_id {
        changes.push("parentId");
    }
    if changes.is_empty() {
        "No changes".to_string()
    } else {
        format!("Changed: {}", changes.join(", "))
    }
}

// ---- internal helpers ----

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

fn validate_entity_type(t: &str) -> AppResult<()> {
    if matches!(t, "note" | "task" | "knowledge_article") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid entityType: {t}")))
    }
}

fn validate_actor_type(t: &str) -> AppResult<()> {
    if matches!(t, "user" | "agent" | "system") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid actorType: {t}")))
    }
}

fn parse_uuid(s: &str, field: &str) -> AppResult<Uuid> {
    Uuid::parse_str(s).map_err(|e| AppError::BadRequest(format!("invalid {field}: {e}")))
}

/// Fetch a knowledge article by id for the restore flow. Returns a full
/// `KnowledgeArticle` model (Uuid/timestamps → String).
async fn fetch_knowledge_article_for_restore(db: &PgPool, id: Uuid) -> AppResult<KnowledgeArticle> {
    #[derive(FromRow)]
    struct Row {
        id: Uuid,
        parent_id: Option<Uuid>,
        project_id: Option<Uuid>,
        node_type: String,
        title: String,
        slug: String,
        content: String,
        excerpt: String,
        tags: Vec<String>,
        status: String,
        sort_order: i32,
        created_at: DateTime<Utc>,
        updated_at: DateTime<Utc>,
    }

    let row = sqlx::query_as!(
        Row,
        r#"SELECT id, parent_id, project_id, node_type, title, slug, content,
                  excerpt, tags, status, sort_order, created_at, updated_at
           FROM knowledge_articles WHERE id = $1"#,
        id,
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("knowledge article {id} not found")))?;

    Ok(KnowledgeArticle {
        id: row.id.to_string(),
        parent_id: row.parent_id.map(|u| u.to_string()),
        project_id: row.project_id.map(|u| u.to_string()),
        node_type: row.node_type,
        title: row.title,
        slug: row.slug,
        content: row.content,
        excerpt: row.excerpt,
        tags: row.tags,
        status: row.status,
        sort_order: row.sort_order,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    })
}
