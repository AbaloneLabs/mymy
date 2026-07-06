//! Drive-backed workspace management.
//!
//! The agent runtime is moving away from host-relative paths and toward one
//! durable Drive tree. The API still runs on the host/container filesystem, so
//! this module is the policy boundary: callers speak in logical `/drive/...`
//! paths, while every mutation is resolved under the configured agent data
//! directory. Keeping all path validation here makes the later microVM mount
//! point and S3 sync provider a storage implementation detail instead of a
//! prompt or UI concern.

use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, Utc};
use regex::Regex;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::drive::{
    DriveEntry, DriveEntryKind, DriveFileResponse, DriveListResponse, DriveMutationResponse,
    DriveProviderKind, DriveProviderStatus, DriveProvidersResponse, DriveRestoreResponse,
    DriveSyncJob, DriveSyncJobsResponse, DriveSyncOperation, DriveSyncStatus, DriveTrashEntry,
    DriveTrashResponse, DriveUploadResponse,
};
use crate::services::document_editor::editor_kind_for_path;
use crate::state::AppState;

pub const DRIVE_PREFIX: &str = "/drive";
pub const AGENTS_MD_FILE: &str = "AGENTS.md";
pub const SOUL_MD_FILE: &str = "SOUL.md";
const MAX_TEXT_PREVIEW_BYTES: u64 = 1_000_000;
const MAX_SYNC_JOBS: i64 = 100;

