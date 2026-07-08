use std::path::Path;

use serde_json::Value;

use crate::agent::security::redact_sensitive_text;
use crate::agent::tools::ToolError;

use super::client::{mcp_health_probe, rpc_request};
use super::config::{load_servers, transport_name, McpServerConfig};
use super::naming::prefixed_tool_name;
use super::types::{McpServerStatus, McpToolInfo};

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
