//! Higher-level agent tools: todo, clarify, delegation metadata, session search.
//!
//! These tools do not invent data. Todo state is persisted per chat session
//! under the agent data directory, and session search reads only real
//! `chat_messages` rows from PostgreSQL.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use futures::stream::BoxStream;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;

use super::{truncate_chars, BuiltinToolConfig};
use crate::agent::execution::ToolExecutionContext;
use crate::agent::providers::types::{ModelInfo, StreamDelta};
use crate::agent::providers::{LlmProvider, Message, ProviderError, ToolSchema};
use crate::agent::runtime::{
    apply_cache_breakpoint, parse_rate_limit_headers, scrub_thinking_blocks, CredentialPool,
    CredentialStatus, MoaConfig, MoaParticipant, MoaProposerOutput, MoaResult, PooledCredential,
    SelectionStrategy,
};
use crate::agent::security::redact::mask_secret;
use crate::agent::security::{redact_sensitive_text, SecretString};
use crate::agent::tools::{
    tool_result, tool_schema, ToolCapability, ToolEffect, ToolEntry, ToolError, ToolHandler,
    ToolRegistry,
};

const VALID_STATUSES: &[&str] = &[
    "pending",
    "in_progress",
    "blocked",
    "completed",
    "cancelled",
];
const MAX_TODO_CONTENT_CHARS: usize = 4_000;
const MAX_TODO_ITEMS: usize = 256;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    registry.register(ToolEntry {
        name: "todo".to_string(),
        toolset: "todo".to_string(),
        schema: tool_schema(
            "todo",
            "Read or replace the current session's task checklist. Pass todos to write; omit to read.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "content": { "type": "string" },
                                "status": { "type": "string", "enum": VALID_STATUSES }
                            },
                            "required": ["id", "content", "status"]
                        }
                    },
                    "merge": { "type": "boolean", "default": false }
                }
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Update, "run_checklist"),
        handler: Arc::new(TodoTool {
            path: todo_path(config),
            state: config.app_state.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "clarify".to_string(),
        toolset: "clarify".to_string(),
        schema: tool_schema(
            "clarify",
            "Prepare a clarifying question for the user. The UI may render the returned request.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "question": { "type": "string" },
                    "choices": { "type": "array", "items": { "type": "string" }, "maxItems": 4 }
                },
                "required": ["question"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Create, "decision"),
        handler: Arc::new(ClarifyTool),
    });

    registry.register(ToolEntry {
        name: "delegate_task".to_string(),
        toolset: "delegation".to_string(),
        schema: tool_schema(
            "delegate_task",
            "Create child-agent task requests. Child execution requires a configured delegation executor.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "goal": { "type": "string" },
                                "context": { "type": "string" },
                                "tools": { "type": "array", "items": { "type": "string" } },
                                "max_turns": { "type": "integer", "minimum": 1 }
                            },
                            "required": ["goal"]
                        }
                    }
                },
                "required": ["tasks"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Create, "delegate"),
        handler: Arc::new(DelegateTool),
    });

    if let (Some(db), Some(agent_profile)) = (config.db.clone(), config.agent_profile.clone()) {
        registry.register(ToolEntry {
            name: "session_search".to_string(),
            toolset: "sessions_read".to_string(),
            schema: tool_schema(
                "session_search",
                "Search past chat sessions. Pass query for FTS, session_id+around_message_id to scroll, or no args to browse recent sessions.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "session_id": { "type": "string" },
                        "around_message_id": { "type": "string" },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                    }
                }),
            ),
            capability: ToolCapability::read("session"),
            handler: Arc::new(SessionSearchTool {
                db,
                agent_profile,
                project_id: config.project_id,
            }),
        });
    }

    registry.register(ToolEntry {
        name: "runtime_status".to_string(),
        toolset: "runtime".to_string(),
        schema: tool_schema(
            "runtime_status",
            "Return native runtime capability status and redaction-safe diagnostic examples.",
            serde_json::json!({ "type": "object", "properties": {} }),
        ),
        capability: ToolCapability::read("runtime"),
        handler: Arc::new(RuntimeStatusTool),
    });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TodoItem {
    id: String,
    content: String,
    status: String,
}

struct TodoTool {
    path: PathBuf,
    state: Option<Arc<crate::state::AppState>>,
}

