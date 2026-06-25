//! Chat domain operations via Hermes CLI.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::chat::{
    ChatMessage, ChatMessagesResponse, ChatSession, ChatSessionResponse, ChatSessionsResponse,
    CreateSessionRequest, MessageRole, SendMessageRequest, SendMessageResponse, SessionStatus,
};
use crate::services::audit::log_audit_safe;
use crate::services::hermes_chat;
use crate::state::AppState;

/// A chat session row.
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

/// A chat message row.
#[derive(Debug, FromRow)]
struct ChatMessageRow {
    id: Uuid,
    session_id: Uuid,
    role: String,
    content: String,
    created_at: DateTime<Utc>,
}

/// Query params for GET /api/chat/sessions.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionQuery {
    pub project_id: Option<String>,
    pub profile: Option<String>,
}

/// GET /api/chat/sessions?projectId={id}&profile={profile}
///
/// Returns chat sessions, optionally filtered by project and/or agent profile.
pub async fn list_sessions(state: &AppState, q: SessionQuery) -> AppResult<ChatSessionsResponse> {
    // Parse project_id once if present.
    let project_uuid = match q.project_id.as_deref() {
        Some(pid) => Some(
            Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}")))?,
        ),
        None => None,
    };

    // sqlx compile-time macros need distinct query strings per combination,
    // so we branch on (project, profile) presence (4 cases).
    let rows = match (project_uuid, q.profile.as_deref()) {
        (Some(pid), Some(prof)) => {
            sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT id, project_id, hermes_session_id, agent_id, profile, title,
                          status, message_count, created_at, updated_at
                   FROM chat_sessions
                   WHERE project_id = $1 AND profile = $2
                   ORDER BY created_at DESC"#,
                pid,
                prof,
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
        (None, Some(prof)) => {
            sqlx::query_as!(
                ChatSessionRow,
                r#"SELECT id, project_id, hermes_session_id, agent_id, profile, title,
                          status, message_count, created_at, updated_at
                   FROM chat_sessions
                   WHERE profile = $1
                   ORDER BY created_at DESC"#,
                prof,
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

    let sessions = rows.into_iter().map(row_to_session).collect();
    Ok(ChatSessionsResponse { sessions })
}

/// POST /api/chat/sessions
///
/// Creates a new (empty) chat session. `project_id` is optional to support
/// general (non-project) conversations. The hermes session id is obtained
/// on the first message.
pub async fn create_session(
    state: &AppState,
    req: CreateSessionRequest,
) -> AppResult<ChatSessionResponse> {
    let project_id = match req.project_id {
        Some(ref pid) => {
            let uuid = Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}")))?;
            // Verify the project exists.
            sqlx::query!(r#"SELECT 1 AS x FROM projects WHERE id = $1"#, uuid)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("project {pid} not found")))?;
            Some(uuid)
        }
        None => None,
    };

    let id = Uuid::new_v4();
    let agent_id = format!("hermes-{}", req.profile);

    sqlx::query!(
        r#"INSERT INTO chat_sessions
             (id, project_id, agent_id, profile, status, message_count)
           VALUES ($1, $2, $3, $4, 'active', 0)"#,
        id,
        project_id,
        agent_id,
        req.profile,
    )
    .execute(&state.db)
    .await?;

    let row = fetch_session(state, id).await?;
    let session = row_to_session(row);
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

/// GET /api/chat/sessions/{id}/messages
///
/// Returns all messages in a session, oldest first.
pub async fn get_messages(state: &AppState, id: Uuid) -> AppResult<ChatMessagesResponse> {
    // Verify session exists.
    let _ = fetch_session(state, id).await?;

    let rows = sqlx::query_as!(
        ChatMessageRow,
        r#"SELECT id, session_id, role, content, created_at
           FROM chat_messages
           WHERE session_id = $1
           ORDER BY created_at ASC"#,
        id
    )
    .fetch_all(&state.db)
    .await?;

    let messages = rows.into_iter().map(row_to_message).collect();
    Ok(ChatMessagesResponse { messages })
}

/// POST /api/chat/sessions/{id}/messages
///
/// Sends a message to the session. On the first message, creates a new hermes
/// session and stores the returned session id. On subsequent messages, resumes
/// the existing hermes session.
pub async fn send_message(
    state: &AppState,
    id: Uuid,
    req: SendMessageRequest,
) -> AppResult<SendMessageResponse> {
    let text = req.text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest("message text cannot be empty".into()));
    }

    let session = fetch_session(state, id).await?;
    let cli = &state.config.hermes_cli_path;

    // Call hermes: new session if no hermes_session_id yet, else resume.
    let result = if let Some(ref hsid) = session.hermes_session_id {
        tracing::info!(session_id = %id, hermes_session_id = %hsid, "resuming hermes session");
        hermes_chat::send_resume(cli, &session.profile, hsid, text)
            .await
            .map_err(chat_err_to_app)?
    } else {
        tracing::info!(session_id = %id, "starting new hermes session");
        hermes_chat::send_new(cli, &session.profile, text)
            .await
            .map_err(chat_err_to_app)?
    };

    // If this was the first message, persist the hermes session id.
    if let Some(ref new_hsid) = result.session_id {
        if session.hermes_session_id.is_none() {
            sqlx::query!(
                r#"UPDATE chat_sessions SET hermes_session_id = $2, updated_at = now()
                   WHERE id = $1"#,
                id,
                new_hsid,
            )
            .execute(&state.db)
            .await?;
        }
    }

    // Derive a title from the first user message if none yet.
    let title = derive_title(text);

    // Insert both the user message and the agent response.
    let user_msg_id = Uuid::new_v4();
    let agent_msg_id = Uuid::new_v4();

    sqlx::query!(
        r#"INSERT INTO chat_messages (id, session_id, role, content)
           VALUES ($1, $2, 'user', $3)"#,
        user_msg_id,
        id,
        text,
    )
    .execute(&state.db)
    .await?;

    sqlx::query!(
        r#"INSERT INTO chat_messages (id, session_id, role, content)
           VALUES ($1, $2, 'agent', $3)"#,
        agent_msg_id,
        id,
        result.response,
    )
    .execute(&state.db)
    .await?;

    // Bump message_count by 2, set title if it was empty.
    sqlx::query!(
        r#"UPDATE chat_sessions SET
             message_count = message_count + 2,
             title = COALESCE(NULLIF(title, ''), $2),
             updated_at = now()
           WHERE id = $1"#,
        id,
        title,
    )
    .execute(&state.db)
    .await?;

    // Fetch the persisted messages + updated session.
    let user_row = fetch_message(state, user_msg_id).await?;
    let agent_row = fetch_message(state, agent_msg_id).await?;
    let session_row = fetch_session(state, id).await?;

    // Audit-log the agent response as an agent-initiated create. The user
    // message itself is not audited (the agent's reply is the meaningful
    // action from the agent system).
    log_audit_safe(
        &state.db,
        "agent",
        &format!("agent:{}", session.profile),
        "create",
        "chat_message",
        Some(&agent_msg_id.to_string()),
        Some(serde_json::json!({ "after": { "sessionId": id.to_string(), "role": "agent" } })),
    )
    .await;

    Ok(SendMessageResponse {
        user_message: row_to_message(user_row),
        agent_message: row_to_message(agent_row),
        session: row_to_session(session_row),
    })
}

/// DELETE /api/chat/sessions/{id}
///
/// Deletes a session and all its messages (cascades).
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

// ---- helpers ----

async fn fetch_session(state: &AppState, id: Uuid) -> Result<ChatSessionRow, AppError> {
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

async fn fetch_message(state: &AppState, id: Uuid) -> Result<ChatMessageRow, AppError> {
    sqlx::query_as!(
        ChatMessageRow,
        r#"SELECT id, session_id, role, content, created_at
           FROM chat_messages WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Internal(format!("message {id} not found after insert")))
}

fn row_to_session(row: ChatSessionRow) -> ChatSession {
    let status = match row.status.as_str() {
        "archived" => SessionStatus::Archived,
        _ => SessionStatus::Active,
    };
    ChatSession {
        id: row.id.to_string(),
        project_id: row.project_id.map(|u| u.to_string()),
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
    let role = match row.role.as_str() {
        "agent" => MessageRole::Agent,
        _ => MessageRole::User,
    };
    ChatMessage {
        id: row.id.to_string(),
        session_id: row.session_id.to_string(),
        role,
        content: row.content,
        created_at: row.created_at.to_rfc3339(),
    }
}

/// Derive a session title from the first message (first 30 chars).
fn derive_title(text: &str) -> String {
    let t = text.trim();
    if t.chars().count() <= 30 {
        t.to_string()
    } else {
        let truncated: String = t.chars().take(30).collect();
        format!("{truncated}…")
    }
}

/// Map a hermes chat error to an AppError.
fn chat_err_to_app(e: hermes_chat::ChatError) -> AppError {
    use hermes_chat::ChatError;
    match e {
        ChatError::CliNotFound(msg) => AppError::Internal(format!(
            "{msg}. Ensure the hermes CLI is installed and HERMES_CLI_PATH is set."
        )),
        ChatError::Timeout => {
            AppError::Internal("hermes did not respond within 180 seconds".into())
        }
        ChatError::HermesFailed(msg) => AppError::Internal(format!("hermes error: {msg}")),
        ChatError::Io(msg) => AppError::Internal(format!("io error: {msg}")),
    }
}
