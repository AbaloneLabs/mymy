//! Local terminal tool.
//!
//! Commands execute through the sandbox runner when it is configured. The
//! terminal toolset is exposed to native agents because workspace mutation and
//! development servers are core agent work. Write access to the processes
//! domain is the execution boundary; no separate interactive permission step is
//! used inside the agent loop.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use serde_json::Value;
use tokio::process::Command;
use uuid::Uuid;

use super::{truncate_chars, workspace_paths::WorkspacePathPolicy, BuiltinToolConfig};
use crate::agent::security::{
    detect_dangerous_command, ensure_read_allowed, ensure_write_allowed, redact_terminal_output,
    Severity,
};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};
use crate::error::AppError;
use crate::services::audit::log_security_denial_safe;
use crate::services::sandbox_processes::{self, NewRunningProcess};
use crate::services::sandbox_runner::{
    logical_path_for_runner, roots_for_runner, RunnerClient, RunnerExecuteRequest,
    RunnerStartProcessRequest,
};

const MAX_OUTPUT_CHARS: usize = 16_000;
const DEFAULT_TIMEOUT_SECS: u64 = 60;
const MAX_TIMEOUT_SECS: u64 = 180;
const MIN_PREVIEW_PORT: u64 = 1024;
const MAX_PREVIEW_PORT: u64 = 65_535;
const MAX_LABEL_CHARS: usize = 80;
const MAX_PROCESS_ROWS: i64 = 50;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let process_context = ProcessToolContext {
        runner_url: config.sandbox_runner_url.clone(),
        db: config.db.clone(),
        agent_profile: config.agent_profile.clone(),
        project_id: config.project_id,
    };

    registry.register(ToolEntry {
        name: "terminal".to_string(),
        toolset: "processes_write".to_string(),
        schema: tool_schema(
            "terminal",
            "Execute a shell command in the agent sandbox. Set background=true for long-running servers.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute." },
                    "timeout": { "type": "integer", "minimum": 1, "maximum": MAX_TIMEOUT_SECS, "description": "Maximum seconds to wait." },
                    "workdir": { "type": "string", "description": "Optional working directory." },
                    "background": { "type": "boolean", "default": false, "description": "Start a managed background process instead of waiting for command completion." },
                    "port": { "type": "integer", "minimum": MIN_PREVIEW_PORT, "maximum": MAX_PREVIEW_PORT, "description": "Optional preview port for background servers." },
                    "label": { "type": "string", "description": "Optional preview/process label for background commands." }
                },
                "required": ["command"]
            }),
        ),
        handler: Arc::new(TerminalTool {
            working_dir: config.working_dir.clone(),
            allowed_roots: allowed_roots(&config.working_dir, &config.allowed_roots),
            runner_url: config.sandbox_runner_url.clone(),
            db: config.db.clone(),
            agent_profile: config.agent_profile.clone(),
            project_id: config.project_id,
            preview_host: config.sandbox_preview_host.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "list_processes".to_string(),
        toolset: "processes_read".to_string(),
        schema: tool_schema(
            "list_processes",
            "List managed background processes for the current agent.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_PROCESS_ROWS }
                }
            }),
        ),
        handler: Arc::new(ListProcessesTool {
            context: process_context.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "read_process_logs".to_string(),
        toolset: "processes_read".to_string(),
        schema: tool_schema(
            "read_process_logs",
            "Read logs and status for a managed background process.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Process id returned by terminal(background=true)." }
                },
                "required": ["id"]
            }),
        ),
        handler: Arc::new(ReadProcessLogsTool {
            context: process_context.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "stop_process".to_string(),
        toolset: "processes_write".to_string(),
        schema: tool_schema(
            "stop_process",
            "Stop a managed background process owned by the current agent.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Process id returned by terminal(background=true)." }
                },
                "required": ["id"]
            }),
        ),
        handler: Arc::new(StopProcessTool {
            context: process_context.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "kill_process".to_string(),
        toolset: "processes_write".to_string(),
        schema: tool_schema(
            "kill_process",
            "Force stop a managed background process owned by the current agent.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Process id returned by terminal(background=true)." }
                },
                "required": ["id"]
            }),
        ),
        handler: Arc::new(KillProcessTool {
            context: process_context.clone(),
        }),
    });
}

struct TerminalTool {
    working_dir: PathBuf,
    allowed_roots: Vec<PathBuf>,
    runner_url: Option<String>,
    db: Option<sqlx::PgPool>,
    agent_profile: Option<String>,
    project_id: Option<Uuid>,
    preview_host: String,
}