#[async_trait]
impl ToolHandler for TodoTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let mut todos = load_todos(&self.path)?;
        if let Some(next) = args.get("todos") {
            let incoming = serde_json::from_value::<Vec<TodoItem>>(next.clone())
                .map_err(|err| ToolError::InvalidArgs(format!("invalid todos: {err}")))?;
            let incoming = normalize_todos(incoming);
            if args.get("merge").and_then(Value::as_bool).unwrap_or(false) {
                let mut positions = todos
                    .iter()
                    .enumerate()
                    .map(|(idx, item)| (item.id.clone(), idx))
                    .collect::<HashMap<_, _>>();
                for item in incoming {
                    if let Some(idx) = positions.get(&item.id).copied() {
                        todos[idx] = item;
                    } else {
                        positions.insert(item.id.clone(), todos.len());
                        todos.push(item);
                    }
                }
                todos = normalize_todos(todos);
            } else {
                todos = incoming;
            }
            save_todos(&self.path, &todos)?;
        }
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "todos": todos,
            "injection": format_todos_for_injection(&todos),
        })))
    }

    async fn execute_with_context(
        &self,
        context: &ToolExecutionContext,
        args: &Value,
    ) -> Result<String, ToolError> {
        let Some(state) = &self.state else {
            return self.execute(args).await;
        };
        let incoming = args
            .get("todos")
            .map(|value| {
                serde_json::from_value::<Vec<crate::services::run_progress::ChecklistInput>>(
                    value.clone(),
                )
                .map_err(|err| ToolError::InvalidArgs(format!("invalid todos: {err}")))
            })
            .transpose()?;
        let items = crate::services::run_progress::update_checklist(
            state,
            context,
            incoming,
            args.get("merge").and_then(Value::as_bool).unwrap_or(false),
            &self.path,
        )
        .await
        .map_err(|err| ToolError::Execution(err.to_string()))?;
        let todos = items
            .iter()
            .map(|item| TodoItem {
                id: item.item_key.clone(),
                content: item.content.clone(),
                status: item.status.clone(),
            })
            .collect::<Vec<_>>();
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "todos": todos,
            "injection": format_todos_for_injection(&todos),
            "source": "database",
        })))
    }
}

struct ClarifyTool;

#[async_trait]
impl ToolHandler for ClarifyTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let question = required_str(args, "question")?.trim();
        if question.is_empty() {
            return Err(ToolError::InvalidArgs(
                "question cannot be empty".to_string(),
            ));
        }
        let choices = args
            .get("choices")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|choice| !choice.is_empty())
                    .take(4)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "clarification_required": true,
            "request_id": uuid::Uuid::new_v4().to_string(),
            "question": question,
            "choices": choices,
            "note": "Return this question to the user and continue after they answer."
        })))
    }
}

struct DelegateTool;

#[async_trait]
impl ToolHandler for DelegateTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let tasks = args
            .get("tasks")
            .and_then(Value::as_array)
            .ok_or_else(|| ToolError::InvalidArgs("missing tasks".to_string()))?;
        let results = tasks
            .iter()
            .map(|task| {
                serde_json::json!({
                    "goal": task.get("goal").and_then(Value::as_str).unwrap_or_default(),
                    "status": "not_configured",
                    "result": null,
                    "error": "delegation executor is not configured for this runtime"
                })
            })
            .collect::<Vec<_>>();
        Ok(tool_result(&serde_json::json!({
            "success": false,
            "results": results
        })))
    }
}

struct RuntimeStatusTool;

#[async_trait]
impl ToolHandler for RuntimeStatusTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        let mut headers = HashMap::new();
        headers.insert("x-ratelimit-limit-requests".to_string(), "0".to_string());
        let mut rate_limits = parse_rate_limit_headers(&headers);
        let throttled = rate_limits.is_throttled();
        let recovery_secs = rate_limits.soonest_recovery_secs();
        rate_limits.record_usage(1, 0);
        let mut pool = CredentialPool::new(
            vec![PooledCredential {
                label: "diagnostic".to_string(),
                api_key: SecretString::new("sk-diagnostic-placeholder"),
                status: CredentialStatus::Ok,
                request_count: 0,
            }],
            SelectionStrategy::LeastUsed,
        );
        let acquired = pool.acquire(chrono::Utc::now());
        pool.mark_exhausted("diagnostic", 1, chrono::Utc::now());
        let _moa_runner = crate::agent::runtime::run_moa_turn;
        let moa_participant = MoaParticipant {
            label: "diagnostic".to_string(),
            provider: Arc::new(RuntimeDiagnosticProvider),
        };
        let moa_config = MoaConfig::default();
        let moa_shape = MoaResult {
            proposer_outputs: vec![MoaProposerOutput {
                label: moa_participant.label,
                content: "proposal".to_string(),
            }],
            aggregated: "aggregate".to_string(),
            usage: crate::agent::providers::types::Usage::default(),
        };
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "cache_breakpoint_marker": apply_cache_breakpoint("stable", "volatile").contains("mymy-cache-breakpoint"),
            "rate_limits": rate_limits,
            "rate_limit_throttled": throttled,
            "rate_limit_recovery_secs": recovery_secs,
            "credential_pool": {
                "strategy": "least_used",
                "available": acquired.is_some(),
                "masked_example": mask_secret("sk-diagnostic-placeholder")
            },
            "moa": {
                "runner_available": true,
                "max_concurrent_default": moa_config.max_concurrent,
                "diagnostic_shape": moa_shape
            },
            "thinking_scrubber": scrub_thinking_blocks("visible <think>hidden</think>")
        })))
    }
}

