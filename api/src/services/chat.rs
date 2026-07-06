//! Chat domain operations backed by the native Rust agent runtime.
//!
//! Session CRUD remains in PostgreSQL, but message execution no longer calls
//! external command shims. Each send operation resolves the default LLM provider,
//! assembles the native tool registry and prompt, then lets the HTTP handler
//! stream agent-loop events to the browser.

mod prompt_snapshot;
mod provider;
mod skill_invocation;

use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::context::ContextManager;
use crate::agent::loop_engine::{AgentLoop, LoopConfig};
use crate::agent::memory::MemoryStore;
use crate::agent::prompt::{assemble_system_prompt, build_system_prompt_parts, PromptConfig};
use crate::agent::providers::{LlmProvider, Message, MessageRole as AgentMessageRole};
use crate::agent::runtime::{MoaConfig, MoaParticipant};
use crate::agent::security::redact_sensitive_text;
use crate::agent::skills::SkillRegistry;
use crate::agent::tools::builtin::{
    mcp, register_agent_toolsets, register_all, BuiltinSessionConfig, BuiltinToolConfig,
};
use crate::agent::tools::ToolRegistry;
use crate::error::{AppError, AppResult};
use crate::models::chat::{
    ChatMessage, ChatMessagesResponse, ChatSession, ChatSessionResponse, ChatSessionsResponse,
    CreateSessionRequest, MessageRole, SendMessageRequest, SessionStatus, ToolCallDto,
};
use crate::services::agent_permissions;
use crate::services::agents;
use crate::services::audit::log_audit_safe;
use crate::services::drive;
use crate::services::llm_providers;
use crate::services::sandbox_runner::logical_path_for_runner;
use crate::state::AppState;

use self::prompt_snapshot::{fingerprint_tool_schemas, resolve_prompt_snapshot};
use self::provider::{parse_runtime_provider_id, DbRotatingProvider};
use self::skill_invocation::resolve_skill_invocation;

#[derive(Debug, FromRow)]
struct ChatSessionRow {
    id: Uuid,
    project_id: Option<Uuid>,
    agent_id: String,
    profile: String,
    title: Option<String>,
    status: String,
    message_count: i32,
    system_prompt_stable: Option<String>,
    system_prompt_context: Option<String>,
    system_prompt_fingerprint: Option<String>,
    tool_schema_fingerprint: Option<String>,
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
    pub execution: PreparedExecution,
    pub system_prompt: String,
    pub user_message: ChatMessage,
}

pub enum PreparedExecution {
    Agent(AgentLoop),
    Moa(PreparedMoaTurn),
}

