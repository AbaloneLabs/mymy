//! Minimal MCP client tools.
//!
//! Servers are loaded from `data/agent/mcp/servers.json`. Stdio subprocesses
//! receive only a safe baseline environment plus explicitly configured keys,
//! so local credentials are not leaked to arbitrary MCP servers.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::extensions::ExtensionSettings;
use super::BuiltinToolConfig;
use crate::agent::crypto::{self, EncryptedKey};
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
        handler: Arc::new(McpStatusTool {
            path: path.clone(),
            db: config.db.clone(),
            extension_settings_key: config.extension_settings_key,
        }),
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
        handler: Arc::new(McpListToolsTool {
            path: path.clone(),
            db: config.db.clone(),
            extension_settings_key: config.extension_settings_key,
        }),
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
        handler: Arc::new(McpCallTool {
            path,
            db: config.db.clone(),
            extension_settings_key: config.extension_settings_key,
        }),
    });
}

pub async fn register_dynamic_tools(
    registry: &mut ToolRegistry,
    config: &BuiltinToolConfig,
) -> Result<(), ToolError> {
    let path = config.agent_data_dir.join("mcp").join("servers.json");
    let servers = load_servers(
        &path,
        config.db.as_ref(),
        config.extension_settings_key.as_ref(),
    )
    .await?;
    for server in servers {
        let list_result = match rpc_request(&server, "tools/list", serde_json::json!({})).await {
            Ok(result) => result,
            Err(err) => {
                tracing::warn!(
                    server = %server.name,
                    error = %err,
                    "MCP dynamic tool discovery failed"
                );
                continue;
            }
        };
        let Some(tools) = list_result.get("tools").and_then(Value::as_array) else {
            continue;
        };
        for tool in tools {
            let Some(remote_name) = tool.get("name").and_then(Value::as_str) else {
                continue;
            };
            let tool_name = prefixed_tool_name(&server.name, remote_name);
            let description = tool
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("MCP server tool")
                .to_string();
            let parameters = tool
                .get("inputSchema")
                .or_else(|| tool.get("input_schema"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({ "type": "object", "properties": {} }));
            registry.register(ToolEntry {
                name: tool_name.clone(),
                toolset: "mcp".to_string(),
                schema: tool_schema(&tool_name, &description, parameters),
                handler: Arc::new(McpDynamicTool {
                    path: path.clone(),
                    db: config.db.clone(),
                    extension_settings_key: config.extension_settings_key,
                    server_name: server.name.clone(),
                    remote_tool_name: remote_name.to_string(),
                }),
            });
        }
    }
    Ok(())
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
    #[serde(default)]
    headers: BTreeMap<String, SecretString>,
    #[serde(default = "default_timeout")]
    timeout_secs: u64,
    #[serde(default = "default_source")]
    source: String,
}

fn default_timeout() -> u64 {
    DEFAULT_TIMEOUT_SECS
}

fn default_source() -> String {
    "file".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub prefixed_name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub name: String,
    pub transport: String,
    pub source: String,
    pub configured: bool,
    pub healthy: bool,
    pub error: Option<String>,
    pub tool_count: usize,
    pub tools: Vec<McpToolInfo>,
}

pub async fn inspect_servers(
    agent_data_dir: &Path,
    db: Option<&sqlx::PgPool>,
    extension_settings_key: Option<&[u8; 32]>,
) -> Result<Vec<McpServerStatus>, ToolError> {
    let path = agent_data_dir.join("mcp").join("servers.json");
    let servers = load_servers(&path, db, extension_settings_key).await?;
    let mut statuses = Vec::new();
    for server in servers {
        let health = mcp_health_probe(&server).await;
        let tools_result = rpc_request(&server, "tools/list", serde_json::json!({})).await;
        let tools = tools_result
            .as_ref()
            .ok()
            .map(|result| parse_tool_infos(&server, result))
            .unwrap_or_default();
        let healthy = health.is_ok() || tools_result.is_ok();
        let error = match (health.err(), tools_result.err()) {
            (Some(health_err), Some(tools_err)) => {
                Some(format!("health: {}; tools/list: {}", health_err, tools_err))
            }
            (Some(health_err), None) => Some(health_err.to_string()),
            (None, Some(tools_err)) => Some(tools_err.to_string()),
            (None, None) => None,
        }
        .map(|value| redact_sensitive_text(&value));
        statuses.push(McpServerStatus {
            name: server.name.clone(),
            transport: transport_name(&server).to_string(),
            source: server.source.clone(),
            configured: true,
            healthy,
            error,
            tool_count: tools.len(),
            tools,
        });
    }
    Ok(statuses)
}

struct McpStatusTool {
    path: PathBuf,
    db: Option<sqlx::PgPool>,
    extension_settings_key: Option<[u8; 32]>,
}

#[async_trait]
impl ToolHandler for McpStatusTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        let servers = load_servers(
            &self.path,
            self.db.as_ref(),
            self.extension_settings_key.as_ref(),
        )
        .await?;
        let mut status = Vec::new();
        for server in servers {
            let health = match mcp_health_probe(&server).await {
                Ok(health) => health,
                Err(err) => serde_json::json!({
                    "healthy": false,
                    "error": err.to_string(),
                }),
            };
            status.push(serde_json::json!({
                "name": server.name,
                "transport": transport_name(&server),
                "configured": true,
                "health": health,
            }));
        }
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "servers": status
        })))
    }
}

