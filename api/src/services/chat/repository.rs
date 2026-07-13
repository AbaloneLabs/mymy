use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::providers::{Message, MessageRole as AgentMessageRole};
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::models::chat::{
    ChatMessage, ChatMessagesResponse, ChatSession, ChatSessionResponse, ChatSessionsResponse,
    CreateSessionRequest, MessageRole, SessionStatus, ToolCallDto,
};
use crate::services::agents;
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

#[derive(Debug, FromRow)]
pub(super) struct ChatSessionRow {
    pub(super) id: Uuid,
    pub(super) project_id: Option<Uuid>,
    pub(super) agent_id: String,
    pub(super) profile: String,
    pub(super) title: Option<String>,
    pub(super) status: String,
    pub(super) message_count: i32,
    pub(super) system_prompt_stable: Option<String>,
    pub(super) system_prompt_context: Option<String>,
    pub(super) system_prompt_fingerprint: Option<String>,
    pub(super) tool_schema_fingerprint: Option<String>,
    pub(super) created_at: DateTime<Utc>,
    pub(super) updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub(super) struct ChatMessageRow {
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
    pub scope: Option<String>,
    pub profile: Option<String>,
}

pub async fn list_sessions(state: &AppState, q: SessionQuery) -> AppResult<ChatSessionsResponse> {
    let scope =
        crate::models::scope::ScopeFilter::parse(q.scope.as_deref(), q.project_id.as_deref())?;
    let rows = sqlx::query_as!(
        ChatSessionRow,
        r#"SELECT s.id, s.project_id, s.agent_id, s.profile, s.title,
                  s.status, s.message_count, s.system_prompt_stable,
                  s.system_prompt_context, s.system_prompt_fingerprint,
                  s.tool_schema_fingerprint, s.created_at, s.updated_at
           FROM chat_sessions s
           INNER JOIN native_agents a ON a.profile = s.profile
           WHERE ($1::text = 'all'
               OR ($1 = 'general' AND s.project_id IS NULL)
               OR ($1 = 'project' AND s.project_id = $2))
             AND ($3::text IS NULL OR s.profile = $3)
             AND NOT s.automation_result_only
           ORDER BY s.created_at DESC"#,
        scope.kind(),
        scope.project_id(),
        q.profile.as_deref() as Option<&str>,
    )
    .fetch_all(&state.db)
    .await?;

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

pub async fn save_agent_messages_for_run(
    state: &AppState,
    run_id: Uuid,
    session_id: Uuid,
    messages: &[Message],
) -> AppResult<Option<ChatMessage>> {
    let mut last_assistant = None;
    let mut last_assistant_inserted = false;
    let mut saved_count = 0_i32;

    for (index, message) in messages.iter().enumerate() {
        let role = match message.role {
            AgentMessageRole::Assistant => MessageRole::Assistant,
            AgentMessageRole::Tool => MessageRole::Tool,
            AgentMessageRole::System => MessageRole::System,
            AgentMessageRole::User => continue,
        };
        let id = Uuid::new_v4();
        let content = redact_sensitive_text(&message.content.clone().unwrap_or_default());
        let tool_calls = serialize_tool_calls(message)?;
        let inserted = sqlx::query(
            r#"INSERT INTO chat_messages
                 (id, session_id, role, content, tool_calls, tool_call_id,
                  agent_run_id, run_message_index)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (agent_run_id, run_message_index)
               WHERE agent_run_id IS NOT NULL AND run_message_index IS NOT NULL
               DO NOTHING"#,
        )
        .bind(id)
        .bind(session_id)
        .bind(role_to_db(role))
        .bind(content)
        .bind(tool_calls)
        .bind(message.tool_call_id.as_deref())
        .bind(run_id)
        .bind(index as i32)
        .execute(&state.db)
        .await?
        .rows_affected()
            == 1;
        let row = sqlx::query_as::<_, ChatMessageRow>(
            r#"SELECT id, session_id, role, content, tool_calls, tool_call_id,
                      metadata, created_at
               FROM chat_messages
               WHERE agent_run_id = $1 AND run_message_index = $2"#,
        )
        .bind(run_id)
        .bind(index as i32)
        .fetch_one(&state.db)
        .await?;
        if inserted {
            saved_count += 1;
        }
        if role == MessageRole::Assistant {
            last_assistant = Some(row_to_message(row));
            last_assistant_inserted = inserted;
        }
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

    if last_assistant_inserted {
        if let Some(ref assistant) = last_assistant {
            log_audit_safe(
                &state.db,
                "agent",
                "agent:native",
                "create",
                "chat_message",
                Some(&assistant.id),
                Some(serde_json::json!({
                    "after": {
                        "sessionId": session_id.to_string(),
                        "role": "assistant",
                        "runId": run_id.to_string(),
                    }
                })),
            )
            .await;
        }
    }

    Ok(last_assistant)
}

pub async fn fetch_session_response(state: &AppState, id: Uuid) -> AppResult<ChatSession> {
    fetch_session(state, id).await.map(row_to_session)
}

pub async fn delete_session(state: &AppState, id: Uuid) -> AppResult<bool> {
    let mut tx = state.db.begin().await?;
    let exists =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM chat_sessions WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    if exists.is_none() {
        let completed = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM session_deletion_operations WHERE session_id = $1 AND state = 'completed')",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        if completed {
            return Ok(true);
        }
        return Err(AppError::NotFound("session not found".to_string()));
    }
    let active_run = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1 FROM agent_runs
             WHERE session_id = $1
               AND status IN ('queued', 'running', 'waiting_decision'))"#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if active_run {
        return Err(AppError::Conflict(
            "cancel active session runs and wait for completion before deleting the chat"
                .to_string(),
        ));
    }
    sqlx::query(
        "UPDATE chat_sessions SET deleting_at = COALESCE(deleting_at, now()) WHERE id = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO session_deletion_operations
              (session_id, state, fenced_at)
           VALUES ($1, 'fenced', now())
           ON CONFLICT (session_id) DO UPDATE SET
             state = CASE
               WHEN session_deletion_operations.state = 'completed' THEN 'completed'
               ELSE 'fenced'
             END,
             last_error_code = NULL,
             fenced_at = COALESCE(session_deletion_operations.fenced_at, now()),
             updated_at = now()"#,
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if !finalize_session_deletion(state, id).await? {
        return Err(AppError::Conflict(
            "session deletion is fenced and will finish after active work settles".to_string(),
        ));
    }
    Ok(true)
}

