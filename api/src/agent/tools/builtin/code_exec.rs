//! Local Python code execution tool.
//!
//! This is a controlled convenience layer over the sandbox runner. The
//! subprocess receives a scrubbed environment, a workspace working directory,
//! timeout limits, redacted output, and the same runner isolation as terminal
//! commands when the runner is configured.

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::{truncate_chars, workspace_paths::WorkspacePathPolicy, BuiltinToolConfig};
use crate::agent::execution::ToolExecutionContext;
use crate::agent::sandbox::{ExecOptions, SandboxManager};
use crate::agent::security::{detect_dangerous_command, redact_terminal_output, Severity};
use crate::agent::tools::{
    tool_result, tool_schema, ToolCapability, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

mod rpc;
mod runner;
mod stub;

use rpc::{sandbox_allowed_tools, CodeRpcHandler};
use runner::execute_python_with_runner;
use stub::python_tool_stub;

const DEFAULT_TIMEOUT_SECS: u64 = 300;
const MAX_TIMEOUT_SECS: u64 = 300;
const MAX_STDOUT_CHARS: usize = 50_000;
const MAX_STDERR_CHARS: usize = 10_000;
const MAX_RPC_CALLS: usize = 50;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    registry.register(ToolEntry {
        name: "execute_code".to_string(),
        toolset: "processes_write".to_string(),
        schema: tool_schema(
            "execute_code",
            "Execute a Python script with scrubbed environment, timeout, and sandbox tool RPC helpers.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "code": { "type": "string" },
                    "language": { "type": "string", "enum": ["python"], "default": "python" },
                    "cwd": { "type": "string", "description": "Optional workspace-relative working directory." },
                    "timeout": { "type": "integer", "minimum": 1, "maximum": MAX_TIMEOUT_SECS }
                },
                "required": ["code"]
            }),
        ),
        capability: ToolCapability::process(),
        handler: Arc::new(CodeExecTool {
            working_dir: config.working_dir.clone(),
            allowed_roots: config.allowed_roots.clone(),
            scratch_dir: config
                .agent_data_dir
                .join("sandbox")
                .join(config.session_id.map_or_else(
                    || "standalone".to_string(),
                    |session_id| session_id.to_string(),
                )),
            runner_url: config.sandbox_runner_url.clone(),
            allowed_tools: sandbox_allowed_tools(config),
            db: config.db.clone(),
            agent_profile: config.agent_profile.clone(),
            app_state: config.app_state.clone(),
        }),
    });
}

struct CodeExecTool {
    working_dir: PathBuf,
    allowed_roots: Vec<PathBuf>,
    scratch_dir: PathBuf,
    runner_url: Option<String>,
    allowed_tools: HashSet<String>,
    db: Option<sqlx::PgPool>,
    agent_profile: Option<String>,
    app_state: Option<Arc<crate::state::AppState>>,
}

#[async_trait]
impl ToolHandler for CodeExecTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        self.run(args, None).await
    }

    async fn execute_with_context(
        &self,
        context: &ToolExecutionContext,
        args: &Value,
    ) -> Result<String, ToolError> {
        self.run(args, Some(context)).await
    }
}

impl CodeExecTool {
    async fn run(
        &self,
        args: &Value,
        context: Option<&ToolExecutionContext>,
    ) -> Result<String, ToolError> {
        let language = args
            .get("language")
            .and_then(Value::as_str)
            .unwrap_or("python");
        if language != "python" {
            return Err(ToolError::InvalidArgs(
                "only python is supported".to_string(),
            ));
        }
        let code = args
            .get("code")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("missing code".to_string()))?;
        if let Some(matched) = detect_dangerous_command(code) {
            if matched.severity == Severity::Hardline {
                return Err(ToolError::Unavailable(format!(
                    "blocked: {} ({})",
                    matched.description, matched.pattern_key
                )));
            }
        }
        let timeout_secs = args
            .get("timeout")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS);
        let cwd = args
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|cwd| !cwd.is_empty())
            .map(PathBuf::from);

        let sandbox = SandboxManager::local(self.working_dir.clone(), self.scratch_dir.clone());
        let helper_dir = self.scratch_dir.join("python");
        tokio::fs::create_dir_all(&helper_dir)
            .await
            .map_err(|err| ToolError::Execution(format!("helper dir create failed: {err}")))?;
        tokio::fs::write(helper_dir.join("mymy_tools.py"), python_tool_stub())
            .await
            .map_err(|err| ToolError::Execution(format!("helper write failed: {err}")))?;
        let rpc = sandbox
            .start_rpc(
                MAX_RPC_CALLS,
                Arc::new(CodeRpcHandler {
                    paths: WorkspacePathPolicy::new(
                        self.working_dir.clone(),
                        self.allowed_roots.clone(),
                    ),
                    allowed_tools: self.allowed_tools.clone(),
                    db: self.db.clone(),
                    agent_profile: self.agent_profile.clone(),
                    app_state: self.app_state.clone(),
                }),
            )
            .await
            .map_err(|err| ToolError::Execution(err.to_string()))?;
        let mut extra_env = BTreeMap::new();
        extra_env.insert(
            "MYMY_TOOLS_RPC_PATH".to_string(),
            rpc.socket_path().display().to_string(),
        );
        extra_env.insert("PYTHONPATH".to_string(), helper_dir.display().to_string());
        let options = ExecOptions {
            language: language.to_string(),
            code: code.to_string(),
            cwd,
            timeout_secs,
            extra_env,
            cancellation: context.map(|value| value.cancellation.clone()),
        };
        let output = if let Some(runner_url) = self.runner_url.as_deref() {
            execute_python_with_runner(
                runner_url,
                &self.working_dir,
                &self.allowed_roots,
                &self.scratch_dir,
                options,
                context.map(|value| value.invocation_id.as_str()),
            )
            .await
        } else {
            sandbox.execute_local(options).await
        }
        .map_err(|err| ToolError::Execution(err.to_string()))?;

        Ok(tool_result(&serde_json::json!({
            "success": output.success,
            "stdout": truncate_chars(&redact_terminal_output(&output.stdout), MAX_STDOUT_CHARS),
            "stderr": truncate_chars(&redact_terminal_output(&output.stderr), MAX_STDERR_CHARS),
            "exit_code": output.exit_code,
            "cwd": output.cwd,
            "allowed_tools": self.allowed_tools.iter().cloned().collect::<Vec<_>>(),
        })))
    }
}

#[cfg(test)]
mod tests;
