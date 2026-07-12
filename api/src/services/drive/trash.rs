use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::drive::{
    DriveEntryKind, DriveMutationResponse, DriveRestoreResponse, DriveTrashEntry, DriveTrashQuery,
    DriveTrashResponse,
};
use crate::services::resource_identity::{self, ResourceActor, TrashProjection};
use crate::state::AppState;

use super::paths::{
    canonical_or_create, drive_root, logical_child_path, logical_parent_path,
    normalize_logical_drive_path, resolve_drive_path, ResolvedDrivePath, DRIVE_PREFIX,
};
use super::sync::enqueue_s3_sync_job_for_resource;
use super::workspace::ensure_drive_root;

#[derive(Debug, FromRow)]
struct DriveTrashRow {
    id: Uuid,
    original_path: String,
    trash_path: String,
    kind: String,
    size_bytes: i64,
    deleted_at: DateTime<Utc>,
    resource_id: Option<Uuid>,
    operation_id: Option<Uuid>,
    lifecycle_revision: Option<i64>,
    restored_at: Option<DateTime<Utc>>,
    purged_at: Option<DateTime<Utc>>,
}

const DEFAULT_TRASH_PAGE_SIZE: i64 = 50;
const MAX_TRASH_PAGE_SIZE: i64 = 100;

pub async fn delete_path(
    state: &AppState,
    logical_path: &str,
    operation_key: Option<&str>,
    expected_lifecycle_revision: Option<&str>,
) -> AppResult<()> {
    delete_path_with_actor(
        state,
        logical_path,
        operation_key,
        expected_lifecycle_revision,
        ResourceActor::user(),
    )
    .await
}

pub async fn delete_path_with_actor(
    state: &AppState,
    logical_path: &str,
    operation_key: Option<&str>,
    expected_lifecycle_revision: Option<&str>,
    actor: ResourceActor,
) -> AppResult<()> {
    let _namespace_guard = state.drive_namespace_lock().write().await;
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    if resolved.logical_path == DRIVE_PREFIX {
        return Err(AppError::BadRequest("Cannot delete the Drive root".into()));
    }
    if !resolved.physical_path.exists() {
        return Ok(());
    }

    let trash_root = drive_root(&state.config.agent_data_dir).join(".trash");
    fs::create_dir_all(&trash_root)?;
    let safe_name = resolved
        .physical_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "drive-entry".to_string());
    let metadata = fs::metadata(&resolved.physical_path)?;
    let kind = if metadata.is_dir() {
        DriveEntryKind::Directory
    } else {
        DriveEntryKind::File
    };
    let resource_id = resource_identity::ensure_existing_resource(
        state,
        &resolved.logical_path,
        if metadata.is_dir() {
            "directory"
        } else {
            "file"
        },
    )
    .await?;
    let operation_key = operation_key
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let prepared = resource_identity::prepare_lifecycle_operation(
        state,
        resource_identity::PrepareLifecycleOperation {
            operation_key: &operation_key,
            operation_kind: "trash",
            known_resource_id: Some(resource_id),
            logical_path: &resolved.logical_path,
            requested_reference: None,
            expected_revision: expected_lifecycle_revision,
            actor: &actor,
            resource_kind: entry_kind_to_str(kind),
            trash_entry_id: None,
        },
    )
    .await?;
    if prepared.state == "completed" {
        return Ok(());
    }
    let trash_id = prepared.operation_id;
    let target = trash_root.join(trash_id.to_string()).join(&safe_name);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let original_path = resolved.logical_path.clone();
    if prepared.state == "prepared" {
        fs::rename(&resolved.physical_path, &target)?;
    } else if !target.exists() || resolved.physical_path.exists() {
        return Err(AppError::Conflict(
            "trash operation filesystem state requires reconciliation".to_string(),
        ));
    }
    let trash_path = format!("/drive/.trash/{trash_id}/{safe_name}");
    let kind_str = entry_kind_to_str(kind);
    let size_bytes = if metadata.is_file() {
        metadata.len() as i64
    } else {
        0
    };
    resource_identity::mark_filesystem_committed(
        state,
        prepared.operation_id,
        &trash_path,
        "lifecycle:filesystem_committed",
    )
    .await?;
    let resource_sequence = resource_identity::project_lifecycle_commit(
        state,
        &prepared,
        "trashed",
        "trashed",
        None,
        &actor,
        Some(&TrashProjection::Created {
            id: trash_id,
            original_path: original_path.clone(),
            trash_path: trash_path.clone(),
            kind: kind_str.to_string(),
            size_bytes,
        }),
    )
    .await?;
    if let Err(error) = enqueue_s3_sync_job_for_resource(
        state,
        &original_path,
        "delete",
        Some(prepared.resource_id),
        Some(resource_sequence),
    )
    .await
    {
        tracing::error!(operation_id = %prepared.operation_id, error = %error, "Drive trash committed; sync enqueue failed");
    }
    if let Err(err) =
        crate::services::knowledge::mark_drive_path_broken(state, &original_path).await
    {
        tracing::warn!(error = %err, path = %original_path, "failed to project broken Wiki resource link");
    }
    Ok(())
}