/// Resume a fenced deletion after all admitted work becomes terminal.
/// Locking both rows makes API retries and the worker mutually exclusive.
async fn finalize_session_deletion(state: &AppState, id: Uuid) -> AppResult<bool> {
    let mut tx = state.db.begin().await?;
    // Session-before-operation is the global lock order. The API path installs
    // the fence in that order, so the worker must not hold the operation row
    // while waiting for a concurrent session-row lock.
    let session_exists =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM chat_sessions WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let operation_exists = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM session_deletion_operations WHERE session_id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    if operation_exists.is_none() {
        return Err(AppError::Internal(
            "session deletion operation is missing".to_string(),
        ));
    }
    if session_exists.is_none() {
        sqlx::query(
            r#"UPDATE session_deletion_operations
               SET state = 'completed', completed_at = COALESCE(completed_at, now()),
                   updated_at = now(), last_error_code = NULL
               WHERE session_id = $1"#,
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(true);
    }
    let active_run = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1 FROM agent_runs
             WHERE session_id = $1
               AND status IN ('queued', 'running', 'waiting_decision'))"#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if active_run {
        sqlx::query(
            "UPDATE session_deletion_operations SET state = 'waiting_for_runs', updated_at = now() WHERE session_id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(false);
    }
    let pending_saves = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1 FROM document_editor_save_receipts
             WHERE source_session_id = $1 AND status = 'pending')"#,
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if pending_saves {
        sqlx::query(
            "UPDATE session_deletion_operations SET state = 'waiting_for_saves', updated_at = now() WHERE session_id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(false);
    }
    sqlx::query(
        r#"UPDATE agent_memories
           SET status = 'stale', lifecycle_revision = lifecycle_revision + 1,
               valid_until = COALESCE(valid_until, now())
           WHERE source_session_id = $1
             AND origin = 'conversation_inferred'
             AND status IN ('pending_review', 'active', 'conflict')"#,
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM chat_sessions WHERE id = $1 AND deleting_at IS NOT NULL")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"UPDATE session_deletion_operations
           SET state = 'completed', completed_at = now(), updated_at = now(),
               last_error_code = NULL
           WHERE session_id = $1"#,
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
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

pub async fn reconcile_session_deletions(state: &AppState, maximum: usize) -> AppResult<usize> {
    let session_ids = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT session_id
           FROM session_deletion_operations
           WHERE state NOT IN ('completed', 'failed')
           ORDER BY updated_at, session_id
           LIMIT $1"#,
    )
    .bind(maximum.min(10_000) as i64)
    .fetch_all(&state.db)
    .await?;
    let mut completed = 0;
    for session_id in session_ids {
        if finalize_session_deletion(state, session_id).await? {
            completed += 1;
        }
    }
    Ok(completed)
}

pub(super) async fn fetch_session(state: &AppState, id: Uuid) -> AppResult<ChatSessionRow> {
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

pub(super) async fn fetch_message_rows(
    state: &AppState,
    id: Uuid,
) -> AppResult<Vec<ChatMessageRow>> {
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

pub(super) async fn insert_user_message(
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

pub(super) async fn insert_user_message_for_input(
    state: &AppState,
    session_id: Uuid,
    run_input_id: Uuid,
    text: &str,
) -> AppResult<(ChatMessage, bool)> {
    let id = Uuid::new_v4();
    let inserted = sqlx::query(
        r#"INSERT INTO chat_messages (id, session_id, role, content, run_input_id)
           VALUES ($1, $2, 'user', $3, $4)
           ON CONFLICT (run_input_id) WHERE run_input_id IS NOT NULL DO NOTHING"#,
    )
    .bind(id)
    .bind(session_id)
    .bind(text)
    .bind(run_input_id)
    .execute(&state.db)
    .await?
    .rows_affected()
        == 1;

    let row = sqlx::query_as::<_, ChatMessageRow>(
        r#"SELECT id, session_id, role, content, tool_calls, tool_call_id,
                  metadata, created_at
           FROM chat_messages WHERE run_input_id = $1"#,
    )
    .bind(run_input_id)
    .fetch_one(&state.db)
    .await?;
    Ok((row_to_message(row), inserted))
}

fn serialize_tool_calls(message: &Message) -> AppResult<Option<serde_json::Value>> {
    if message.tool_calls.is_empty() {
        return Ok(None);
    }
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
    .map(Some)
    .map_err(|err| AppError::Internal(format!("tool call serialization failed: {err}")))
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

pub(super) fn row_to_agent_message(row: &ChatMessageRow) -> Message {
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

pub(super) fn derive_title(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= 30 {
        trimmed.to_string()
    } else {
        let truncated: String = trimmed.chars().take(30).collect();
        format!("{truncated}…")
    }
}
