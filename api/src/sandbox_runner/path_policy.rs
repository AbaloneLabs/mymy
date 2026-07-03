//! Path and environment policy for runner-mounted workspaces.
//!
//! The API sends physical Drive paths and logical mount paths to the runner.
//! This module is the last line of defense before execution: every requested
//! root must already exist, must stay under the runner data root, and the
//! command working directory must map to one of the mounted roots.

use std::path::{Path, PathBuf};

use tokio::process::Command;

use super::error::RunnerError;
use super::types::PreparedRoot;

pub(crate) fn canonicalize_existing(path: &str) -> Result<PathBuf, RunnerError> {
    Path::new(path)
        .canonicalize()
        .map_err(|err| RunnerError::BadRequest(format!("invalid path {path}: {err}")))
}

pub(crate) fn add_parent_dirs(cmd: &mut Command, path: &Path) {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if current == Path::new("/") || current == path {
            continue;
        }
        cmd.arg("--dir").arg(&current);
    }
}

pub(crate) fn writable_root_paths(roots: &[PreparedRoot]) -> Vec<PathBuf> {
    let mut paths = roots
        .iter()
        .filter(|root| root.writable)
        .map(|root| root.host_path.clone())
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    paths
}

pub(crate) fn map_host_path_to_mount(path: &Path, roots: &[PreparedRoot]) -> Option<PathBuf> {
    roots
        .iter()
        .filter(|root| path.starts_with(&root.host_path))
        .max_by_key(|root| root.host_path.components().count())
        .map(|root| {
            let suffix = path.strip_prefix(&root.host_path).unwrap_or(Path::new(""));
            root.mount_path.join(suffix)
        })
}

pub(crate) fn is_safe_env_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
        && !key.contains("KEY")
        && !key.contains("TOKEN")
        && !key.contains("SECRET")
        && !key.contains("PASSWORD")
}