struct McpListToolsTool {
    path: PathBuf,
    db: Option<sqlx::PgPool>,
    extension_settings_key: Option<[u8; 32]>,
}

#[async_trait]
impl ToolHandler for McpListToolsTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let server = resolve_server(
            &self.path,
            self.db.as_ref(),
            self.extension_settings_key.as_ref(),
            required_str(args, "server")?,
        )
        .await?;
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
    db: Option<sqlx::PgPool>,
    extension_settings_key: Option<[u8; 32]>,
}

#[async_trait]
impl ToolHandler for McpCallTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let server = resolve_server(
            &self.path,
            self.db.as_ref(),
            self.extension_settings_key.as_ref(),
            required_str(args, "server")?,
        )
        .await?;
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
        let result = process_content_blocks(result, &media_dir_for_config(&self.path)).await?;
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "server": server.name,
            "tool": tool,
            "result": result
        })))
    }
}

struct McpDynamicTool {
    path: PathBuf,
    db: Option<sqlx::PgPool>,
    extension_settings_key: Option<[u8; 32]>,
    server_name: String,
    remote_tool_name: String,
}

#[async_trait]
impl ToolHandler for McpDynamicTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let server = resolve_server(
            &self.path,
            self.db.as_ref(),
            self.extension_settings_key.as_ref(),
            &self.server_name,
        )
        .await?;
        let result = rpc_request(
            &server,
            "tools/call",
            serde_json::json!({
                "name": self.remote_tool_name,
                "arguments": args
            }),
        )
        .await?;
        let result = process_content_blocks(result, &media_dir_for_config(&self.path)).await?;
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "server": self.server_name,
            "tool": self.remote_tool_name,
            "result": result
        })))
    }
}