pub struct PreparedMoaTurn {
    pub preset_id: Uuid,
    pub preset_name: String,
    pub proposers: Vec<MoaParticipant>,
    pub aggregator: MoaParticipant,
    pub config: MoaConfig,
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
                r#"SELECT s.id, s.project_id, s.agent_id, s.profile, s.title,
                          s.status, s.message_count, s.system_prompt_stable,
                          s.system_prompt_context, s.system_prompt_fingerprint,
                          s.tool_schema_fingerprint, s.created_at, s.updated_at
                   FROM chat_sessions s
                   INNER JOIN native_agents a ON a.profile = s.profile
                   WHERE s.project_id = $1 AND s.profile = $2
                   ORDER BY s.created_at DESC"#,
                pid,
                profile,
            )
            .fetch_all(&state.db)
            .await?
        }
        (Some(pid), None) => {
            sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT s.id, s.project_id, s.agent_id, s.profile, s.title,
                          s.status, s.message_count, s.system_prompt_stable,
                          s.system_prompt_context, s.system_prompt_fingerprint,
                          s.tool_schema_fingerprint, s.created_at, s.updated_at
                   FROM chat_sessions s
                   INNER JOIN native_agents a ON a.profile = s.profile
                   WHERE s.project_id = $1
                   ORDER BY s.created_at DESC"#,
                pid,
            )
            .fetch_all(&state.db)
            .await?
        }
        (None, Some(profile)) => {
            sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT s.id, s.project_id, s.agent_id, s.profile, s.title,
                          s.status, s.message_count, s.system_prompt_stable,
                          s.system_prompt_context, s.system_prompt_fingerprint,
                          s.tool_schema_fingerprint, s.created_at, s.updated_at
                   FROM chat_sessions s
                   INNER JOIN native_agents a ON a.profile = s.profile
                   WHERE s.profile = $1
                   ORDER BY s.created_at DESC"#,
                profile,
            )
            .fetch_all(&state.db)
            .await?
        }
        (None, None) => {
            sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT s.id, s.project_id, s.agent_id, s.profile, s.title,
                          s.status, s.message_count, s.system_prompt_stable,
                          s.system_prompt_context, s.system_prompt_fingerprint,
                          s.tool_schema_fingerprint, s.created_at, s.updated_at
                   FROM chat_sessions s
                   INNER JOIN native_agents a ON a.profile = s.profile
                   ORDER BY s.created_at DESC"#
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

    let profile = resolve_session_profile(state, req.profile).await?;
    let agent_id = format!("native-{profile}");
    let id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO chat_sessions
             (id, project_id, agent_id, profile, status, message_count)
           VALUES ($1, $2, $3, $4, 'active', 0)"#,
        id,
        project_id,
        agent_id,
        profile,
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

async fn resolve_session_profile(
    state: &AppState,
    requested_profile: Option<String>,
) -> AppResult<String> {
    let profile = match requested_profile {
        Some(value) if !value.trim().is_empty() => agents::normalize_agent_profile(value.trim())?,
        _ => agents::first_agent_profile(state).await?.ok_or_else(|| {
            AppError::BadRequest(
                "cannot create chat session without a configured agent".to_string(),
            )
        })?,
    };

    let exists =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM native_agents WHERE profile = $1")
            .bind(&profile)
            .fetch_one(&state.db)
            .await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!(
            "agent profile {profile} not found"
        )));
    }
    Ok(profile)
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
    let use_moa = req.use_moa;
    let moa_runtime = if use_moa {
        Some(crate::services::moa::resolve_runtime_preset(state, req.moa_preset_id).await?)
    } else {
        None
    };
    let default_runtime = if moa_runtime.is_none() {
        let provider_id = llm_providers::resolve_default_provider_id(state).await?;
        Some((
            provider_id,
            llm_providers::resolve_runtime_config(state, provider_id).await?,
        ))
    } else {
        None
    };

    let workspace =
        drive::resolve_agent_drive_workspace(state, &session.profile, session.project_id).await?;
    let working_dir = workspace.working_dir;
    let allowed_roots = workspace.allowed_roots;
    let permission_policy = agent_permissions::load_policy(state, &session.profile).await?;
    let mut registry = ToolRegistry::new();
    let extension_settings_key = state.encryption_key.read().await.as_ref().copied();
    let builtin_config = BuiltinToolConfig::for_session(BuiltinSessionConfig {
        working_dir: working_dir.clone(),
        allowed_roots: allowed_roots.clone(),
        agent_data_dir: state.config.agent_data_dir.clone(),
        session_id: id,
        agent_profile: session.profile.clone(),
        project_id: session.project_id,
        sandbox_runner_url: state.config.sandbox_runner_url.clone(),
        sandbox_preview_host: state.config.sandbox_preview_host.clone(),
        db: state.db.clone(),
        extension_settings_key,
        app_state: Arc::new(state.clone()),
        permission_policy: permission_policy.clone(),
    });
    register_all(&mut registry, &builtin_config);
    crate::services::extensions::register_runtime_extensions(&mut registry, state).await?;
    if let Err(err) = mcp::register_dynamic_tools(&mut registry, &builtin_config).await {
        tracing::warn!(error = %err, "MCP dynamic tool registration failed");
    }
    register_agent_toolsets(&mut registry, &permission_policy);
    let tool_schemas_for_prompt = if use_moa {
        Vec::new()
    } else {
        registry.schemas()
    };
    let available_tool_names = tool_schemas_for_prompt
        .iter()
        .map(|schema| schema.function.name.clone())
        .collect::<Vec<_>>();
    let tool_schema_fingerprint = fingerprint_tool_schemas(&tool_schemas_for_prompt)?;
    let registry = Arc::new(registry);
    let memory_dir = state.config.agent_data_dir.join("memory");
    let memory_snapshot = MemoryStore::load(memory_dir)
        .ok()
        .map(|store| store.snapshot().clone());
    let skill_index = SkillRegistry::new(state.config.agent_data_dir.join("skills"))
        .system_prompt_index()
        .ok();
    let mut context_blocks = Vec::new();
    if let Some(index) = skill_index.filter(|index| !index.trim().is_empty()) {
        context_blocks.push(index);
    }
    context_blocks.push(format!(
        "DRIVE.md:\nPrivate workspace: /drive/agents/{}\nShared workspace: /drive/shared\nUse relative paths for private files, for example report.md or notes/plan.md. Use /drive/shared/... only for shared files. Do not include /drive/agents/{} in private file tool paths.\nThe runtime current directory is {}.",
        session.profile,
        session.profile,
        logical_path_for_runner(&working_dir)
    ));
    context_blocks.push(format!(
        "Available app data domains:\n{}",
        permission_policy.capability_summary()
    ));

    let mut volatile_blocks = Vec::new();
    if let Some(snapshot) = memory_snapshot {
        if !snapshot.user.trim().is_empty() {
            volatile_blocks.push(format!("USER.md:\n{}", snapshot.user));
        }
        if !snapshot.memory.trim().is_empty() {
            volatile_blocks.push(format!("MEMORY.md:\n{}", snapshot.memory));
        }
    }

    let model = moa_runtime
        .as_ref()
        .map(|preset| preset.aggregator_provider.model.clone())
        .or_else(|| {
            default_runtime
                .as_ref()
                .map(|(_, config)| config.model.clone())
        })
        .unwrap_or_else(|| "unknown".to_string());
    let prompt_parts = build_system_prompt_parts(&PromptConfig {
        soul_md_path: Some(drive::agent_soul_md_path(
            &state.config.agent_data_dir,
            &session.profile,
        )),
        agents_md_path: Some(drive::agent_agents_md_path(
            &state.config.agent_data_dir,
            &session.profile,
        )),
        working_dir,
        memory_md_path: None,
        user_md_path: None,
        available_tool_names,
        model,
        system_message: (!context_blocks.is_empty()).then(|| context_blocks.join("\n\n")),
        volatile_system_message: (!volatile_blocks.is_empty())
            .then(|| volatile_blocks.join("\n\n")),
    });
    let prompt_parts =
        resolve_prompt_snapshot(state, &session, &prompt_parts, &tool_schema_fingerprint).await?;
    let system_prompt = assemble_system_prompt(&prompt_parts);

    let rows = fetch_message_rows(state, id).await?;
    let mut messages = rows.iter().map(row_to_agent_message).collect::<Vec<_>>();
    let agent_user_text = resolve_skill_invocation(state, &text, id).await?;

    let user_message = insert_user_message(state, id, &text).await?;
    messages.push(Message::user(agent_user_text));
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

    let execution = if let Some(runtime) = moa_runtime {
        let proposers = runtime
            .proposer_providers
            .iter()
            .map(|provider| {
                Ok(MoaParticipant {
                    label: format!("{} ({})", provider.label, provider.model),
                    provider: Arc::new(DbRotatingProvider {
                        state: state.clone(),
                        provider_id: parse_runtime_provider_id(&provider.id)?,
                    }),
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        let aggregator = MoaParticipant {
            label: format!(
                "{} ({})",
                runtime.aggregator_provider.label, runtime.aggregator_provider.model
            ),
            provider: Arc::new(DbRotatingProvider {
                state: state.clone(),
                provider_id: parse_runtime_provider_id(&runtime.aggregator_provider.id)?,
            }),
        };
        PreparedExecution::Moa(PreparedMoaTurn {
            preset_id: runtime.id,
            preset_name: runtime.name,
            proposers,
            aggregator,
            config: MoaConfig {
                max_concurrent: runtime.max_concurrent,
                aggregation_prompt: runtime.aggregation_prompt,
            },
        })
    } else {
        let (provider_id, provider_config) = default_runtime
            .ok_or_else(|| AppError::Internal("default provider resolution missing".into()))?;
        let provider: Arc<dyn LlmProvider> = Arc::new(DbRotatingProvider {
            state: state.clone(),
            provider_id,
        });
        let context_manager =
            ContextManager::for_model(&provider_config.model, provider_config.max_tokens);
        let agent_loop = AgentLoop::new(
            provider,
            registry,
            LoopConfig::default(),
            Some(context_manager),
        )
        .with_clarify_gate(id, state.clarify_gate.clone())
        .with_todo_path(
            state
                .config
                .agent_data_dir
                .join("todos")
                .join(format!("{id}.json")),
        );
        PreparedExecution::Agent(agent_loop)
    };

    tracing::info!(
        session_id = %id,
        profile = %session.profile,
        moa = use_moa,
        "prepared native chat turn"
    );

    Ok(PreparedNativeTurn {
        session_id: id,
        messages,
        agent_message_start,
        execution,
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
        r#"SELECT id, project_id, agent_id, profile, title,
                  status, message_count, system_prompt_stable, system_prompt_context,
                  system_prompt_fingerprint, tool_schema_fingerprint, created_at, updated_at
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
    let content = redact_sensitive_text(&message.content.clone().unwrap_or_default());
    let tool_calls = if message.tool_calls.is_empty() {
        None
    } else {
        Some(
            serde_json::to_value(
                message
                    .tool_calls
                    .iter()
                    .map(|call| ToolCallDto {
                        id: redact_sensitive_text(&call.id),
                        name: call.name.clone(),
                        arguments: redact_sensitive_text(&call.arguments),
                    })
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
