//! Chat domain operations backed by the native Rust agent runtime.
//!
//! Session CRUD remains in PostgreSQL, but message execution no longer calls
//! the Hermes CLI. Each send operation resolves the default LLM provider,
//! assembles the native tool registry and prompt, then lets the HTTP handler
//! stream agent-loop events to the browser.

use std::{io, sync::Arc};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use futures::{stream::BoxStream, StreamExt};
use serde::Deserialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::context::ContextManager;
use crate::agent::loop_engine::{AgentLoop, LoopConfig};
use crate::agent::memory::MemoryStore;
use crate::agent::prompt::{build_system_prompt, PromptConfig};
use crate::agent::providers::types::ModelInfo;
use crate::agent::providers::{self, LlmProvider, Message, MessageRole as AgentMessageRole};
use crate::agent::providers::{ProviderError, StreamDelta, ToolSchema};
use crate::agent::runtime::{MoaConfig, MoaParticipant};
use crate::agent::security::redact_sensitive_text;
use crate::agent::skills::{BundleRegistry, SkillRegistry};
use crate::agent::tools::builtin::{
    mcp, register_all, register_safe_defaults, BuiltinSessionConfig, BuiltinToolConfig,
};
use crate::agent::tools::ToolRegistry;
use crate::error::{AppError, AppResult};
use crate::models::chat::{
    ChatMessage, ChatMessagesResponse, ChatSession, ChatSessionResponse, ChatSessionsResponse,
    CreateSessionRequest, MessageRole, SendMessageRequest, SessionStatus, ToolCallDto,
};
use crate::services::agents;
use crate::services::audit::log_audit_safe;
use crate::services::drive;
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

struct AgentWorkspaceMetadata {
    name: String,
    role: String,
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

    let rows =
        match (project_uuid, q.profile.as_deref()) {
            (Some(pid), Some(profile)) => sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT s.id, s.project_id, s.hermes_session_id, s.agent_id, s.profile, s.title,
                          s.status, s.message_count, s.created_at, s.updated_at
                   FROM chat_sessions s
                   INNER JOIN native_agents a ON a.profile = s.profile
                   WHERE s.project_id = $1 AND s.profile = $2
                   ORDER BY s.created_at DESC"#,
                pid,
                profile,
            )
            .fetch_all(&state.db)
            .await?,
            (Some(pid), None) => sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT s.id, s.project_id, s.hermes_session_id, s.agent_id, s.profile, s.title,
                          s.status, s.message_count, s.created_at, s.updated_at
                   FROM chat_sessions s
                   INNER JOIN native_agents a ON a.profile = s.profile
                   WHERE s.project_id = $1
                   ORDER BY s.created_at DESC"#,
                pid,
            )
            .fetch_all(&state.db)
            .await?,
            (None, Some(profile)) => sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT s.id, s.project_id, s.hermes_session_id, s.agent_id, s.profile, s.title,
                          s.status, s.message_count, s.created_at, s.updated_at
                   FROM chat_sessions s
                   INNER JOIN native_agents a ON a.profile = s.profile
                   WHERE s.profile = $1
                   ORDER BY s.created_at DESC"#,
                profile,
            )
            .fetch_all(&state.db)
            .await?,
            (None, None) => sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT s.id, s.project_id, s.hermes_session_id, s.agent_id, s.profile, s.title,
                          s.status, s.message_count, s.created_at, s.updated_at
                   FROM chat_sessions s
                   INNER JOIN native_agents a ON a.profile = s.profile
                   ORDER BY s.created_at DESC"#
            )
            .fetch_all(&state.db)
            .await?,
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

    let agent_meta = fetch_agent_workspace_metadata(state, &session.profile).await?;
    drive::ensure_agent_workspace(
        state,
        &session.profile,
        &agent_meta.name,
        Some(&agent_meta.role),
    )?;
    let working_dir = drive::agent_workspace_path(&state.config.agent_data_dir, &session.profile);
    let mut allowed_roots = vec![drive::shared_root(&state.config.agent_data_dir)];
    if let Some(project_id) = session.project_id {
        if let Some(project_slug) = fetch_project_drive_slug(state, project_id).await? {
            drive::ensure_project_workspace(state, &project_slug)?;
            allowed_roots.push(drive::project_workspace_path(
                &state.config.agent_data_dir,
                &project_slug,
            ));
        }
    }
    let mut registry = ToolRegistry::new();
    let extension_settings_key = state.encryption_key.read().await.as_ref().copied();
    let builtin_config = BuiltinToolConfig::for_session(BuiltinSessionConfig {
        working_dir: working_dir.clone(),
        allowed_roots: allowed_roots.clone(),
        agent_data_dir: state.config.agent_data_dir.clone(),
        session_id: id,
        agent_profile: session.profile.clone(),
        project_id: session.project_id,
        db: state.db.clone(),
        extension_settings_key,
    });
    register_all(&mut registry, &builtin_config);
    crate::services::extensions::register_runtime_extensions(&mut registry, state).await?;
    if let Err(err) = mcp::register_dynamic_tools(&mut registry, &builtin_config).await {
        tracing::warn!(error = %err, "MCP dynamic tool registration failed");
    }
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
    system_blocks.push(format!(
        "DRIVE.md:\nAgent workspace: /drive/agents/{}\nShared workspace: /drive/shared\nProject workspaces are available only when the current chat session is linked to a project.\nThe runtime current directory is {}.",
        session.profile,
        working_dir.display()
    ));

    let system_prompt = build_system_prompt(&PromptConfig {
        soul_md_path: Some(crate::services::agent_prompts::soul_md_path(
            &state.config.agent_data_dir,
            &session.profile,
        )?),
        agents_md_path: Some(crate::services::agent_prompts::agents_md_path(
            &state.config.agent_data_dir,
            &session.profile,
        )?),
        working_dir,
        memory_md_path: None,
        user_md_path: None,
        available_tool_names: if use_moa {
            Vec::new()
        } else {
            registry.available_tool_names()
        },
        model: moa_runtime
            .as_ref()
            .map(|preset| preset.aggregator_provider.model.clone())
            .or_else(|| {
                default_runtime
                    .as_ref()
                    .map(|(_, config)| config.model.clone())
            })
            .unwrap_or_else(|| "unknown".to_string()),
        system_message: (!system_blocks.is_empty()).then(|| system_blocks.join("\n\n")),
    });

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
        .with_approval_gate(id, state.approval_gate.clone())
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