#[cfg(any(test, feature = "release-harness"))]
pub async fn list_trash(state: &AppState) -> AppResult<DriveTrashResponse> {
    list_trash_page(
        state,
        DriveTrashQuery {
            cursor: None,
            limit: Some(DEFAULT_TRASH_PAGE_SIZE),
        },
    )
    .await
}

pub async fn list_trash_page(
    state: &AppState,
    query: DriveTrashQuery,
) -> AppResult<DriveTrashResponse> {
    let limit = query
        .limit
        .unwrap_or(DEFAULT_TRASH_PAGE_SIZE)
        .clamp(1, MAX_TRASH_PAGE_SIZE);
    let cursor = query
        .cursor
        .as_deref()
        .map(decode_trash_cursor)
        .transpose()?;
    let (cursor_time, cursor_id) = cursor
        .map(|value| (Some(value.0), Some(value.1)))
        .unwrap_or((None, None));
    let mut rows = sqlx::query_as::<_, DriveTrashRow>(
        r#"SELECT id, original_path, trash_path, kind, size_bytes, deleted_at,
                  resource_id, operation_id,
                  (SELECT lifecycle_revision FROM drive_resources WHERE id = drive_trash_entries.resource_id) AS lifecycle_revision,
                  restored_at, purged_at
           FROM drive_trash_entries
           WHERE restored_at IS NULL AND purged_at IS NULL
             AND ($1::timestamptz IS NULL OR (deleted_at, id) < ($1, $2))
           ORDER BY deleted_at DESC, id DESC
           LIMIT $3"#,
    )
    .bind(cursor_time)
    .bind(cursor_id)
    .bind(limit + 1)
    .fetch_all(&state.db)
    .await?;

    let has_more = rows.len() > limit as usize;
    if has_more {
        rows.pop();
    }
    let next_cursor = if has_more {
        rows.last()
            .map(|row| encode_trash_cursor(row.deleted_at, row.id))
    } else {
        None
    };
    let total_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM drive_trash_entries WHERE restored_at IS NULL AND purged_at IS NULL",
    )
    .fetch_one(&state.db)
    .await?;

    Ok(DriveTrashResponse {
        entries: rows.into_iter().map(row_to_trash_entry).collect(),
        next_cursor,
        total_count,
    })
}

fn encode_trash_cursor(deleted_at: DateTime<Utc>, id: Uuid) -> String {
    URL_SAFE_NO_PAD.encode(format!("{}|{}", deleted_at.to_rfc3339(), id))
}

fn decode_trash_cursor(value: &str) -> AppResult<(DateTime<Utc>, Uuid)> {
    if value.len() > 256 {
        return Err(AppError::BadRequest("invalid Trash cursor".to_string()));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| AppError::BadRequest("invalid Trash cursor".to_string()))?;
    let decoded = String::from_utf8(bytes)
        .map_err(|_| AppError::BadRequest("invalid Trash cursor".to_string()))?;
    let (time, id) = decoded
        .split_once('|')
        .ok_or_else(|| AppError::BadRequest("invalid Trash cursor".to_string()))?;
    let deleted_at = DateTime::parse_from_rfc3339(time)
        .map_err(|_| AppError::BadRequest("invalid Trash cursor".to_string()))?
        .with_timezone(&Utc);
    let id = Uuid::parse_str(id)
        .map_err(|_| AppError::BadRequest("invalid Trash cursor".to_string()))?;
    Ok((deleted_at, id))
}