struct RuntimeDiagnosticProvider;

#[async_trait]
impl LlmProvider for RuntimeDiagnosticProvider {
    async fn stream(
        &self,
        _system_prompt: &str,
        _messages: &[Message],
        _tools: &[ToolSchema],
    ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
        Ok(Box::pin(futures::stream::empty()))
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        Ok(Vec::new())
    }
}

struct SessionSearchTool {
    db: sqlx::PgPool,
    agent_profile: String,
    project_id: Option<uuid::Uuid>,
}

#[async_trait]
impl ToolHandler for SessionSearchTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(10)
            .clamp(1, 50) as i64;
        if let Some(query) = args.get("query").and_then(Value::as_str) {
            return self.discovery(query, limit).await;
        }
        if let (Some(session_id), Some(message_id)) = (
            args.get("session_id").and_then(Value::as_str),
            args.get("around_message_id").and_then(Value::as_str),
        ) {
            return self.scroll(session_id, message_id, limit).await;
        }
        self.browse(limit).await
    }
}

impl SessionSearchTool {
    async fn discovery(&self, query: &str, limit: i64) -> Result<String, ToolError> {
        let rows = sqlx::query(
            r#"SELECT cm.id, cm.session_id, cm.role, cm.content, cm.created_at,
                      COALESCE(cs.title, '') AS title
               FROM chat_messages cm
               JOIN chat_sessions cs ON cs.id = cm.session_id
               WHERE cm.search_tsv @@ plainto_tsquery('simple', $1)
                 AND cs.profile = $2
                 AND cs.project_id IS NOT DISTINCT FROM $3
                 AND NOT cs.automation_result_only
               ORDER BY ts_rank(cm.search_tsv, plainto_tsquery('simple', $1)) DESC,
                        cm.created_at DESC
               LIMIT $4"#,
        )
        .bind(query)
        .bind(&self.agent_profile)
        .bind(self.project_id)
        .bind(limit)
        .fetch_all(&self.db)
        .await
        .map_err(|err| ToolError::Execution(format!("session search failed: {err}")))?;

        let results = rows
            .into_iter()
            .map(|row| {
                serde_json::json!({
                    "message_id": row.get::<uuid::Uuid, _>("id").to_string(),
                    "session_id": row.get::<uuid::Uuid, _>("session_id").to_string(),
                    "title": row.get::<String, _>("title"),
                    "role": row.get::<String, _>("role"),
                    "snippet": truncate_chars(&redact_sensitive_text(&row.get::<String, _>("content")), 600),
                    "timestamp": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
                })
            })
            .collect::<Vec<_>>();
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "mode": "discovery",
            "results": results
        })))
    }

    async fn scroll(
        &self,
        session_id: &str,
        message_id: &str,
        limit: i64,
    ) -> Result<String, ToolError> {
        let session_id = uuid::Uuid::parse_str(session_id)
            .map_err(|err| ToolError::InvalidArgs(format!("invalid session_id: {err}")))?;
        let message_id = uuid::Uuid::parse_str(message_id)
            .map_err(|err| ToolError::InvalidArgs(format!("invalid around_message_id: {err}")))?;
        let allowed = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                 SELECT 1 FROM chat_sessions
                 WHERE id = $1 AND profile = $2
                   AND project_id IS NOT DISTINCT FROM $3
                   AND NOT automation_result_only
               )"#,
        )
        .bind(session_id)
        .bind(&self.agent_profile)
        .bind(self.project_id)
        .fetch_one(&self.db)
        .await
        .map_err(|err| ToolError::Execution(format!("session scope check failed: {err}")))?;
        if !allowed {
            return Err(ToolError::Execution(
                "session is outside the current agent/project scope".to_string(),
            ));
        }
        let rows = sqlx::query(
            r#"SELECT id, role, content, created_at
               FROM chat_messages
               WHERE session_id = $1
               ORDER BY created_at ASC"#,
        )
        .bind(session_id)
        .fetch_all(&self.db)
        .await
        .map_err(|err| ToolError::Execution(format!("session scroll failed: {err}")))?;
        let anchor = rows
            .iter()
            .position(|row| row.get::<uuid::Uuid, _>("id") == message_id)
            .ok_or_else(|| {
                ToolError::InvalidArgs(
                    "around_message_id does not belong to the scoped session".to_string(),
                )
            })?;
        let half = (limit as usize).saturating_div(2);
        let start = anchor.saturating_sub(half);
        let end = (start + limit as usize).min(rows.len());
        let window = rows[start..end]
            .iter()
            .map(message_json)
            .collect::<Vec<_>>();
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "mode": "scroll",
            "session_id": session_id.to_string(),
            "window": window
        })))
    }

    async fn browse(&self, limit: i64) -> Result<String, ToolError> {
        let rows = sqlx::query(
            r#"SELECT cs.id, COALESCE(cs.title, '') AS title, cs.updated_at,
                      COALESCE((
                        SELECT cm.content FROM chat_messages cm
                        WHERE cm.session_id = cs.id
                        ORDER BY cm.created_at DESC
                        LIMIT 1
                      ), '') AS preview
               FROM chat_sessions cs
               WHERE cs.profile = $1
                 AND cs.project_id IS NOT DISTINCT FROM $2
                 AND NOT cs.automation_result_only
               ORDER BY cs.updated_at DESC
               LIMIT $3"#,
        )
        .bind(&self.agent_profile)
        .bind(self.project_id)
        .bind(limit)
        .fetch_all(&self.db)
        .await
        .map_err(|err| ToolError::Execution(format!("session browse failed: {err}")))?;
        let sessions = rows
            .into_iter()
            .map(|row| {
                serde_json::json!({
                    "session_id": row.get::<uuid::Uuid, _>("id").to_string(),
                    "title": row.get::<String, _>("title"),
                    "preview": truncate_chars(&redact_sensitive_text(&row.get::<String, _>("preview")), 300),
                    "timestamp": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at").to_rfc3339(),
                })
            })
            .collect::<Vec<_>>();
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "mode": "browse",
            "sessions": sessions
        })))
    }
}