fn parse_runtime_provider_id(id: &str) -> AppResult<Uuid> {
    Uuid::parse_str(id)
        .map_err(|err| AppError::Internal(format!("invalid runtime provider id: {err}")))
}

async fn resolve_skill_invocation(
    state: &AppState,
    text: &str,
    session_id: Uuid,
) -> AppResult<String> {
    let Some((slash_name, user_instruction)) = split_slash_invocation(text) else {
        return Ok(text.to_string());
    };
    let skills = SkillRegistry::new(state.config.agent_data_dir.join("skills"));
    let bundles = BundleRegistry::new(
        state.config.agent_data_dir.join("skill-bundles"),
        skills.clone(),
    );
    let config = crate::services::skills::load_config(state)?;
    let session_id = session_id.to_string();

    if let Some(bundle) = bundles
        .resolve(slash_name)
        .map_err(|err| map_skill_io("skill bundle resolve failed", err))?
    {
        return bundles
            .build_invocation_message(&bundle, user_instruction, &session_id, &config)
            .await
            .map_err(|err| map_skill_io("skill bundle invocation failed", err));
    }

    if let Some(skill) = skills
        .resolve_slash(slash_name)
        .map_err(|err| map_skill_io("skill resolve failed", err))?
    {
        return skills
            .build_invocation_message(&skill.name, user_instruction, &session_id, &config)
            .await
            .map_err(|err| map_skill_io("skill invocation failed", err));
    }

    Ok(text.to_string())
}

fn split_slash_invocation(text: &str) -> Option<(&str, &str)> {
    let rest = text.trim().strip_prefix('/')?.trim_start();
    if rest.is_empty() {
        return None;
    }
    let command_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let slash_name = &rest[..command_end];
    if slash_name.is_empty() {
        return None;
    }
    Some((slash_name, rest[command_end..].trim_start()))
}

