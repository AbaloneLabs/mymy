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
use crate::agent::execution::ToolExecutionContext;
use crate::agent::memory::{MemoryOperation, MemoryStore, MemoryTarget};
use crate::agent::tools::{
    tool_result, tool_schema, DataSensitivity, ToolCapability, ToolEffect, ToolEntry, ToolError,
    ToolHandler, ToolRegistry,
};
use crate::models::runtime_memory::MemorySearchQuery;
use crate::services::runtime_memory::{self, NewMemory};
use crate::state::AppState;

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
        capability: ToolCapability::read("memory").with_sensitivity(DataSensitivity::Private),
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
        capability: ToolCapability::mutation(ToolEffect::Update, "memory")
            .with_sensitivity(DataSensitivity::Private),
        handler: Arc::new(MemoryTool {
            store: Arc::new(Mutex::new(store)),
        }),
    });

    let (Some(state), Some(agent_profile)) = (&config.app_state, &config.agent_profile) else {
        return;
    };
    let durable = DurableMemoryScope {
        state: state.clone(),
        agent_profile: agent_profile.clone(),
        project_id: config.project_id,
    };
    registry.register(ToolEntry {
        name: "memory_search".to_string(),
        toolset: "memory_read".to_string(),
        schema: tool_schema(
            "memory_search",
            "Search reviewed durable memory on demand. Results include source run and decision provenance.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "status": {
                        "type": "string",
                        "enum": ["active", "pending_review", "conflict", "stale"]
                    },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                },
                "required": ["query"]
            }),
        ),
        capability: ToolCapability::read("durable_memory")
            .with_sensitivity(DataSensitivity::Private),
        handler: Arc::new(DurableMemorySearchTool {
            scope: durable.clone(),
        }),
    });
    registry.register(ToolEntry {
        name: "memory_record".to_string(),
        toolset: "memory_write".to_string(),
        schema: tool_schema(
            "memory_record",
            "Record a provenance-aware durable memory. Agent-proposed entries require later user review.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string", "maxLength": 4000 },
                    "memoryType": {
                        "type": "string",
                        "enum": ["preference", "convention", "decision", "fact"]
                    },
                    "sensitivity": {
                        "type": "string",
                        "enum": ["normal", "private", "financial"]
                    }
                },
                "required": ["content", "memoryType", "sensitivity"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Create, "durable_memory")
            .with_sensitivity(DataSensitivity::Private),
        handler: Arc::new(DurableMemoryRecordTool { scope: durable }),
    });
}

struct MemoryTool {
    store: Arc<Mutex<MemoryStore>>,
}

struct MemoryReadTool {
    store: Arc<Mutex<MemoryStore>>,
}

#[derive(Clone)]
struct DurableMemoryScope {
    state: Arc<AppState>,
    agent_profile: String,
    project_id: Option<uuid::Uuid>,
}

struct DurableMemorySearchTool {
    scope: DurableMemoryScope,
}

struct DurableMemoryRecordTool {
    scope: DurableMemoryScope,
}

#[async_trait]
impl ToolHandler for DurableMemorySearchTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        Err(ToolError::Unavailable(
            "durable memory requires run execution context".to_string(),
        ))
    }

    async fn execute_with_context(
        &self,
        context: &ToolExecutionContext,
        args: &Value,
    ) -> Result<String, ToolError> {
        validate_scope(&self.scope, context)?;
        let response = runtime_memory::search_memories(
            &self.scope.state,
            MemorySearchQuery {
                q: Some(required_str(args, "query")?.to_string()),
                agent_profile: Some(self.scope.agent_profile.clone()),
                scope: Some(if self.scope.project_id.is_some() {
                    "project".to_string()
                } else {
                    "general".to_string()
                }),
                project_id: self.scope.project_id.map(|id| id.to_string()),
                status: args
                    .get("status")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| Some("active".to_string())),
                limit: args.get("limit").and_then(Value::as_i64).unwrap_or(10),
            },
        )
        .await
        .map_err(|err| ToolError::Execution(err.to_string()))?;
        Ok(tool_result(&response))
    }
}

#[async_trait]
impl ToolHandler for DurableMemoryRecordTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        Err(ToolError::Unavailable(
            "durable memory requires run execution context".to_string(),
        ))
    }

    async fn execute_with_context(
        &self,
        context: &ToolExecutionContext,
        args: &Value,
    ) -> Result<String, ToolError> {
        validate_scope(&self.scope, context)?;
        if args.get("query").is_some() {
            return Err(ToolError::InvalidArgs(
                "memory_record does not accept query".to_string(),
            ));
        }
        let origin = if context.authorization.explicit_user_action {
            "explicit_user"
        } else {
            "agent_proposed"
        };
        let memory = runtime_memory::create_memory(
            &self.scope.state,
            NewMemory {
                source_run_id: Some(context.run_id),
                source_decision_id: None,
                agent_profile: &self.scope.agent_profile,
                project_id: self.scope.project_id,
                memory_type: required_str(args, "memoryType")?,
                origin,
                content: required_str(args, "content")?,
                confidence: if origin == "explicit_user" { 1.0 } else { 0.7 },
                sensitivity: required_str(args, "sensitivity")?,
            },
        )
        .await
        .map_err(|err| ToolError::Execution(err.to_string()))?;
        Ok(tool_result(&memory))
    }
}

fn validate_scope(
    scope: &DurableMemoryScope,
    context: &ToolExecutionContext,
) -> Result<(), ToolError> {
    if context.agent_profile != scope.agent_profile || context.project_id != scope.project_id {
        return Err(ToolError::Execution(
            "durable memory scope changed since tool registration".to_string(),
        ));
    }
    Ok(())
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
