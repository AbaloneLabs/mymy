use std::path::{Path, PathBuf};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;
use tokio::process::Command;
use uuid::Uuid;

use super::super::truncate_chars;
use super::process_tools::app_error_to_tool;
use super::validation::{
    check_redirected_paths, ensure_directory, parse_preview_port, validate_label,
};
use super::{DEFAULT_TIMEOUT_SECS, MAX_OUTPUT_CHARS, MAX_TIMEOUT_SECS};
use crate::agent::security::{detect_dangerous_command, redact_terminal_output, Severity};
use crate::agent::tools::{tool_result, ToolError, ToolHandler};
use crate::services::sandbox_processes::{self, NewRunningProcess};
use crate::services::sandbox_runner::{
    logical_path_for_runner, roots_for_runner, RunnerClient, RunnerExecuteRequest,
    RunnerStartProcessRequest,
};

pub(super) struct TerminalTool {
    pub(super) working_dir: PathBuf,
    pub(super) allowed_roots: Vec<PathBuf>,
    pub(super) runner_url: Option<String>,
    pub(super) db: Option<sqlx::PgPool>,
    pub(super) agent_profile: Option<String>,
    pub(super) project_id: Option<Uuid>,
    pub(super) preview_host: String,
}

#[async_trait]
impl ToolHandler for TerminalTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        self.run(args).await
    }
}

impl TerminalTool {
    async fn run(&self, args: &Value) -> Result<String, ToolError> {
        let command = args
            .get("command")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("missing command".to_string()))?;
        let workdir = match args.get("workdir").and_then(Value::as_str) {
            Some(raw) => ensure_directory(&self.working_dir, &self.allowed_roots, Path::new(raw))?,
            None => std::fs::canonicalize(&self.working_dir)
                .unwrap_or_else(|_| self.working_dir.clone()),
        };
        check_redirected_paths(self.db.as_ref(), command, &workdir, &self.allowed_roots).await?;

        if let Some(matched) = detect_dangerous_command(command) {
            match matched.severity {
                Severity::Hardline => {
                    return Err(ToolError::Unavailable(format!(
                        "blocked: {} ({})",
                        matched.description, matched.pattern_key
                    )));
                }
                Severity::Dangerous => {}
            }
        }
        let timeout_secs = args
            .get("timeout")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS);
        let background = args
            .get("background")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if background {
            let port = parse_preview_port(args.get("port"))?;
            let label = args
                .get("label")
                .and_then(Value::as_str)
                .map(|value| validate_label(value, "process label"))
                .transpose()?;
            return self
                .start_background_process(command, &workdir, port, label)
                .await;
        }

        if let Some(runner_url) = &self.runner_url {
            let response = RunnerClient::new(runner_url.clone())
                .execute(&RunnerExecuteRequest {
                    command: command.to_string(),
                    cwd: workdir.display().to_string(),
                    roots: roots_for_runner(&self.working_dir, &self.allowed_roots),
                    timeout_secs: Some(timeout_secs),
                    env: None,
                })
                .await
                .map_err(|err| ToolError::Execution(format!("runner execution failed: {err}")))?;
            return Ok(tool_result(&serde_json::json!({
                "stdout": truncate_chars(&redact_terminal_output(&response.stdout), MAX_OUTPUT_CHARS),
                "stderr": truncate_chars(&redact_terminal_output(&response.stderr), MAX_OUTPUT_CHARS),
                "exit_code": response.exit_code,
                "sandbox": "runner",
                "cwd": logical_path_for_runner(Path::new(&response.cwd)),
            })));
        }

        let child = Command::new("bash")
            .arg("-c")
            .arg(command)
            .current_dir(&workdir)
            .output();

        let output = tokio::time::timeout(Duration::from_secs(timeout_secs), child)
            .await
            .map_err(|_| ToolError::Execution(format!("command timed out after {timeout_secs}s")))?
            .map_err(|err| ToolError::Execution(format!("failed to run command: {err}")))?;

        Ok(tool_result(&serde_json::json!({
            "stdout": truncate_chars(&redact_terminal_output(&String::from_utf8_lossy(&output.stdout)), MAX_OUTPUT_CHARS),
            "stderr": truncate_chars(&redact_terminal_output(&String::from_utf8_lossy(&output.stderr)), MAX_OUTPUT_CHARS),
            "exit_code": output.status.code().unwrap_or(-1),
            "cwd": logical_path_for_runner(&workdir),
        })))
    }

    async fn start_background_process(
        &self,
        command: &str,
        workdir: &Path,
        port: Option<u16>,
        label: Option<String>,
    ) -> Result<String, ToolError> {
        let runner_url = self.runner_url.as_ref().ok_or_else(|| {
            ToolError::Unavailable("sandbox runner is not configured".to_string())
        })?;
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| ToolError::Unavailable("database is not configured".to_string()))?;
        let agent_profile = self
            .agent_profile
            .as_ref()
            .ok_or_else(|| ToolError::Unavailable("agent profile is not configured".to_string()))?;

        let response = RunnerClient::new(runner_url.clone())
            .start_process(&RunnerStartProcessRequest {
                execution: RunnerExecuteRequest {
                    command: command.to_string(),
                    cwd: workdir.display().to_string(),
                    roots: roots_for_runner(&self.working_dir, &self.allowed_roots),
                    timeout_secs: None,
                    env: None,
                },
                port,
            })
            .await
            .map_err(|err| ToolError::Execution(format!("runner process failed: {err}")))?;
        let pid = response.pid.map(|value| value as i32);
        let logical_cwd = logical_path_for_runner(workdir);
        let metadata = serde_json::json!({
            "runnerStatus": response.status.clone(),
            "forwardedUrl": response.forwarded_url.clone(),
            "port": port,
            "startedBy": "terminal_tool",
        });
        sandbox_processes::insert_running_process(
            db,
            &NewRunningProcess {
                id: response.id,
                agent_profile,
                project_id: self.project_id,
                command,
                cwd: &logical_cwd,
                pid,
                metadata: &metadata,
            },
        )
        .await
        .map_err(|err| app_error_to_tool(err, "process metadata save failed"))?;

        let preview_path = if let Some(port) = port {
            let label = label.unwrap_or_else(|| format!("Port {port}"));
            let target_url = response
                .forwarded_url
                .clone()
                .unwrap_or_else(|| format!("http://{}:{port}", self.preview_host));
            Some(
                sandbox_processes::create_process_preview(
                    db,
                    agent_profile,
                    self.project_id,
                    response.id,
                    &label,
                    &target_url,
                )
                .await
                .map_err(|err| app_error_to_tool(err, "preview registration failed"))?,
            )
        } else {
            None
        };

        Ok(tool_result(&serde_json::json!({
            "background": true,
            "process_id": response.id.to_string(),
            "pid": response.pid,
            "status": response.status,
            "cwd": logical_path_for_runner(workdir),
            "sandbox": "runner",
            "preview_path": preview_path,
            "forwarded_url": response.forwarded_url,
        })))
    }
}
