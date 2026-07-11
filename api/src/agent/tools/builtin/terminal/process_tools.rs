use async_trait::async_trait;
use serde_json::Value;
use uuid::Uuid;

use super::super::truncate_chars;
use super::{MAX_OUTPUT_CHARS, MAX_PROCESS_ROWS};
use crate::agent::security::redact_terminal_output;
use crate::agent::tools::{tool_result, ToolError, ToolHandler};
use crate::error::AppError;
use crate::services::sandbox_processes;
use crate::services::sandbox_runner::RunnerClient;

#[derive(Clone)]
pub(super) struct ProcessToolContext {
    pub(super) runner_url: Option<String>,
    pub(super) db: Option<sqlx::PgPool>,
    pub(super) agent_profile: Option<String>,
    pub(super) project_id: Option<Uuid>,
}

pub(super) struct ListProcessesTool {
    pub(super) context: ProcessToolContext,
}

#[async_trait]
impl ToolHandler for ListProcessesTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let db = self.context.db()?;
        let agent_profile = self.context.agent_profile()?;
        let limit = args
            .get("limit")
            .and_then(Value::as_i64)
            .unwrap_or(20)
            .clamp(1, MAX_PROCESS_ROWS);
        let processes = sandbox_processes::list_owned_processes(
            db,
            agent_profile,
            self.context.project_id,
            limit,
        )
        .await
        .map_err(|err| app_error_to_tool(err, "process list failed"))?
        .into_iter()
        .map(process_to_tool_value)
        .collect::<Vec<_>>();
        Ok(tool_result(&serde_json::json!({ "processes": processes })))
    }
}

pub(super) struct ReadProcessLogsTool {
    pub(super) context: ProcessToolContext,
}

#[async_trait]
impl ToolHandler for ReadProcessLogsTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let db = self.context.db()?;
        let agent_profile = self.context.agent_profile()?;
        let id = parse_uuid_arg(args, "id")?;
        sandbox_processes::ensure_process_owner(db, id, agent_profile, self.context.project_id)
            .await
            .map_err(|err| app_error_to_tool(err, "process owner check failed"))?;

        let logs = if let Some(runner_url) = &self.context.runner_url {
            match RunnerClient::new(runner_url.clone()).process_logs(id).await {
                Ok(response) => {
                    sandbox_processes::reconcile_from_runner(
                        db,
                        sandbox_processes::RunnerProcessReconcile {
                            id: response.id,
                            runner_status: &response.status,
                            pid: response.pid.map(|value| value as i32),
                            command: &response.command,
                            cwd: &response.cwd,
                            port: response.port,
                            cpu_percent: None,
                            memory_bytes: None,
                            storage_bytes: None,
                            open_ports: serde_json::json!([]),
                        },
                    )
                    .await
                    .map_err(|err| app_error_to_tool(err, "process reconcile failed"))?;
                    response.logs
                }
                Err(err) => {
                    tracing::warn!(
                        process_id = %id,
                        error = %err,
                        "runner logs unavailable for terminal process tool"
                    );
                    String::new()
                }
            }
        } else {
            String::new()
        };

        let process = sandbox_processes::fetch_process_for_owner(
            db,
            id,
            agent_profile,
            self.context.project_id,
        )
        .await
        .map_err(|err| app_error_to_tool(err, "process fetch failed"))?;
        Ok(tool_result(&serde_json::json!({
            "process": process_to_tool_value(process),
            "logs": truncate_chars(&redact_terminal_output(&logs), MAX_OUTPUT_CHARS),
        })))
    }
}

pub(super) struct StopProcessTool {
    pub(super) context: ProcessToolContext,
}

pub(super) struct KillProcessTool {
    pub(super) context: ProcessToolContext,
}

