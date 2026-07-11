//! Filesystem tools for the native agent.
//!
//! Paths are constrained to the agent workspace plus explicit Drive roots.
//! The policy mirrors the sandbox mount layout: the private agent workspace is
//! the default root for relative paths, while shared and project directories are
//! available only when the session grants them.

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::{truncate_chars, workspace_paths::WorkspacePathPolicy, BuiltinToolConfig};
use crate::agent::security::{
    ensure_read_allowed, ensure_write_allowed, is_sensitive_path, redact_sensitive_text,
};
use crate::agent::tools::{
    app_error_to_tool, tool_result, tool_schema, ToolCapability, ToolEffect, ToolEntry, ToolError,
    ToolHandler, ToolRegistry,
};
use crate::error::AppError;
use crate::models::content_security::ContentOrigin;
use crate::services::audit::log_security_denial_safe;
use crate::services::document_revisions::{record_document_revision, RevisionActor};
use crate::services::file_observations::{
    ensure_file_not_changed_since_observed, fingerprint_path, record_file_observation,
    record_file_observation_fingerprint, FileFingerprint, FileObservationSource,
};
use crate::services::workspace_content::{AdmissionActor, AdmissionOutcome, AdmissionRequest};
use crate::state::AppState;

const MAX_READ_LINES: usize = 1_000;
const DEFAULT_READ_LINES: usize = 500;
const MAX_SEARCH_RESULTS: usize = 100;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let paths = Arc::new(WorkspacePathPolicy::new(
        config.working_dir.clone(),
        config.allowed_roots.clone(),
    ));

    registry.register(ToolEntry {
        name: "read_file".to_string(),
        toolset: "drive_read".to_string(),
        schema: tool_schema(
            "read_file",
            "Read a UTF-8 text file. Use a relative path for your private workspace, or /drive/shared/... for shared files.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Examples: report.md, notes/plan.md, /drive/shared/report.md. Do not pass drive/agents/... or host paths." },
                    "offset": { "type": "integer", "minimum": 1 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_READ_LINES }
                },
                "required": ["path"]
            }),
        ),
        capability: ToolCapability::read("file").with_resource_argument("path"),
        handler: Arc::new(ReadFileTool {
            paths: Arc::clone(&paths),
            db: config.db.clone(),
            agent_profile: config.agent_profile.clone(),
            app_state: config.app_state.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "search_files".to_string(),
        toolset: "drive_read".to_string(),
        schema: tool_schema(
            "search_files",
            "Search UTF-8 files under your available workspace roots for a literal text pattern.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "path": { "type": "string", "description": "Optional relative subdirectory or /drive/... logical path." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_SEARCH_RESULTS }
                },
                "required": ["query"]
            }),
        ),
        capability: ToolCapability::read("file").with_resource_argument("path"),
        handler: Arc::new(SearchFilesTool {
            paths: Arc::clone(&paths),
        }),
    });

    registry.register(ToolEntry {
        name: "write_file".to_string(),
        toolset: "drive_write".to_string(),
        schema: tool_schema(
            "write_file",
            "Create or overwrite a UTF-8 text file. Use relative paths for private files and /drive/shared/... for shared files.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Examples: report.md, notes/plan.md, /drive/shared/report.md. Do not pass drive/agents/... or host paths." },
                    "content": { "type": "string" },
                    "expectedFingerprint": { "type": "string", "description": "Fingerprint returned by read_file. Required when overwriting an existing file." }
                },
                "required": ["path", "content"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Update, "file")
            .with_resource_argument("path"),
        handler: Arc::new(WriteFileTool {
            paths: Arc::clone(&paths),
            db: config.db.clone(),
            agent_profile: config.agent_profile.clone(),
            app_state: config.app_state.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "patch_file".to_string(),
        toolset: "drive_write".to_string(),
        schema: tool_schema(
            "patch_file",
            "Replace exactly one text occurrence in a UTF-8 text file.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative private path or /drive/... logical path." },
                    "old_string": { "type": "string" },
                    "new_string": { "type": "string" },
                    "expectedFingerprint": { "type": "string", "description": "Fingerprint returned by read_file." }
                },
                "required": ["path", "old_string", "new_string", "expectedFingerprint"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Update, "file")
            .with_resource_argument("path"),
        handler: Arc::new(PatchFileTool {
            paths,
            db: config.db.clone(),
            agent_profile: config.agent_profile.clone(),
            app_state: config.app_state.clone(),
        }),
    });
}

