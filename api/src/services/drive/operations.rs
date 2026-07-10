use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::drive::{
    DriveEntry, DriveEntryKind, DriveFileResponse, DriveListResponse, DriveProviderKind,
    DriveUploadResponse, MoveDrivePathResponse,
};
use crate::services::document_editor::editor_kind_for_path;
use crate::state::AppState;

use super::content::{is_editable, mime_type_for_path, read_preview_content};
use super::paths::{logical_child_path, metadata_updated_at, resolve_drive_path, DRIVE_PREFIX};
use super::sync::enqueue_s3_sync_job;
use super::workspace::ensure_drive_root;

pub async fn list(state: &AppState, logical_path: Option<&str>) -> AppResult<DriveListResponse> {
    ensure_drive_root(state)?;
    let resolved = resolve_drive_path(
        &state.config.agent_data_dir,
        logical_path.unwrap_or(DRIVE_PREFIX),
    )?;
    let metadata = fs::metadata(&resolved.physical_path)?;
    if !metadata.is_dir() {
        return Err(AppError::BadRequest("Drive path is not a directory".into()));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&resolved.physical_path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".trash" {
            continue;
        }
        let metadata = entry.metadata()?;
        let kind = if metadata.is_dir() {
            DriveEntryKind::Directory
        } else {
            DriveEntryKind::File
        };
        let path = logical_child_path(&resolved.logical_path, &name);
        entries.push(DriveEntry {
            mime_type: if kind == DriveEntryKind::Directory {
                "inode/directory".to_string()
            } else {
                mime_type_for_path(&entry.path()).to_string()
            },
            name,
            path,
            kind,
            size: if metadata.is_file() {
                metadata.len()
            } else {
                0
            },
            updated_at: metadata_updated_at(&metadata),
            provider: DriveProviderKind::LocalVm,
        });
    }

    entries.sort_by(|left, right| {
        let left_rank = if left.kind == DriveEntryKind::Directory {
            0
        } else {
            1
        };
        let right_rank = if right.kind == DriveEntryKind::Directory {
            0
        } else {
            1
        };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(DriveListResponse {
        path: resolved.logical_path,
        entries,
    })
}

pub async fn read_file(state: &AppState, logical_path: &str) -> AppResult<DriveFileResponse> {
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    let metadata = fs::metadata(&resolved.physical_path)?;
    if !metadata.is_file() {
        return Err(AppError::BadRequest("Drive path is not a file".into()));
    }

    let mime_type = mime_type_for_path(&resolved.physical_path).to_string();
    let content = read_preview_content(&resolved.physical_path, &metadata, &mime_type)?;

    Ok(DriveFileResponse {
        path: resolved.logical_path,
        name: resolved
            .physical_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        mime_type,
        size: metadata.len(),
        updated_at: metadata_updated_at(&metadata),
        editable: is_editable(&resolved.physical_path),
        editor_kind: editor_kind_for_path(&resolved.physical_path),
        content,
    })
}

pub fn blob_path(state: &AppState, logical_path: &str) -> AppResult<(PathBuf, String)> {
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    let metadata = fs::metadata(&resolved.physical_path)?;
    if !metadata.is_file() {
        return Err(AppError::BadRequest("Drive path is not a file".into()));
    }
    let mime_type = mime_type_for_path(&resolved.physical_path).to_string();
    Ok((resolved.physical_path, mime_type))
}

pub async fn write_file(state: &AppState, logical_path: &str, content: &str) -> AppResult<()> {
    write_file_bytes(state, logical_path, content.as_bytes()).await
}

pub async fn write_file_bytes(state: &AppState, logical_path: &str, bytes: &[u8]) -> AppResult<()> {
    ensure_drive_root(state)?;
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    if let Some(parent) = resolved.physical_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if resolved.physical_path.exists() && fs::metadata(&resolved.physical_path)?.is_dir() {
        return Err(AppError::BadRequest("Cannot overwrite a directory".into()));
    }
    fs::write(&resolved.physical_path, bytes)?;
    enqueue_s3_sync_job(state, &resolved.logical_path, "upload").await?;
    Ok(())
}

pub async fn upload_file(
    state: &AppState,
    target_directory: &str,
    file_name: &str,
    bytes: &[u8],
) -> AppResult<DriveUploadResponse> {
    ensure_drive_root(state)?;
    let safe_name = validate_file_name(file_name)?;
    let target_dir = resolve_drive_path(&state.config.agent_data_dir, target_directory)?;
    if target_dir.physical_path.exists() && !target_dir.physical_path.is_dir() {
        return Err(AppError::BadRequest(
            "Upload target must be a Drive directory".into(),
        ));
    }
    fs::create_dir_all(&target_dir.physical_path)?;
    let logical_path = logical_child_path(&target_dir.logical_path, &safe_name);
    let physical_path = target_dir.physical_path.join(&safe_name);
    fs::write(&physical_path, bytes)?;
    enqueue_s3_sync_job(state, &logical_path, "upload").await?;

    Ok(DriveUploadResponse {
        success: true,
        files: vec![entry_for_path(safe_name, logical_path, &physical_path)?],
    })
}

pub async fn create_folder(state: &AppState, logical_path: &str) -> AppResult<()> {
    ensure_drive_root(state)?;
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    fs::create_dir_all(resolved.physical_path)?;
    Ok(())
}

pub async fn move_path(
    state: &AppState,
    source_path: &str,
    destination_path: &str,
) -> AppResult<MoveDrivePathResponse> {
    let source = resolve_drive_path(&state.config.agent_data_dir, source_path)?;
    let destination = resolve_drive_path(&state.config.agent_data_dir, destination_path)?;
    if source.logical_path == DRIVE_PREFIX {
        return Err(AppError::BadRequest(
            "Cannot move the Drive root".to_string(),
        ));
    }
    if !source.physical_path.exists() {
        return Err(AppError::NotFound(format!(
            "Drive path {} not found",
            source.logical_path
        )));
    }
    if destination.physical_path.exists() {
        return Err(AppError::Conflict(format!(
            "Drive path {} already exists",
            destination.logical_path
        )));
    }
    if destination.physical_path.starts_with(&source.physical_path) {
        return Err(AppError::BadRequest(
            "Cannot move a Drive directory inside itself".to_string(),
        ));
    }
    let Some(parent) = destination.physical_path.parent() else {
        return Err(AppError::BadRequest(
            "Invalid Drive destination path".to_string(),
        ));
    };
    if !parent.is_dir() {
        return Err(AppError::BadRequest(
            "Drive destination parent must exist".to_string(),
        ));
    }
    fs::rename(&source.physical_path, &destination.physical_path)?;
    if let Err(err) = crate::services::knowledge::reconcile_drive_move(
        state,
        &source.logical_path,
        &destination.logical_path,
    )
    .await
    {
        if let Err(rollback_err) = fs::rename(&destination.physical_path, &source.physical_path) {
            return Err(AppError::Internal(format!(
                "Drive move link reconciliation failed ({err}) and rollback failed ({rollback_err})"
            )));
        }
        return Err(err);
    }
    enqueue_s3_sync_job(state, &source.logical_path, "delete").await?;
    enqueue_s3_sync_job(state, &destination.logical_path, "upload").await?;
    Ok(MoveDrivePathResponse {
        success: true,
        source_path: source.logical_path,
        destination_path: destination.logical_path,
    })
}

fn entry_for_path(
    name: String,
    logical_path: String,
    physical_path: &Path,
) -> AppResult<DriveEntry> {
    let metadata = fs::metadata(physical_path)?;
    let kind = if metadata.is_dir() {
        DriveEntryKind::Directory
    } else {
        DriveEntryKind::File
    };
    Ok(DriveEntry {
        mime_type: if kind == DriveEntryKind::Directory {
            "inode/directory".to_string()
        } else {
            mime_type_for_path(physical_path).to_string()
        },
        name,
        path: logical_path,
        kind,
        size: if metadata.is_file() {
            metadata.len()
        } else {
            0
        },
        updated_at: metadata_updated_at(&metadata),
        provider: DriveProviderKind::LocalVm,
    })
}

fn validate_file_name(value: &str) -> AppResult<String> {
    let name = value.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(AppError::BadRequest("Invalid upload file name".into()));
    }
    Ok(name.to_string())
}
