use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use super::super::workspace_paths::WorkspacePathPolicy;
use super::{MAX_LABEL_CHARS, MAX_PREVIEW_PORT, MIN_PREVIEW_PORT};
use crate::agent::security::{ensure_read_allowed, ensure_write_allowed};
use crate::agent::tools::ToolError;
use crate::error::AppError;
use crate::services::audit::log_security_denial_safe;
use crate::state::AppState;

pub(super) fn parse_preview_port(value: Option<&Value>) -> Result<Option<u16>, ToolError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let Some(port) = value.as_u64() else {
        return Err(ToolError::InvalidArgs(
            "port must be an integer".to_string(),
        ));
    };
    if !(MIN_PREVIEW_PORT..=MAX_PREVIEW_PORT).contains(&port) {
        return Err(ToolError::InvalidArgs(format!(
            "port must be between {MIN_PREVIEW_PORT} and {MAX_PREVIEW_PORT}"
        )));
    }
    Ok(Some(port as u16))
}

pub(super) fn validate_label(value: &str, label: &str) -> Result<String, ToolError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(ToolError::InvalidArgs(format!("{label} cannot be empty")));
    }
    if value.chars().count() > MAX_LABEL_CHARS {
        return Err(ToolError::InvalidArgs(format!(
            "{label} must be at most {MAX_LABEL_CHARS} characters"
        )));
    }
    Ok(value)
}

pub(super) async fn check_redirected_paths(
    db: Option<&sqlx::PgPool>,
    state: Option<&AppState>,
    command: &str,
    workdir: &Path,
    allowed_roots: &[PathBuf],
) -> Result<(), ToolError> {
    let paths = WorkspacePathPolicy::new(workdir.to_path_buf(), allowed_roots.to_vec());
    for target in literal_drive_targets(command) {
        let resolved = paths.resolve_for_write_with_logical(&target)?;
        ensure_content_access(state, &resolved.logical).await?;
    }
    for target in redirected_targets(output_redirection_regex(), command) {
        let path = paths.resolve_for_write_internal_path(&resolve_shell_path(workdir, &target))?;
        ensure_content_access(state, &paths.logical_path_for(&path)).await?;
        if let Err(error) = ensure_write_allowed(&path) {
            audit_terminal_denial(db, "terminal_write_redirect", &path, &error).await;
            return Err(error);
        }
    }
    for target in redirected_targets(input_redirection_regex(), command) {
        let candidate =
            paths.resolve_for_write_internal_path(&resolve_shell_path(workdir, &target))?;
        ensure_content_access(state, &paths.logical_path_for(&candidate)).await?;
        let path = paths.resolve_existing_internal_path(&resolve_shell_path(workdir, &target))?;
        if let Err(error) = ensure_read_allowed(&path) {
            audit_terminal_denial(db, "terminal_read_redirect", &path, &error).await;
            return Err(error);
        }
    }
    Ok(())
}

fn literal_drive_targets(command: &str) -> Vec<String> {
    literal_drive_path_regex()
        .find_iter(command)
        .map(|value| {
            value
                .as_str()
                .trim_end_matches([',', ')', ']', '}'])
                .to_string()
        })
        .collect()
}

fn literal_drive_path_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"/drive(?:/[^\s'\";&|<>]*)?"#).expect("literal Drive path regex compiles")
    })
}

async fn ensure_content_access(
    state: Option<&AppState>,
    logical_path: &str,
) -> Result<(), ToolError> {
    let Some(state) = state else {
        return Ok(());
    };
    state
        .workspace_content
        .ensure_not_quarantined(state, logical_path)
        .await
        .map_err(|error| match error {
            AppError::Coded { code, message, .. } => ToolError::Coded { code, message },
            other => ToolError::Execution(other.to_string()),
        })
}

fn redirected_targets(regex: &Regex, command: &str) -> Vec<String> {
    regex
        .captures_iter(command)
        .filter_map(|captures| {
            [1, 2, 3]
                .into_iter()
                .find_map(|idx| captures.get(idx).map(|value| value.as_str().to_string()))
        })
        .filter(|target| !target.starts_with('&') && !target.starts_with('<'))
        .collect()
}

fn output_redirection_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?m)(?:^|[\s;&|])(?:\d?>{1,2}|&>|>\|)\s*(?:'([^']+)'|"([^"]+)"|([^\s;&|]+))"#)
            .expect("output redirection regex compiles")
    })
}

fn input_redirection_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?m)(?:^|[\s;&|])(?:\d?<)\s*(?:'([^']+)'|"([^"]+)"|([^\s;&|]+))"#)
            .expect("input redirection regex compiles")
    })
}

fn resolve_shell_path(workdir: &Path, target: &str) -> PathBuf {
    if let Some(rest) = target.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    let path = Path::new(target);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        workdir.join(path)
    }
}

async fn audit_terminal_denial(
    db: Option<&sqlx::PgPool>,
    operation: &str,
    path: &Path,
    error: &ToolError,
) {
    if let Some(db) = db {
        log_security_denial_safe(
            db,
            operation,
            &path.display().to_string(),
            &error.to_string(),
        )
        .await;
    }
}

pub(super) fn ensure_directory(
    root: &Path,
    allowed_roots: &[PathBuf],
    path: &Path,
) -> Result<PathBuf, ToolError> {
    WorkspacePathPolicy::new(root.to_path_buf(), allowed_roots.to_vec())
        .resolve_directory_path(path)
}

pub(super) fn allowed_roots(root: &Path, extra_roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut roots = vec![std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf())];
    roots.extend(
        extra_roots
            .iter()
            .map(|path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())),
    );
    roots.sort();
    roots.dedup();
    roots
}
