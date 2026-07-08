use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::knowledge::KnowledgeArticle;
use crate::models::note::Note;
use crate::models::version::{RestoreVersionRequest, RestoreVersionResponse};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

use super::checkpoints::create_version_checkpoint;
use super::snapshots::{knowledge_article_to_snapshot, note_to_snapshot};
use super::validation::validate_actor_type;

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

/// POST /api/versions/{versionId}/restore
///
/// Restores an entity to the state captured in the given version. Restore
/// handlers first checkpoint the current state, apply the target snapshot,
/// then checkpoint the restored state for auditability.
pub async fn restore_version(
    state: &AppState,
    version_id: Uuid,
    req: RestoreVersionRequest,
) -> AppResult<RestoreVersionResponse> {
    let actor_type = req.actor_type.as_deref().unwrap_or("user");
    let actor_label = req.actor_label.as_deref();
    validate_actor_type(actor_type)?;

    let target = sqlx::query!(
        r#"SELECT entity_type, entity_id, version_num, snapshot
           FROM entity_versions WHERE id = $1"#,
        version_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("version {version_id} not found")))?;

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

    create_version_checkpoint(
        &state.db,
        "note",
        note_id,
        &current_snapshot,
        actor_type,
        actor_label,
        &format!("Before restore to v{target_num}"),
    )
    .await?;

    let title = snapshot["title"].as_str().unwrap_or("").to_string();
    let content = snapshot["content"].as_str().unwrap_or("").to_string();
    let tags: Vec<String> = snapshot["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|value| value.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let pinned = snapshot["pinned"].as_bool().unwrap_or(false);
    let project_uuid = snapshot["projectId"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok());

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

    let restored_snapshot = note_to_snapshot(&restored_note);
    let restored_version = create_version_checkpoint(
        &state.db,
        "note",
        note_id,
        &restored_snapshot,
        actor_type,
        actor_label,
        &format!("Restored from v{target_num}"),
    )
    .await?;

    log_audit_safe(
        &state.db,
        actor_type,
        actor_label.unwrap_or("user"),
        "update",
        "note",
        Some(&note_id_str),
        Some(serde_json::json!({
            "restoredFromVersion": version_id.to_string(),
            "targetVersionNum": target_num,
        })),
    )
    .await;

    Ok(RestoreVersionResponse {
        note: Some(restored_note),
        article: None,
        version: restored_version,
    })
}

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

    let title = snapshot["title"].as_str().unwrap_or("").to_string();
    let slug = snapshot["slug"].as_str().unwrap_or("").to_string();
    let content = snapshot["content"].as_str().unwrap_or("").to_string();
    let excerpt = snapshot["excerpt"].as_str().unwrap_or("").to_string();
    let tags: Vec<String> = snapshot["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|value| value.as_str().map(String::from))
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
        .and_then(|value| Uuid::parse_str(value).ok());
    let project_uuid = snapshot["projectId"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok());

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

    let restored_article = fetch_knowledge_article_for_restore(&state.db, article_id).await?;

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

/// Fetch a knowledge article by id for the restore flow. Returns a full
/// `KnowledgeArticle` model (Uuid/timestamps -> String).
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