pub async fn restore_trash(
    state: &AppState,
    id: Uuid,
    operation_key: Option<&str>,
    expected_lifecycle_revision: Option<&str>,
) -> AppResult<DriveRestoreResponse> {
    restore_trash_with_actor(
        state,
        id,
        operation_key,
        expected_lifecycle_revision,
        ResourceActor::user(),
    )
    .await
}

pub async fn restore_trash_with_actor(
    state: &AppState,
    id: Uuid,
    operation_key: Option<&str>,
    expected_lifecycle_revision: Option<&str>,
    actor: ResourceActor,
) -> AppResult<DriveRestoreResponse> {
    let _namespace_guard = state.drive_namespace_lock().write().await;
    ensure_drive_root(state)?;
    let row = sqlx::query_as!(
        DriveTrashRow,
        r#"SELECT id, original_path, trash_path, kind, size_bytes, deleted_at,
                  resource_id, operation_id,
                  (SELECT lifecycle_revision FROM drive_resources WHERE id = drive_trash_entries.resource_id) AS lifecycle_revision,
                  restored_at, purged_at
           FROM drive_trash_entries
           WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("trash entry {id} not found")))?;
    let resource_id = row.resource_id.ok_or_else(|| {
        AppError::Conflict(
            "trash entry identity is unresolved; reconcile it before restore".to_string(),
        )
    })?;
    let operation_key = operation_key
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let prepared = resource_identity::prepare_lifecycle_operation(
        state,
        resource_identity::PrepareLifecycleOperation {
            operation_key: &operation_key,
            operation_kind: "restore",
            known_resource_id: Some(resource_id),
            logical_path: &row.original_path,
            requested_reference: None,
            expected_revision: expected_lifecycle_revision,
            actor: &actor,
            resource_kind: &row.kind,
            trash_entry_id: Some(id),
        },
    )
    .await?;

    if prepared.state == "completed" {
        let status = resource_identity::operation_status(state, prepared.operation_id).await?;
        return Ok(DriveRestoreResponse {
            success: true,
            restored_path: status.committed_reference.ok_or_else(|| {
                AppError::Internal("completed restore is missing its path".to_string())
            })?,
        });
    }
    if row.restored_at.is_some() || row.purged_at.is_some() {
        return Err(AppError::Conflict(
            "trash entry already reached a terminal lifecycle state".to_string(),
        ));
    }

    let trash_physical = trash_path_to_physical(&state.config.agent_data_dir, &row.trash_path)?;
    if !trash_physical.exists() {
        return Err(AppError::NotFound(format!(
            "trash payload for {id} was not found"
        )));
    }
    let restore_target = if let Some(reference) = prepared.requested_reference.as_deref() {
        resolve_drive_path(&state.config.agent_data_dir, reference)?
    } else {
        let target = available_restore_target(&state.config.agent_data_dir, &row.original_path)?;
        resource_identity::set_lifecycle_requested_reference(
            state,
            prepared.operation_id,
            &target.logical_path,
        )
        .await?;
        target
    };
    if let Some(parent) = restore_target.physical_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if prepared.state == "prepared" {
        fs::rename(&trash_physical, &restore_target.physical_path)?;
    } else if !restore_target.physical_path.exists() || trash_physical.exists() {
        return Err(AppError::Conflict(
            "restore operation filesystem state requires reconciliation".to_string(),
        ));
    }
    resource_identity::mark_filesystem_committed(
        state,
        prepared.operation_id,
        &restore_target.logical_path,
        "lifecycle:filesystem_committed",
    )
    .await?;
    let resource_sequence = resource_identity::project_lifecycle_commit(
        state,
        &prepared,
        "restored",
        "active",
        Some(&restore_target.logical_path),
        &actor,
        Some(&TrashProjection::Restored { id }),
    )
    .await?;
    if let Err(error) = enqueue_s3_sync_job_for_resource(
        state,
        &restore_target.logical_path,
        "upload",
        Some(prepared.resource_id),
        Some(resource_sequence),
    )
    .await
    {
        tracing::error!(operation_id = %prepared.operation_id, error = %error, "Drive restore committed; sync enqueue failed");
    }
    if let Err(err) = crate::services::knowledge::reconcile_drive_restore(
        state,
        &row.original_path,
        &restore_target.logical_path,
    )
    .await
    {
        tracing::warn!(error = %err, "failed to reconcile restored Wiki resource link");
    }

    Ok(DriveRestoreResponse {
        success: true,
        restored_path: restore_target.logical_path,
    })
}