struct ReadFileTool {
    paths: Arc<WorkspacePathPolicy>,
    db: Option<sqlx::PgPool>,
    agent_profile: Option<String>,
    app_state: Option<Arc<AppState>>,
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
        // Hold namespace and file locks across content, fingerprint, and
        // observation reads. Otherwise the tool could return text from one
        // revision with the fingerprint of the next revision and authorize a
        // later overwrite the agent never actually reviewed.
        let candidate = self.paths.resolve_for_write_with_logical(path)?;
        ensure_content_access(self.app_state.as_deref(), &candidate.logical).await?;
        let _namespace_guard = match self.app_state.as_deref() {
            Some(state) => Some(state.drive_namespace_lock().read().await),
            None => None,
        };
        let resolved = self.paths.resolve_existing_with_logical(path)?;
        let _write_guard = match self.app_state.as_deref() {
            Some(state) => Some(
                state
                    .drive_write_lock(&resolved.physical)
                    .await
                    .lock_owned()
                    .await,
            ),
            None => None,
        };
        if let Err(err) = ensure_read_allowed(&resolved.physical) {
            audit_guardrail_denial(self.db.as_ref(), "read", &resolved.physical, &err).await;
            return Err(err);
        }
        let content = tokio::fs::read_to_string(&resolved.physical)
            .await
            .map_err(|err| ToolError::Execution(format!("read failed: {err}")))?;
        let fingerprint = fingerprint_path(&resolved.physical)
            .await
            .map_err(ToolError::Execution)?;
        let lines: Vec<&str> = content.lines().collect();
        let start = offset.saturating_sub(1).min(lines.len());
        let end = (start + limit).min(lines.len());
        let numbered = (start..end)
            .map(|idx| format!("{}:{}", idx + 1, lines[idx]))
            .collect::<Vec<_>>()
            .join("\n");
        let numbered = redact_sensitive_text(&numbered);
        record_file_observation(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            &resolved.logical,
            &resolved.physical,
            FileObservationSource::Read,
        )
        .await
        .map_err(ToolError::Execution)?;

        Ok(tool_result(&serde_json::json!({
            "path": resolved.logical,
            "content": numbered,
            "total_lines": lines.len(),
            "shown_start": start + 1,
            "shown_end": end,
            "fingerprint": fingerprint.hash,
        })))
    }
}

struct WriteFileTool {
    paths: Arc<WorkspacePathPolicy>,
    db: Option<sqlx::PgPool>,
    agent_profile: Option<String>,
    app_state: Option<Arc<AppState>>,
}

#[async_trait]
impl ToolHandler for WriteFileTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        self.write(args).await
    }
}

impl WriteFileTool {
    async fn write(&self, args: &Value) -> Result<String, ToolError> {
        let path = required_str(args, "path")?;
        let content = required_str(args, "content")?;
        let resolved = self.paths.resolve_for_write_with_logical(path)?;
        ensure_content_access(self.app_state.as_deref(), &resolved.logical).await?;
        if let Err(err) = ensure_write_allowed(&resolved.physical) {
            audit_guardrail_denial(self.db.as_ref(), "write", &resolved.physical, &err).await;
            return Err(err);
        }
        ensure_file_not_changed_since_observed(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            &resolved.logical,
            &resolved.physical,
        )
        .await
        .map_err(ToolError::Execution)?;
        let existed = resolved.physical.exists();
        let expected = if existed {
            Some(
                args.get("expectedFingerprint")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        ToolError::InvalidArgs(
                            "expectedFingerprint is required when overwriting an existing file"
                                .to_string(),
                        )
                    })?,
            )
        } else {
            None
        };
        if let Some(expected) = expected {
            let current = fingerprint_path(&resolved.physical)
                .await
                .map_err(ToolError::Execution)?;
            if expected != current.hash {
                return Err(ToolError::Execution(
                    "File fingerprint changed before overwrite; read the file again".to_string(),
                ));
            }
        }
        let state = self.app_state.as_deref().ok_or_else(|| {
            ToolError::Unavailable("workspace content service is not configured".to_string())
        })?;
        let outcome = state
            .workspace_content
            .admit_bytes(
                state,
                AdmissionRequest {
                    desired_path: resolved.logical.clone(),
                    file_name: resolved
                        .physical
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("file")
                        .to_string(),
                    origin: ContentOrigin::AgentGenerated,
                    actor: AdmissionActor::agent(self.agent_profile.as_deref(), None),
                    expected_fingerprint: expected.map(str::to_string),
                    allow_overwrite: existed,
                    enqueue_s3_sync: true,
                },
                content.as_bytes(),
            )
            .await
            .map_err(app_error_to_tool)?;
        match outcome {
            AdmissionOutcome::Committed { .. } => {}
            AdmissionOutcome::Quarantined { .. } => {
                return Err(app_error_to_tool(AppError::content_quarantined()));
            }
            AdmissionOutcome::Rejected => {
                return Err(app_error_to_tool(AppError::content_rejected()));
            }
        }
        let (fingerprint, observation_recorded) = record_committed_agent_file(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            self.app_state.as_deref(),
            &resolved.logical,
            &resolved.physical,
            "native-file-tool",
        )
        .await?;
        Ok(tool_result(&serde_json::json!({
            "path": resolved.logical,
            "bytes_written": content.len(),
            "lines_written": content.lines().count(),
            "fingerprint": fingerprint.hash,
            "observationRecorded": observation_recorded,
        })))
    }
}

