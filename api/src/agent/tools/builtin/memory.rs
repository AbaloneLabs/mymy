//! Curated memory tool.
//!
//! This tool mutates the on-disk memory files immediately, but the system
//! prompt for the current turn is built from the snapshot loaded before the
//! turn began.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::Mutex;

use super::BuiltinToolConfig;
use crate::agent::memory::{MemoryOperation, MemoryStore, MemoryTarget};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let dir = config.agent_data_dir.join("memory");
    let Ok(store) = MemoryStore::load(dir) else {
        return;
    };

    registry.register(ToolEntry {
        name: "memory_read".to_string(),
        toolset: "memory_read".to_string(),
        schema: tool_schema(
            "memory_read",
            "Read curated MEMORY.md and USER.md entries.",
            serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        ),
        handler: Arc::new(MemoryReadTool {
            store: Arc::new(Mutex::new(store.clone())),
        }),
    });

    registry.register(ToolEntry {
        name: "memory".to_string(),
        toolset: "memory_write".to_string(),
        schema: tool_schema(
            "memory",
            "Add, replace, remove, or batch-update curated MEMORY.md and USER.md entries.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "target": { "type": "string", "enum": ["memory", "user"] },
                    "action": { "type": "string", "enum": ["add", "replace", "remove"] },
                    "content": { "type": "string" },
                    "old_text": { "type": "string" },
                    "operations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": { "type": "string", "enum": ["add", "replace", "remove"] },
                                "content": { "type": "string" },
                                "old_text": { "type": "string" }
                            },
                            "required": ["action"]
                        }
                    }
                },
                "required": ["target"]
            }),
        ),
        handler: Arc::new(MemoryTool {
            store: Arc::new(Mutex::new(store)),
        }),
    });
}

struct MemoryTool {
    store: Arc<Mutex<MemoryStore>>,
}

struct MemoryReadTool {
    store: Arc<Mutex<MemoryStore>>,
}

#[async_trait]
impl ToolHandler for MemoryReadTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        let store = self.store.lock().await;
        let snapshot = store.snapshot();
        Ok(tool_result(&serde_json::json!({
            "memory": snapshot.memory,
            "user": snapshot.user,
        })))
    }
}

#[async_trait]
impl ToolHandler for MemoryTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let target = required_str(args, "target").and_then(|value| {
            MemoryTarget::parse(value)
                .ok_or_else(|| ToolError::InvalidArgs("invalid target".to_string()))
        })?;
        let mut store = self.store.lock().await;
        store.reset_consolidation_failures();

        if let Some(operations) = args.get("operations") {
            let operations = serde_json::from_value::<Vec<MemoryOperation>>(operations.clone())
                .map_err(|err| ToolError::InvalidArgs(format!("invalid operations: {err}")))?;
            let result = store
                .apply_batch(target, &operations)
                .map_err(|err| ToolError::Execution(format!("memory batch failed: {err}")))?;
            return Ok(tool_result(&result));
        }

        let action = required_str(args, "action")?;
        let result = match action {
            "add" => store.add(target, required_str(args, "content")?),
            "replace" => store.replace(
                target,
                required_str(args, "old_text")?,
                required_str(args, "content")?,
            ),
            "remove" => store.remove(target, required_str(args, "old_text")?),
            _ => return Err(ToolError::InvalidArgs("invalid action".to_string())),
        }
        .map_err(|err| ToolError::Execution(format!("memory mutation failed: {err}")))?;
        Ok(tool_result(&result))
    }
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
}
