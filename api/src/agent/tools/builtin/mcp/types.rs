use serde::Serialize;
use serde_json::Value;

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
