//! Local Python code execution tool.
//!
//! This is a controlled convenience layer over the sandbox runner. The
//! subprocess receives a scrubbed environment, a workspace working directory,
//! timeout limits, redacted output, and the same runner isolation as terminal
//! commands when the runner is configured.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::{truncate_chars, workspace_paths::WorkspacePathPolicy, BuiltinToolConfig};
use crate::agent::sandbox::{ExecOptions, SandboxManager, SandboxRpcHandler};
use crate::agent::security::{
    detect_dangerous_command, ensure_read_allowed, ensure_write_allowed, is_sensitive_path,
    redact_sensitive_text, redact_terminal_output, Severity,
};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};
use crate::models::agent::AgentToolDomain;
use crate::services::file_observations::{
    ensure_file_not_changed_since_observed, record_file_observation, FileObservationSource,
};
use crate::services::sandbox_runner::{roots_for_runner, RunnerClient, RunnerExecuteRequest};

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
        };
        let output = if let Some(runner_url) = self.runner_url.as_deref() {
            execute_python_with_runner(
                runner_url,
                &self.working_dir,
                &self.allowed_roots,
                &self.scratch_dir,
                options,
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

async fn execute_python_with_runner(
    runner_url: &str,
    working_dir: &Path,
    allowed_roots: &[PathBuf],
    scratch_dir: &Path,
    options: ExecOptions,
) -> Result<crate::agent::sandbox::ExecResult, crate::agent::sandbox::SandboxError> {
    if options.language != "python" {
        return Err(crate::agent::sandbox::SandboxError::InvalidRequest(
            "only python is supported".to_string(),
        ));
    }
    tokio::fs::create_dir_all(&scratch_dir)
        .await
        .map_err(|err| {
            crate::agent::sandbox::SandboxError::Execution(format!(
                "scratch dir create failed: {err}"
            ))
        })?;
    let cwd = resolve_runner_cwd(working_dir, allowed_roots, options.cwd)?;
    let script = scratch_dir.join(format!("exec-{}.py", uuid::Uuid::new_v4()));
    let runner = scratch_dir.join(format!("runner-{}.py", uuid::Uuid::new_v4()));
    let cwd_file = scratch_dir.join(".cwd");
    tokio::fs::write(&script, options.code)
        .await
        .map_err(|err| {
            crate::agent::sandbox::SandboxError::Execution(format!("script write failed: {err}"))
        })?;
    let runner_code = format!(
        r#"import os
import runpy

script = {script:?}
cwd_file = {cwd_file:?}
try:
    runpy.run_path(script, run_name="__main__")
finally:
    with open(cwd_file, "w", encoding="utf-8") as handle:
        handle.write(os.getcwd())
"#,
        script = script.display().to_string(),
        cwd_file = cwd_file.display().to_string()
    );
    tokio::fs::write(&runner, runner_code)
        .await
        .map_err(|err| {
            crate::agent::sandbox::SandboxError::Execution(format!("runner write failed: {err}"))
        })?;

    let mut extra_roots = Vec::with_capacity(allowed_roots.len() + 1);
    extra_roots.push(scratch_dir.to_path_buf());
    extra_roots.extend(allowed_roots.iter().cloned());

    let response = RunnerClient::new(runner_url.to_string())
        .execute(&RunnerExecuteRequest {
            command: format!("python3 {}", shell_quote(&runner.display().to_string())),
            cwd: cwd.display().to_string(),
            roots: roots_for_runner(working_dir, &extra_roots),
            timeout_secs: Some(options.timeout_secs),
            env: Some(options.extra_env),
        })
        .await
        .map_err(|err| crate::agent::sandbox::SandboxError::Execution(err.to_string()))?;
    let _ = tokio::fs::remove_file(&script).await;
    let _ = tokio::fs::remove_file(&runner).await;
    let cwd = tokio::fs::read_to_string(&cwd_file)
        .await
        .ok()
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .unwrap_or(response.cwd);
    Ok(crate::agent::sandbox::ExecResult {
        success: response.success,
        stdout: response.stdout,
        stderr: response.stderr,
        exit_code: response.exit_code,
        cwd,
    })
}

fn resolve_runner_cwd(
    working_dir: &Path,
    allowed_roots: &[PathBuf],
    requested: Option<PathBuf>,
) -> Result<PathBuf, crate::agent::sandbox::SandboxError> {
    let paths = WorkspacePathPolicy::new(working_dir.to_path_buf(), allowed_roots.to_vec());
    match requested {
        Some(path) => paths
            .resolve_directory_path(&path)
            .map_err(|err| crate::agent::sandbox::SandboxError::InvalidRequest(err.to_string())),
        None => Ok(paths.root().to_path_buf()),
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

struct CodeRpcHandler {
    paths: WorkspacePathPolicy,
    allowed_tools: HashSet<String>,
    db: Option<sqlx::PgPool>,
    agent_profile: Option<String>,
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
        let resolved = self
            .paths
            .resolve_existing_with_logical(path)
            .map_err(|err| err.to_string())?;
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
        ensure_write_allowed(&resolved.physical).map_err(|err| err.to_string())?;
        ensure_file_not_changed_since_observed(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            &resolved.logical,
            &resolved.physical,
        )
        .await?;
        if let Some(parent) = resolved.physical.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|err| format!("create parent failed: {err}"))?;
        }
        tokio::fs::write(&resolved.physical, content)
            .await
            .map_err(|err| format!("write failed: {err}"))?;
        record_file_observation(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            &resolved.logical,
            &resolved.physical,
            FileObservationSource::Write,
        )
        .await?;
        Ok(serde_json::json!({
            "path": resolved.logical,
            "bytes_written": content.len(),
            "lines_written": content.lines().count(),
        }))
    }

    async fn patch_file(&self, args: Value) -> Result<Value, String> {
        let path = required_arg(&args, "path")?;
        let old_string = required_arg(&args, "old_string")?;
        let new_string = required_arg(&args, "new_string")?;
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
        tokio::fs::write(&resolved.physical, updated)
            .await
            .map_err(|err| format!("write failed: {err}"))?;
        record_file_observation(
            self.db.as_ref(),
            self.agent_profile.as_deref(),
            &resolved.logical,
            &resolved.physical,
            FileObservationSource::Write,
        )
        .await?;
        Ok(serde_json::json!({
            "path": resolved.logical,
            "replacements": 1,
        }))
    }
}

fn sandbox_allowed_tools(config: &BuiltinToolConfig) -> HashSet<String> {
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

fn python_tool_stub() -> &'static str {
    r#"import json
import os
import socket


def call_tool(name, **kwargs):
    socket_path = os.environ.get("MYMY_TOOLS_RPC_PATH")
    if not socket_path:
        raise RuntimeError("MYMY_TOOLS_RPC_PATH is not configured")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.connect(socket_path)
        client.sendall((json.dumps({"tool": name, "args": kwargs}) + "\n").encode("utf-8"))
        response = b""
        while not response.endswith(b"\n"):
            chunk = client.recv(65536)
            if not chunk:
                break
            response += chunk
    payload = json.loads(response.decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error", "tool RPC failed"))
    return payload.get("result")


def read_file(path, offset=1, limit=500):
    return call_tool("read_file", path=path, offset=offset, limit=limit)


def search_files(query, path=None, limit=50):
    args = {"query": query, "limit": limit}
    if path is not None:
        args["path"] = path
    return call_tool("search_files", **args)


def write_file(path, content):
    return call_tool("write_file", path=path, content=content)


def patch_file(path, old_string, new_string):
    return call_tool("patch_file", path=path, old_string=old_string, new_string=new_string)
"#
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("mymy-code-exec-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn test_tool(workspace: PathBuf, scratch: PathBuf) -> CodeExecTool {
        CodeExecTool {
            working_dir: workspace,
            allowed_roots: Vec::new(),
            scratch_dir: scratch,
            runner_url: None,
            allowed_tools: ["read_file", "search_files", "write_file", "patch_file"]
                .into_iter()
                .map(ToString::to_string)
                .collect(),
            db: None,
            agent_profile: None,
        }
    }

    #[tokio::test]
    async fn python_can_call_allowed_tools_via_rpc() {
        let workspace = temp_dir("workspace");
        let scratch = temp_dir("scratch");
        std::fs::write(workspace.join("sample.txt"), "needle\nsecond").unwrap();
        let tool = test_tool(workspace.clone(), scratch.clone());

        let output = tool
            .execute(&serde_json::json!({
                "code": r#"import json
import mymy_tools
print(mymy_tools.read_file("sample.txt")["content"])
print(len(mymy_tools.search_files("needle")["matches"]))
"#
            }))
            .await
            .unwrap();
        let parsed = serde_json::from_str::<Value>(&output).unwrap();
        assert!(parsed["stdout"].as_str().unwrap().contains("needle"));
        assert!(parsed["stdout"].as_str().unwrap().contains("1"));

        let _ = std::fs::remove_dir_all(workspace);
        let _ = std::fs::remove_dir_all(scratch);
    }

    #[tokio::test]
    async fn cwd_persists_across_calls_in_same_scratch_session() {
        let workspace = temp_dir("workspace");
        let scratch = temp_dir("scratch");
        std::fs::create_dir_all(workspace.join("nested")).unwrap();
        let tool = test_tool(workspace.clone(), scratch.clone());

        tool.execute(&serde_json::json!({
            "code": r#"import os
os.chdir("nested")
"#
        }))
        .await
        .unwrap();
        let output = tool
            .execute(&serde_json::json!({
                "code": r#"import os
print(os.path.basename(os.getcwd()))
"#
            }))
            .await
            .unwrap();
        let parsed = serde_json::from_str::<Value>(&output).unwrap();
        assert!(parsed["stdout"].as_str().unwrap().contains("nested"));

        let _ = std::fs::remove_dir_all(workspace);
        let _ = std::fs::remove_dir_all(scratch);
    }

    #[tokio::test]
    async fn python_can_write_and_patch_files_via_rpc() {
        let workspace = temp_dir("workspace");
        let scratch = temp_dir("scratch");
        let tool = test_tool(workspace.clone(), scratch.clone());

        let output = tool
            .execute(&serde_json::json!({
                "code": r#"import mymy_tools
mymy_tools.write_file("generated.txt", "alpha\n")
mymy_tools.patch_file("generated.txt", "alpha", "beta")
print(mymy_tools.read_file("generated.txt")["content"])
"#
            }))
            .await
            .unwrap();
        let parsed = serde_json::from_str::<Value>(&output).unwrap();
        assert!(parsed["stdout"].as_str().unwrap().contains("beta"));

        let _ = std::fs::remove_dir_all(workspace);
        let _ = std::fs::remove_dir_all(scratch);
    }

    #[tokio::test]
    async fn python_rpc_can_write_shared_logical_drive_path() {
        let base = temp_dir("drive");
        let workspace = base.join("drive").join("agents").join("elena");
        let shared = base.join("drive").join("shared");
        let scratch = temp_dir("scratch");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&shared).unwrap();
        let tool = CodeExecTool {
            working_dir: workspace.clone(),
            allowed_roots: vec![shared.clone()],
            scratch_dir: scratch.clone(),
            runner_url: None,
            allowed_tools: ["read_file", "search_files", "write_file", "patch_file"]
                .into_iter()
                .map(ToString::to_string)
                .collect(),
            db: None,
            agent_profile: None,
        };

        let output = tool
            .execute(&serde_json::json!({
                "code": r#"import mymy_tools
mymy_tools.write_file("/drive/shared/generated.txt", "shared\n")
print(mymy_tools.read_file("/drive/shared/generated.txt")["content"])
"#
            }))
            .await
            .unwrap();
        let parsed = serde_json::from_str::<Value>(&output).unwrap();
        assert!(parsed["stdout"].as_str().unwrap().contains("shared"));
        assert_eq!(
            std::fs::read_to_string(shared.join("generated.txt")).unwrap(),
            "shared\n"
        );

        let _ = std::fs::remove_dir_all(base);
        let _ = std::fs::remove_dir_all(scratch);
    }

    #[test]
    fn runner_cwd_accepts_logical_shared_drive_path() {
        let base = temp_dir("drive");
        let workspace = base.join("drive").join("agents").join("elena");
        let shared = base.join("drive").join("shared");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&shared).unwrap();

        let cwd = resolve_runner_cwd(
            &workspace,
            std::slice::from_ref(&shared),
            Some("/drive/shared".into()),
        )
        .unwrap();
        assert_eq!(cwd, shared.canonicalize().unwrap());

        let _ = std::fs::remove_dir_all(base);
    }
}
