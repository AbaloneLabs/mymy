use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::super::{workspace_paths::WorkspacePathPolicy, BuiltinToolConfig};
use crate::agent::sandbox::SandboxRpcHandler;
use crate::agent::security::{
    ensure_read_allowed, ensure_write_allowed, is_sensitive_path, redact_sensitive_text,
};
use crate::error::AppError;
use crate::models::agent::AgentToolDomain;
use crate::models::content_security::ContentOrigin;
use crate::services::document_revisions::{record_document_revision, RevisionActor};
use crate::services::file_observations::{
    ensure_file_not_changed_since_observed, fingerprint_path, record_file_observation,
    record_file_observation_fingerprint, FileFingerprint, FileObservationSource,
};
use crate::services::workspace_content::{AdmissionActor, AdmissionOutcome, AdmissionRequest};
use crate::state::AppState;

pub(super) struct CodeRpcHandler {
    pub(super) paths: WorkspacePathPolicy,
    pub(super) allowed_tools: HashSet<String>,
    pub(super) db: Option<sqlx::PgPool>,
    pub(super) agent_profile: Option<String>,
    pub(super) app_state: Option<Arc<AppState>>,
}

#[async_trait]
impl SandboxRpcHandler for CodeRpcHandler {
    async fn call(&self, tool: &str, args: Value) -> Result<Value, String> {
        if !self.allowed_tools.contains(tool) {
            return Err(format!("tool is not allowed in sandbox RPC: {tool}"));
        }
        match tool {
            "read_file" => self.read_file(args).await,
            "search_files" => self.search_files(args).await,
            "write_file" => self.write_file(args).await,
            "patch_file" => self.patch_file(args).await,
            _ => Err(format!("unsupported sandbox RPC tool: {tool}")),
        }
    }
}

impl CodeRpcHandler {
    async fn read_file(&self, args: Value) -> Result<Value, String> {
        let path = required_arg(&args, "path")?;
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(500)
            .clamp(1, 1_000) as usize;
        let offset = args
            .get("offset")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .max(1) as usize;
        let candidate = self
            .paths
            .resolve_for_write_with_logical(path)
            .map_err(|err| err.to_string())?;
        ensure_content_access(self.app_state.as_deref(), &candidate.logical).await?;
        let _namespace_guard = match self.app_state.as_deref() {
            Some(state) => Some(state.drive_namespace_lock().read().await),
            None => None,
        };
        let resolved = self
            .paths
            .resolve_existing_with_logical(path)
            .map_err(|err| err.to_string())?;
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
        ensure_read_allowed(&resolved.physical).map_err(|err| err.to_string())?;
        let content = tokio::fs::read_to_string(&resolved.physical)
            .await
            .map_err(|err| format!("read failed: {err}"))?;
        let lines: Vec<&str> = content.lines().collect();
        let start = offset.saturating_sub(1).min(lines.len());
        let end = (start + limit).min(lines.len());
        let content = (start..end)
            .map(|idx| format!("{}:{}", idx + 1, lines[idx]))
            .collect::<Vec<_>>()
            .join("\n");
        record_file_observation(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            &resolved.logical,
            &resolved.physical,
            FileObservationSource::Read,
        )
        .await?;
        Ok(serde_json::json!({
            "path": resolved.logical,
            "content": redact_sensitive_text(&content),
            "total_lines": lines.len(),
        }))
    }

    async fn search_files(&self, args: Value) -> Result<Value, String> {
        let query = required_arg(&args, "query")?;
        if query.is_empty() {
            return Err("query cannot be empty".to_string());
        }
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(50)
            .clamp(1, 100) as usize;
        let start = args
            .get("path")
            .and_then(Value::as_str)
            .map(|path| {
                self.paths
                    .resolve_existing(path)
                    .map_err(|err| err.to_string())
            })
            .transpose()?
            .unwrap_or_else(|| self.paths.root().to_path_buf());
        let mut matches = Vec::new();
        search_dir(&self.paths, &start, query, limit, &mut matches)?;
        Ok(serde_json::json!({ "matches": matches }))
    }

