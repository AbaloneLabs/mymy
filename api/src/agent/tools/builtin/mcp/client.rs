use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::agent::security::redact_sensitive_text;
use crate::agent::tools::ToolError;

use super::config::{filtered_env, transport_name, McpServerConfig};

pub(super) async fn mcp_health_probe(server: &McpServerConfig) -> Result<Value, ToolError> {
    match rpc_request(server, "ping", serde_json::json!({})).await {
        Ok(_) => Ok(serde_json::json!({
            "healthy": true,
            "probe": "ping",
        })),
        Err(err) if is_method_not_found(&err) => {
            let result = rpc_request(server, "tools/list", serde_json::json!({})).await?;
            let tool_count = result
                .get("tools")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            Ok(serde_json::json!({
                "healthy": true,
                "probe": "tools/list",
                "toolCount": tool_count,
            }))
        }
        Err(err) => Err(err),
    }
}

pub(super) async fn rpc_request(
    server: &McpServerConfig,
    method: &str,
    params: Value,
) -> Result<Value, ToolError> {
    if server.command.is_some() {
        return stdio_request(server, method, params).await;
    }
    if server.url.is_some() && matches!(transport_name(server), "http" | "streamable_http") {
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
            "protocolVersion": "2025-06-18",
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
    let _ = parse_rpc_response_for_id(&init_line, 1)?;

    let initialized = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    });
    stdin
        .write_all(format!("{initialized}\n").as_bytes())
        .await
        .map_err(|err| ToolError::Execution(format!("MCP initialized write failed: {err}")))?;

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

    let line = read_response_line(&mut lines, 2, server.timeout_secs).await?;
    let _ = child.kill().await;
    parse_rpc_response_for_id(&line, 2)
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
    let mut request = client.post(url);
    for (key, value) in &server.headers {
        request = request.header(key, value.expose());
    }
    let response = request
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }))
        .send()
        .await
        .map_err(|err| ToolError::Execution(format!("MCP HTTP request failed: {err}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| ToolError::Execution(format!("MCP HTTP body failed: {err}")))?;
    if !status.is_success() {
        return Err(ToolError::Execution(format!(
            "MCP HTTP status {}: {}",
            status.as_u16(),
            redact_sensitive_text(&text)
        )));
    }
    parse_rpc_response_for_id(&text, 1)
}

pub(super) fn parse_rpc_response_for_id(raw: &str, expected_id: i64) -> Result<Value, ToolError> {
    parse_rpc_response_inner(raw, Some(expected_id))
}

fn parse_rpc_response_inner(raw: &str, expected_id: Option<i64>) -> Result<Value, ToolError> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|err| ToolError::Execution(format!("MCP JSON parse failed: {err}")))?;
    if let Some(expected_id) = expected_id {
        let id = value.get("id").and_then(Value::as_i64);
        if id != Some(expected_id) {
            return Err(ToolError::Execution(format!(
                "MCP response id mismatch: expected {expected_id}, got {id:?}"
            )));
        }
    }
    if let Some(error) = value.get("error") {
        return Err(ToolError::Execution(format!(
            "MCP error: {}",
            redact_sensitive_text(&error.to_string())
        )));
    }
    Ok(value.get("result").cloned().unwrap_or(Value::Null))
}

async fn read_response_line(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    expected_id: i64,
    timeout_secs: u64,
) -> Result<String, ToolError> {
    loop {
        let line = tokio::time::timeout(Duration::from_secs(timeout_secs), lines.next_line())
            .await
            .map_err(|_| ToolError::Execution("MCP stdio request timed out".to_string()))?
            .map_err(|err| ToolError::Execution(format!("MCP response read failed: {err}")))?
            .ok_or_else(|| ToolError::Execution("MCP server closed stdout".to_string()))?;
        let value: Value = serde_json::from_str(&line)
            .map_err(|err| ToolError::Execution(format!("MCP JSON parse failed: {err}")))?;
        if value.get("id").and_then(Value::as_i64) == Some(expected_id) {
            return Ok(line);
        }
    }
}

fn is_method_not_found(error: &ToolError) -> bool {
    let value = error.to_string().to_ascii_lowercase();
    value.contains("-32601") || value.contains("method not found")
}
