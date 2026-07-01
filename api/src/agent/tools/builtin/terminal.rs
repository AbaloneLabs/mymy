//! Local terminal tool.
//!
//! The handler exists for Phase 4 parity, but the chat integration does not
//! expose the `terminal` toolset by default. Running arbitrary commands needs
//! the explicit approval layer planned for Phase 8.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;
use tokio::process::Command;

use super::{truncate_chars, BuiltinToolConfig};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

const MAX_OUTPUT_CHARS: usize = 16_000;
const DEFAULT_TIMEOUT_SECS: u64 = 60;
const MAX_TIMEOUT_SECS: u64 = 180;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    registry.register(ToolEntry {
        name: "terminal".to_string(),
        toolset: "terminal".to_string(),
        schema: tool_schema(
            "terminal",
            "Execute a local shell command. Returns stdout, stderr, and exit code.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute." },
                    "timeout": { "type": "integer", "minimum": 1, "maximum": MAX_TIMEOUT_SECS, "description": "Maximum seconds to wait." },
                    "workdir": { "type": "string", "description": "Optional working directory." }
                },
                "required": ["command"]
            }),
        ),
        handler: Arc::new(TerminalTool {
            working_dir: config.working_dir.clone(),
        }),
    });
}

struct TerminalTool {
    working_dir: PathBuf,
}

#[async_trait]
impl ToolHandler for TerminalTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let command = args
            .get("command")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("missing command".to_string()))?;
        let timeout_secs = args
            .get("timeout")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS);
        let workdir = args
            .get("workdir")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .unwrap_or_else(|| self.working_dir.clone());
        ensure_directory(&workdir)?;

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
            "stdout": truncate_chars(&String::from_utf8_lossy(&output.stdout), MAX_OUTPUT_CHARS),
            "stderr": truncate_chars(&String::from_utf8_lossy(&output.stderr), MAX_OUTPUT_CHARS),
            "exit_code": output.status.code().unwrap_or(-1),
        })))
    }
}

fn ensure_directory(path: &Path) -> Result<(), ToolError> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(ToolError::InvalidArgs(format!(
            "workdir is not a directory: {}",
            path.display()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn terminal_runs_harmless_command() {
        let tool = TerminalTool {
            working_dir: std::env::current_dir().unwrap(),
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
}
