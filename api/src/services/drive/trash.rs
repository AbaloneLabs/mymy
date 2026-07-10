use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::drive::{
    DriveEntryKind, DriveMutationResponse, DriveRestoreResponse, DriveTrashEntry,
    DriveTrashResponse,
};
use crate::state::AppState;

use super::paths::{
    canonical_or_create, drive_root, logical_child_path, logical_parent_path,
    normalize_logical_drive_path, resolve_drive_path, ResolvedDrivePath, DRIVE_PREFIX,
};
use super::sync::enqueue_s3_sync_job;
use super::workspace::ensure_drive_root;

#[derive(Debug, FromRow)]
struct DriveTrashRow {
    id: Uuid,
    original_path: String,
    trash_path: String,
    kind: String,
    size_bytes: i64,
    deleted_at: DateTime<Utc>,
}

pub async fn delete_path(state: &AppState, logical_path: &str) -> AppResult<()> {
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    if resolved.logical_path == DRIVE_PREFIX {
        return Err(AppError::BadRequest("Cannot delete the Drive root".into()));
    }
    if !resolved.physical_path.exists() {
        return Ok(());
    }

    let trash_root = drive_root(&state.config.agent_data_dir).join(".trash");
    fs::create_dir_all(&trash_root)?;
    let trash_id = Uuid::new_v4();
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
    let target = trash_root.join(trash_id.to_string()).join(&safe_name);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let original_path = resolved.logical_path.clone();
    fs::rename(resolved.physical_path, target)?;
    let trash_path = format!("/drive/.trash/{trash_id}/{safe_name}");
    let kind_str = entry_kind_to_str(kind);
    let size_bytes = if metadata.is_file() {
        metadata.len() as i64
    } else {
        0
    };
    sqlx::query!(
        r#"INSERT INTO drive_trash_entries
             (id, original_path, trash_path, kind, size_bytes)
           VALUES ($1, $2, $3, $4, $5)"#,
        trash_id,
        &original_path,
        trash_path,
        kind_str,
        size_bytes,
    )
    .execute(&state.db)
    .await?;
    enqueue_s3_sync_job(state, &original_path, "delete").await?;
    if let Err(err) =
        crate::services::knowledge::mark_drive_path_broken(state, &original_path).await
    {
        tracing::warn!(error = %err, path = %original_path, "failed to project broken Wiki resource link");
    }
    Ok(())
}

pub async fn list_trash(state: &AppState) -> AppResult<DriveTrashResponse> {
    let rows = sqlx::query_as!(
        DriveTrashRow,
        r#"SELECT id, original_path, trash_path, kind, size_bytes, deleted_at
           FROM drive_trash_entries
           WHERE restored_at IS NULL
           ORDER BY deleted_at DESC"#
    )
    .fetch_all(&state.db)
    .await?;

    Ok(DriveTrashResponse {
        entries: rows.into_iter().map(row_to_trash_entry).collect(),
    })
}

pub async fn restore_trash(state: &AppState, id: Uuid) -> AppResult<DriveRestoreResponse> {
    ensure_drive_root(state)?;
    let row = sqlx::query_as!(
        DriveTrashRow,
        r#"SELECT id, original_path, trash_path, kind, size_bytes, deleted_at
           FROM drive_trash_entries
           WHERE id = $1 AND restored_at IS NULL"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("trash entry {id} not found")))?;

    let trash_physical = trash_path_to_physical(&state.config.agent_data_dir, &row.trash_path)?;
    if !trash_physical.exists() {
        return Err(AppError::NotFound(format!(
            "trash payload for {id} was not found"
        )));
    }
    let restore_target =
        available_restore_target(&state.config.agent_data_dir, &row.original_path)?;
    if let Some(parent) = restore_target.physical_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(trash_physical, &restore_target.physical_path)?;
    sqlx::query!(
        "UPDATE drive_trash_entries SET restored_at = now() WHERE id = $1",
        id
    )
    .execute(&state.db)
    .await?;
    enqueue_s3_sync_job(state, &restore_target.logical_path, "upload").await?;
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

pub async fn purge_trash(state: &AppState, id: Uuid) -> AppResult<DriveMutationResponse> {
    let row = sqlx::query_as!(
        DriveTrashRow,
        r#"SELECT id, original_path, trash_path, kind, size_bytes, deleted_at
           FROM drive_trash_entries
           WHERE id = $1 AND restored_at IS NULL"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("trash entry {id} not found")))?;
    let trash_physical = trash_path_to_physical(&state.config.agent_data_dir, &row.trash_path)?;
    if trash_physical.is_dir() {
        fs::remove_dir_all(&trash_physical)?;
    } else if trash_physical.exists() {
        fs::remove_file(&trash_physical)?;
    }
    sqlx::query!(
        "UPDATE drive_trash_entries SET restored_at = now() WHERE id = $1",
        id
    )
    .execute(&state.db)
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
