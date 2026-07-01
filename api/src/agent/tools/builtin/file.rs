//! Filesystem tools for the native agent.
//!
//! Paths are constrained to the configured working directory. This keeps the
//! tools useful for project work while avoiding accidental reads or writes
//! outside the intended workspace before Phase 8 introduces a richer approval
//! and sandbox policy.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::{truncate_chars, BuiltinToolConfig};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

const MAX_READ_LINES: usize = 1_000;
const DEFAULT_READ_LINES: usize = 500;
const MAX_SEARCH_RESULTS: usize = 100;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let paths = Arc::new(PathPolicy::new(config.working_dir.clone()));

    registry.register(ToolEntry {
        name: "read_file".to_string(),
        toolset: "file_read".to_string(),
        schema: tool_schema(
            "read_file",
            "Read a UTF-8 text file. Returns content with line numbers.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "offset": { "type": "integer", "minimum": 1 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_READ_LINES }
                },
                "required": ["path"]
            }),
        ),
        handler: Arc::new(ReadFileTool {
            paths: Arc::clone(&paths),
        }),
    });

    registry.register(ToolEntry {
        name: "search_files".to_string(),
        toolset: "file_read".to_string(),
        schema: tool_schema(
            "search_files",
            "Search UTF-8 files under the workspace for a literal text pattern.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "path": { "type": "string", "description": "Optional subdirectory." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_SEARCH_RESULTS }
                },
                "required": ["query"]
            }),
        ),
        handler: Arc::new(SearchFilesTool {
            paths: Arc::clone(&paths),
        }),
    });

    registry.register(ToolEntry {
        name: "write_file".to_string(),
        toolset: "file_write".to_string(),
        schema: tool_schema(
            "write_file",
            "Create or overwrite a UTF-8 text file in the workspace.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"]
            }),
        ),
        handler: Arc::new(WriteFileTool {
            paths: Arc::clone(&paths),
        }),
    });

    registry.register(ToolEntry {
        name: "patch_file".to_string(),
        toolset: "file_write".to_string(),
        schema: tool_schema(
            "patch_file",
            "Replace exactly one text occurrence in a UTF-8 file.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "old_string": { "type": "string" },
                    "new_string": { "type": "string" }
                },
                "required": ["path", "old_string", "new_string"]
            }),
        ),
        handler: Arc::new(PatchFileTool { paths }),
    });
}

#[derive(Debug)]
struct PathPolicy {
    root: PathBuf,
}

impl PathPolicy {
    fn new(root: PathBuf) -> Self {
        let root = std::fs::canonicalize(&root).unwrap_or_else(|_| normalize_path(&root));
        Self { root }
    }

    fn resolve_existing(&self, raw: &str) -> Result<PathBuf, ToolError> {
        let normalized = self.normalize_candidate(raw)?;
        let canonical = std::fs::canonicalize(&normalized)
            .map_err(|err| ToolError::InvalidArgs(format!("path cannot be resolved: {err}")))?;
        self.ensure_inside(&canonical, raw)?;
        Ok(canonical)
    }

    fn resolve_for_write(&self, raw: &str) -> Result<PathBuf, ToolError> {
        let normalized = self.normalize_candidate(raw)?;
        if normalized.exists() {
            let canonical = std::fs::canonicalize(&normalized)
                .map_err(|err| ToolError::InvalidArgs(format!("path cannot be resolved: {err}")))?;
            self.ensure_inside(&canonical, raw)?;
            return Ok(canonical);
        }

        let parent = normalized.parent().unwrap_or(&self.root);
        let ancestor = nearest_existing_ancestor(parent)?;
        let canonical_ancestor = std::fs::canonicalize(&ancestor).map_err(|err| {
            ToolError::InvalidArgs(format!("path ancestor cannot be resolved: {err}"))
        })?;
        self.ensure_inside(&canonical_ancestor, raw)?;
        Ok(normalized)
    }

    fn normalize_candidate(&self, raw: &str) -> Result<PathBuf, ToolError> {
        let raw_path = Path::new(raw);
        let candidate = if raw_path.is_absolute() {
            raw_path.to_path_buf()
        } else {
            self.root.join(raw_path)
        };
        let normalized = normalize_path(&candidate);
        self.ensure_inside(&normalized, raw)?;
        Ok(normalized)
    }

    fn ensure_inside(&self, path: &Path, raw: &str) -> Result<(), ToolError> {
        if path.starts_with(&self.root) {
            return Ok(());
        }
        Err(ToolError::InvalidArgs(format!(
            "path escapes workspace: {raw}"
        )))
    }
}

struct ReadFileTool {
    paths: Arc<PathPolicy>,
}

#[async_trait]
impl ToolHandler for ReadFileTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let path = required_str(args, "path")?;
        let offset = args
            .get("offset")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .max(1) as usize;
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_READ_LINES as u64)
            .clamp(1, MAX_READ_LINES as u64) as usize;
        let resolved = self.paths.resolve_existing(path)?;
        let content = tokio::fs::read_to_string(&resolved)
            .await
            .map_err(|err| ToolError::Execution(format!("read failed: {err}")))?;
        let lines: Vec<&str> = content.lines().collect();
        let start = offset.saturating_sub(1).min(lines.len());
        let end = (start + limit).min(lines.len());
        let numbered = (start..end)
            .map(|idx| format!("{}:{}", idx + 1, lines[idx]))
            .collect::<Vec<_>>()
            .join("\n");

        Ok(tool_result(&serde_json::json!({
            "path": resolved.display().to_string(),
            "content": numbered,
            "total_lines": lines.len(),
            "shown_start": start + 1,
            "shown_end": end,
        })))
    }
}

