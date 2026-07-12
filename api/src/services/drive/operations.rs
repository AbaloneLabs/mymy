use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::content_security::ContentOrigin;
use crate::models::document_editor::DocumentEditorSyncStatus;
use crate::models::drive::{
    DriveEntry, DriveEntryKind, DriveFileResponse, DriveListResponse, DriveProviderKind,
    DriveUploadOutcome, DriveUploadResponse, DriveUploadResult, MoveDrivePathResponse,
};
use crate::services::document_editor::editor_kind_for_path;
use crate::services::file_observations::{fingerprint_path, FileFingerprint};
use crate::services::resource_identity::{self, ResourceActor};
use crate::services::workspace_content::{
    AdmissionActor, AdmissionOutcome, AdmissionRequest, StagedContent,
};
use crate::state::AppState;

use super::content::{is_editable, mime_type_for_path, read_preview_content};
use super::paths::{logical_child_path, metadata_updated_at, resolve_drive_path, DRIVE_PREFIX};
use super::sync::enqueue_s3_sync_job_for_resource;
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
    let resource_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM drive_resources WHERE provider = 'local_vm' AND canonical_path = $1 AND lifecycle_state = 'active'",
    )
    .bind(&resolved.logical_path)
    .fetch_optional(&state.db)
    .await?;

    Ok(DriveFileResponse {
        resource_id: resource_id.map(|id| id.to_string()),
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
#[cfg(test)]
pub async fn write_file_conditionally(
    state: &AppState,
    logical_path: &str,
    content: &str,
    expected_fingerprint: Option<&str>,
) -> AppResult<FileFingerprint> {
    write_file_conditionally_with_context(
        state,
        logical_path,
        content,
        expected_fingerprint,
        AdmissionActor::user(),
        None,
        None,
    )
    .await
    .map(|result| result.0)
}

pub async fn write_file_conditionally_with_context(
    state: &AppState,
    logical_path: &str,
    content: &str,
    expected_fingerprint: Option<&str>,
    actor: AdmissionActor,
    operation_key: Option<String>,
    artifact: Option<resource_identity::ArtifactClassification>,
) -> AppResult<(FileFingerprint, Uuid)> {
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
                actor,
                expected_fingerprint: expected_fingerprint.map(str::to_string),
                allow_overwrite: true,
                enqueue_s3_sync: true,
                operation_key,
                artifact,
            },
            content.as_bytes(),
        )
        .await?;
    match outcome {
        AdmissionOutcome::Committed {
            fingerprint,
            operation_id,
            ..
        } => Ok((fingerprint, operation_id)),
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
                operation_key: None,
                artifact: None,
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
    operation_key: Option<&str>,
    expected_lifecycle_revision: Option<&str>,
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
    let metadata = fs::metadata(&source.physical_path)?;
    let resource_id = resource_identity::ensure_existing_resource(
        state,
        &source.logical_path,
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
    let actor = ResourceActor::user();
    let prepared = resource_identity::prepare_lifecycle_operation(
        state,
        resource_identity::PrepareLifecycleOperation {
            operation_key: &operation_key,
            operation_kind: "move",
            known_resource_id: Some(resource_id),
            logical_path: &source.logical_path,
            requested_reference: Some(&destination.logical_path),
            expected_revision: expected_lifecycle_revision,
            actor: &actor,
            resource_kind: if metadata.is_dir() {
                "directory"
            } else {
                "file"
            },
            trash_entry_id: None,
        },
    )
    .await?;
    if metadata.is_dir() && prepared.state == "prepared" && source.physical_path.is_dir() {
        resource_identity::prepare_directory_move(
            state,
            prepared.operation_id,
            &source.physical_path,
            &source.logical_path,
        )
        .await?;
    }
    let resource_sequence = if prepared.state != "completed" {
        if prepared.state == "prepared" {
            fs::rename(&source.physical_path, &destination.physical_path)?;
        } else if !destination.physical_path.exists() || source.physical_path.exists() {
            return Err(AppError::Conflict(
                "move operation filesystem state requires manual reconciliation".to_string(),
            ));
        }
        resource_identity::mark_filesystem_committed(
            state,
            prepared.operation_id,
            &destination.logical_path,
            "lifecycle:filesystem_committed",
        )
        .await?;
        resource_identity::project_lifecycle_commit(
            state,
            &prepared,
            "moved",
            "active",
            Some(&destination.logical_path),
            &actor,
            None,
        )
        .await?
    } else {
        sqlx::query_scalar::<_, i64>(
            "SELECT current_revision + lifecycle_revision FROM drive_resources WHERE id = $1",
        )
        .bind(prepared.resource_id)
        .fetch_one(&state.db)
        .await?
    };
    if metadata.is_dir() {
        resource_identity::project_directory_descendant_paths(
            state,
            prepared.operation_id,
            prepared.resource_id,
            &source.logical_path,
            &destination.logical_path,
        )
        .await?;
    }
    if let Err(err) = crate::services::knowledge::reconcile_drive_move(
        state,
        &source.logical_path,
        &destination.logical_path,
    )
    .await
    {
        tracing::error!(operation_id = %prepared.operation_id, error = %err, "Drive move committed; Wiki links require reconciliation");
    }
    if let Err(error) = enqueue_s3_sync_job_for_resource(
        state,
        &source.logical_path,
        "delete",
        Some(prepared.resource_id),
        Some(resource_sequence),
    )
    .await
    {
        tracing::error!(operation_id = %prepared.operation_id, error = %error, "Drive move committed; delete sync enqueue failed");
    }
    if let Err(error) = enqueue_s3_sync_job_for_resource(
        state,
        &destination.logical_path,
        "upload",
        Some(prepared.resource_id),
        Some(resource_sequence),
    )
    .await
    {
        tracing::error!(operation_id = %prepared.operation_id, error = %error, "Drive move committed; upload sync enqueue failed");
    }
    let lifecycle_revision = sqlx::query_scalar::<_, i64>(
        "SELECT lifecycle_revision FROM drive_resources WHERE id = $1",
    )
    .bind(prepared.resource_id)
    .fetch_one(&state.db)
    .await?;
    Ok(MoveDrivePathResponse {
        success: true,
        source_path: source.logical_path,
        destination_path: destination.logical_path,
        operation_id: prepared.operation_id.to_string(),
        resource_id: prepared.resource_id.to_string(),
        lifecycle_revision: lifecycle_revision.to_string(),
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