    async fn write_file(&self, args: Value) -> Result<Value, String> {
        let path = required_arg(&args, "path")?;
        let content = required_arg(&args, "content")?;
        let resolved = self
            .paths
            .resolve_for_write_with_logical(path)
            .map_err(|err| err.to_string())?;
        ensure_content_access(self.app_state.as_deref(), &resolved.logical).await?;
        ensure_write_allowed(&resolved.physical).map_err(|err| err.to_string())?;
        ensure_file_not_changed_since_observed(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            &resolved.logical,
            &resolved.physical,
        )
        .await?;
        let existed = resolved.physical.exists();
        let expected_fingerprint = if existed {
            Some(required_arg(&args, "expectedFingerprint")?.to_string())
        } else {
            None
        };
        let state = self
            .app_state
            .as_deref()
            .ok_or_else(|| "workspace content service is not configured".to_string())?;
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
                    expected_fingerprint,
                    allow_overwrite: existed,
                    enqueue_s3_sync: true,
                },
                content.as_bytes(),
            )
            .await
            .map_err(app_error_to_rpc)?;
        match outcome {
            AdmissionOutcome::Committed { .. } => {}
            AdmissionOutcome::Quarantined { .. } => {
                return Err(app_error_to_rpc(AppError::content_quarantined()));
            }
            AdmissionOutcome::Rejected => {
                return Err(app_error_to_rpc(AppError::content_rejected()));
            }
        }
        let (fingerprint, observation_recorded) = record_code_rpc_write(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            self.app_state.as_deref(),
            &resolved.logical,
            &resolved.physical,
            "agent-code-rpc-write",
        )
        .await?;
        Ok(serde_json::json!({
            "path": resolved.logical,
            "bytes_written": content.len(),
            "lines_written": content.lines().count(),
            "fingerprint": fingerprint.hash,
            "observationRecorded": observation_recorded,
        }))
    }

    async fn patch_file(&self, args: Value) -> Result<Value, String> {
        let path = required_arg(&args, "path")?;
        let old_string = required_arg(&args, "old_string")?;
        let new_string = required_arg(&args, "new_string")?;
        let candidate = self
            .paths
            .resolve_for_write_with_logical(path)
            .map_err(|err| err.to_string())?;
        ensure_content_access(self.app_state.as_deref(), &candidate.logical).await?;
        let resolved = self
            .paths
            .resolve_existing_with_logical(path)
            .map_err(|err| err.to_string())?;
        ensure_write_allowed(&resolved.physical).map_err(|err| err.to_string())?;
        ensure_file_not_changed_since_observed(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            &resolved.logical,
            &resolved.physical,
        )
        .await?;
        let content = tokio::fs::read_to_string(&resolved.physical)
            .await
            .map_err(|err| format!("read failed: {err}"))?;
        let occurrences = content.matches(old_string).count();
        if occurrences != 1 {
            return Err(format!(
                "old_string must occur exactly once, found {occurrences}"
            ));
        }
        let updated = content.replacen(old_string, new_string, 1);
        let expected = required_arg(&args, "expectedFingerprint")?;
        let current = fingerprint_path(&resolved.physical).await?;
        if expected != current.hash {
            return Err("File fingerprint changed before patch; read the file again".to_string());
        }
        let state = self
            .app_state
            .as_deref()
            .ok_or_else(|| "workspace content service is not configured".to_string())?;
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
            .map_err(app_error_to_rpc)?;
        match outcome {
            AdmissionOutcome::Committed { .. } => {}
            AdmissionOutcome::Quarantined { .. } => {
                return Err(app_error_to_rpc(AppError::content_quarantined()));
            }
            AdmissionOutcome::Rejected => {
                return Err(app_error_to_rpc(AppError::content_rejected()));
            }
        }
        let (fingerprint, observation_recorded) = record_code_rpc_write(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            self.app_state.as_deref(),
            &resolved.logical,
            &resolved.physical,
            "agent-code-rpc-patch",
        )
        .await?;
        Ok(serde_json::json!({
            "path": resolved.logical,
            "replacements": 1,
            "fingerprint": fingerprint.hash,
            "observationRecorded": observation_recorded,
        }))
    }
}