fn todo_path(config: &BuiltinToolConfig) -> PathBuf {
    let name = config
        .session_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "default".to_string());
    config
        .agent_data_dir
        .join("todos")
        .join(format!("{name}.json"))
}

fn load_todos(path: &PathBuf) -> Result<Vec<TodoItem>, ToolError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| ToolError::Execution(format!("todo read failed: {err}")))?;
    serde_json::from_str(&raw)
        .map_err(|err| ToolError::Execution(format!("todo parse failed: {err}")))
}

fn save_todos(path: &PathBuf, todos: &[TodoItem]) -> Result<(), ToolError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| ToolError::Execution(format!("todo dir create failed: {err}")))?;
    }
    let tmp = path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, serde_json::to_string_pretty(todos).unwrap())
        .map_err(|err| ToolError::Execution(format!("todo write failed: {err}")))?;
    std::fs::rename(tmp, path)
        .map_err(|err| ToolError::Execution(format!("todo rename failed: {err}")))?;
    Ok(())
}

fn normalize_todos(todos: Vec<TodoItem>) -> Vec<TodoItem> {
    let mut seen = HashMap::new();
    let mut normalized = Vec::new();
    for item in todos {
        if seen.contains_key(&item.id) || item.id.trim().is_empty() {
            continue;
        }
        let status = if VALID_STATUSES.contains(&item.status.as_str()) {
            item.status
        } else {
            "pending".to_string()
        };
        let content = truncate_chars(item.content.trim(), MAX_TODO_CONTENT_CHARS);
        seen.insert(item.id.clone(), normalized.len());
        normalized.push(TodoItem {
            id: item.id.trim().to_string(),
            content,
            status,
        });
        if normalized.len() >= MAX_TODO_ITEMS {
            break;
        }
    }
    normalized
}

fn format_todos_for_injection(todos: &[TodoItem]) -> Option<String> {
    if todos.is_empty() {
        return None;
    }
    let mut out = String::from("Current task list:\n");
    for item in todos {
        let mark = match item.status.as_str() {
            "completed" => "[x]",
            "in_progress" => "[~]",
            "cancelled" => "[-]",
            "blocked" => "[!]",
            _ => "[ ]",
        };
        out.push_str(&format!("- {mark} {} - {}\n", item.id, item.content));
    }
    Some(out)
}

fn message_json(row: &sqlx::postgres::PgRow) -> Value {
    serde_json::json!({
        "message_id": row.get::<uuid::Uuid, _>("id").to_string(),
        "role": row.get::<String, _>("role"),
        "content": truncate_chars(&redact_sensitive_text(&row.get::<String, _>("content")), 1_500),
        "timestamp": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
    })
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn todo_normalization_limits_status_and_duplicates() {
        let todos = normalize_todos(vec![
            TodoItem {
                id: "a".to_string(),
                content: "one".to_string(),
                status: "bad".to_string(),
            },
            TodoItem {
                id: "a".to_string(),
                content: "two".to_string(),
                status: "completed".to_string(),
            },
        ]);
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].status, "pending");
    }
}
