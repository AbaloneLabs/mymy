//! MCP server inspection API.
//!
//! Runtime MCP configuration can come from the local JSON file or encrypted
//! extension rows. This service exposes only non-secret operational state:
//! server identity, transport, health, and discovered tool schemas.

use serde::Serialize;

use crate::agent::tools::builtin::mcp::{self, McpServerStatus};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct McpServersResponse {
    pub servers: Vec<McpServerStatus>,
}

pub async fn list_servers(state: &AppState) -> AppResult<McpServersResponse> {
    let key = state.encryption_key.read().await.as_ref().copied();
    let servers = mcp::inspect_servers(&state.config.agent_data_dir, Some(&state.db), key.as_ref())
        .await
        .map_err(|err| AppError::Internal(format!("MCP inspection failed: {err}")))?;
    Ok(McpServersResponse { servers })
}
