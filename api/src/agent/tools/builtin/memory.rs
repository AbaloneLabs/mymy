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
use crate::models::runtime_memory::{MemorySearchQuery, ReviewMemoryRequest};
use crate::services::runtime_memory::{self, MemoryCorrection, NewMemory};
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
                    "target": { "type": "string", "enum": ["memory", "user"], "description": "Curated file to update: agent memory or user profile memory." },
                    "action": { "type": "string", "enum": ["add", "replace", "remove"], "description": "Single update operation; omit when using operations." },
                    "content": { "type": "string", "description": "New bounded memory entry or replacement text." },
                    "old_text": { "type": "string", "description": "Exact existing entry text required by replace or remove." },
                    "operations": {
                        "type": "array",
                        "description": "Ordered atomic batch of curated-memory updates.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": { "type": "string", "enum": ["add", "replace", "remove"], "description": "Operation performed on one exact entry." },
                                "content": { "type": "string", "description": "New entry or replacement text." },
                                "old_text": { "type": "string", "description": "Exact existing entry required by replace or remove." }
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
            "Search reviewed durable facts, preferences, decisions, and conventions on demand. This does not search full chat transcripts or workspace files; use the returned provenance for an exact permitted source read when needed.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Text describing the durable fact or convention to recall." },
                    "status": {
                        "type": "string",
                        "enum": ["active", "pending_review", "conflict", "stale"],
                        "description": "Optional lifecycle status filter; defaults to recallable active memory."
                    },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "description": "Maximum durable memories to return." }
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
                    "content": { "type": "string", "maxLength": 4000, "description": "One bounded declarative fact, preference, decision, or convention." },
                    "memoryType": {
                        "type": "string",
                        "enum": ["preference", "convention", "decision", "fact"],
                        "description": "Semantic class of the durable memory."
                    },
                    "sensitivity": {
                        "type": "string",
                        "enum": ["normal", "private", "financial"],
                        "description": "Sensitivity class controlling review and disclosure."
                    }
                },
                "required": ["content", "memoryType", "sensitivity"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Create, "durable_memory")
            .with_sensitivity(DataSensitivity::Private),
        handler: Arc::new(DurableMemoryRecordTool {
            scope: durable.clone(),
        }),
    });
    registry.register(ToolEntry {
        name: "memory_correct".to_string(),
        toolset: "memory_write".to_string(),
        schema: tool_schema(
            "memory_correct",
            "Correct one exact durable or inferred memory after resolving it with memory_search. This creates a new explicit revision and preserves the prior fact as superseded; ask the user when more than one fact could be meant.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "memoryId": { "type": "string", "description": "Exact stable memory ID returned by memory_search." },
                    "expectedContentRevision": { "type": "integer", "minimum": 1, "description": "Content revision returned by memory_search; stale values are rejected." },
                    "expectedLifecycleRevision": { "type": "integer", "minimum": 1, "description": "Lifecycle revision returned by memory_search; stale values are rejected." },
                    "idempotencyKey": { "type": "string", "minLength": 16, "maxLength": 200, "description": "Fresh stable retry key for this correction; reuse it only to recover the same requested correction." },
                    "content": { "type": "string", "minLength": 1, "maxLength": 4000, "description": "One corrected declarative fact confirmed by the current user." }
                },
                "required": ["memoryId", "expectedContentRevision", "expectedLifecycleRevision", "idempotencyKey", "content"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Update, "durable_memory")
            .with_resource_argument("memoryId")
            .with_sensitivity(DataSensitivity::Private),
        handler: Arc::new(DurableMemoryCorrectTool {
            scope: durable.clone(),
        }),
    });
    registry.register(ToolEntry {
        name: "memory_forget".to_string(),
        toolset: "memory_write".to_string(),
        schema: tool_schema(
            "memory_forget",
            "Forget one exact memory after resolving it with memory_search. This removes derived content but does not delete the original chat or an independently retained fact; ask the user when the intended target is ambiguous.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "memoryId": { "type": "string", "description": "Exact stable memory ID returned by memory_search." },
                    "expectedContentRevision": { "type": "integer", "minimum": 1, "description": "Content revision returned by memory_search; stale values are rejected." },
                    "expectedLifecycleRevision": { "type": "integer", "minimum": 1, "description": "Lifecycle revision returned by memory_search; stale values are rejected." }
                    ,"idempotencyKey": { "type": "string", "minLength": 16, "maxLength": 200, "description": "Fresh stable retry key for this forget request; reuse it only to recover the same deletion." }
                },
                "required": ["memoryId", "expectedContentRevision", "expectedLifecycleRevision", "idempotencyKey"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Delete, "durable_memory")
            .with_resource_argument("memoryId")
            .with_sensitivity(DataSensitivity::Private),
        handler: Arc::new(DurableMemoryForgetTool { scope: durable }),
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

struct DurableMemoryCorrectTool {
    scope: DurableMemoryScope,
}

struct DurableMemoryForgetTool {
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
                source_session_id: None,
                source_message_start: None,
                source_message_end: None,
                extraction_batch_id: None,
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

#[async_trait]
impl ToolHandler for DurableMemoryCorrectTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        Err(ToolError::Unavailable(
            "durable memory correction requires run execution context".to_string(),
        ))
    }

    async fn execute_with_context(
        &self,
        context: &ToolExecutionContext,
        args: &Value,
    ) -> Result<String, ToolError> {
        validate_scope(&self.scope, context)?;
        let memory = runtime_memory::correct_memory(
            &self.scope.state,
            MemoryCorrection {
                memory_id: required_uuid(args, "memoryId")?,
                expected_content_revision: required_i64(args, "expectedContentRevision")?,
                expected_lifecycle_revision: required_i64(args, "expectedLifecycleRevision")?,
                agent_profile: &self.scope.agent_profile,
                project_id: self.scope.project_id,
                source_run_id: context.run_id,
                idempotency_key: required_str(args, "idempotencyKey")?,
                content: required_str(args, "content")?,
            },
        )
        .await
        .map_err(|err| ToolError::Execution(err.to_string()))?;
        Ok(tool_result(&memory))
    }
}

#[async_trait]
impl ToolHandler for DurableMemoryForgetTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        Err(ToolError::Unavailable(
            "durable memory deletion requires run execution context".to_string(),
        ))
    }

    async fn execute_with_context(
        &self,
        context: &ToolExecutionContext,
        args: &Value,
    ) -> Result<String, ToolError> {
        validate_scope(&self.scope, context)?;
        let memory = runtime_memory::forget_memory_in_scope(
            &self.scope.state,
            required_uuid(args, "memoryId")?,
            &self.scope.agent_profile,
            self.scope.project_id,
            ReviewMemoryRequest {
                action: "delete".to_string(),
                expected_content_revision: required_i64(args, "expectedContentRevision")?,
                expected_lifecycle_revision: required_i64(args, "expectedLifecycleRevision")?,
                idempotency_key: Some(required_str(args, "idempotencyKey")?.to_string()),
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

fn required_uuid(args: &Value, key: &str) -> Result<uuid::Uuid, ToolError> {
    uuid::Uuid::parse_str(required_str(args, key)?)
        .map_err(|_| ToolError::InvalidArgs(format!("invalid {key}")))
}

fn required_i64(args: &Value, key: &str) -> Result<i64, ToolError> {
    args.get(key)
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .ok_or_else(|| ToolError::InvalidArgs(format!("invalid {key}")))
}
