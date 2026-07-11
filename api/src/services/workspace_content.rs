//! Central content-admission and Drive commit boundary.
//!
//! All byte-producing adapters stage content outside Drive, inspect it under
//! an origin-aware policy, and enter the visible workspace only through this
//! service. Keeping path locks, compare-and-swap checks, atomic replacement,
//! fingerprints, and S3 enqueue in one transaction-shaped operation prevents
//! a less-visible ingress adapter from silently weakening those invariants.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::content_security::{ContentOrigin, ContentSafetyVerdict};
use crate::models::document_editor::DocumentEditorSyncStatus;
use crate::services::content_quarantine;
use crate::services::drive;
use crate::services::file_observations::{fingerprint_path, FileFingerprint};
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct AdmissionActor {
    pub kind: &'static str,
    pub id: Option<String>,
    pub agent_run_id: Option<Uuid>,
    pub provider_ref: Option<String>,
}

impl AdmissionActor {
    pub fn system() -> Self {
        Self {
            kind: "system",
            id: None,
            agent_run_id: None,
            provider_ref: None,
        }
    }

    pub fn user() -> Self {
        Self {
            kind: "user",
            id: None,
            agent_run_id: None,
            provider_ref: None,
        }
    }

    pub fn provider() -> Self {
        Self {
            kind: "provider",
            id: None,
            agent_run_id: None,
            provider_ref: None,
        }
    }