async fn mcp_health_probe(server: &McpServerConfig) -> Result<Value, ToolError> {
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

fn parse_tool_infos(server: &McpServerConfig, result: &Value) -> Vec<McpToolInfo> {
    result
        .get("tools")
        .and_then(Value::as_array)
        .map(|tools| {
            tools
                .iter()
                .filter_map(|tool| {
                    let name = tool.get("name").and_then(Value::as_str)?;
                    let description = tool
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("MCP server tool")
                        .to_string();
                    let input_schema = tool
                        .get("inputSchema")
                        .or_else(|| tool.get("input_schema"))
                        .cloned()
                        .unwrap_or_else(
                            || serde_json::json!({ "type": "object", "properties": {} }),
                        );
                    Some(McpToolInfo {
                        name: name.to_string(),
                        prefixed_name: prefixed_tool_name(&server.name, name),
                        description,
                        input_schema,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn is_method_not_found(error: &ToolError) -> bool {
    let value = error.to_string().to_ascii_lowercase();
    value.contains("-32601") || value.contains("method not found")
}

async fn rpc_request(
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

fn parse_rpc_response_for_id(raw: &str, expected_id: i64) -> Result<Value, ToolError> {
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

async fn process_content_blocks(result: Value, media_dir: &Path) -> Result<Value, ToolError> {
    let Some(blocks) = result.get("content").and_then(Value::as_array) else {
        return Ok(result);
    };
    let mut text_blocks = Vec::new();
    let mut media = Vec::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    text_blocks.push(redact_sensitive_text(text));
                }
            }
            Some("image") => {
                if let Some(data) = block.get("data").and_then(Value::as_str) {
                    let mime = block
                        .get("mimeType")
                        .or_else(|| block.get("mime_type"))
                        .and_then(Value::as_str)
                        .unwrap_or("image/png");
                    let path = cache_media_block(media_dir, mime, data).await?;
                    media.push(serde_json::json!({
                        "mimeType": mime,
                        "path": path.display().to_string(),
                        "tag": format!("MEDIA:{}", path.display()),
                    }));
                }
            }
            _ => {}
        }
    }
    Ok(serde_json::json!({
        "content": text_blocks.join("\n"),
        "media": media,
        "raw": result,
    }))
}

async fn cache_media_block(media_dir: &Path, mime: &str, data: &str) -> Result<PathBuf, ToolError> {
    tokio::fs::create_dir_all(media_dir)
        .await
        .map_err(|err| ToolError::Execution(format!("MCP media dir create failed: {err}")))?;
    let extension = match mime {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    };
    let path = media_dir.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|err| ToolError::Execution(format!("MCP image decode failed: {err}")))?;
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|err| ToolError::Execution(format!("MCP image cache failed: {err}")))?;
    Ok(path)
}

fn media_dir_for_config(path: &Path) -> PathBuf {
    path.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir)
        .join("media")
}

async fn load_servers(
    path: &PathBuf,
    db: Option<&sqlx::PgPool>,
    extension_settings_key: Option<&[u8; 32]>,
) -> Result<Vec<McpServerConfig>, ToolError> {
    let mut servers = load_file_servers(path)?;
    if let Some(db) = db {
        let rows = sqlx::query(
            r#"SELECT name, settings_encrypted, settings_nonce
               FROM extensions
               WHERE kind = 'mcp_server' AND enabled = true
               ORDER BY created_at ASC"#,
        )
        .fetch_all(db)
        .await
        .map_err(|err| ToolError::Execution(format!("MCP extension config query failed: {err}")))?;
        let Some(key) = extension_settings_key else {
            if !rows.is_empty() {
                tracing::warn!(
                    "MCP extension settings require an unlocked encryption key; skipping DB MCP servers"
                );
            }
            return Ok(servers);
        };
        for row in rows {
            let name = row.get::<String, _>("name");
            let Some(ciphertext_hex) = row.get::<Option<String>, _>("settings_encrypted") else {
                tracing::warn!(server = %name, "MCP extension settings are not encrypted; skipping");
                continue;
            };
            let Some(nonce_hex) = row.get::<Option<String>, _>("settings_nonce") else {
                tracing::warn!(server = %name, "MCP extension settings nonce missing; skipping");
                continue;
            };
            let plaintext = crypto::decrypt_api_key(
                key,
                &EncryptedKey {
                    ciphertext_hex,
                    nonce_hex,
                },
            )
            .map_err(|err| ToolError::Execution(format!("MCP extension decrypt failed: {err}")))?;
            let settings = serde_json::from_str::<Value>(&plaintext).map_err(|err| {
                ToolError::Execution(format!("MCP extension settings JSON failed: {err}"))
            })?;
            if let Some(server) = config_from_extension_row(name, settings)? {
                let server_name = server.name.clone();
                if let Some(existing) = servers
                    .iter_mut()
                    .find(|existing| existing.name == server_name)
                {
                    *existing = server;
                } else {
                    servers.push(server);
                }
            }
        }
    }
    Ok(servers)
}

fn load_file_servers(path: &PathBuf) -> Result<Vec<McpServerConfig>, ToolError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| ToolError::Execution(format!("MCP config read failed: {err}")))?;
    serde_json::from_str(&raw)
        .map_err(|err| ToolError::Execution(format!("MCP config parse failed: {err}")))
}

fn config_from_extension_row(
    name: String,
    settings: Value,
) -> Result<Option<McpServerConfig>, ToolError> {
    let settings = serde_json::from_value::<ExtensionSettings>(settings).map_err(|err| {
        ToolError::Execution(format!("MCP extension settings parse failed: {err}"))
    })?;
    let ExtensionSettings::McpServer {
        transport,
        command,
        args,
        url,
        env,
        headers,
        timeout_secs,
    } = settings
    else {
        return Ok(None);
    };
    Ok(Some(McpServerConfig {
        name,
        command,
        args,
        url,
        transport: Some(transport),
        env,
        headers,
        timeout_secs: timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS),
        source: "extension".to_string(),
    }))
}

