//! Preview registration tool for sandboxed development servers.
//!
//! Agents can start a server inside their workspace and then register the
//! forwarded loopback port here. The HTTP proxy enforces the same loopback-only
//! target policy, so the tool cannot be used as an arbitrary network proxy.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use uuid::Uuid;

use super::BuiltinToolConfig;
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

const MIN_PREVIEW_PORT: u64 = 1024;
const MAX_PREVIEW_PORT: u64 = 65_535;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    registry.register(ToolEntry {
        name: "register_preview".to_string(),
        toolset: "runtime".to_string(),
        schema: tool_schema(
            "register_preview",
            "Register a development server port as a browser-accessible preview endpoint.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "port": { "type": "integer", "minimum": MIN_PREVIEW_PORT, "maximum": MAX_PREVIEW_PORT },
                    "label": { "type": "string", "description": "Short preview name." }
                },
                "required": ["port", "label"]
            }),
        ),
        handler: Arc::new(RegisterPreviewTool {
            db: config.db.clone(),
            agent_profile: config.agent_profile.clone(),
            project_id: config.project_id,
        }),
    });
}

struct RegisterPreviewTool {
    db: Option<sqlx::PgPool>,
    agent_profile: Option<String>,
    project_id: Option<Uuid>,
}

#[async_trait]
impl ToolHandler for RegisterPreviewTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| ToolError::Unavailable("database is not configured".to_string()))?;
        let agent_profile = self
            .agent_profile
            .as_ref()
            .ok_or_else(|| ToolError::Unavailable("agent profile is not configured".to_string()))?;
        let port = args
            .get("port")
            .and_then(Value::as_u64)
            .ok_or_else(|| ToolError::InvalidArgs("missing port".to_string()))?;
        if !(MIN_PREVIEW_PORT..=MAX_PREVIEW_PORT).contains(&port) {
            return Err(ToolError::InvalidArgs(format!(
                "port must be between {MIN_PREVIEW_PORT} and {MAX_PREVIEW_PORT}"
            )));
        }
        let label = args
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ToolError::InvalidArgs("missing label".to_string()))?;
        if label.chars().count() > 80 {
            return Err(ToolError::InvalidArgs(
                "label must be at most 80 characters".to_string(),
            ));
        }

        let target_url = format!("http://127.0.0.1:{port}");
        let token = Uuid::new_v4().simple().to_string();
        let row = sqlx::query!(
            r#"INSERT INTO preview_endpoints
                 (agent_profile, project_id, label, target_url, token, visibility, status)
               VALUES ($1, $2, $3, $4, $5, 'session', 'active')
               RETURNING id"#,
            agent_profile,
            self.project_id,
            label,
            target_url,
            token,
        )
        .fetch_one(db)
        .await
        .map_err(|err| ToolError::Execution(format!("preview registration failed: {err}")))?;

        Ok(tool_result(&serde_json::json!({
            "id": row.id.to_string(),
            "label": label,
            "target_url": target_url,
            "preview_path": format!("/api/previews/{token}"),
        })))
    }
}
