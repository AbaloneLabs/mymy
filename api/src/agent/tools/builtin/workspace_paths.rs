//! Shared path policy for built-in tools.
//!
//! Agents are instructed to use logical `/drive/...` paths, while built-in
//! tools execute inside the API process where the same files live under the
//! configured agent data directory. This policy keeps that translation in one
//! place so file, terminal, and code-execution tools enforce the same workspace
//! boundary before touching the host filesystem.

use std::path::{Component, Path, PathBuf};

use crate::agent::tools::ToolError;
use crate::services::drive;

#[derive(Debug, Clone)]
pub(super) struct WorkspacePathPolicy {
    root: PathBuf,
    allowed_roots: Vec<PathBuf>,
    drive_root: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub(super) struct ResolvedWorkspacePath {
    pub physical: PathBuf,
    pub logical: String,
}

impl WorkspacePathPolicy {
    pub(super) fn new(root: PathBuf, allowed_roots: Vec<PathBuf>) -> Self {
        let root = std::fs::canonicalize(&root).unwrap_or_else(|_| normalize_path(&root));
        let mut all_roots = vec![root.clone()];
        all_roots.extend(
            allowed_roots
                .into_iter()
                .map(|path| std::fs::canonicalize(&path).unwrap_or_else(|_| normalize_path(&path))),
        );
        all_roots.sort();
        all_roots.dedup();
        let drive_root = drive::physical_drive_root_from_roots(&root, &all_roots);
        Self {
            root,
            allowed_roots: all_roots,
            drive_root,
        }
    }

    pub(super) fn root(&self) -> &Path {
        &self.root
    }

    pub(super) fn resolve_existing(&self, raw: &str) -> Result<PathBuf, ToolError> {
        Ok(self.resolve_existing_with_logical(raw)?.physical)
    }

    pub(super) fn resolve_existing_with_logical(
        &self,
        raw: &str,
    ) -> Result<ResolvedWorkspacePath, ToolError> {
        self.resolve_existing_path_with_logical(Path::new(raw))
    }

    pub(super) fn resolve_existing_path(&self, raw: &Path) -> Result<PathBuf, ToolError> {
        Ok(self.resolve_existing_path_with_logical(raw)?.physical)
    }

    pub(super) fn resolve_existing_internal_path(&self, raw: &Path) -> Result<PathBuf, ToolError> {
        let normalized = self.normalize_candidate(raw, true)?;
        let canonical = std::fs::canonicalize(&normalized)
            .map_err(|err| ToolError::InvalidArgs(format!("path cannot be resolved: {err}")))?;
        self.ensure_inside(&canonical, &raw.display().to_string())?;
        Ok(canonical)
    }

    pub(super) fn resolve_existing_path_with_logical(
        &self,
        raw: &Path,
    ) -> Result<ResolvedWorkspacePath, ToolError> {
        let normalized = self.normalize_candidate(raw, false)?;
        let canonical = std::fs::canonicalize(&normalized)
            .map_err(|err| ToolError::InvalidArgs(format!("path cannot be resolved: {err}")))?;
        self.ensure_inside(&canonical, &raw.display().to_string())?;
        Ok(ResolvedWorkspacePath {
            logical: self.logical_path_for(&canonical),
            physical: canonical,
        })
    }

    #[cfg(test)]
    pub(super) fn resolve_for_write(&self, raw: &str) -> Result<PathBuf, ToolError> {
        Ok(self.resolve_for_write_with_logical(raw)?.physical)
    }

    pub(super) fn resolve_for_write_with_logical(
        &self,
        raw: &str,
    ) -> Result<ResolvedWorkspacePath, ToolError> {
        self.resolve_for_write_path_with_logical(Path::new(raw))
    }

    pub(super) fn resolve_for_write_internal_path(&self, raw: &Path) -> Result<PathBuf, ToolError> {
        Ok(self.resolve_for_write_path_impl(raw, true)?.physical)
    }

    pub(super) fn resolve_for_write_path_with_logical(
        &self,
        raw: &Path,
    ) -> Result<ResolvedWorkspacePath, ToolError> {
        self.resolve_for_write_path_impl(raw, false)
    }

    fn resolve_for_write_path_impl(
        &self,
        raw: &Path,
        allow_internal_absolute: bool,
    ) -> Result<ResolvedWorkspacePath, ToolError> {
        let normalized = self.normalize_candidate(raw, allow_internal_absolute)?;
        let raw_label = raw.display().to_string();
        if normalized.exists() {
            let canonical = std::fs::canonicalize(&normalized)
                .map_err(|err| ToolError::InvalidArgs(format!("path cannot be resolved: {err}")))?;
            self.ensure_inside(&canonical, &raw_label)?;
            return Ok(ResolvedWorkspacePath {
                logical: self.logical_path_for(&canonical),
                physical: canonical,
            });
        }

        let parent = normalized.parent().unwrap_or(&self.root);
        let ancestor = nearest_existing_ancestor(parent)?;
        let canonical_ancestor = std::fs::canonicalize(&ancestor).map_err(|err| {
            ToolError::InvalidArgs(format!("path ancestor cannot be resolved: {err}"))
        })?;
        self.ensure_inside(&canonical_ancestor, &raw_label)?;
        Ok(ResolvedWorkspacePath {
            logical: self.logical_path_for(&normalized),
            physical: normalized,
        })
    }