    pub fn agent(profile: Option<&str>, run_id: Option<Uuid>) -> Self {
        Self {
            kind: "agent",
            id: profile.map(str::to_string),
            agent_run_id: run_id,
            provider_ref: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AdmissionRequest {
    pub desired_path: String,
    pub file_name: String,
    pub origin: ContentOrigin,
    pub actor: AdmissionActor,
    pub expected_fingerprint: Option<String>,
    pub allow_overwrite: bool,
    pub enqueue_s3_sync: bool,
}

#[derive(Debug)]
pub enum AdmissionOutcome {
    Committed {
        fingerprint: FileFingerprint,
        sync_status: DocumentEditorSyncStatus,
    },
    Quarantined {
        id: Uuid,
    },
    Rejected,
}

#[derive(Debug)]
pub struct StagedContent {
    pub storage_key: Uuid,
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
}

pub struct ContentStager {
    storage_key: Uuid,
    path: PathBuf,
    file: File,
    size: u64,
    maximum: u64,
    hasher: Sha256,
    finished: bool,
}

impl ContentStager {
    pub async fn begin(state: &AppState) -> AppResult<Self> {
        let directory = staging_root(state);
        ensure_private_directory(&directory).await?;
        let storage_key = Uuid::new_v4();
        let path = directory.join(storage_key.to_string());
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .await?;
        set_private_file_permissions(&path).await?;
        Ok(Self {
            storage_key,
            path,
            file,
            size: 0,
            maximum: state.config.content_max_item_bytes(),
            hasher: Sha256::new(),
            finished: false,
        })
    }

    pub async fn write_chunk(&mut self, bytes: &[u8]) -> AppResult<()> {
        let next_size = self
            .size
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| AppError::PayloadTooLarge("content size overflowed".to_string()))?;
        if next_size > self.maximum {
            return Err(AppError::PayloadTooLarge(
                "content exceeds the configured item limit".to_string(),
            ));
        }
        self.file.write_all(bytes).await?;
        self.hasher.update(bytes);
        self.size = next_size;
        Ok(())
    }

    pub async fn finish(mut self) -> AppResult<StagedContent> {
        self.file.flush().await?;
        self.file.sync_all().await?;
        self.finished = true;
        Ok(StagedContent {
            storage_key: self.storage_key,
            path: self.path.clone(),
            size: self.size,
            sha256: hex::encode(self.hasher.clone().finalize()),
        })
    }
}

impl Drop for ContentStager {
    fn drop(&mut self) {
        // An unfinished stage is never referenced by the database. Cleanup is
        // best effort here and authoritative in the reconciliation worker.
        if !self.finished {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[derive(Debug, Default)]
pub struct WorkspaceContentService;

impl WorkspaceContentService {
    pub fn new() -> Self {
        Self
    }

    pub async fn admit_bytes(
        &self,
        state: &AppState,
        request: AdmissionRequest,
        bytes: &[u8],
    ) -> AppResult<AdmissionOutcome> {
        let mut stager = ContentStager::begin(state).await?;
        stager.write_chunk(bytes).await?;
        let staged = stager.finish().await?;
        self.admit_staged(state, request, staged).await
    }

    pub async fn admit_staged(
        &self,
        state: &AppState,
        request: AdmissionRequest,
        staged: StagedContent,
    ) -> AppResult<AdmissionOutcome> {
        let resolved =
            drive::resolve_drive_path(&state.config.agent_data_dir, &request.desired_path)?;
        let bytes = read_staged_bounded(state, &staged).await?;
        let report = state
            .content_safety
            .inspect(&request.file_name, &bytes, request.origin);
        if report.size != staged.size || report.sha256 != staged.sha256 {
            remove_staged(&staged).await;
            return Err(AppError::Internal(
                "staged content identity changed before inspection".to_string(),
            ));
        }

        match report.verdict {
            ContentSafetyVerdict::Reject => {
                remove_staged(&staged).await;
                Ok(AdmissionOutcome::Rejected)
            }
            ContentSafetyVerdict::ReviewRequired => {
                let _namespace_guard = state.drive_namespace_lock().read().await;
                let write_lock = state.drive_write_lock(&resolved.physical_path).await;
                let _write_guard = write_lock.lock().await;
                let target_fingerprint = if resolved.physical_path.is_file() {
                    Some(
                        fingerprint_path(&resolved.physical_path)
                            .await
                            .map_err(AppError::Internal)?
                            .hash,
                    )
                } else {
                    None
                };
                let id = content_quarantine::store_pending(
                    state,
                    &request,
                    &resolved.logical_path,
                    &staged,
                    &report,
                    target_fingerprint.as_deref(),
                )
                .await?;
                Ok(AdmissionOutcome::Quarantined { id })
            }
            ContentSafetyVerdict::Pass | ContentSafetyVerdict::Restricted => {
                let (fingerprint, sync_status) = self
                    .commit_staged(
                        state,
                        &resolved.logical_path,
                        &staged,
                        request.expected_fingerprint.as_deref(),
                        request.allow_overwrite,
                        request.enqueue_s3_sync,
                    )
                    .await?;
                Ok(AdmissionOutcome::Committed {
                    fingerprint,
                    sync_status,
                })
            }
        }
    }

    /// Commit bytes already re-inspected by the quarantine approval flow.
    pub(crate) async fn release_reviewed(
        &self,
        state: &AppState,
        desired_path: &str,
        staged: &StagedContent,
    ) -> AppResult<FileFingerprint> {
        let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, desired_path)?;
        let (fingerprint, _) = self
            .commit_staged(state, &resolved.logical_path, staged, None, false, true)
            .await?;
        Ok(fingerprint)
    }

    pub async fn ensure_not_quarantined(
        &self,
        state: &AppState,
        logical_path: &str,
    ) -> AppResult<()> {
        let path = drive::normalize_logical_drive_path(logical_path)?;
        let pending = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1
                     FROM content_quarantine_items
                    WHERE desired_path = $1
                      AND status IN ('pending', 'approving')
                      AND target_fingerprint IS NULL
               )"#,
        )
        .bind(path)
        .fetch_one(&state.db)
        .await?;
        if pending {
            return Err(AppError::content_quarantined());
        }
        Ok(())
    }

    async fn commit_staged(
        &self,
        state: &AppState,
        logical_path: &str,
        staged: &StagedContent,
        expected_fingerprint: Option<&str>,
        allow_overwrite: bool,
        enqueue_s3_sync: bool,
    ) -> AppResult<(FileFingerprint, DocumentEditorSyncStatus)> {
        let bytes = read_staged_bounded(state, staged).await?;
        let _namespace_guard = state.drive_namespace_lock().read().await;
        let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
        let write_lock = state.drive_write_lock(&resolved.physical_path).await;
        let _write_guard = write_lock.lock().await;

        if resolved.physical_path.exists() {
            if resolved.physical_path.is_dir() {
                return Err(AppError::BadRequest(
                    "Cannot replace a Drive directory with file content".to_string(),
                ));
            }
            if !allow_overwrite {
                return Err(AppError::quarantine_destination_conflict());
            }
            if let Some(expected) = expected_fingerprint {
                let expected_hash = expected.split(':').next().unwrap_or(expected);
                let current = fingerprint_path(&resolved.physical_path)
                    .await
                    .map_err(AppError::Internal)?;
                if current.hash != expected_hash {
                    return Err(AppError::Conflict(
                        "Drive file changed since it was read".to_string(),
                    ));
                }
            }
        } else if expected_fingerprint.is_some() {
            return Err(AppError::Conflict(
                "Drive file no longer exists at the reviewed path".to_string(),
            ));
        }

        if let Some(parent) = resolved.physical_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        atomic_replace_file(&resolved.physical_path, &bytes).await?;
        let fingerprint = fingerprint_path(&resolved.physical_path)
            .await
            .map_err(AppError::Internal)?;
        remove_staged(staged).await;

        if !enqueue_s3_sync || state.config.drive_s3_bucket.is_none() {
            return Ok((fingerprint, DocumentEditorSyncStatus::LocalOnly));
        }
        if let Err(error) =
            drive::enqueue_s3_sync_job(state, &resolved.logical_path, "upload").await
        {
            tracing::error!(
                path = %resolved.logical_path,
                error = %error,
                "workspace commit completed but S3 enqueue failed"
            );
            return Ok((fingerprint, DocumentEditorSyncStatus::Failed));
        }
        Ok((fingerprint, DocumentEditorSyncStatus::Pending))
    }
}

pub fn quarantine_root(state: &AppState) -> PathBuf {
    state.config.agent_data_dir.join("content-quarantine")
}

pub fn staging_root(state: &AppState) -> PathBuf {
    quarantine_root(state).join("staging")
}

pub fn pending_root(state: &AppState) -> PathBuf {
    quarantine_root(state).join("pending")
}

pub(crate) async fn ensure_private_directory(path: &Path) -> AppResult<()> {
    tokio::fs::create_dir_all(path).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).await?;
    }
    Ok(())
}

