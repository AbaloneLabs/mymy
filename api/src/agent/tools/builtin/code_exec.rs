//! Local Python code execution tool.
//!
//! This is a controlled convenience layer, not a security sandbox. It is not
//! enabled by the safe default toolsets. The subprocess receives a scrubbed
//! environment, a workspace working directory, timeout limits, and redacted
//! output, but OS-level isolation requires a future Docker backend.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;
use tokio::process::Command;

use super::{truncate_chars, BuiltinToolConfig};
use crate::agent::security::{detect_dangerous_command, redact_terminal_output, Severity};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

const DEFAULT_TIMEOUT_SECS: u64 = 300;
const MAX_TIMEOUT_SECS: u64 = 300;
const MAX_STDOUT_CHARS: usize = 50_000;
const MAX_STDERR_CHARS: usize = 10_000;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    registry.register(ToolEntry {
        name: "execute_code".to_string(),
        toolset: "code_execution".to_string(),
        schema: tool_schema(
            "execute_code",
            "Execute a Python script with scrubbed environment and timeout. Not enabled by safe defaults.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "code": { "type": "string" },
                    "language": { "type": "string", "enum": ["python"], "default": "python" },
                    "timeout": { "type": "integer", "minimum": 1, "maximum": MAX_TIMEOUT_SECS }
                },
                "required": ["code"]
            }),
        ),
        handler: Arc::new(CodeExecTool {
            working_dir: config.working_dir.clone(),
            scratch_dir: config.agent_data_dir.join("sandbox"),
        }),
    });
}

struct CodeExecTool {
    working_dir: PathBuf,
    scratch_dir: PathBuf,
}

#[async_trait]
impl ToolHandler for CodeExecTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
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
            let action = match matched.severity {
                Severity::Hardline => "blocked",
                Severity::Dangerous => "requires approval",
            };
            return Err(ToolError::Unavailable(format!(
                "{action}: {} ({})",
                matched.description, matched.pattern_key
            )));
        }
        let timeout_secs = args
            .get("timeout")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS);

        tokio::fs::create_dir_all(&self.scratch_dir)
            .await
            .map_err(|err| ToolError::Execution(format!("scratch dir create failed: {err}")))?;
        let script = self
            .scratch_dir
            .join(format!("exec-{}.py", uuid::Uuid::new_v4()));
        tokio::fs::write(&script, code)
            .await
            .map_err(|err| ToolError::Execution(format!("script write failed: {err}")))?;

        let output = tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            Command::new("python3")
                .arg(&script)
                .current_dir(&self.working_dir)
                .env_clear()
                .envs(scrubbed_env())
                .output(),
        )
        .await
        .map_err(|_| ToolError::Execution(format!("code timed out after {timeout_secs}s")))?
        .map_err(|err| ToolError::Unavailable(format!("python3 execution failed: {err}")))?;

        let _ = tokio::fs::remove_file(&script).await;
        Ok(tool_result(&serde_json::json!({
            "success": output.status.success(),
            "stdout": truncate_chars(&redact_terminal_output(&String::from_utf8_lossy(&output.stdout)), MAX_STDOUT_CHARS),
            "stderr": truncate_chars(&redact_terminal_output(&String::from_utf8_lossy(&output.stderr)), MAX_STDERR_CHARS),
            "exit_code": output.status.code().unwrap_or(-1),
        })))
    }
}

fn scrubbed_env() -> HashMap<String, String> {
    let mut env = HashMap::new();
    for key in ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }
    env.insert("PYTHONNOUSERSITE".to_string(), "1".to_string());
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubbed_env_excludes_secret_names() {
        let env = scrubbed_env();
        assert!(!env.keys().any(|key| key.contains("TOKEN")));
        assert!(env.contains_key("PYTHONNOUSERSITE"));
    }
}