    pub(super) fn resolve_directory_path(&self, raw: &Path) -> Result<PathBuf, ToolError> {
        let canonical = self.resolve_existing_path(raw)?;
        if canonical.is_dir() {
            return Ok(canonical);
        }
        Err(ToolError::InvalidArgs(format!(
            "workdir is not a directory: {}",
            canonical.display()
        )))
    }

    pub(super) fn is_inside(&self, path: &Path) -> bool {
        self.allowed_roots.iter().any(|root| path.starts_with(root))
    }

    fn normalize_candidate(
        &self,
        raw: &Path,
        allow_internal_absolute: bool,
    ) -> Result<PathBuf, ToolError> {
        if !allow_internal_absolute {
            self.reject_malformed_agent_path(raw)?;
        }
        let candidate = if raw.is_absolute() {
            self.map_logical_drive_path(raw)?
                .unwrap_or_else(|| raw.to_path_buf())
        } else {
            self.root.join(raw)
        };
        let normalized = normalize_path(&candidate);
        self.ensure_inside(&normalized, &raw.display().to_string())?;
        Ok(normalized)
    }

    fn reject_malformed_agent_path(&self, raw: &Path) -> Result<(), ToolError> {
        let parts = raw
            .components()
            .filter_map(|component| match component {
                Component::Normal(name) => Some(name.to_string_lossy().to_string()),
                _ => None,
            })
            .collect::<Vec<_>>();
        let Some(first) = parts.first().map(String::as_str) else {
            return Ok(());
        };

        if raw.is_absolute() && first != "drive" {
            return Err(ToolError::InvalidArgs(
                "absolute file tool paths must start with /drive".to_string(),
            ));
        }
        if !raw.is_absolute() && matches!(first, "drive" | "agents" | "shared" | "projects") {
            return Err(ToolError::InvalidArgs(
                "for private files, omit the workspace prefix and pass a relative path like notes/report.md; for shared files, use /drive/shared/report.md".to_string(),
            ));
        }
        Ok(())
    }

    fn map_logical_drive_path(&self, raw: &Path) -> Result<Option<PathBuf>, ToolError> {
        let Some(drive_root) = &self.drive_root else {
            return Ok(None);
        };
        drive::physical_path_for_logical_drive_path(drive_root, raw)
            .map_err(|err| ToolError::InvalidArgs(format!("invalid logical Drive path: {err}")))
    }

    fn ensure_inside(&self, path: &Path, raw: &str) -> Result<(), ToolError> {
        if self.is_inside(path) {
            return Ok(());
        }
        Err(ToolError::InvalidArgs(format!(
            "path escapes workspace: {raw}"
        )))
    }

    pub(super) fn logical_path_for(&self, path: &Path) -> String {
        if let Some(drive_root) = &self.drive_root {
            if path == drive_root {
                return "/drive".to_string();
            }
            if let Ok(relative) = path.strip_prefix(drive_root) {
                let suffix = relative
                    .components()
                    .filter_map(|component| match component {
                        Component::Normal(name) => Some(name.to_string_lossy().to_string()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("/");
                if suffix.is_empty() {
                    return "/drive".to_string();
                }
                return format!("/drive/{suffix}");
            }
        }
        path.display().to_string()
    }
}

fn nearest_existing_ancestor(path: &Path) -> Result<PathBuf, ToolError> {
    let mut current = path.to_path_buf();
    loop {
        if current.exists() {
            return Ok(current);
        }
        if !current.pop() {
            return Err(ToolError::InvalidArgs(format!(
                "path has no existing ancestor: {}",
                path.display()
            )));
        }
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_drive() -> (PathBuf, PathBuf, PathBuf) {
        let base =
            std::env::temp_dir().join(format!("mymy-workspace-paths-{}", uuid::Uuid::new_v4()));
        let agent = base.join("drive").join("agents").join("elena");
        let shared = base.join("drive").join("shared");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::create_dir_all(&shared).unwrap();
        (base, agent, shared)
    }

    #[test]
    fn logical_drive_path_resolves_to_allowed_shared_root() {
        let (base, agent, shared) = temp_drive();
        let policy = WorkspacePathPolicy::new(agent, vec![shared.clone()]);

        let resolved = policy.resolve_for_write("/drive/shared/check.md").unwrap();
        assert_eq!(resolved, shared.join("check.md"));

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn logical_drive_path_rejects_other_agent_root() {
        let (base, agent, shared) = temp_drive();
        let policy = WorkspacePathPolicy::new(agent, vec![shared]);

        assert!(policy
            .resolve_for_write("/drive/agents/other/check.md")
            .is_err());

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn logical_drive_path_rejects_parent_segments() {
        let (base, agent, shared) = temp_drive();
        let policy = WorkspacePathPolicy::new(agent, vec![shared]);

        let err = policy
            .resolve_for_write("/drive/shared/../agents/elena/check.md")
            .unwrap_err();
        assert!(err.to_string().contains("invalid logical Drive path"));

        let _ = std::fs::remove_dir_all(base);
    }
}