#[async_trait]
impl ToolHandler for StopProcessTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let db = self.context.db()?;
        let agent_profile = self.context.agent_profile()?;
        let id = parse_uuid_arg(args, "id")?;
        sandbox_processes::ensure_process_owner(db, id, agent_profile, self.context.project_id)
            .await
            .map_err(|err| app_error_to_tool(err, "process owner check failed"))?;

        if let Some(runner_url) = &self.context.runner_url {
            if let Err(err) = RunnerClient::new(runner_url.clone()).stop_process(id).await {
                tracing::warn!(
                    process_id = %id,
                    error = %err,
                    "runner stop unavailable for terminal process tool"
                );
            }
        }
        sandbox_processes::stop_process_record(db, id)
            .await
            .map_err(|err| app_error_to_tool(err, "process stop save failed"))?;
        let process = sandbox_processes::fetch_process_for_owner(
            db,
            id,
            agent_profile,
            self.context.project_id,
        )
        .await
        .map_err(|err| app_error_to_tool(err, "process fetch failed"))?;
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "process": process_to_tool_value(process),
        })))
    }
}

#[async_trait]
impl ToolHandler for KillProcessTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let db = self.context.db()?;
        let agent_profile = self.context.agent_profile()?;
        let id = parse_uuid_arg(args, "id")?;
        sandbox_processes::ensure_process_owner(db, id, agent_profile, self.context.project_id)
            .await
            .map_err(|err| app_error_to_tool(err, "process owner check failed"))?;

        if let Some(runner_url) = &self.context.runner_url {
            if let Err(err) = RunnerClient::new(runner_url.clone()).kill_process(id).await {
                tracing::warn!(
                    process_id = %id,
                    error = %err,
                    "runner kill unavailable for terminal process tool"
                );
            }
        }
        sandbox_processes::stop_process_record(db, id)
            .await
            .map_err(|err| app_error_to_tool(err, "process kill save failed"))?;
        let process = sandbox_processes::fetch_process_for_owner(
            db,
            id,
            agent_profile,
            self.context.project_id,
        )
        .await
        .map_err(|err| app_error_to_tool(err, "process fetch failed"))?;
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "process": process_to_tool_value(process),
        })))
    }
}

impl ProcessToolContext {
    fn db(&self) -> Result<&sqlx::PgPool, ToolError> {
        self.db
            .as_ref()
            .ok_or_else(|| ToolError::Unavailable("database is not configured".to_string()))
    }

    fn agent_profile(&self) -> Result<&str, ToolError> {
        self.agent_profile
            .as_deref()
            .ok_or_else(|| ToolError::Unavailable("agent profile is not configured".to_string()))
    }
}

pub(super) fn app_error_to_tool(err: AppError, context: &str) -> ToolError {
    match err {
        AppError::BadRequest(message)
        | AppError::NotFound(message)
        | AppError::PayloadTooLarge(message)
        | AppError::UnsupportedMedia(message) => ToolError::InvalidArgs(message),
        AppError::Unauthorized(message) | AppError::ServiceUnavailable(message) => {
            ToolError::Unavailable(message)
        }
        AppError::Conflict(message) | AppError::Internal(message) => {
            ToolError::Execution(format!("{context}: {message}"))
        }
        AppError::Coded { code, message, .. } => ToolError::Coded { code, message },
        AppError::Database(err) => ToolError::Execution(format!("{context}: {err}")),
        AppError::Io(err) => ToolError::Execution(format!("{context}: {err}")),
    }
}

fn process_to_tool_value(process: crate::models::sandbox::SandboxProcess) -> Value {
    serde_json::json!({
        "id": process.id,
        "agent_profile": process.agent_profile,
        "project_id": process.project_id,
        "command": process.command,
        "cwd": process.cwd,
        "status": process.status,
        "pid": process.pid,
        "started_at": process.started_at,
        "stopped_at": process.stopped_at,
        "exit_code": process.exit_code,
        "metadata": process.metadata,
        "preview_path": process.preview_path,
        "preview_target_url": process.preview_target_url,
    })
}

fn parse_uuid_arg(args: &Value, key: &str) -> Result<Uuid, ToolError> {
    let raw = args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))?;
    Uuid::parse_str(raw).map_err(|err| ToolError::InvalidArgs(format!("invalid {key}: {err}")))
}
