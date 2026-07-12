//! Drive-backed resource references attached to Wiki nodes.
//!
//! Files remain owned by Drive. This table stores only logical paths and a
//! broken-link projection, allowing the same file to appear under multiple
//! Wiki nodes without copying document bytes.

use std::collections::HashMap;
use std::path::Path;

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::document_editor::DocumentEditorKind;
use crate::models::knowledge::{
    AttachKnowledgeResourceRequest, KnowledgeResource, KnowledgeResourcesResponse,
};
use crate::services::{document_editor, drive};
use crate::state::AppState;

#[derive(Debug, FromRow)]
struct ResourceRow {
    id: Uuid,
    knowledge_id: Uuid,
    resource_type: String,
    resource_ref: String,
    drive_resource_id: Option<Uuid>,
    title: String,
    sort_order: i32,
    status: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub async fn list_resources(
    state: &AppState,
    knowledge_id: Uuid,
) -> AppResult<KnowledgeResourcesResponse> {
    ensure_knowledge_exists(state, knowledge_id).await?;
    let rows = resource_rows(state, Some(knowledge_id)).await?;
    Ok(KnowledgeResourcesResponse {
        resources: reconcile_rows(state, rows).await?,
    })
}

pub(super) async fn resource_map(
    state: &AppState,
) -> AppResult<HashMap<Uuid, Vec<KnowledgeResource>>> {
    let rows = resource_rows(state, None).await?;
    let resources = reconcile_rows(state, rows).await?;
    let mut map = HashMap::new();
    for resource in resources {
        let knowledge_id = Uuid::parse_str(&resource.knowledge_id).map_err(|err| {
            AppError::Internal(format!("stored knowledge resource id is invalid: {err}"))
        })?;
        map.entry(knowledge_id)
            .or_insert_with(Vec::new)
            .push(resource);
    }
    Ok(map)
}

pub async fn attach_resource(
    state: &AppState,
    knowledge_id: Uuid,
    request: AttachKnowledgeResourceRequest,
) -> AppResult<KnowledgeResource> {
    ensure_knowledge_exists(state, knowledge_id).await?;
    let resource_ref = drive::normalize_logical_drive_path(&request.resource_ref)?;
    let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, &resource_ref)?;
    if !resolved.physical_path.is_file() {
        return Err(AppError::BadRequest(
            "Wiki resources must reference an existing Drive file".to_string(),
        ));
    }
    let editor_kind = document_editor::editor_kind_for_path(&resolved.physical_path);
    if !matches!(
        editor_kind,
        DocumentEditorKind::Markdown
            | DocumentEditorKind::Docx
            | DocumentEditorKind::Xlsx
            | DocumentEditorKind::Pptx
    ) {
        return Err(AppError::BadRequest(
            "Wiki resources support markdown, docx, xlsx, and pptx files".to_string(),
        ));
    }
    let derived_title = resolved
        .physical_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| resource_ref.clone());
    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&derived_title);
    if title.chars().count() > 255 {
        return Err(AppError::BadRequest(
            "resource title must not exceed 255 characters".to_string(),
        ));
    }
    let drive_resource_id =
        crate::services::resource_identity::ensure_existing_resource(state, &resource_ref, "file")
            .await?;
    let mut tx = state.db.begin().await?;
    let existing_id = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM knowledge_resources
           WHERE knowledge_id = $1 AND drive_resource_id = $2
           FOR UPDATE"#,
    )
    .bind(knowledge_id)
    .bind(drive_resource_id)
    .fetch_optional(&mut *tx)
    .await?;
    let row = if let Some(existing_id) = existing_id {
        sqlx::query(
            r#"DELETE FROM knowledge_resources
               WHERE knowledge_id = $1 AND resource_type = 'drive_file'
                 AND resource_ref = $2 AND id <> $3"#,
        )
        .bind(knowledge_id)
        .bind(&resource_ref)
        .bind(existing_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query_as::<_, ResourceRow>(
            r#"UPDATE knowledge_resources
               SET resource_ref = $2, title = $3, sort_order = $4,
                   status = 'linked', broken_at = NULL, updated_at = now()
               WHERE id = $1
               RETURNING id, knowledge_id, resource_type, resource_ref,
                         drive_resource_id, title, sort_order, status,
                         created_at, updated_at"#,
        )
        .bind(existing_id)
        .bind(&resource_ref)
        .bind(title)
        .bind(request.sort_order)
        .fetch_one(&mut *tx)
        .await?
    } else {
        sqlx::query_as::<_, ResourceRow>(
            r#"INSERT INTO knowledge_resources
                 (knowledge_id, resource_type, resource_ref, drive_resource_id,
                  title, sort_order, status, broken_at)
               VALUES ($1, 'drive_file', $2, $3, $4, $5, 'linked', NULL)
               ON CONFLICT (knowledge_id, resource_type, resource_ref) DO UPDATE SET
                 drive_resource_id = EXCLUDED.drive_resource_id,
                 title = EXCLUDED.title,
                 sort_order = EXCLUDED.sort_order,
                 status = 'linked',
                 broken_at = NULL,
                 updated_at = now()
               RETURNING id, knowledge_id, resource_type, resource_ref,
                         drive_resource_id, title, sort_order, status,
                         created_at, updated_at"#,
        )
        .bind(knowledge_id)
        .bind(&resource_ref)
        .bind(drive_resource_id)
        .bind(title)
        .bind(request.sort_order)
        .fetch_one(&mut *tx)
        .await?
    };
    tx.commit().await?;
    Ok(row_to_resource(row))
}