pub(super) fn sandbox_allowed_tools(config: &BuiltinToolConfig) -> HashSet<String> {
    let configured = std::env::var("SANDBOX_ALLOWED_TOOLS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|tool| !tool.is_empty())
                .map(ToString::to_string)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_else(|| {
            ["read_file", "search_files", "write_file", "patch_file"]
                .into_iter()
                .map(ToString::to_string)
                .collect()
        });
    let mut configured = configured
        .into_iter()
        .filter(|tool| {
            matches!(
                tool.as_str(),
                "read_file" | "search_files" | "write_file" | "patch_file"
            )
        })
        .collect::<HashSet<_>>();

    if let Some(policy) = &config.permission_policy {
        if !policy.can_read(AgentToolDomain::Drive) {
            configured.remove("read_file");
            configured.remove("search_files");
        }
        if !policy.can_write(AgentToolDomain::Drive) {
            configured.remove("write_file");
            configured.remove("patch_file");
        }
    }
    configured
}

fn required_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing {key}"))
}

async fn ensure_content_access(state: Option<&AppState>, logical_path: &str) -> Result<(), String> {
    let Some(state) = state else {
        return Ok(());
    };
    state
        .workspace_content
        .ensure_not_quarantined(state, logical_path)
        .await
        .map_err(app_error_to_rpc)
}

fn app_error_to_rpc(error: AppError) -> String {
    match error {
        AppError::Coded { code, message, .. } => format!("{code}: {message}"),
        other => other.to_string(),
    }
}

async fn record_code_rpc_write(
    db: Option<&sqlx::PgPool>,
    agent_profile: Option<&str>,
    state: Option<&AppState>,
    logical_path: &str,
    physical_path: &Path,
    source: &str,
) -> Result<(FileFingerprint, bool), String> {
    let fingerprint = fingerprint_path(physical_path).await?;
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
            "agent code RPC write committed but observation recording failed"
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
                "agent code RPC write committed but revision provenance was not recorded"
            );
        }
    }
    Ok((fingerprint, observation_recorded))
}

fn search_dir(
    paths: &WorkspacePathPolicy,
    dir: &Path,
    query: &str,
    limit: usize,
    matches: &mut Vec<Value>,
) -> Result<(), String> {
    if matches.len() >= limit {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir).map_err(|err| format!("read_dir failed: {err}"))?;
    for entry in entries {
        if matches.len() >= limit {
            break;
        }
        let entry = entry.map_err(|err| format!("dir entry failed: {err}"))?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if matches!(
            file_name.as_ref(),
            ".git" | "target" | "node_modules" | "dist"
        ) {
            continue;
        }
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|err| format!("file type failed: {err}"))?;
        let Ok(canonical) = path.canonicalize() else {
            continue;
        };
        if !paths.is_inside(&canonical) || is_sensitive_path(&canonical) {
            continue;
        }
        if file_type.is_dir() {
            search_dir(paths, &canonical, query, limit, matches)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&canonical) else {
            continue;
        };
        for (idx, line) in content.lines().enumerate() {
            if line.contains(query) {
                matches.push(serde_json::json!({
                    "path": paths.logical_path_for(&canonical),
                    "line": idx + 1,
                    "preview": redact_sensitive_text(line.trim()),
                }));
                if matches.len() >= limit {
                    break;
                }
            }
        }
    }
    Ok(())
}
