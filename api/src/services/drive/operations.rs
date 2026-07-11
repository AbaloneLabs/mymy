use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::content_security::ContentOrigin;
use crate::models::document_editor::DocumentEditorSyncStatus;
use crate::models::drive::{
    DriveEntry, DriveEntryKind, DriveFileResponse, DriveListResponse, DriveProviderKind,
    DriveUploadOutcome, DriveUploadResponse, DriveUploadResult, MoveDrivePathResponse,
};
use crate::services::document_editor::editor_kind_for_path;
use crate::services::file_observations::{fingerprint_path, FileFingerprint};
use crate::services::workspace_content::{
    AdmissionActor, AdmissionOutcome, AdmissionRequest, StagedContent,
};
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
    state
        .workspace_content
        .ensure_not_quarantined(state, logical_path)
        .await?;
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
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    if resolved.physical_path.exists() && expected_fingerprint.is_none() {
        return Err(AppError::Conflict(
            "Existing Drive files require the fingerprint returned by the latest read".to_string(),
        ));
    }
    let file_name = resolved
        .physical_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_string();
    let outcome = state
        .workspace_content
        .admit_bytes(
            state,
            AdmissionRequest {
                desired_path: resolved.logical_path,
                file_name,
                origin: ContentOrigin::UserEdit,
                actor: AdmissionActor::user(),
                expected_fingerprint: expected_fingerprint.map(str::to_string),
                allow_overwrite: true,
                enqueue_s3_sync: true,
            },
            content.as_bytes(),
        )
        .await?;
    match outcome {
        AdmissionOutcome::Committed { fingerprint, .. } => Ok(fingerprint),
        AdmissionOutcome::Quarantined { .. } => Err(AppError::content_quarantined()),
        AdmissionOutcome::Rejected => Err(AppError::content_rejected()),
    }
}

pub async fn upload_staged_file(
    state: &AppState,
    target_directory: &str,
    file_name: &str,
    staged: StagedContent,
) -> AppResult<DriveUploadResponse> {
    ensure_drive_root(state)?;
    let safe_name = validate_file_name(file_name)?;
    let target_dir = resolve_drive_path(&state.config.agent_data_dir, target_directory)?;
    if target_dir.physical_path.exists() && !target_dir.physical_path.is_dir() {
        return Err(AppError::BadRequest(
            "Upload target must be a Drive directory".into(),
        ));
    }
    let logical_path = logical_child_path(&target_dir.logical_path, &safe_name);
    let physical_path = target_dir.physical_path.join(&safe_name);
    let outcome = state
        .workspace_content
        .admit_staged(
            state,
            AdmissionRequest {
                desired_path: logical_path.clone(),
                file_name: safe_name.clone(),
                origin: ContentOrigin::UserUpload,
                actor: AdmissionActor::user(),
                expected_fingerprint: None,
                allow_overwrite: true,
                enqueue_s3_sync: true,
            },
            staged,
        )
        .await?;
    let (files, result) = match outcome {
        AdmissionOutcome::Committed { sync_status, .. } => {
            if sync_status == DocumentEditorSyncStatus::Failed {
                tracing::warn!(
                    path = %logical_path,
                    "Drive upload committed but object-storage sync could not be queued"
                );
            }
            let entry = entry_for_path(safe_name, logical_path, &physical_path)?;
            (
                vec![entry.clone()],
                DriveUploadResult {
                    requested_name: file_name.to_string(),
                    outcome: DriveUploadOutcome::Committed,
                    file: Some(entry),
                    code: None,
                    message: None,
                },
            )
        }
        AdmissionOutcome::Quarantined { .. } => (
            Vec::new(),
            DriveUploadResult {
                requested_name: file_name.to_string(),
                outcome: DriveUploadOutcome::Quarantined,
                file: None,
                code: Some("content_quarantined".to_string()),
                message: Some(
                    "The file requires user review before it becomes available.".to_string(),
                ),
            },
        ),
        AdmissionOutcome::Rejected => (
            Vec::new(),
            DriveUploadResult {
                requested_name: file_name.to_string(),
                outcome: DriveUploadOutcome::Rejected,
                file: None,
                code: Some("content_rejected".to_string()),
                message: Some("The file does not pass the current content policy.".to_string()),
            },
        ),
    };

    Ok(DriveUploadResponse {
        success: true,
        files,
        results: vec![result],
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
