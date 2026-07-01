//! Chat domain operations backed by the native Rust agent runtime.
//!
//! Session CRUD remains in PostgreSQL, but message execution no longer calls
//! the Hermes CLI. Each send operation resolves the default LLM provider,
//! assembles the native tool registry and prompt, then lets the HTTP handler
//! stream agent-loop events to the browser.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::context::ContextManager;
use crate::agent::loop_engine::{AgentLoop, LoopConfig};
use crate::agent::memory::MemoryStore;
use crate::agent::prompt::{build_system_prompt, PromptConfig};
use crate::agent::providers::{self, LlmProvider, Message, MessageRole as AgentMessageRole};
use crate::agent::skills::SkillRegistry;
use crate::agent::tools::builtin::{register_all, register_safe_defaults, BuiltinToolConfig};
use crate::agent::tools::ToolRegistry;
use crate::error::{AppError, AppResult};
use crate::models::chat::{
    ChatMessage, ChatMessagesResponse, ChatSession, ChatSessionResponse, ChatSessionsResponse,
    CreateSessionRequest, MessageRole, SendMessageRequest, SessionStatus, ToolCallDto,
};
use crate::services::audit::log_audit_safe;
use crate::services::llm_providers;
use crate::state::AppState;

#[derive(Debug, FromRow)]
struct ChatSessionRow {
    id: Uuid,
    project_id: Option<Uuid>,
    hermes_session_id: Option<String>,
    agent_id: String,
    profile: String,
    title: Option<String>,
    status: String,
    message_count: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct ChatMessageRow {
    id: Uuid,
    session_id: Uuid,
    role: String,
    content: String,
    tool_calls: Option<serde_json::Value>,
    tool_call_id: Option<String>,
    metadata: Option<serde_json::Value>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionQuery {
    pub project_id: Option<String>,
    pub profile: Option<String>,
}

pub struct PreparedNativeTurn {
    pub session_id: Uuid,
    pub messages: Vec<Message>,
    pub agent_message_start: usize,
    pub agent_loop: AgentLoop,
    pub system_prompt: String,
    pub user_message: ChatMessage,
}

pub async fn list_sessions(state: &AppState, q: SessionQuery) -> AppResult<ChatSessionsResponse> {
    let project_uuid = match q.project_id.as_deref() {
        Some(pid) => Some(
            Uuid::parse_str(pid)
                .map_err(|err| AppError::BadRequest(format!("invalid projectId: {err}")))?,
        ),
        None => None,
    };

    let rows = match (project_uuid, q.profile.as_deref()) {
        (Some(pid), Some(profile)) => {
            sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT id, project_id, hermes_session_id, agent_id, profile, title,
                          status, message_count, created_at, updated_at
                   FROM chat_sessions
                   WHERE project_id = $1 AND profile = $2
                   ORDER BY created_at DESC"#,
                pid,
                profile,
            )
            .fetch_all(&state.db)
            .await?
        }
        (Some(pid), None) => {
            sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT id, project_id, hermes_session_id, agent_id, profile, title,
                          status, message_count, created_at, updated_at
                   FROM chat_sessions
                   WHERE project_id = $1
                   ORDER BY created_at DESC"#,
                pid,
            )
            .fetch_all(&state.db)
            .await?
        }
        (None, Some(profile)) => {
            sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT id, project_id, hermes_session_id, agent_id, profile, title,
                          status, message_count, created_at, updated_at
                   FROM chat_sessions
                   WHERE profile = $1
                   ORDER BY created_at DESC"#,
                profile,
            )
            .fetch_all(&state.db)
            .await?
        }
        (None, None) => {
            sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT id, project_id, hermes_session_id, agent_id, profile, title,
                          status, message_count, created_at, updated_at
                   FROM chat_sessions
                   ORDER BY created_at DESC"#
            )
            .fetch_all(&state.db)
            .await?
        }
    };

    Ok(ChatSessionsResponse {
        sessions: rows.into_iter().map(row_to_session).collect(),
    })
}

