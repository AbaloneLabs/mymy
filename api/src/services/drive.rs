//! Drive-backed workspace management.
//!
//! The agent runtime is moving away from host-relative paths and toward one
//! durable Drive tree. The API still runs on the host/container filesystem, so
//! this module is the policy boundary: callers speak in logical `/drive/...`
//! paths, while every mutation is resolved under the configured agent data
//! directory. Keeping all path validation here makes the later microVM mount
//! point and S3 sync provider a storage implementation detail instead of a
//! prompt or UI concern.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use regex::Regex;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::drive::{
    DriveEntry, DriveEntryKind, DriveFileResponse, DriveListResponse, DriveProviderKind,
    DriveProviderStatus, DriveProvidersResponse,
};
use crate::state::AppState;

const DRIVE_PREFIX: &str = "/drive";
const MAX_TEXT_PREVIEW_BYTES: u64 = 1_000_000;

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

pub fn project_workspace_path(agent_data_dir: &Path, drive_slug: &str) -> PathBuf {
    projects_root(agent_data_dir).join(drive_slug)
}

pub fn logical_agent_path(profile: &str) -> String {
    format!("{DRIVE_PREFIX}/agents/{profile}")
}

pub fn logical_project_path(drive_slug: &str) -> String {
    format!("{DRIVE_PREFIX}/projects/{drive_slug}")
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

    let agents_path = workspace.join("AGENTS.md");
    if !agents_path.exists() {
        fs::write(
            &agents_path,
            default_agents_md(profile, display_name, role.unwrap_or("agent")),
        )?;
    }

    let soul_path = workspace.join("SOUL.md");
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
    fs::write(resolved.physical_path, content)?;
    Ok(())
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
    let stamp = Utc::now().format("%Y%m%d%H%M%S");
    let safe_name = resolved
        .physical_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "drive-entry".to_string());
    let target = trash_root.join(format!("{safe_name}-{stamp}"));
    fs::rename(resolved.physical_path, target)?;
    Ok(())
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

struct ResolvedDrivePath {
    physical_path: PathBuf,
    logical_path: String,
}

fn resolve_drive_path(agent_data_dir: &Path, logical_path: &str) -> AppResult<ResolvedDrivePath> {
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

fn normalize_logical_drive_path(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(DRIVE_PREFIX.to_string());
    }
    if !trimmed.starts_with(DRIVE_PREFIX) {
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
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "rs" => "text/x-rust",
        "py" => "text/x-python",
        "sh" => "application/x-sh",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
