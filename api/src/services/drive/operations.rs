use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::document_editor::DocumentEditorSyncStatus;
use crate::models::drive::{
    DriveEntry, DriveEntryKind, DriveFileResponse, DriveListResponse, DriveProviderKind,
    DriveUploadResponse, MoveDrivePathResponse,
};
use crate::services::document_editor::editor_kind_for_path;
use crate::services::document_malware::scan_document_bytes;
use crate::services::file_mutations::atomic_replace_file;
use crate::services::file_observations::{fingerprint_path, FileFingerprint};
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
    let _namespace_guard = state.drive_namespace_lock().read().await;
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    let write_lock = state.drive_write_lock(&resolved.physical_path).await;
    let _write_guard = write_lock.lock().await;
    let metadata = fs::metadata(&resolved.physical_path)?;
    if !metadata.is_file() {
        return Err(AppError::BadRequest("Drive path is not a file".into()));
    }

    let mime_type = mime_type_for_path(&resolved.physical_path).to_string();
    let preview_path = resolved.physical_path.clone();
    let preview_metadata = metadata.clone();
    let preview_mime_type = mime_type.clone();
    let content = state
        .document_conversion_pool
        .run("preview", move || {
            read_preview_content(&preview_path, &preview_metadata, &preview_mime_type)
        })
        .await?;
    let fingerprint = fingerprint_path(&resolved.physical_path)
        .await
        .map_err(AppError::Internal)?;

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
        fingerprint: fingerprint.hash,
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

/// Conditionally replace a raw Drive file under the same lock used by the
/// document editor and native-agent tools.
///
/// Lightweight text surfaces do not exchange the normalized document model,
/// but they still need the same compare-and-swap boundary. The content hash is
/// therefore checked inside the critical section immediately before the
/// atomic replacement.
pub async fn write_file_conditionally(
    state: &AppState,
    logical_path: &str,
    content: &str,
    expected_fingerprint: Option<&str>,
) -> AppResult<FileFingerprint> {
    let _namespace_guard = state.drive_namespace_lock().read().await;
    ensure_drive_root(state)?;
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    let write_lock = state.drive_write_lock(&resolved.physical_path).await;
    let _write_guard = write_lock.lock().await;
    if resolved.physical_path.exists() {
        let expected = expected_fingerprint.ok_or_else(|| {
            AppError::Conflict(
                "Existing Drive files require the fingerprint returned by the latest read"
                    .to_string(),
            )
        })?;
        let current = fingerprint_path(&resolved.physical_path)
            .await
            .map_err(AppError::Internal)?;
        if current.hash != expected {
            return Err(AppError::Conflict(
                "Drive file changed since it was read".to_string(),
            ));
        }
    } else if expected_fingerprint.is_some() {
        return Err(AppError::Conflict(
            "Drive file no longer exists at the reviewed path".to_string(),
        ));
    }
    let bytes = content.as_bytes().to_vec();
    let bytes = state
        .document_conversion_pool
        .run("drive_write_scan", move || {
            scan_document_bytes(&bytes)?;
            Ok(bytes)
        })
        .await?;
    write_file_bytes_unlocked(state, &resolved.logical_path, &bytes).await?;
    fingerprint_path(&resolved.physical_path)
        .await
        .map_err(AppError::Internal)
}

/// Write bytes while the caller holds the shared lock for the resolved path.
///
/// Document-editor saves need this lower-level entry point so their optimistic
/// fingerprint check, package conversion, validation, and replacement all stay
/// inside one critical section. Other callers must use `write_file_bytes`.
pub(crate) async fn write_file_bytes_unlocked(
    state: &AppState,
    logical_path: &str,
    bytes: &[u8],
) -> AppResult<DocumentEditorSyncStatus> {
    ensure_drive_root(state)?;
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    if let Some(parent) = resolved.physical_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if resolved.physical_path.exists() && fs::metadata(&resolved.physical_path)?.is_dir() {
        return Err(AppError::BadRequest("Cannot overwrite a directory".into()));
    }
    atomic_replace_file(&resolved.physical_path, bytes).await?;
    if state.config.drive_s3_bucket.is_none() {
        return Ok(DocumentEditorSyncStatus::LocalOnly);
    }
    if let Err(error) = enqueue_s3_sync_job(state, &resolved.logical_path, "upload").await {
        // The local file is already durable at this point. Returning an error
        // would tell the editor that the save failed and make a retry conflict
        // with bytes that were in fact committed. Sync recovery remains a
        // separate status concern and must never falsify local-save outcome.
        tracing::error!(
            path = %resolved.logical_path,
            error = %error,
            "local Drive write committed but S3 sync enqueue failed"
        );
        return Ok(DocumentEditorSyncStatus::Failed);
    }
    Ok(DocumentEditorSyncStatus::Pending)
}

pub async fn upload_file(
    state: &AppState,
    target_directory: &str,
    file_name: &str,
    bytes: Vec<u8>,
) -> AppResult<DriveUploadResponse> {
    let _namespace_guard = state.drive_namespace_lock().read().await;
    ensure_drive_root(state)?;
    let safe_name = validate_file_name(file_name)?;
    let target_dir = resolve_drive_path(&state.config.agent_data_dir, target_directory)?;
    if target_dir.physical_path.exists() && !target_dir.physical_path.is_dir() {
        return Err(AppError::BadRequest(
            "Upload target must be a Drive directory".into(),
        ));
    }
    // Scan before creating directories or temporary files so every rejected
    // upload leaves the Drive namespace byte-for-byte unchanged.
    let bytes = state
        .document_conversion_pool
        .run("upload_scan", move || {
            scan_document_bytes(&bytes)?;
            Ok(bytes)
        })
        .await?;
    fs::create_dir_all(&target_dir.physical_path)?;
    let logical_path = logical_child_path(&target_dir.logical_path, &safe_name);
    let physical_path = target_dir.physical_path.join(&safe_name);
    let write_lock = state.drive_write_lock(&physical_path).await;
    let _write_guard = write_lock.lock().await;
    atomic_replace_file(&physical_path, &bytes).await?;
    if let Err(error) = enqueue_s3_sync_job(state, &logical_path, "upload").await {
        tracing::error!(
            path = %logical_path,
            error = %error,
            "local Drive upload committed but S3 sync enqueue failed"
        );
    }

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
    let _namespace_guard = state.drive_namespace_lock().write().await;
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
