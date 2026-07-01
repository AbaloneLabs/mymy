//! MCP server inspection HTTP API.

use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};

use crate::error::AppResult;
use crate::services::mcp::{self as mcp_service, McpServersResponse};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/mcp/servers", get(list_servers))
}

pub async fn list_servers(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<McpServersResponse>> {
    Ok(Json(mcp_service::list_servers(&state).await?))
}