fn map_skill_io(context: &str, err: io::Error) -> AppError {
    let message = format!("{context}: {err}");
    match err.kind() {
        io::ErrorKind::AlreadyExists
        | io::ErrorKind::InvalidData
        | io::ErrorKind::InvalidInput
        | io::ErrorKind::PermissionDenied => AppError::BadRequest(message),
        io::ErrorKind::NotFound => AppError::NotFound(message),
        _ => AppError::Internal(message),
    }
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

async fn fetch_agent_workspace_metadata(
    state: &AppState,
    profile: &str,
) -> AppResult<AgentWorkspaceMetadata> {
    let row = sqlx::query!(
        r#"SELECT name, role FROM native_agents WHERE profile = $1"#,
        profile
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent profile {profile} not found")))?;
    Ok(AgentWorkspaceMetadata {
        name: row.name,
        role: row.role,
    })
}

async fn fetch_project_drive_slug(state: &AppState, id: Uuid) -> AppResult<Option<String>> {
    sqlx::query_scalar!(r#"SELECT drive_slug FROM projects WHERE id = $1"#, id)
        .fetch_optional(&state.db)
        .await
        .map_err(AppError::Database)
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

struct DbRotatingProvider {
    state: AppState,
    provider_id: Uuid,
}

#[async_trait]
impl LlmProvider for DbRotatingProvider {
    async fn stream(
        &self,
        system_prompt: &str,
        messages: &[Message],
        tools: &[ToolSchema],
    ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
        let state = self.state.clone();
        let provider_id = self.provider_id;
        let system_prompt = system_prompt.to_string();
        let messages = messages.to_vec();
        let tools = tools.to_vec();
        let stream = async_stream::stream! {
            let mut last_error = None;
            for attempt in 1..=3 {
                let resolved = match llm_providers::resolve_runtime_config_with_credential(&state, provider_id).await {
                    Ok(resolved) => resolved,
                    Err(err) => {
                        yield Err(ProviderError::InvalidResponse(format!("provider config resolution failed: {err}")));
                        return;
                    }
                };
                let credential_id = resolved.credential_id;
                let provider = providers::create_provider(&resolved.config);
                let mut inner = match provider.stream(&system_prompt, &messages, &tools).await {
                    Ok(inner) => inner,
                    Err(ProviderError::RateLimited { retry_after_secs }) => {
                        if let Err(err) = llm_providers::mark_credential_rate_limited(
                            &state,
                            provider_id,
                            credential_id,
                            retry_after_secs,
                        )
                        .await
                        {
                            tracing::warn!(error = %err, "failed to mark pooled credential rate-limited");
                        }
                        last_error = Some(ProviderError::RateLimited { retry_after_secs });
                        if attempt < 3 && credential_id.is_some() {
                            continue;
                        }
                        break;
                    }
                    Err(err) => {
                        yield Err(err);
                        return;
                    }
                };
                while let Some(delta) = inner.next().await {
                    if let Err(ProviderError::RateLimited { retry_after_secs }) = &delta {
                        if let Err(err) = llm_providers::mark_credential_rate_limited(
                            &state,
                            provider_id,
                            credential_id,
                            *retry_after_secs,
                        )
                        .await
                        {
                            tracing::warn!(error = %err, "failed to mark pooled credential rate-limited");
                        }
                    }
                    yield delta;
                }
                return;
            }
            yield Err(last_error.unwrap_or(ProviderError::RateLimited {
                retry_after_secs: Some(60),
            }));
        };
        Ok(Box::pin(stream))
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let mut last_error = None;
        for attempt in 1..=3 {
            let resolved = llm_providers::resolve_runtime_config_with_credential(
                &self.state,
                self.provider_id,
            )
            .await
            .map_err(|err| {
                ProviderError::InvalidResponse(format!("provider config resolution failed: {err}"))
            })?;
            let credential_id = resolved.credential_id;
            let provider = providers::create_provider(&resolved.config);
            match provider.list_models().await {
                Ok(models) => return Ok(models),
                Err(ProviderError::RateLimited { retry_after_secs }) => {
                    if let Err(err) = llm_providers::mark_credential_rate_limited(
                        &self.state,
                        self.provider_id,
                        credential_id,
                        retry_after_secs,
                    )
                    .await
                    {
                        tracing::warn!(error = %err, "failed to mark pooled credential rate-limited");
                    }
                    last_error = Some(ProviderError::RateLimited { retry_after_secs });
                    if attempt < 3 && credential_id.is_some() {
                        continue;
                    }
                    break;
                }
                Err(err) => return Err(err),
            }
        }
        Err(last_error.unwrap_or(ProviderError::RateLimited {
            retry_after_secs: Some(60),
        }))
    }
}