#[derive(Debug, FromRow)]
struct DriveTrashRow {
    id: Uuid,
    original_path: String,
    trash_path: String,
    kind: String,
    size_bytes: i64,
    deleted_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct DriveSyncJobRow {
    id: Uuid,
    provider: String,
    drive_path: String,
    operation: String,
    status: String,
    error: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub fn drive_root(agent_data_dir: &Path) -> PathBuf {
    agent_data_dir.join("drive")
}

pub fn agents_root(agent_data_dir: &Path) -> PathBuf {
    drive_root(agent_data_dir).join("agents")
}

pub fn projects_root(agent_data_dir: &Path) -> PathBuf {
    drive_root(agent_data_dir).join("projects")
}

pub fn shared_root(agent_data_dir: &Path) -> PathBuf {
    drive_root(agent_data_dir).join("shared")
}

pub fn agent_workspace_path(agent_data_dir: &Path, profile: &str) -> PathBuf {
    agents_root(agent_data_dir).join(profile)
}

pub fn agent_agents_md_path(agent_data_dir: &Path, profile: &str) -> PathBuf {
    agent_workspace_path(agent_data_dir, profile).join(AGENTS_MD_FILE)
}

pub fn agent_soul_md_path(agent_data_dir: &Path, profile: &str) -> PathBuf {
    agent_workspace_path(agent_data_dir, profile).join(SOUL_MD_FILE)
}

pub fn project_workspace_path(agent_data_dir: &Path, drive_slug: &str) -> PathBuf {
    projects_root(agent_data_dir).join(drive_slug)
}

pub fn logical_agent_path(profile: &str) -> String {
    format!("{DRIVE_PREFIX}/agents/{profile}")
}

pub fn logical_project_path(drive_slug: &str) -> String {
    format!("{DRIVE_PREFIX}/projects/{drive_slug}")
}

pub fn logical_agent_file_path(profile: &str, file_name: &str) -> String {
    format!("{}/{file_name}", logical_agent_path(profile))
}

pub fn physical_drive_root_from_path(path: &Path) -> Option<PathBuf> {
    let mut root = PathBuf::new();
    for component in path.components() {
        let is_drive = matches!(
            component,
            Component::Normal(name) if name == OsStr::new("drive")
        );
        root.push(component.as_os_str());
        if is_drive {
            return Some(root);
        }
    }
    None
}

pub fn physical_drive_root_from_roots(
    primary_root: &Path,
    extra_roots: &[PathBuf],
) -> Option<PathBuf> {
    physical_drive_root_from_path(primary_root).or_else(|| {
        extra_roots
            .iter()
            .find_map(|root| physical_drive_root_from_path(root))
    })
}

pub fn physical_path_for_logical_drive_path(
    drive_root: &Path,
    logical_path: &Path,
) -> AppResult<Option<PathBuf>> {
    let mut components = logical_path.components();
    if !matches!(components.next(), Some(Component::RootDir)) {
        return Ok(None);
    }
    match components.next() {
        Some(Component::Normal(name)) if name == OsStr::new("drive") => {}
        _ => return Ok(None),
    }

    let mut relative = PathBuf::new();
    for component in components {
        match component {
            Component::Normal(name) => relative.push(name),
            Component::CurDir | Component::ParentDir => {
                return Err(AppError::BadRequest("Invalid Drive path segment".into()));
            }
            _ => return Err(AppError::BadRequest("Invalid Drive path".into())),
        }
    }

    if relative.as_os_str().is_empty() {
        Ok(Some(drive_root.to_path_buf()))
    } else {
        Ok(Some(drive_root.join(relative)))
    }
}

#[derive(Debug, Clone)]
pub struct AgentDriveWorkspace {
    pub agent_profile: String,
    pub project_id: Option<Uuid>,
    pub working_dir: PathBuf,
    pub allowed_roots: Vec<PathBuf>,
}

pub fn ensure_drive_root(state: &AppState) -> AppResult<()> {
    for path in [
        drive_root(&state.config.agent_data_dir),
        agents_root(&state.config.agent_data_dir),
        projects_root(&state.config.agent_data_dir),
        shared_root(&state.config.agent_data_dir),
        drive_root(&state.config.agent_data_dir).join(".trash"),
    ] {
        fs::create_dir_all(&path)?;
    }
    Ok(())
}

pub fn provider_status(state: &AppState) -> DriveProvidersResponse {
    DriveProvidersResponse {
        providers: vec![
            DriveProviderStatus {
                provider: DriveProviderKind::LocalVm,
                configured: true,
                writable: drive_root(&state.config.agent_data_dir).exists(),
                bucket: None,
                region: None,
                endpoint: None,
            },
            DriveProviderStatus {
                provider: DriveProviderKind::S3,
                configured: state.config.drive_s3_bucket.is_some(),
                writable: state.config.drive_s3_bucket.is_some(),
                bucket: state.config.drive_s3_bucket.clone(),
                region: state.config.drive_s3_region.clone(),
                endpoint: state.config.drive_s3_endpoint.clone(),
            },
        ],
    }
}

pub fn project_drive_slug(name: &str, id: Uuid) -> String {
    let slug = name
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let prefix = if slug.is_empty() { "project" } else { &slug };
    let id_suffix = id.simple().to_string();
    format!("{prefix}-{}", &id_suffix[..8])
}

pub fn ensure_agent_workspace(
    state: &AppState,
    profile: &str,
    display_name: &str,
    role: Option<&str>,
) -> AppResult<()> {
    ensure_drive_root(state)?;
    let workspace = agent_workspace_path(&state.config.agent_data_dir, profile);
    fs::create_dir_all(&workspace)?;

    let agents_path = workspace.join(AGENTS_MD_FILE);
    if !agents_path.exists() {
        fs::write(
            &agents_path,
            default_agents_md(profile, display_name, role.unwrap_or("agent")),
        )?;
    }

    let soul_path = workspace.join(SOUL_MD_FILE);
    if !soul_path.exists() {
        fs::write(
            &soul_path,
            default_soul_md(profile, display_name, role.unwrap_or("agent")),
        )?;
    }

    Ok(())
}

pub fn ensure_project_workspace(state: &AppState, drive_slug: &str) -> AppResult<()> {
    ensure_drive_root(state)?;
    fs::create_dir_all(project_workspace_path(
        &state.config.agent_data_dir,
        drive_slug,
    ))?;
    Ok(())
}

pub async fn resolve_agent_drive_workspace(
    state: &AppState,
    profile: &str,
    project_id: Option<Uuid>,
) -> AppResult<AgentDriveWorkspace> {
    let agent = sqlx::query!(
        "SELECT name, role FROM native_agents WHERE profile = $1",
        profile
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent {profile} not found")))?;

    ensure_agent_workspace(state, profile, &agent.name, Some(&agent.role))?;
    let working_dir = agent_workspace_path(&state.config.agent_data_dir, profile);
    let mut allowed_roots = vec![shared_root(&state.config.agent_data_dir)];

    if let Some(project_id) = project_id {
        let project = sqlx::query!("SELECT drive_slug FROM projects WHERE id = $1", project_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
        ensure_project_workspace(state, &project.drive_slug)?;
        allowed_roots.push(project_workspace_path(
            &state.config.agent_data_dir,
            &project.drive_slug,
        ));
    }

    allowed_roots.push(working_dir.clone());
    Ok(AgentDriveWorkspace {
        agent_profile: profile.to_string(),
        project_id,
        working_dir: working_dir.canonicalize()?,
        allowed_roots: canonical_workspace_roots(allowed_roots)?,
    })
}

pub fn archive_agent_workspace(state: &AppState, profile: &str) -> AppResult<()> {
    let source = agent_workspace_path(&state.config.agent_data_dir, profile);
    if !source.exists() {
        return Ok(());
    }
    ensure_drive_root(state)?;
    let stamp = Utc::now().format("%Y%m%d%H%M%S");
    let target = drive_root(&state.config.agent_data_dir)
        .join(".trash")
        .join("agents")
        .join(format!("{profile}-{stamp}"));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(source, target)?;
    Ok(())
}

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
    let content = if is_docx(&resolved.physical_path) {
        extract_docx_text(&resolved.physical_path)?
    } else if is_textual(&resolved.physical_path, &mime_type) {
        if metadata.len() > MAX_TEXT_PREVIEW_BYTES {
            return Err(AppError::BadRequest(
                "Text preview is limited to 1MB files".into(),
            ));
        }
        fs::read_to_string(&resolved.physical_path)?
    } else {
        String::new()
    };

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
    ensure_drive_root(state)?;
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    if let Some(parent) = resolved.physical_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if resolved.physical_path.exists() && fs::metadata(&resolved.physical_path)?.is_dir() {
        return Err(AppError::BadRequest("Cannot overwrite a directory".into()));
    }
    fs::write(&resolved.physical_path, content)?;
    enqueue_s3_sync_job(state, &resolved.logical_path, "upload").await?;
    Ok(())
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

pub async fn list_sync_jobs(state: &AppState) -> AppResult<DriveSyncJobsResponse> {
    let rows = sqlx::query_as!(
        DriveSyncJobRow,
        r#"SELECT id, provider, drive_path, operation, status, error, created_at, updated_at
           FROM drive_sync_jobs
           ORDER BY created_at DESC
           LIMIT $1"#,
        MAX_SYNC_JOBS
    )
    .fetch_all(&state.db)
    .await?;

    Ok(DriveSyncJobsResponse {
        jobs: rows.into_iter().map(row_to_sync_job).collect(),
    })
}

pub async fn enqueue_s3_sync_job(
    state: &AppState,
    logical_path: &str,
    operation: &str,
) -> AppResult<()> {
    if state.config.drive_s3_bucket.is_none() {
        return Ok(());
    }
    let path = normalize_logical_drive_path(logical_path)?;
    sqlx::query!(
        r#"INSERT INTO drive_sync_jobs (provider, drive_path, operation, status)
           VALUES ('s3', $1, $2, 'pending')"#,
        path,
        operation,
    )
    .execute(&state.db)
    .await?;
    Ok(())
}

pub fn physical_path_for_sync(state: &AppState, logical_path: &str) -> AppResult<PathBuf> {
    Ok(resolve_drive_path(&state.config.agent_data_dir, logical_path)?.physical_path)
}

pub fn s3_object_key(logical_path: &str) -> AppResult<String> {
    let normalized = normalize_logical_drive_path(logical_path)?;
    let key = normalized
        .trim_start_matches(DRIVE_PREFIX)
        .trim_start_matches('/')
        .to_string();
    if key.is_empty() {
        return Err(AppError::BadRequest(
            "Drive root cannot be synchronized as a single S3 object".into(),
        ));
    }
    Ok(key)
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

fn row_to_sync_job(row: DriveSyncJobRow) -> DriveSyncJob {
    DriveSyncJob {
        id: row.id.to_string(),
        provider: parse_provider(&row.provider),
        drive_path: row.drive_path,
        operation: parse_sync_operation(&row.operation),
        status: parse_sync_status(&row.status),
        error: row.error,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
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

fn logical_parent_path(logical_path: &str) -> AppResult<String> {
    let normalized = normalize_logical_drive_path(logical_path)?;
    let mut parts = normalized
        .trim_start_matches(DRIVE_PREFIX)
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return Err(AppError::BadRequest("Drive root has no parent".into()));
    }
    parts.pop();
    if parts.is_empty() {
        Ok(DRIVE_PREFIX.to_string())
    } else {
        Ok(format!("{DRIVE_PREFIX}/{}", parts.join("/")))
    }
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

fn canonical_workspace_roots(roots: Vec<PathBuf>) -> AppResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    for root in roots {
        fs::create_dir_all(&root)?;
        out.push(root.canonicalize()?);
    }
    out.sort();
    out.dedup();
    Ok(out)
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

fn parse_provider(value: &str) -> DriveProviderKind {
    match value {
        "s3" => DriveProviderKind::S3,
        _ => DriveProviderKind::LocalVm,
    }
}

fn parse_sync_operation(value: &str) -> DriveSyncOperation {
    match value {
        "download" => DriveSyncOperation::Download,
        "delete" => DriveSyncOperation::Delete,
        _ => DriveSyncOperation::Upload,
    }
}

fn parse_sync_status(value: &str) -> DriveSyncStatus {
    match value {
        "running" => DriveSyncStatus::Running,
        "failed" => DriveSyncStatus::Failed,
        "done" => DriveSyncStatus::Done,
        _ => DriveSyncStatus::Pending,
    }
}

fn default_agents_md(profile: &str, display_name: &str, role: &str) -> String {
    format!(
        r#"# Agent Operating Guide

You are {display_name} (`{profile}`), a mymy sandboxed agent.

## Workspace Boundaries

- Treat this directory as your private local workspace.
- Use `/drive/shared` for files that must be visible to other agents.
- Use `/drive/projects/<project>` for project files when a project is assigned.
- Do not attempt to inspect or modify another agent's private workspace.

## Execution

- Prefer small, verifiable changes.
- Keep generated files inside the Drive roots that are explicitly available to you.
- When running a development server, bind to `0.0.0.0` and report the port so mymy can expose a preview endpoint.

## Role

{role}
"#
    )
}

fn default_soul_md(profile: &str, display_name: &str, role: &str) -> String {
    format!(
        r#"# SOUL

Name: {display_name}
Profile: {profile}
Role: {role}

Operate as a careful, self-auditing agent. Preserve user data, keep work inside
the assigned Drive workspace, and explain meaningful risks before taking action.
"#
    )
}

pub struct ResolvedDrivePath {
    pub physical_path: PathBuf,
    pub logical_path: String,
}

pub fn resolve_drive_path(
    agent_data_dir: &Path,
    logical_path: &str,
) -> AppResult<ResolvedDrivePath> {
    let root = canonical_or_create(&drive_root(agent_data_dir))?;
    let normalized = normalize_logical_drive_path(logical_path)?;
    let relative = normalized
        .trim_start_matches(DRIVE_PREFIX)
        .trim_start_matches('/');
    let physical_path = if relative.is_empty() {
        root.clone()
    } else {
        root.join(relative)
    };

    let boundary_target = if physical_path.exists() {
        physical_path.canonicalize()?
    } else {
        physical_path
            .parent()
            .ok_or_else(|| AppError::BadRequest("Invalid Drive path".into()))?
            .canonicalize()?
    };
    if !boundary_target.starts_with(&root) {
        return Err(AppError::BadRequest(
            "Path is outside the Drive root".into(),
        ));
    }

    Ok(ResolvedDrivePath {
        physical_path,
        logical_path: normalized,
    })
}

pub fn normalize_logical_drive_path(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(DRIVE_PREFIX.to_string());
    }
    if trimmed != DRIVE_PREFIX && !trimmed.starts_with(&format!("{DRIVE_PREFIX}/")) {
        return Err(AppError::BadRequest(
            "Drive paths must start with /drive".into(),
        ));
    }

    let mut parts = Vec::new();
    for raw_part in trimmed.trim_start_matches(DRIVE_PREFIX).split('/') {
        if raw_part.is_empty() {
            continue;
        }
        if raw_part == "." || raw_part == ".." {
            return Err(AppError::BadRequest("Invalid Drive path segment".into()));
        }
        parts.push(raw_part.to_string());
    }

    if parts.is_empty() {
        Ok(DRIVE_PREFIX.to_string())
    } else {
        Ok(format!("{DRIVE_PREFIX}/{}", parts.join("/")))
    }
}

fn canonical_or_create(path: &Path) -> AppResult<PathBuf> {
    fs::create_dir_all(path)?;
    Ok(path.canonicalize()?)
}

fn logical_child_path(parent: &str, child: &str) -> String {
    if parent == DRIVE_PREFIX {
        format!("{DRIVE_PREFIX}/{child}")
    } else {
        format!("{parent}/{child}")
    }
}

fn metadata_updated_at(metadata: &fs::Metadata) -> Option<String> {
    metadata.modified().ok().map(|time| {
        let datetime: DateTime<Utc> = time.into();
        datetime.to_rfc3339()
    })
}

fn mime_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" => "text/markdown",
        "txt" | "log" => "text/plain",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "rs" => "text/x-rust",
        "py" => "text/x-python",
        "sh" => "application/x-sh",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

fn is_docx(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("docx"))
}

fn is_textual(path: &Path, mime_type: &str) -> bool {
    if mime_type.starts_with("text/") {
        return true;
    }
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "json" | "yaml" | "yml" | "toml" | "rs" | "py" | "sh"
    )
}

fn is_editable(path: &Path) -> bool {
    let mime_type = mime_type_for_path(path);
    is_textual(path, mime_type)
}

fn extract_docx_text(path: &Path) -> AppResult<String> {
    let file = File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| AppError::Internal(format!("Failed to read docx archive: {error}")))?;
    let mut document = archive
        .by_name("word/document.xml")
        .map_err(|error| AppError::Internal(format!("Failed to read docx document: {error}")))?;
    let mut xml = String::new();
    document.read_to_string(&mut xml)?;

    let paragraph_re = Regex::new(r"</w:p>").expect("static regex");
    let tag_re = Regex::new(r"<[^>]+>").expect("static regex");
    let entity_re = Regex::new(r"&(?:amp|lt|gt|quot|apos);").expect("static regex");
    let with_breaks = paragraph_re.replace_all(&xml, "\n");
    let stripped = tag_re.replace_all(&with_breaks, "");
    let decoded = entity_re.replace_all(&stripped, |caps: &regex::Captures<'_>| match &caps[0] {
        "&amp;" => "&",
        "&lt;" => "<",
        "&gt;" => ">",
        "&quot;" => "\"",
        "&apos;" => "'",
        _ => "",
    });
    Ok(decoded
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logical_drive_path_maps_to_physical_root() {
        let drive_root = Path::new("/tmp/mymy-test/drive");
        let mapped =
            physical_path_for_logical_drive_path(drive_root, Path::new("/drive/shared/a.md"))
                .unwrap()
                .unwrap();
        assert_eq!(mapped, PathBuf::from("/tmp/mymy-test/drive/shared/a.md"));
    }

    #[test]
    fn logical_drive_mapping_rejects_parent_segments() {
        let drive_root = Path::new("/tmp/mymy-test/drive");
        let err = physical_path_for_logical_drive_path(drive_root, Path::new("/drive/shared/../x"))
            .unwrap_err();
        assert!(err.to_string().contains("Invalid Drive path segment"));
    }

    #[test]
    fn normalize_logical_drive_path_rejects_similar_prefixes() {
        let err = normalize_logical_drive_path("/drivefoo").unwrap_err();
        assert!(err.to_string().contains("Drive paths must start"));
    }
}