pub async fn create_session(
    state: &AppState,
    req: CreateSessionRequest,
) -> AppResult<ChatSessionResponse> {
    let project_id = match req.project_id {
        Some(ref pid) => {
            let uuid = Uuid::parse_str(pid)
                .map_err(|err| AppError::BadRequest(format!("invalid projectId: {err}")))?;
            sqlx::query!(r#"SELECT 1 AS x FROM projects WHERE id = $1"#, uuid)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("project {pid} not found")))?;
            Some(uuid)
        }
        None => None,
    };

    let id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO chat_sessions
             (id, project_id, agent_id, profile, status, message_count)
           VALUES ($1, $2, 'native-default', $3, 'active', 0)"#,
        id,
        project_id,
        req.profile,
    )
    .execute(&state.db)
    .await?;

    let session = row_to_session(fetch_session(state, id).await?);
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "chat_session",
        Some(&session.id),
        Some(
            serde_json::json!({ "after": { "profile": session.profile, "title": session.title } }),
        ),
    )
    .await;
    Ok(ChatSessionResponse { session })
}

pub async fn get_messages(state: &AppState, id: Uuid) -> AppResult<ChatMessagesResponse> {
    let _ = fetch_session(state, id).await?;
    let rows = fetch_message_rows(state, id).await?;
    Ok(ChatMessagesResponse {
        messages: rows.into_iter().map(row_to_message).collect(),
    })
}

pub async fn prepare_native_turn(
    state: &AppState,
    id: Uuid,
    req: SendMessageRequest,
) -> AppResult<PreparedNativeTurn> {
    let text = req.text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::BadRequest("message text cannot be empty".into()));
    }

    let session = fetch_session(state, id).await?;
    let provider_config = llm_providers::resolve_default_config(state).await?;
    let provider: Arc<dyn LlmProvider> = Arc::from(providers::create_provider(&provider_config));

    let working_dir = std::env::current_dir()
        .map_err(|err| AppError::Internal(format!("failed to resolve working directory: {err}")))?;
    let mut registry = ToolRegistry::new();
    register_all(
        &mut registry,
        &BuiltinToolConfig::for_session(
            working_dir.clone(),
            state.config.agent_data_dir.clone(),
            id,
            state.db.clone(),
        ),
    );
    register_safe_defaults(&mut registry);
    let registry = Arc::new(registry);
    let memory_dir = state.config.agent_data_dir.join("memory");
    let memory_snapshot = MemoryStore::load(memory_dir)
        .ok()
        .map(|store| store.snapshot().clone());
    let skill_index = SkillRegistry::new(state.config.agent_data_dir.join("skills"))
        .system_prompt_index()
        .ok();
    let mut system_blocks = Vec::new();
    if let Some(index) = skill_index.filter(|index| !index.trim().is_empty()) {
        system_blocks.push(index);
    }
    if let Some(snapshot) = memory_snapshot {
        if !snapshot.user.trim().is_empty() {
            system_blocks.push(format!("USER.md:\n{}", snapshot.user));
        }
        if !snapshot.memory.trim().is_empty() {
            system_blocks.push(format!("MEMORY.md:\n{}", snapshot.memory));
        }
    }

    let system_prompt = build_system_prompt(&PromptConfig {
        soul_md_path: None,
        working_dir,
        memory_md_path: None,
        user_md_path: None,
        available_tool_names: registry.available_tool_names(),
        model: provider_config.model.clone(),
        system_message: (!system_blocks.is_empty()).then(|| system_blocks.join("\n\n")),
    });

    let rows = fetch_message_rows(state, id).await?;
    let mut messages = rows.iter().map(row_to_agent_message).collect::<Vec<_>>();

    let user_message = insert_user_message(state, id, &text).await?;
    messages.push(Message::user(text.clone()));
    let agent_message_start = messages.len();

    let title = derive_title(&text);
    sqlx::query!(
        r#"UPDATE chat_sessions SET
             message_count = message_count + 1,
             title = COALESCE(NULLIF(title, ''), $2),
             updated_at = now()
           WHERE id = $1"#,
        id,
        title,
    )
    .execute(&state.db)
    .await?;

    let context_manager =
        ContextManager::for_model(&provider_config.model, provider_config.max_tokens);
    let agent_loop = AgentLoop::new(
        provider,
        registry,
        LoopConfig::default(),
        Some(context_manager),
    );

    tracing::info!(
        session_id = %id,
        profile = %session.profile,
        model = %provider_config.model,
        "prepared native chat turn"
    );

    Ok(PreparedNativeTurn {
        session_id: id,
        messages,
        agent_message_start,
        agent_loop,
        system_prompt,
        user_message,
    })
}

