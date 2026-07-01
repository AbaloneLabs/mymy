//! Minimal MCP client tools.
//!
//! Servers are loaded from `data/agent/mcp/servers.json`. Stdio subprocesses
//! receive only a safe baseline environment plus explicitly configured keys,
//! so local credentials are not leaked to arbitrary MCP servers.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::BuiltinToolConfig;
use crate::agent::security::{redact_sensitive_text, SecretString};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

const DEFAULT_TIMEOUT_SECS: u64 = 60;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let path = config.agent_data_dir.join("mcp").join("servers.json");
    registry.register(ToolEntry {
        name: "mcp_status".to_string(),
        toolset: "mcp".to_string(),
        schema: tool_schema(
            "mcp_status",
            "List configured MCP servers loaded from the local agent data directory.",
            serde_json::json!({ "type": "object", "properties": {} }),
        ),
        handler: Arc::new(McpStatusTool { path: path.clone() }),
    });
    registry.register(ToolEntry {
        name: "mcp_list_tools".to_string(),
        toolset: "mcp".to_string(),
        schema: tool_schema(
            "mcp_list_tools",
            "Call an MCP server's tools/list method.",
            serde_json::json!({
                "type": "object",
                "properties": { "server": { "type": "string" } },
                "required": ["server"]
            }),
        ),
        handler: Arc::new(McpListToolsTool { path: path.clone() }),
    });
    registry.register(ToolEntry {
        name: "mcp_call".to_string(),
        toolset: "mcp".to_string(),
        schema: tool_schema(
            "mcp_call",
            "Call a configured MCP server tool through JSON-RPC tools/call.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" },
                    "tool": { "type": "string" },
                    "arguments": { "type": "object" }
                },
                "required": ["server", "tool"]
            }),
        ),
        handler: Arc::new(McpCallTool { path }),
    });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct McpServerConfig {
    name: String,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    transport: Option<String>,
    #[serde(default)]
    env: BTreeMap<String, SecretString>,
    #[serde(default = "default_timeout")]
    timeout_secs: u64,
}

fn default_timeout() -> u64 {
    DEFAULT_TIMEOUT_SECS
}

struct McpStatusTool {
    path: PathBuf,
}

#[async_trait]
impl ToolHandler for McpStatusTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        let servers = load_servers(&self.path)?;
        let status = servers
            .into_iter()
            .map(|server| {
                serde_json::json!({
                    "name": server.name,
                    "transport": transport_name(&server),
                    "configured": true
                })
            })
            .collect::<Vec<_>>();
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "servers": status
        })))
    }
}

struct McpListToolsTool {
    path: PathBuf,
}

#[async_trait]
impl ToolHandler for McpListToolsTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let server = resolve_server(&self.path, required_str(args, "server")?)?;
        let result = rpc_request(&server, "tools/list", serde_json::json!({})).await?;
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "server": server.name,
            "result": result
        })))
    }
}

struct McpCallTool {
    path: PathBuf,
}

#[async_trait]
impl ToolHandler for McpCallTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let server = resolve_server(&self.path, required_str(args, "server")?)?;
        let tool = required_str(args, "tool")?;
        let arguments = args
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let result = rpc_request(
            &server,
            "tools/call",
            serde_json::json!({ "name": tool, "arguments": arguments }),
        )
        .await?;
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "server": server.name,
            "tool": tool,
            "result": result
        })))
    }
}

async fn rpc_request(
    server: &McpServerConfig,
    method: &str,
    params: Value,
) -> Result<Value, ToolError> {
    if server.command.is_some() {
        return stdio_request(server, method, params).await;
    }
    if server.url.is_some() && transport_name(server) == "http" {
        return http_request(server, method, params).await;
    }
    Err(ToolError::Unavailable(format!(
        "unsupported MCP transport: {}",
        transport_name(server)
    )))
}