pub async fn purge_trash(
    state: &AppState,
    id: Uuid,
    operation_key: Option<&str>,
    expected_lifecycle_revision: Option<&str>,
) -> AppResult<DriveMutationResponse> {
    purge_trash_with_actor(
        state,
        id,
        operation_key,
        expected_lifecycle_revision,
        ResourceActor::user(),
    )
    .await
}

pub async fn purge_trash_with_actor(
    state: &AppState,
    id: Uuid,
    operation_key: Option<&str>,
    expected_lifecycle_revision: Option<&str>,
    actor: ResourceActor,
) -> AppResult<DriveMutationResponse> {
    let _namespace_guard = state.drive_namespace_lock().write().await;
    let row = sqlx::query_as!(
        DriveTrashRow,
        r#"SELECT id, original_path, trash_path, kind, size_bytes, deleted_at,
                  resource_id, operation_id,
                  (SELECT lifecycle_revision FROM drive_resources WHERE id = drive_trash_entries.resource_id) AS lifecycle_revision,
                  restored_at, purged_at
           FROM drive_trash_entries
           WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("trash entry {id} not found")))?;
    let resource_id = row.resource_id.ok_or_else(|| {
        AppError::Conflict(
            "trash entry identity is unresolved; reconcile it before purge".to_string(),
        )
    })?;
    let operation_key = operation_key
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let prepared = resource_identity::prepare_lifecycle_operation(
        state,
        resource_identity::PrepareLifecycleOperation {
            operation_key: &operation_key,
            operation_kind: "purge",
            known_resource_id: Some(resource_id),
            logical_path: &row.original_path,
            requested_reference: None,
            expected_revision: expected_lifecycle_revision,
            actor: &actor,
            resource_kind: &row.kind,
            trash_entry_id: Some(id),
        },
    )
    .await?;
    if prepared.state == "completed" {
        return Ok(DriveMutationResponse { success: true });
    }
    if row.restored_at.is_some() || row.purged_at.is_some() {
        return Err(AppError::Conflict(
            "trash entry already reached a terminal lifecycle state".to_string(),
        ));
    }
    let trash_physical = trash_path_to_physical(&state.config.agent_data_dir, &row.trash_path)?;
    if trash_physical.is_dir() {
        fs::remove_dir_all(&trash_physical)?;
    } else if trash_physical.exists() {
        fs::remove_file(&trash_physical)?;
    }
    resource_identity::mark_filesystem_committed(
        state,
        prepared.operation_id,
        &row.trash_path,
        "lifecycle:filesystem_committed",
    )
    .await?;
    resource_identity::project_lifecycle_commit(
        state,
        &prepared,
        "purged",
        "purged",
        None,
        &actor,
        Some(&TrashProjection::Purged { id }),
    )
    .await?;
    Ok(DriveMutationResponse { success: true })
}

fn row_to_trash_entry(row: DriveTrashRow) -> DriveTrashEntry {
    DriveTrashEntry {
        id: row.id.to_string(),
        original_path: row.original_path,
        trash_path: row.trash_path,
        kind: parse_entry_kind(&row.kind),
        size: row.size_bytes.max(0) as u64,
        deleted_at: row.deleted_at.to_rfc3339(),
        operation_id: row.operation_id.map(|id| id.to_string()),
        lifecycle_revision: row.lifecycle_revision.map(|value| value.to_string()),
    }
}

fn trash_path_to_physical(agent_data_dir: &Path, logical_path: &str) -> AppResult<PathBuf> {
    let normalized = normalize_logical_drive_path(logical_path)?;
    let relative = normalized
        .trim_start_matches(DRIVE_PREFIX)
        .trim_start_matches('/');
    if !relative.starts_with(".trash/") {
        return Err(AppError::BadRequest("Invalid trash path".into()));
    }
    let root = canonical_or_create(&drive_root(agent_data_dir))?;
    let physical = root.join(relative);
    let boundary = if physical.exists() {
        physical.canonicalize()?
    } else {
        physical
            .parent()
            .ok_or_else(|| AppError::BadRequest("Invalid trash path".into()))?
            .canonicalize()?
    };
    if !boundary.starts_with(root.join(".trash")) {
        return Err(AppError::BadRequest("Trash path escapes trash root".into()));
    }
    Ok(physical)
}