#[derive(Clone)]
struct ProcessToolContext {
    runner_url: Option<String>,
    db: Option<sqlx::PgPool>,
    agent_profile: Option<String>,
    project_id: Option<Uuid>,
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

struct ListProcessesTool {
    context: ProcessToolContext,
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

struct ReadProcessLogsTool {
    context: ProcessToolContext,
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

struct StopProcessTool {
    context: ProcessToolContext,
}

struct KillProcessTool {
    context: ProcessToolContext,
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

fn app_error_to_tool(err: AppError, context: &str) -> ToolError {
    match err {
        AppError::BadRequest(message) | AppError::NotFound(message) => {
            ToolError::InvalidArgs(message)
        }
        AppError::Unauthorized(message) => ToolError::Unavailable(message),
        AppError::Conflict(message) | AppError::Internal(message) => {
            ToolError::Execution(format!("{context}: {message}"))
        }
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

fn parse_preview_port(value: Option<&Value>) -> Result<Option<u16>, ToolError> {
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

fn validate_label(value: &str, label: &str) -> Result<String, ToolError> {
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

fn parse_uuid_arg(args: &Value, key: &str) -> Result<Uuid, ToolError> {
    let raw = args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))?;
    Uuid::parse_str(raw).map_err(|err| ToolError::InvalidArgs(format!("invalid {key}: {err}")))
}

async fn check_redirected_paths(
    db: Option<&sqlx::PgPool>,
    command: &str,
    workdir: &Path,
    allowed_roots: &[PathBuf],
) -> Result<(), ToolError> {
    let paths = WorkspacePathPolicy::new(workdir.to_path_buf(), allowed_roots.to_vec());
    for target in redirected_targets(output_redirection_regex(), command) {
        let path = paths.resolve_for_write_internal_path(&resolve_shell_path(workdir, &target))?;
        if let Err(error) = ensure_write_allowed(&path) {
            audit_terminal_denial(db, "terminal_write_redirect", &path, &error).await;
            return Err(error);
        }
    }
    for target in redirected_targets(input_redirection_regex(), command) {
        let path = paths.resolve_existing_internal_path(&resolve_shell_path(workdir, &target))?;
        if let Err(error) = ensure_read_allowed(&path) {
            audit_terminal_denial(db, "terminal_read_redirect", &path, &error).await;
            return Err(error);
        }
    }
    Ok(())
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

fn ensure_directory(
    root: &Path,
    allowed_roots: &[PathBuf],
    path: &Path,
) -> Result<PathBuf, ToolError> {
    WorkspacePathPolicy::new(root.to_path_buf(), allowed_roots.to_vec())
        .resolve_directory_path(path)
}

fn allowed_roots(root: &Path, extra_roots: &[PathBuf]) -> Vec<PathBuf> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn terminal_runs_harmless_command() {
        let tool = TerminalTool {
            working_dir: std::env::current_dir().unwrap(),
            allowed_roots: allowed_roots(&std::env::current_dir().unwrap(), &[]),
            runner_url: None,
            db: None,
            agent_profile: None,
            project_id: None,
            preview_host: "127.0.0.1".to_string(),
        };
        let output = tool
            .execute(&serde_json::json!({"command":"printf hello"}))
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&output).unwrap()["stdout"],
            "hello"
        );
    }

    #[tokio::test]
    async fn terminal_blocks_hardline_command() {
        let tool = TerminalTool {
            working_dir: std::env::current_dir().unwrap(),
            allowed_roots: allowed_roots(&std::env::current_dir().unwrap(), &[]),
            runner_url: None,
            db: None,
            agent_profile: None,
            project_id: None,
            preview_host: "127.0.0.1".to_string(),
        };
        let err = tool
            .execute(&serde_json::json!({"command":"shutdown now"}))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("blocked"));
    }

    #[tokio::test]
    async fn terminal_runs_non_hardline_command_with_process_access() {
        let tool = TerminalTool {
            working_dir: std::env::current_dir().unwrap(),
            allowed_roots: allowed_roots(&std::env::current_dir().unwrap(), &[]),
            runner_url: None,
            db: None,
            agent_profile: None,
            project_id: None,
            preview_host: "127.0.0.1".to_string(),
        };
        let output = tool
            .execute(&serde_json::json!({"command":"printf 'DELETE FROM users'"}))
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&output).unwrap()["stdout"],
            "DELETE FROM users"
        );
    }

    #[tokio::test]
    async fn terminal_redacts_secret_shaped_output() {
        let tool = TerminalTool {
            working_dir: std::env::current_dir().unwrap(),
            allowed_roots: allowed_roots(&std::env::current_dir().unwrap(), &[]),
            runner_url: None,
            db: None,
            agent_profile: None,
            project_id: None,
            preview_host: "127.0.0.1".to_string(),
        };
        let output = tool
            .execute(&serde_json::json!({"command":"printf 'API_KEY=sk-abcdefghijklmnop'"}))
            .await
            .unwrap();
        let parsed = serde_json::from_str::<Value>(&output).unwrap();
        assert!(parsed["stdout"].as_str().unwrap().contains("[REDACTED]"));
    }

    #[tokio::test]
    async fn terminal_blocks_sensitive_output_redirection() {
        let tool = TerminalTool {
            working_dir: std::env::current_dir().unwrap(),
            allowed_roots: allowed_roots(&std::env::current_dir().unwrap(), &[]),
            runner_url: None,
            db: None,
            agent_profile: None,
            project_id: None,
            preview_host: "127.0.0.1".to_string(),
        };
        let err = tool
            .execute(&serde_json::json!({"command":"printf secret > .env"}))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("sensitive path"));
    }

    #[test]
    fn ensure_directory_accepts_logical_shared_drive_path() {
        let base = std::env::temp_dir().join(format!("mymy-terminal-{}", uuid::Uuid::new_v4()));
        let agent = base.join("drive").join("agents").join("elena");
        let shared = base.join("drive").join("shared");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::create_dir_all(&shared).unwrap();
        let roots = allowed_roots(&agent, std::slice::from_ref(&shared));

        let resolved = ensure_directory(&agent, &roots, Path::new("/drive/shared")).unwrap();
        assert_eq!(resolved, shared.canonicalize().unwrap());

        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn redirection_allows_logical_shared_drive_path() {
        let base = std::env::temp_dir().join(format!("mymy-terminal-{}", uuid::Uuid::new_v4()));
        let agent = base.join("drive").join("agents").join("elena");
        let shared = base.join("drive").join("shared");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::create_dir_all(&shared).unwrap();
        let roots = allowed_roots(&agent, std::slice::from_ref(&shared));

        check_redirected_paths(None, "printf ok > /drive/shared/check.txt", &agent, &roots)
            .await
            .unwrap();

        let _ = std::fs::remove_dir_all(base);
    }
}