struct PatchFileTool {
    paths: Arc<WorkspacePathPolicy>,
    db: Option<sqlx::PgPool>,
    agent_profile: Option<String>,
    app_state: Option<Arc<AppState>>,
}

#[async_trait]
impl ToolHandler for PatchFileTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        self.patch(args).await
    }
}

impl PatchFileTool {
    async fn patch(&self, args: &Value) -> Result<String, ToolError> {
        let path = required_str(args, "path")?;
        let old_string = required_str(args, "old_string")?;
        let new_string = required_str(args, "new_string")?;
        let candidate = self.paths.resolve_for_write_with_logical(path)?;
        ensure_content_access(self.app_state.as_deref(), &candidate.logical).await?;
        let resolved = self.paths.resolve_existing_with_logical(path)?;
        if let Err(err) = ensure_write_allowed(&resolved.physical) {
            audit_guardrail_denial(self.db.as_ref(), "patch", &resolved.physical, &err).await;
            return Err(err);
        }
        ensure_file_not_changed_since_observed(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            &resolved.logical,
            &resolved.physical,
        )
        .await
        .map_err(ToolError::Execution)?;
        let expected = required_str(args, "expectedFingerprint")?;
        let current = fingerprint_path(&resolved.physical)
            .await
            .map_err(ToolError::Execution)?;
        if expected != current.hash {
            return Err(ToolError::Execution(
                "File fingerprint changed before patch; read the file again".to_string(),
            ));
        }
        let content = tokio::fs::read_to_string(&resolved.physical)
            .await
            .map_err(|err| ToolError::Execution(format!("read failed: {err}")))?;
        let occurrences = content.matches(old_string).count();
        if occurrences != 1 {
            return Err(ToolError::InvalidArgs(format!(
                "old_string must occur exactly once, found {occurrences}"
            )));
        }
        let updated = content.replacen(old_string, new_string, 1);
        let state = self.app_state.as_deref().ok_or_else(|| {
            ToolError::Unavailable("workspace content service is not configured".to_string())
        })?;
        let outcome = state
            .workspace_content
            .admit_bytes(
                state,
                AdmissionRequest {
                    desired_path: resolved.logical.clone(),
                    file_name: resolved
                        .physical
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("file")
                        .to_string(),
                    origin: ContentOrigin::AgentGenerated,
                    actor: AdmissionActor::agent(self.agent_profile.as_deref(), None),
                    expected_fingerprint: Some(expected.to_string()),
                    allow_overwrite: true,
                    enqueue_s3_sync: true,
                },
                updated.as_bytes(),
            )
            .await
            .map_err(app_error_to_tool)?;
        match outcome {
            AdmissionOutcome::Committed { .. } => {}
            AdmissionOutcome::Quarantined { .. } => {
                return Err(app_error_to_tool(AppError::content_quarantined()));
            }
            AdmissionOutcome::Rejected => {
                return Err(app_error_to_tool(AppError::content_rejected()));
            }
        }
        let (fingerprint, observation_recorded) = record_committed_agent_file(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            self.app_state.as_deref(),
            &resolved.logical,
            &resolved.physical,
            "native-patch-tool",
        )
        .await?;
        Ok(tool_result(&serde_json::json!({
            "path": resolved.logical,
            "replacements": 1,
            "fingerprint": fingerprint.hash,
            "observationRecorded": observation_recorded,
        })))
    }
}

struct SearchFilesTool {
    paths: Arc<WorkspacePathPolicy>,
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
            .unwrap_or_else(|| self.paths.root().to_path_buf());
        if !start.is_dir() {
            return Err(ToolError::InvalidArgs(format!(
                "search path is not a directory: {}",
                start.display()
            )));
        }
        let mut results = Vec::new();
        search_dir(&self.paths, &start, query, limit, &mut results)?;
        Ok(tool_result(&serde_json::json!({ "matches": results })))
    }
}

fn search_dir(
    paths: &WorkspacePathPolicy,
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
        if !paths.is_inside(&canonical) {
            continue;
        }
        if is_sensitive_path(&canonical) {
            continue;
        }
        if file_type.is_dir() {
            search_dir(paths, &canonical, query, limit, results)?;
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
                    "path": paths.logical_path_for(&canonical),
                    "line": idx + 1,
                    "preview": truncate_chars(&redact_sensitive_text(line.trim()), 300),
                }));
                if results.len() >= limit {
                    break;
                }
            }
        }
    }
    Ok(())
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
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
        .map_err(app_error_to_tool)
}