async fn resolve_server(
    path: &PathBuf,
    db: Option<&sqlx::PgPool>,
    extension_settings_key: Option<&[u8; 32]>,
    name: &str,
) -> Result<McpServerConfig, ToolError> {
    load_servers(path, db, extension_settings_key)
        .await?
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

fn prefixed_tool_name(server_name: &str, tool_name: &str) -> String {
    let server = identifier_part(server_name);
    let tool = identifier_part(tool_name);
    let name = format!("{server}_{tool}");
    if name
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_alphabetic() || ch == '_')
    {
        name
    } else {
        format!("mcp_{name}")
    }
}

fn identifier_part(value: &str) -> String {
    let mut out = String::new();
    let mut previous_underscore = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            previous_underscore = false;
        } else if !previous_underscore && !out.is_empty() {
            out.push('_');
            previous_underscore = true;
        }
    }
    let out = out.trim_matches('_').to_string();
    if out.is_empty() {
        "mcp".to_string()
    } else {
        out
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

    #[test]
    fn prefixed_tool_name_is_provider_safe() {
        assert_eq!(
            prefixed_tool_name("file-system", "read/file"),
            "file_system_read_file"
        );
        assert_eq!(prefixed_tool_name("1", "2"), "mcp_1_2");
    }

    #[test]
    fn rpc_response_requires_expected_id() {
        let ok = parse_rpc_response_for_id(r#"{"jsonrpc":"2.0","id":2,"result":{"ok":true}}"#, 2)
            .unwrap();
        assert_eq!(ok["ok"], true);
        let err =
            parse_rpc_response_for_id(r#"{"jsonrpc":"2.0","id":3,"result":{}}"#, 2).unwrap_err();
        assert!(err.to_string().contains("id mismatch"));
    }

    #[tokio::test]
    async fn content_blocks_extract_text_and_cache_media() {
        let dir = std::env::temp_dir().join(format!("mymy-mcp-media-{}", uuid::Uuid::new_v4()));
        let result = process_content_blocks(
            serde_json::json!({
                "content": [
                    { "type": "text", "text": "hello" },
                    { "type": "image", "mimeType": "image/png", "data": "aGk=" }
                ]
            }),
            &dir,
        )
        .await
        .unwrap();
        assert_eq!(result["content"], "hello");
        let path = result["media"][0]["path"].as_str().unwrap();
        assert!(std::path::Path::new(path).exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
