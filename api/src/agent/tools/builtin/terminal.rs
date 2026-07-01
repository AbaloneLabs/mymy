//! Local terminal tool.
//!
//! The handler exists for Phase 4 parity, but the chat integration does not
//! expose the `terminal` toolset by default. Running arbitrary commands needs
//! the explicit approval layer planned for Phase 8.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use serde_json::Value;
use tokio::process::Command;

use super::{truncate_chars, BuiltinToolConfig};
use crate::agent::security::{
    detect_dangerous_command, ensure_read_allowed, ensure_write_allowed, redact_terminal_output,
    Severity,
};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};
use crate::services::audit::log_security_denial_safe;

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
            db: config.db.clone(),
        }),
    });
}

struct TerminalTool {
    working_dir: PathBuf,
    db: Option<sqlx::PgPool>,
}

#[async_trait]
impl ToolHandler for TerminalTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        self.run(args, false).await
    }

    async fn execute_approved(&self, args: &Value) -> Result<String, ToolError> {
        self.run(args, true).await
    }
}

impl TerminalTool {
    async fn run(&self, args: &Value, approved_dangerous: bool) -> Result<String, ToolError> {
        let command = args
            .get("command")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("missing command".to_string()))?;
        let workdir = args
            .get("workdir")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .unwrap_or_else(|| self.working_dir.clone());
        let workdir = ensure_directory(&self.working_dir, &workdir)?;
        check_redirected_paths(self.db.as_ref(), command, &workdir).await?;

        if let Some(matched) = detect_dangerous_command(command) {
            match matched.severity {
                Severity::Hardline => {
                    return Err(ToolError::Unavailable(format!(
                        "blocked: {} ({})",
                        matched.description, matched.pattern_key
                    )));
                }
                Severity::Dangerous if !approved_dangerous => {
                    return Err(ToolError::Unavailable(format!(
                        "requires approval: {} ({})",
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
        })))
    }
}

async fn check_redirected_paths(
    db: Option<&sqlx::PgPool>,
    command: &str,
    workdir: &Path,
) -> Result<(), ToolError> {
    for target in redirected_targets(output_redirection_regex(), command) {
        let path = resolve_shell_path(workdir, &target);
        if let Err(error) = ensure_write_allowed(&path) {
            audit_terminal_denial(db, "terminal_write_redirect", &path, &error).await;
            return Err(error);
        }
    }
    for target in redirected_targets(input_redirection_regex(), command) {
        let path = resolve_shell_path(workdir, &target);
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

fn ensure_directory(root: &Path, path: &Path) -> Result<PathBuf, ToolError> {
    let root = std::fs::canonicalize(root)
        .map_err(|err| ToolError::InvalidArgs(format!("workspace cannot be resolved: {err}")))?;
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let canonical = std::fs::canonicalize(&resolved)
        .map_err(|err| ToolError::InvalidArgs(format!("workdir cannot be resolved: {err}")))?;
    if !canonical.is_dir() {
        Err(ToolError::InvalidArgs(format!(
            "workdir is not a directory: {}",
            canonical.display()
        )))
    } else if !canonical.starts_with(root) {
        Err(ToolError::InvalidArgs(format!(
            "workdir escapes workspace: {}",
            path.display()
        )))
    } else {
        Ok(canonical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn terminal_runs_harmless_command() {
        let tool = TerminalTool {
            working_dir: std::env::current_dir().unwrap(),
            db: None,
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
    async fn terminal_blocks_dangerous_command() {
        let tool = TerminalTool {
            working_dir: std::env::current_dir().unwrap(),
            db: None,
        };
        let err = tool
            .execute(&serde_json::json!({"command":"rm -rf target/tmp"}))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("requires approval"));
    }

    #[tokio::test]
    async fn terminal_runs_dangerous_command_after_approval() {
        let tool = TerminalTool {
            working_dir: std::env::current_dir().unwrap(),
            db: None,
        };
        let output = tool
            .execute_approved(&serde_json::json!({"command":"printf 'DELETE FROM users'"}))
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
            db: None,
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
            db: None,
        };
        let err = tool
            .execute(&serde_json::json!({"command":"printf secret > .env"}))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("sensitive path"));
    }
}
