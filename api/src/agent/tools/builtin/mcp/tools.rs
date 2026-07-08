use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::super::BuiltinToolConfig;
use super::client::{mcp_health_probe, rpc_request};
use super::config::{load_servers, resolve_server, transport_name};
use super::content::{media_dir_for_config, process_content_blocks};
use super::naming::prefixed_tool_name;
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

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

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
}