async fn audit_guardrail_denial(
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

async fn record_committed_agent_file(
    db: Option<&sqlx::PgPool>,
    agent_profile: Option<&str>,
    state: Option<&AppState>,
    logical_path: &str,
    physical_path: &Path,
    source: &str,
) -> Result<(FileFingerprint, bool), ToolError> {
    let fingerprint = fingerprint_path(physical_path)
        .await
        .map_err(ToolError::Execution)?;
    let observation_recorded = match (db, agent_profile) {
        (Some(db), Some(agent_profile)) => record_file_observation_fingerprint(
            db,
            agent_profile,
            logical_path,
            &fingerprint,
            FileObservationSource::Write,
        )
        .await
        .is_ok(),
        _ => true,
    };
    if !observation_recorded {
        tracing::warn!(
            path = %logical_path,
            agent = agent_profile.unwrap_or("unknown"),
            "agent file write committed but observation recording failed"
        );
    }
    if let (Some(state), Some(agent_profile)) = (state, agent_profile) {
        if let Err(error) = record_document_revision(
            state,
            logical_path,
            &fingerprint.hash,
            RevisionActor::Agent(agent_profile),
            source,
            None,
        )
        .await
        {
            tracing::warn!(
                path = %logical_path,
                error = %error,
                "agent file write committed but revision provenance was not recorded"
            );
        }
    }
    Ok((fingerprint, observation_recorded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    #[test]
    fn path_policy_rejects_workspace_escape() {
        let root = std::env::current_dir().unwrap();
        let policy = WorkspacePathPolicy::new(root, Vec::new());
        assert!(policy.resolve_for_write("../outside").is_err());
    }

    #[test]
    fn sensitive_files_are_blocked() {
        let temp_root =
            std::env::temp_dir().join(format!("mymy-file-tool-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_root).unwrap();
        std::fs::write(temp_root.join(".env"), "TOKEN=secret").unwrap();

        let policy = WorkspacePathPolicy::new(temp_root.clone(), Vec::new());
        let resolved = policy.resolve_existing(".env").unwrap();
        assert!(ensure_read_allowed(&resolved).is_err());

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn write_and_patch_share_one_fingerprint_critical_section(pool: sqlx::PgPool) {
        let base = std::env::temp_dir().join(format!("mymy-file-race-{}", uuid::Uuid::new_v4()));
        let temp_root = base.join("drive/shared");
        std::fs::create_dir_all(&temp_root).unwrap();
        let path = temp_root.join("state.txt");
        std::fs::write(&path, "first").unwrap();
        let fingerprint = fingerprint_path(&path).await.unwrap().hash;
        let paths = Arc::new(WorkspacePathPolicy::new(temp_root.clone(), Vec::new()));
        let state = Arc::new(test_state(pool, base.clone()));
        let writer = WriteFileTool {
            paths: Arc::clone(&paths),
            db: None,
            agent_profile: None,
            app_state: Some(Arc::clone(&state)),
        };
        let patcher = PatchFileTool {
            paths,
            db: None,
            agent_profile: None,
            app_state: Some(state),
        };
        let write_args = serde_json::json!({
            "path": "state.txt",
            "content": "written",
            "expectedFingerprint": fingerprint.clone(),
        });
        let patch_args = serde_json::json!({
            "path": "state.txt",
            "old_string": "first",
            "new_string": "patched",
            "expectedFingerprint": fingerprint,
        });

        let (write_result, patch_result) =
            tokio::join!(writer.write(&write_args), patcher.patch(&patch_args));

        assert_ne!(write_result.is_ok(), patch_result.is_ok());
        let committed = std::fs::read_to_string(&path).unwrap();
        assert!(matches!(committed.as_str(), "written" | "patched"));
        let temporary_files = std::fs::read_dir(&temp_root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".mymy-"))
            .count();
        assert_eq!(temporary_files, 0);
        let _ = std::fs::remove_dir_all(base);
    }

    fn test_state(db: sqlx::PgPool, agent_data_dir: std::path::PathBuf) -> AppState {
        AppState::new(
            db,
            Config {
                database_url: "postgres://mymy:mymy@localhost/mymy".to_string(),
                port: 0,
                cors_origins: Vec::new(),
                agent_data_dir,
                auth_cookie_secure: false,
                cron_tick_interval_secs: 60,
                cron_timezone: "UTC".to_string(),
                cron_output_keep: 50,
                drive_s3_bucket: None,
                drive_s3_region: None,
                drive_s3_endpoint: None,
                sandbox_runner_url: None,
                sandbox_preview_host: "127.0.0.1".to_string(),
            },
        )
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

        let policy = WorkspacePathPolicy::new(temp_root.clone(), Vec::new());
        assert!(policy.resolve_existing("outside-link").is_err());
        assert!(policy.resolve_for_write("outside-link").is_err());

        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&temp_root);
    }
}
