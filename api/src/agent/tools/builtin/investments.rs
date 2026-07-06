//! Read-only investment tools for portfolio context.
//!
//! Investment records are user-maintained data inside mymy, not broker-linked
//! execution state. The native agent therefore gets a compact read-only
//! snapshot tool by default, while all record mutations stay behind the normal
//! HTTP UI/API surface where user intent is explicit.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use sqlx::PgPool;

use super::BuiltinToolConfig;
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};
use crate::services::investments;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let Some(db) = config.db.clone() else {
        return;
    };

    registry.register(ToolEntry {
        name: "investment_snapshot".to_string(),
        toolset: "investments_read".to_string(),
        schema: tool_schema(
            "investment_snapshot",
            "Return the user's manual investment summary, positions, and watchlist. This is read-only and does not place trades.",
            serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        ),
        handler: Arc::new(InvestmentSnapshotTool { db }),
    });
}

struct InvestmentSnapshotTool {
    db: PgPool,
}

#[async_trait]
impl ToolHandler for InvestmentSnapshotTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        let snapshot = investments::compact_snapshot(&self.db)
            .await
            .map_err(|err| ToolError::Execution(format!("investment snapshot failed: {err}")))?;
        Ok(tool_result(&snapshot))
    }
}