struct WriteFileTool {
    paths: Arc<PathPolicy>,
}

#[async_trait]
impl ToolHandler for WriteFileTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let path = required_str(args, "path")?;
        let content = required_str(args, "content")?;
        let resolved = self.paths.resolve_for_write(path)?;
        if let Some(parent) = resolved.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|err| ToolError::Execution(format!("create parent failed: {err}")))?;
        }
        tokio::fs::write(&resolved, content)
            .await
            .map_err(|err| ToolError::Execution(format!("write failed: {err}")))?;
        Ok(tool_result(&serde_json::json!({
            "path": resolved.display().to_string(),
            "bytes_written": content.len(),
            "lines_written": content.lines().count(),
        })))
    }
}

struct PatchFileTool {
    paths: Arc<PathPolicy>,
}

#[async_trait]
impl ToolHandler for PatchFileTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let path = required_str(args, "path")?;
        let old_string = required_str(args, "old_string")?;
        let new_string = required_str(args, "new_string")?;
        let resolved = self.paths.resolve_existing(path)?;
        let content = tokio::fs::read_to_string(&resolved)
            .await
            .map_err(|err| ToolError::Execution(format!("read failed: {err}")))?;
        let occurrences = content.matches(old_string).count();
        if occurrences != 1 {
            return Err(ToolError::InvalidArgs(format!(
                "old_string must occur exactly once, found {occurrences}"
            )));
        }
        let updated = content.replacen(old_string, new_string, 1);
        tokio::fs::write(&resolved, updated)
            .await
            .map_err(|err| ToolError::Execution(format!("write failed: {err}")))?;
        Ok(tool_result(&serde_json::json!({
            "path": resolved.display().to_string(),
            "replacements": 1,
        })))
    }
}

struct SearchFilesTool {
    paths: Arc<PathPolicy>,
}

#[async_trait]
impl ToolHandler for SearchFilesTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let query = required_str(args, "query")?;
        if query.is_empty() {
            return Err(ToolError::InvalidArgs("query cannot be empty".to_string()));
        }
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(50)
            .clamp(1, MAX_SEARCH_RESULTS as u64) as usize;
        let start = args
            .get("path")
            .and_then(Value::as_str)
            .map(|path| self.paths.resolve_existing(path))
            .transpose()?
            .unwrap_or_else(|| self.paths.root.clone());
        if !start.is_dir() {
            return Err(ToolError::InvalidArgs(format!(
                "search path is not a directory: {}",
                start.display()
            )));
        }
        let mut results = Vec::new();
        search_dir(&self.paths.root, &start, query, limit, &mut results)?;
        Ok(tool_result(&serde_json::json!({ "matches": results })))
    }
}

fn search_dir(
    root: &Path,
    dir: &Path,
    query: &str,
    limit: usize,
    results: &mut Vec<serde_json::Value>,
) -> Result<(), ToolError> {
    if results.len() >= limit {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir)
        .map_err(|err| ToolError::Execution(format!("read_dir failed: {err}")))?;
    for entry in entries {
        if results.len() >= limit {
            break;
        }
        let entry =
            entry.map_err(|err| ToolError::Execution(format!("dir entry failed: {err}")))?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name == ".git"
            || file_name == "target"
            || file_name == "node_modules"
            || file_name == "dist"
        {
            continue;
        }
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|err| ToolError::Execution(format!("file type failed: {err}")))?;
        let Ok(canonical) = std::fs::canonicalize(&path) else {
            continue;
        };
        if !canonical.starts_with(root) {
            continue;
        }
        if file_type.is_dir() {
            search_dir(root, &canonical, query, limit, results)?;
            continue;
        }
        if !canonical.is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&canonical) else {
            continue;
        };
        for (idx, line) in content.lines().enumerate() {
            if line.contains(query) {
                results.push(serde_json::json!({
                    "path": canonical.display().to_string(),
                    "line": idx + 1,
                    "preview": truncate_chars(line.trim(), 300),
                }));
                if results.len() >= limit {
                    break;
                }
            }
        }
    }
    Ok(())
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

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
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

    #[test]
    fn path_policy_rejects_workspace_escape() {
        let root = std::env::current_dir().unwrap();
        let policy = PathPolicy::new(root);
        assert!(policy.resolve_for_write("../outside").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn path_policy_rejects_symlink_escape() {
        let temp_root =
            std::env::temp_dir().join(format!("mymy-file-tool-{}", uuid::Uuid::new_v4()));
        let outside =
            std::env::temp_dir().join(format!("mymy-file-tool-outside-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_root).unwrap();
        std::fs::write(&outside, "secret").unwrap();
        std::os::unix::fs::symlink(&outside, temp_root.join("outside-link")).unwrap();

        let policy = PathPolicy::new(temp_root.clone());
        assert!(policy.resolve_existing("outside-link").is_err());
        assert!(policy.resolve_for_write("outside-link").is_err());

        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&temp_root);
    }
}
