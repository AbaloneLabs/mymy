use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, Utc};

use crate::error::{AppError, AppResult};

pub const DRIVE_PREFIX: &str = "/drive";
pub const AGENTS_MD_FILE: &str = "AGENTS.md";
pub const SOUL_MD_FILE: &str = "SOUL.md";

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

pub(super) fn canonical_or_create(path: &Path) -> AppResult<PathBuf> {
    fs::create_dir_all(path)?;
    Ok(path.canonicalize()?)
}

pub(super) fn canonical_workspace_roots(roots: Vec<PathBuf>) -> AppResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    for root in roots {
        fs::create_dir_all(&root)?;
        out.push(root.canonicalize()?);
    }
    out.sort();
    out.dedup();
    Ok(out)
}

pub(super) fn logical_child_path(parent: &str, child: &str) -> String {
    if parent == DRIVE_PREFIX {
        format!("{DRIVE_PREFIX}/{child}")
    } else {
        format!("{parent}/{child}")
    }
}

pub(super) fn logical_parent_path(logical_path: &str) -> AppResult<String> {
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

pub(super) fn metadata_updated_at(metadata: &fs::Metadata) -> Option<String> {
    metadata.modified().ok().map(|time| {
        let datetime: DateTime<Utc> = time.into();
        datetime.to_rfc3339()
    })
}