pub async fn detach_resource(
    state: &AppState,
    knowledge_id: Uuid,
    resource_id: Uuid,
) -> AppResult<bool> {
    let deleted =
        sqlx::query("DELETE FROM knowledge_resources WHERE id = $1 AND knowledge_id = $2")
            .bind(resource_id)
            .bind(knowledge_id)
            .execute(&state.db)
            .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "knowledge resource {resource_id} not found"
        )));
    }
    Ok(true)
}

pub async fn mark_drive_path_broken(state: &AppState, path: &str) -> AppResult<()> {
    let path = drive::normalize_logical_drive_path(path)?;
    let prefix = format!("{path}/%");
    sqlx::query(
        r#"UPDATE knowledge_resources
           SET status = 'broken', broken_at = now(), updated_at = now()
           WHERE resource_type = 'drive_file'
             AND (resource_ref = $1 OR resource_ref LIKE $2)"#,
    )
    .bind(path)
    .bind(prefix)
    .execute(&state.db)
    .await?;
    Ok(())
}

pub async fn reconcile_drive_restore(
    state: &AppState,
    original_path: &str,
    restored_path: &str,
) -> AppResult<()> {
    reconcile_drive_move(state, original_path, restored_path).await
}

pub async fn reconcile_drive_move(
    state: &AppState,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    let old_path = drive::normalize_logical_drive_path(old_path)?;
    let new_path = drive::normalize_logical_drive_path(new_path)?;
    let prefix = format!("{old_path}/%");
    let mut tx = state.db.begin().await?;
    let affected = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        r#"SELECT id, knowledge_id, resource_ref FROM knowledge_resources
           WHERE resource_type = 'drive_file'
             AND (resource_ref = $1 OR resource_ref LIKE $2)
           FOR UPDATE"#,
    )
    .bind(&old_path)
    .bind(prefix)
    .fetch_all(&mut *tx)
    .await?;
    for (id, knowledge_id, resource_ref) in affected {
        let suffix = resource_ref
            .strip_prefix(&old_path)
            .ok_or_else(|| AppError::Internal("Drive resource prefix changed".to_string()))?;
        let next_ref = format!("{new_path}{suffix}");
        let duplicate = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id FROM knowledge_resources
               WHERE knowledge_id = $1 AND resource_type = 'drive_file'
                 AND resource_ref = $2 AND id <> $3
               FOR UPDATE"#,
        )
        .bind(knowledge_id)
        .bind(&next_ref)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
        if duplicate.is_some() {
            sqlx::query("DELETE FROM knowledge_resources WHERE id = $1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query(
                r#"UPDATE knowledge_resources
                   SET resource_ref = $2, status = 'linked', broken_at = NULL,
                       updated_at = now()
                   WHERE id = $1"#,
            )
            .bind(id)
            .bind(next_ref)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

async fn ensure_knowledge_exists(state: &AppState, knowledge_id: Uuid) -> AppResult<()> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM knowledge_articles WHERE id = $1)",
    )
    .bind(knowledge_id)
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(AppError::NotFound(format!(
            "knowledge article {knowledge_id} not found"
        )));
    }
    Ok(())
}