pub async fn save_agent_messages(
    state: &AppState,
    session_id: Uuid,
    messages: &[Message],
) -> AppResult<Option<ChatMessage>> {
    let mut last_assistant = None;
    let mut saved_count = 0_i32;

    for message in messages {
        let role = match message.role {
            AgentMessageRole::Assistant => MessageRole::Assistant,
            AgentMessageRole::Tool => MessageRole::Tool,
            AgentMessageRole::System => MessageRole::System,
            AgentMessageRole::User => continue,
        };
        let saved = insert_agent_message(state, session_id, role, message).await?;
        if role == MessageRole::Assistant {
            last_assistant = Some(saved.clone());
        }
        saved_count += 1;
    }

    if saved_count > 0 {
        sqlx::query!(
            r#"UPDATE chat_sessions SET
                 message_count = message_count + $2,
                 updated_at = now()
               WHERE id = $1"#,
            session_id,
            saved_count,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref assistant) = last_assistant {
        log_audit_safe(
            &state.db,
            "agent",
            "agent:native",
            "create",
            "chat_message",
            Some(&assistant.id),
            Some(serde_json::json!({ "after": { "sessionId": session_id.to_string(), "role": "assistant" } })),
        )
        .await;
    }

    Ok(last_assistant)
}

pub async fn fetch_session_response(state: &AppState, id: Uuid) -> AppResult<ChatSession> {
    fetch_session(state, id).await.map(row_to_session)
}

pub async fn delete_session(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query!("DELETE FROM chat_sessions WHERE id = $1", id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("session {id} not found")));
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "chat_session",
        Some(&id.to_string()),
        Some(serde_json::json!({ "before": { "id": id.to_string() } })),
    )
    .await;
    Ok(true)
}

async fn fetch_session(state: &AppState, id: Uuid) -> AppResult<ChatSessionRow> {
    sqlx::query_as!(
        ChatSessionRow,
        r#"SELECT id, project_id, hermes_session_id, agent_id, profile, title,
                  status, message_count, created_at, updated_at
           FROM chat_sessions WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("session {id} not found")))
}

async fn fetch_message_rows(state: &AppState, id: Uuid) -> AppResult<Vec<ChatMessageRow>> {
    Ok(sqlx::query_as!(
        ChatMessageRow,
        r#"SELECT id, session_id, role, content, tool_calls, tool_call_id, metadata, created_at
           FROM chat_messages
           WHERE session_id = $1
           ORDER BY created_at ASC"#,
        id
    )
    .fetch_all(&state.db)
    .await?)
}

async fn insert_user_message(
    state: &AppState,
    session_id: Uuid,
    text: &str,
) -> AppResult<ChatMessage> {
    let id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO chat_messages (id, session_id, role, content)
           VALUES ($1, $2, 'user', $3)"#,
        id,
        session_id,
        text,
    )
    .execute(&state.db)
    .await?;

    let row = sqlx::query_as!(
        ChatMessageRow,
        r#"SELECT id, session_id, role, content, tool_calls, tool_call_id, metadata, created_at
           FROM chat_messages WHERE id = $1"#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    Ok(row_to_message(row))
}