fn available_restore_target(
    agent_data_dir: &Path,
    original_path: &str,
) -> AppResult<ResolvedDrivePath> {
    let original = resolve_drive_path(agent_data_dir, original_path)?;
    if !original.physical_path.exists() {
        return Ok(original);
    }

    let parent = original
        .physical_path
        .parent()
        .ok_or_else(|| AppError::BadRequest("Invalid restore target".into()))?
        .to_path_buf();
    let logical_parent = logical_parent_path(&original.logical_path)?;
    let file_name = original
        .physical_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| AppError::BadRequest("Invalid restore target".into()))?;
    let stamp = Utc::now().format("%Y%m%d%H%M%S");
    for index in 0..100 {
        let candidate_name = restored_file_name(&file_name, &stamp.to_string(), index);
        let physical_path = parent.join(&candidate_name);
        if !physical_path.exists() {
            return Ok(ResolvedDrivePath {
                physical_path,
                logical_path: logical_child_path(&logical_parent, &candidate_name),
            });
        }
    }
    Err(AppError::BadRequest(
        "Could not find an available restore target".into(),
    ))
}

fn restored_file_name(file_name: &str, stamp: &str, index: usize) -> String {
    let suffix = if index == 0 {
        format!("restored-{stamp}")
    } else {
        format!("restored-{stamp}-{index}")
    };
    let path = Path::new(file_name);
    match (path.file_stem(), path.extension()) {
        (Some(stem), Some(ext)) => format!(
            "{}-{}.{}",
            stem.to_string_lossy(),
            suffix,
            ext.to_string_lossy()
        ),
        _ => format!("{file_name}-{suffix}"),
    }
}

fn entry_kind_to_str(kind: DriveEntryKind) -> &'static str {
    match kind {
        DriveEntryKind::Directory => "directory",
        DriveEntryKind::File => "file",
    }
}

fn parse_entry_kind(value: &str) -> DriveEntryKind {
    match value {
        "directory" => DriveEntryKind::Directory,
        _ => DriveEntryKind::File,
    }
}

#[cfg(test)]
mod pagination_tests {
    use super::*;

    #[sqlx::test(migrations = "./migrations")]
    async fn trash_cursor_is_stable_and_reports_the_full_count(pool: sqlx::PgPool) {
        for index in 0..3 {
            sqlx::query(
                r#"INSERT INTO drive_trash_entries
                     (original_path, trash_path, kind, size_bytes, deleted_at)
                   VALUES ($1, $2, 'file', $3,
                           timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => $4))"#,
            )
            .bind(format!("/drive/shared/{index}.md"))
            .bind(format!("/drive/.trash/{index}/{index}.md"))
            .bind(index as i64)
            .bind(index as f64)
            .execute(&pool)
            .await
            .unwrap();
        }
        let state = AppState::new(pool, test_config());
        let first = list_trash_page(
            &state,
            DriveTrashQuery {
                cursor: None,
                limit: Some(2),
            },
        )
        .await
        .unwrap();
        assert_eq!(first.entries.len(), 2);
        assert_eq!(first.total_count, 3);
        let second = list_trash_page(
            &state,
            DriveTrashQuery {
                cursor: first.next_cursor,
                limit: Some(2),
            },
        )
        .await
        .unwrap();
        assert_eq!(second.entries.len(), 1);
        assert!(second.next_cursor.is_none());
        assert_ne!(first.entries[0].id, second.entries[0].id);
        assert_ne!(first.entries[1].id, second.entries[0].id);
    }

    #[test]
    fn trash_cursor_rejects_malformed_input() {
        assert!(decode_trash_cursor("not-a-cursor").is_err());
        let timestamp = Utc::now();
        let id = Uuid::new_v4();
        assert_eq!(
            decode_trash_cursor(&encode_trash_cursor(timestamp, id))
                .unwrap()
                .1,
            id
        );
    }

    fn test_config() -> crate::config::Config {
        crate::config::Config {
            database_url: String::new(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: std::env::temp_dir().join("mymy-trash-pagination-test"),
            auth_cookie_secure: false,
            cron_tick_interval_secs: 60,
            cron_timezone: "UTC".to_string(),
            cron_output_keep: 10,
            drive_s3_bucket: None,
            drive_s3_region: None,
            drive_s3_endpoint: None,
            sandbox_runner_url: None,
            sandbox_preview_host: "127.0.0.1".to_string(),
        }
    }
}