async fn resource_rows(
    state: &AppState,
    knowledge_id: Option<Uuid>,
) -> AppResult<Vec<ResourceRow>> {
    Ok(sqlx::query_as::<_, ResourceRow>(
        r#"SELECT id, knowledge_id, resource_type, resource_ref,
                  drive_resource_id, title, sort_order, status,
                  created_at, updated_at
           FROM knowledge_resources
           WHERE ($1::uuid IS NULL OR knowledge_id = $1)
           ORDER BY sort_order, created_at"#,
    )
    .bind(knowledge_id)
    .fetch_all(&state.db)
    .await?)
}

async fn reconcile_rows(
    state: &AppState,
    rows: Vec<ResourceRow>,
) -> AppResult<Vec<KnowledgeResource>> {
    let mut resources = Vec::with_capacity(rows.len());
    for mut row in rows {
        let stored_ref = row.resource_ref.clone();
        let stored_resource_id = row.drive_resource_id;
        let projection = if let Some(resource_id) = row.drive_resource_id {
            sqlx::query_as::<_, (String, Option<String>)>(
                "SELECT lifecycle_state, current_path FROM drive_resources WHERE id = $1",
            )
            .bind(resource_id)
            .fetch_optional(&state.db)
            .await?
        } else {
            None
        };
        if let Some((lifecycle, Some(current_path))) = projection.as_ref() {
            if lifecycle == "active" && row.resource_ref != *current_path {
                row.resource_ref = current_path.clone();
            }
        }
        let linked = projection
            .as_ref()
            .is_some_and(|(lifecycle, current_path)| {
                lifecycle == "active"
                    && current_path.as_deref().is_some_and(|path| {
                        drive::resolve_drive_path(&state.config.agent_data_dir, path)
                            .is_ok_and(|resolved| resolved.physical_path.is_file())
                    })
            })
            || (row.drive_resource_id.is_none()
                && drive::resolve_drive_path(&state.config.agent_data_dir, &row.resource_ref)
                    .is_ok_and(|resolved| resolved.physical_path.is_file()));
        if linked && row.drive_resource_id.is_none() {
            row.drive_resource_id = Some(
                crate::services::resource_identity::ensure_existing_resource(
                    state,
                    &row.resource_ref,
                    "file",
                )
                .await?,
            );
        }
        let next_status = if linked { "linked" } else { "broken" };
        if row.status != next_status
            || stored_ref != row.resource_ref
            || stored_resource_id != row.drive_resource_id
        {
            sqlx::query(
                r#"UPDATE knowledge_resources
                   SET resource_ref = $2, drive_resource_id = $3, status = $4,
                       broken_at = CASE WHEN $4 = 'broken' THEN COALESCE(broken_at, now()) ELSE NULL END,
                       updated_at = now()
                   WHERE id = $1"#,
            )
            .bind(row.id)
            .bind(&row.resource_ref)
            .bind(row.drive_resource_id)
            .bind(next_status)
            .execute(&state.db)
            .await?;
            row.status = next_status.to_string();
            row.updated_at = Utc::now();
        }
        resources.push(row_to_resource(row));
    }
    Ok(resources)
}

fn row_to_resource(row: ResourceRow) -> KnowledgeResource {
    KnowledgeResource {
        id: row.id.to_string(),
        knowledge_id: row.knowledge_id.to_string(),
        drive_resource_id: row.drive_resource_id.map(|id| id.to_string()),
        resource_type: row.resource_type,
        editor_kind: document_editor::editor_kind_for_path(Path::new(&row.resource_ref)),
        resource_ref: row.resource_ref,
        title: row.title,
        sort_order: row.sort_order,
        status: row.status,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}