async fn insert_agent_message(
    state: &AppState,
    session_id: Uuid,
    role: MessageRole,
    message: &Message,
) -> AppResult<ChatMessage> {
    let id = Uuid::new_v4();
    let content = message.content.clone().unwrap_or_default();
    let tool_calls = if message.tool_calls.is_empty() {
        None
    } else {
        Some(
            serde_json::to_value(
                message
                    .tool_calls
                    .iter()
                    .map(ToolCallDto::from)
                    .collect::<Vec<_>>(),
            )
            .map_err(|err| AppError::Internal(format!("tool call serialization failed: {err}")))?,
        )
    };
    let role_str = role_to_db(role);

    sqlx::query!(
        r#"INSERT INTO chat_messages
             (id, session_id, role, content, tool_calls, tool_call_id)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
        id,
        session_id,
        role_str,
        content,
        tool_calls,
        message.tool_call_id.as_deref(),
    )
    .execute(&state.db)
    .await?;

    let row = sqlx::query_as!(
        ChatMessageRow,
        r#"SELECT id, session_id, role, content, tool_calls, tool_call_id, metadata, created_at
           FROM chat_messages WHERE id = $1"#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    Ok(row_to_message(row))
}

fn row_to_session(row: ChatSessionRow) -> ChatSession {
    let status = match row.status.as_str() {
        "archived" => SessionStatus::Archived,
        _ => SessionStatus::Active,
    };
    ChatSession {
        id: row.id.to_string(),
        project_id: row.project_id.map(|id| id.to_string()),
        hermes_session_id: row.hermes_session_id,
        agent_id: row.agent_id,
        profile: row.profile,
        title: row.title,
        status,
        message_count: row.message_count,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

fn row_to_message(row: ChatMessageRow) -> ChatMessage {
    ChatMessage {
        id: row.id.to_string(),
        session_id: row.session_id.to_string(),
        role: db_role_to_model(&row.role),
        content: row.content,
        tool_calls: row
            .tool_calls
            .and_then(|value| serde_json::from_value::<Vec<ToolCallDto>>(value).ok()),
        tool_call_id: row.tool_call_id,
        metadata: row.metadata,
        created_at: row.created_at.to_rfc3339(),
    }
}

fn row_to_agent_message(row: &ChatMessageRow) -> Message {
    Message {
        role: match db_role_to_model(&row.role) {
            MessageRole::User => AgentMessageRole::User,
            MessageRole::Assistant => AgentMessageRole::Assistant,
            MessageRole::Tool => AgentMessageRole::Tool,
            MessageRole::System => AgentMessageRole::System,
        },
        content: Some(row.content.clone()).filter(|content| !content.is_empty()),
        tool_calls: row
            .tool_calls
            .clone()
            .and_then(|value| serde_json::from_value::<Vec<ToolCallDto>>(value).ok())
            .unwrap_or_default()
            .into_iter()
            .map(|call| crate::agent::providers::ToolCall {
                id: call.id,
                name: call.name,
                arguments: call.arguments,
            })
            .collect(),
        tool_call_id: row.tool_call_id.clone(),
    }
}

fn db_role_to_model(role: &str) -> MessageRole {
    match role {
        "user" => MessageRole::User,
        "tool" => MessageRole::Tool,
        "system" => MessageRole::System,
        _ => MessageRole::Assistant,
    }
}

fn role_to_db(role: MessageRole) -> &'static str {
    match role {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::Tool => "tool",
        MessageRole::System => "system",
    }
}

fn derive_title(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= 30 {
        trimmed.to_string()
    } else {
        let truncated: String = trimmed.chars().take(30).collect();
        format!("{truncated}…")
    }
}