async fn set_private_file_permissions(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
    }
    Ok(())
}

pub(crate) async fn read_staged_bounded(
    state: &AppState,
    staged: &StagedContent,
) -> AppResult<Vec<u8>> {
    if staged.size > state.config.content_max_item_bytes() {
        return Err(AppError::PayloadTooLarge(
            "staged content exceeds the configured item limit".to_string(),
        ));
    }
    let bytes = tokio::fs::read(&staged.path).await?;
    if bytes.len() as u64 != staged.size {
        return Err(AppError::content_policy_changed());
    }
    Ok(bytes)
}

pub(crate) async fn remove_staged(staged: &StagedContent) {
    if let Err(error) = tokio::fs::remove_file(&staged.path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(error = %error, "failed to remove private staged content");
        }
    }
}

/// Replace a Drive file through a same-directory durable temporary file.
///
/// This primitive is intentionally private to the workspace boundary. A
/// caller that needs to mutate visible content must submit an admission
/// request instead of bypassing inspection, revision checks, or sync enqueue.
async fn atomic_replace_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let path = path.to_path_buf();
    let bytes = bytes.to_vec();
    tokio::task::spawn_blocking(move || atomic_replace_file_blocking(&path, &bytes))
        .await
        .map_err(|error| std::io::Error::other(format!("file write worker failed: {error}")))?
}

fn atomic_replace_file_blocking(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "file has no parent directory",
        )
    })?;
    std::fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("workspace-file");
    let temporary_path = parent.join(format!(".{file_name}.mymy-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut temporary = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)?;
        if let Ok(metadata) = std::fs::metadata(path) {
            temporary.set_permissions(metadata.permissions())?;
        }
        temporary.write_all(bytes)?;
        temporary.sync_all()?;
        std::fs::rename(&temporary_path, path)?;
        if let Err(error) = sync_parent_directory(parent) {
            tracing::warn!(
                error = %error,
                "parent directory sync failed after workspace commit"
            );
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> std::io::Result<()> {
    std::fs::File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod architecture_tests {
    use super::*;

    #[tokio::test]
    async fn atomic_replacement_is_complete_and_cleans_temporary_state() {
        let directory =
            std::env::temp_dir().join(format!("mymy-workspace-replace-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("document.txt");
        std::fs::write(&path, b"before").unwrap();

        atomic_replace_file(&path, b"after-complete").await.unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"after-complete");
        let temporary_files = std::fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".mymy-"))
            .count();
        assert_eq!(temporary_files, 0);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn no_other_rust_module_can_call_the_atomic_drive_primitive() {
        let source_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut violations = Vec::new();
        visit_rust_files(&source_root, &mut |path, source| {
            if path.ends_with("services/workspace_content.rs") {
                return;
            }
            if source.contains("atomic_replace_file(") {
                violations.push(
                    path.strip_prefix(&source_root)
                        .unwrap()
                        .display()
                        .to_string(),
                );
            }
        });
        assert!(
            violations.is_empty(),
            "Drive atomic replacement bypasses found in: {}",
            violations.join(", ")
        );
    }

    #[test]
    fn drive_byte_adapters_cannot_use_direct_filesystem_writes() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let adapters = [
            "src/handlers/drive.rs",
            "src/services/agent_prompts.rs",
            "src/services/document_editor.rs",
            "src/services/drive_sync.rs",
            "src/services/drive/operations.rs",
            "src/services/drive/workspace.rs",
            "src/agent/tools/builtin/file.rs",
            "src/agent/tools/builtin/code_exec/rpc.rs",
            "src/agent/tools/builtin/mcp/content.rs",
        ];
        let forbidden = [
            "std::fs::write(",
            "tokio::fs::write(",
            "fs::write(",
            "std::fs::copy(",
            "tokio::fs::copy(",
            "fs::copy(",
            "File::create(",
        ];
        let violations = adapters
            .into_iter()
            .filter(|relative| {
                let relative = *relative;
                let source = std::fs::read_to_string(manifest.join(relative)).unwrap();
                let production = source.split("#[cfg(test)]").next().unwrap_or(&source);
                forbidden.iter().any(|pattern| production.contains(pattern))
            })
            .collect::<Vec<_>>();
        assert!(
            violations.is_empty(),
            "direct Drive byte writes found in adapters: {}",
            violations.join(", ")
        );
    }

    fn visit_rust_files(root: &Path, visitor: &mut impl FnMut(&Path, &str)) {
        for entry in std::fs::read_dir(root).unwrap().filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                visit_rust_files(&path, visitor);
            } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
                let source = std::fs::read_to_string(&path).unwrap();
                visitor(&path, &source);
            }
        }
    }
}