async fn stdio_request(
    server: &McpServerConfig,
    method: &str,
    params: Value,
) -> Result<Value, ToolError> {
    let command = server.command.as_deref().unwrap();
    let mut child = Command::new(command)
        .args(&server.args)
        .env_clear()
        .envs(filtered_env(&server.env))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| ToolError::Unavailable(format!("MCP stdio spawn failed: {err}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| ToolError::Execution("MCP stdin unavailable".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ToolError::Execution("MCP stdout unavailable".to_string()))?;
    let mut lines = BufReader::new(stdout).lines();

    let initialize = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "mymy", "version": "0.1.0" }
        }
    });
    stdin
        .write_all(format!("{initialize}\n").as_bytes())
        .await
        .map_err(|err| ToolError::Execution(format!("MCP initialize write failed: {err}")))?;
    let init_line =
        tokio::time::timeout(Duration::from_secs(server.timeout_secs), lines.next_line())
            .await
            .map_err(|_| ToolError::Execution("MCP initialize timed out".to_string()))?
            .map_err(|err| ToolError::Execution(format!("MCP initialize read failed: {err}")))?
            .ok_or_else(|| {
                ToolError::Execution("MCP server closed during initialize".to_string())
            })?;
    let _ = parse_rpc_response(&init_line)?;

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": method,
        "params": params
    });
    stdin
        .write_all(format!("{request}\n").as_bytes())
        .await
        .map_err(|err| ToolError::Execution(format!("MCP request write failed: {err}")))?;
    drop(stdin);

    let line = tokio::time::timeout(Duration::from_secs(server.timeout_secs), lines.next_line())
        .await
        .map_err(|_| ToolError::Execution("MCP stdio request timed out".to_string()))?
        .map_err(|err| ToolError::Execution(format!("MCP response read failed: {err}")))?
        .ok_or_else(|| ToolError::Execution("MCP server closed stdout".to_string()))?;
    let _ = child.kill().await;
    parse_rpc_response(&line)
}

async fn http_request(
    server: &McpServerConfig,
    method: &str,
    params: Value,
) -> Result<Value, ToolError> {
    let url = server.url.as_deref().unwrap();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(server.timeout_secs))
        .build()
        .map_err(|err| ToolError::Execution(format!("MCP HTTP client failed: {err}")))?;
    let response = client
        .post(url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }))
        .send()
        .await
        .map_err(|err| ToolError::Execution(format!("MCP HTTP request failed: {err}")))?;
    let text = response
        .text()
        .await
        .map_err(|err| ToolError::Execution(format!("MCP HTTP body failed: {err}")))?;
    parse_rpc_response(&text)
}

fn parse_rpc_response(raw: &str) -> Result<Value, ToolError> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|err| ToolError::Execution(format!("MCP JSON parse failed: {err}")))?;
    if let Some(error) = value.get("error") {
        return Err(ToolError::Execution(format!(
            "MCP error: {}",
            redact_sensitive_text(&error.to_string())
        )));
    }
    Ok(value.get("result").cloned().unwrap_or(Value::Null))
}

fn load_servers(path: &PathBuf) -> Result<Vec<McpServerConfig>, ToolError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| ToolError::Execution(format!("MCP config read failed: {err}")))?;
    serde_json::from_str(&raw)
        .map_err(|err| ToolError::Execution(format!("MCP config parse failed: {err}")))
}

fn resolve_server(path: &PathBuf, name: &str) -> Result<McpServerConfig, ToolError> {
    load_servers(path)?
        .into_iter()
        .find(|server| server.name == name)
        .ok_or_else(|| ToolError::InvalidArgs(format!("MCP server not found: {name}")))
}

fn filtered_env(configured: &BTreeMap<String, SecretString>) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for key in ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }
    for (key, value) in configured {
        env.insert(key.clone(), value.expose().to_string());
    }
    env
}

fn transport_name(server: &McpServerConfig) -> &str {
    if let Some(transport) = server.transport.as_deref() {
        return transport;
    }
    if server.command.is_some() {
        "stdio"
    } else {
        "http"
    }
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filtered_env_uses_explicit_secret_only() {
        let mut configured = BTreeMap::new();
        configured.insert("API_KEY".to_string(), SecretString::new("secret"));
        let env = filtered_env(&configured);
        assert_eq!(env.get("API_KEY").unwrap(), "secret");
    }
}
