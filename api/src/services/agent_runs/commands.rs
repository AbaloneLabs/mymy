//! Public run commands and their transactional invariants.
//!
//! Commands validate ownership and mutable state before changing durable run
//! or input rows. State transitions and their audit events share a transaction
//! when clients must never observe one without the other; handlers therefore
//! cannot construct partially applied lifecycle changes themselves.

use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::agent::prompt::PROMPT_VERSION;
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::models::agent_run::{
    CancelAgentRunResponse, EnqueueChatRunRequest, EnqueueChatRunResponse, SessionRunInputView,
    UpdateSessionRunInputRequest,
};
use crate::models::chat::ChatSseEvent;
use crate::state::AppState;

use super::projection::{input_to_view, is_terminal, run_to_view, truncate_chars};
use super::repository::{fetch_run_row, run_columns, run_select};
use super::{
    append_event, insert_event_in_tx, AgentRunRow, SessionRunInputRow,
    INTERACTIVE_MAX_RUNTIME_SECONDS, INTERACTIVE_MAX_TOOL_CALLS, INTERACTIVE_MAX_TOTAL_TOKENS,
    MAX_CLIENT_REQUEST_ID_CHARS,
};

#[derive(Debug, FromRow)]
struct SessionIdentityRow {
    profile: String,
    project_id: Option<Uuid>,
    deleting_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn enqueue_chat_run(
    state: &AppState,
    session_id: Uuid,
    request: EnqueueChatRunRequest,
) -> AppResult<EnqueueChatRunResponse> {
    let client_request_id = request.client_request_id.trim();
    if client_request_id.is_empty()
        || client_request_id.chars().count() > MAX_CLIENT_REQUEST_ID_CHARS
    {
        return Err(AppError::BadRequest(
            "clientRequestId must contain 1 to 128 characters".to_string(),
        ));
    }
    let text = request.text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest(
            "message text cannot be empty".to_string(),
        ));
    }

    let mut tx = state.db.begin().await?;
    let session = sqlx::query_as::<_, SessionIdentityRow>(
        "SELECT profile, project_id, deleting_at FROM chat_sessions WHERE id = $1 FOR UPDATE",
    )
    .bind(session_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;
    if session.deleting_at.is_some() {
        return Err(AppError::Conflict(
            "chat session deletion is already in progress".to_string(),
        ));
    }

    let options = serde_json::json!({
        "useMoa": request.use_moa,
        "moaPresetId": request.moa_preset_id,
    });
    let inserted = sqlx::query_as::<_, SessionRunInputRow>(
        r#"INSERT INTO session_run_inputs
             (session_id, client_request_id, content, options)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (session_id, client_request_id) DO NOTHING
           RETURNING id, session_id, client_request_id, target_run_id, kind,
                     content, options, status, sequence, created_at, applied_at"#,
    )
    .bind(session_id)
    .bind(client_request_id)
    .bind(text)
    .bind(&options)
    .fetch_optional(&mut *tx)
    .await?;

    let (input, deduplicated) = match inserted {
        Some(input) => (input, false),
        None => (
            fetch_input_by_client_request(&mut tx, session_id, client_request_id).await?,
            true,
        ),
    };

    let mut input = input;
    let run = if let Some(run_id) = input.target_run_id {
        fetch_run_in_tx(&mut tx, run_id).await?
    } else {
        // Every accepted input owns a stable run identity immediately. A
        // follow-up must not point at the currently running turn because that
        // turn may finish before the sender reconnects, leaving the sender to
        // observe the wrong terminal state. The worker still serializes these
        // per-input runs by session and input sequence.
        let follows_existing = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                 SELECT 1 FROM agent_runs
                 WHERE session_id = $1
                   AND trigger_type = 'chat'
                   AND status IN ('queued', 'running', 'waiting_decision')
               )"#,
        )
        .bind(session_id)
        .fetch_one(&mut *tx)
        .await?;
        if follows_existing {
            sqlx::query("UPDATE session_run_inputs SET kind = 'follow_up' WHERE id = $1")
                .bind(input.id)
                .execute(&mut *tx)
                .await?;
            input.kind = "follow_up".to_string();
        }
        let run = insert_chat_run(&mut tx, &session, &input).await?;
        sqlx::query("UPDATE session_run_inputs SET target_run_id = $2 WHERE id = $1")
            .bind(input.id)
            .bind(run.id)
            .execute(&mut *tx)
            .await?;
        input.target_run_id = Some(run.id);
        Some(run)
    };

    tx.commit().await?;
    if !deduplicated {
        crate::services::proactive::record_activity(
            state,
            Some(&session.profile),
            session.project_id,
            "user_message",
            &input.id.to_string(),
        )
        .await?;
    }
    state.agent_run_notify.notify_waiters();
    Ok(EnqueueChatRunResponse {
        input: input_to_view(input),
        run: run.map(run_to_view),
        deduplicated,
    })
}

pub async fn request_cancel(
    state: &AppState,
    run_id: Uuid,
    actor: &str,
) -> AppResult<CancelAgentRunResponse> {
    let run = fetch_run_row(&state.db, run_id).await?;
    validate_run_origin(state, &run).await?;
    if is_terminal(&run.status) {
        return Ok(CancelAgentRunResponse {
            accepted: false,
            terminal: true,
            status: run.status,
        });
    }
    let updated = sqlx::query_as::<_, (Uuid, String)>(
        r#"WITH RECURSIVE affected AS (
             SELECT id FROM agent_runs WHERE id = $1
             UNION ALL
             SELECT child.id
             FROM agent_runs child
             INNER JOIN affected parent ON child.parent_run_id = parent.id
           )
           UPDATE agent_runs run
           SET cancel_requested_at = COALESCE(run.cancel_requested_at, now()),
               cancel_requested_by = COALESCE(run.cancel_requested_by, $2)
           FROM affected
           WHERE run.id = affected.id
             AND run.status NOT IN ('completed', 'failed', 'cancelled')
           RETURNING run.id, run.status"#,
    )
    .bind(run_id)
    .bind(actor)
    .fetch_all(&state.db)
    .await?;
    for (affected_id, _) in &updated {
        state.signal_run_cancellation(*affected_id).await;
    }
    state.agent_run_notify.notify_waiters();
    Ok(CancelAgentRunResponse {
        accepted: !updated.is_empty(),
        terminal: false,
        status: updated
            .iter()
            .find(|(id, _)| *id == run_id)
            .map(|(_, status)| status.clone())
            .unwrap_or(run.status),
    })
}

/// Move a durable provider retry forward without creating another chat input.
///
/// Only runs explicitly parked by the provider retry policy are eligible. The
/// stable run and input identities ensure a successful manual retry clears the
/// pending schedule by completing the original request exactly once.
pub async fn request_provider_retry_now(
    state: &AppState,
    run_id: Uuid,
) -> AppResult<crate::models::agent_run::AgentRunView> {
    let run = fetch_run_row(&state.db, run_id).await?;
    validate_run_origin(state, &run).await?;
    let mut tx = state.db.begin().await?;
    let updated = sqlx::query_as::<_, AgentRunRow>(&format!(
        r#"UPDATE agent_runs
           SET next_attempt_at = NULL, error_code = NULL
           WHERE id = $1 AND status = 'queued'
             AND next_attempt_at IS NOT NULL
             AND error_code = 'provider_retry_scheduled'
             AND cancel_requested_at IS NULL
           RETURNING {}"#,
        run_columns()
    ))
    .bind(run_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Conflict("run is not waiting for a provider retry".to_string()))?;
    insert_event_in_tx(
        &mut tx,
        run_id,
        "provider_retry_requested",
        serde_json::to_value(ChatSseEvent::ProviderRetryRequested {
            run_id: run_id.to_string(),
        })
        .map_err(|error| {
            AppError::Internal(format!(
                "provider retry request serialization failed: {error}"
            ))
        })?,
        Some(&format!(
            "provider-retry-requested:{}",
            updated.provider_retry_count
        )),
    )
    .await?;
    tx.commit().await?;
    state.agent_run_notify.notify_waiters();
    Ok(run_to_view(updated))
}

pub async fn update_queued_input(
    state: &AppState,
    input_id: Uuid,
    request: UpdateSessionRunInputRequest,
) -> AppResult<SessionRunInputView> {
    let text = request.text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest(
            "queued message text cannot be empty".to_string(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let input = fetch_input_for_update(&mut tx, input_id).await?;
    if input.status != "queued" {
        return Err(AppError::Conflict(
            "only queued messages can be edited".to_string(),
        ));
    }
    let run_id = input
        .target_run_id
        .ok_or_else(|| AppError::Conflict("queued message has no run identity".to_string()))?;
    let run = fetch_run_in_tx(&mut tx, run_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent run {run_id} not found")))?;
    if run.status != "queued" {
        return Err(AppError::Conflict(
            "message execution has already started".to_string(),
        ));
    }
    let updated = sqlx::query_as::<_, SessionRunInputRow>(
        r#"UPDATE session_run_inputs SET content = $2
           WHERE id = $1 AND status = 'queued'
           RETURNING id, session_id, client_request_id, target_run_id, kind,
                     content, options, status, sequence, created_at, applied_at"#,
    )
    .bind(input_id)
    .bind(text)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE agent_runs SET objective = $2 WHERE id = $1 AND status = 'queued'")
        .bind(run_id)
        .bind(truncate_chars(&redact_sensitive_text(text), 240))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    state.agent_run_notify.notify_waiters();
    Ok(input_to_view(updated))
}

pub async fn cancel_queued_input(
    state: &AppState,
    input_id: Uuid,
) -> AppResult<SessionRunInputView> {
    let mut tx = state.db.begin().await?;
    let input = fetch_input_for_update(&mut tx, input_id).await?;
    if input.status == "cancelled" {
        tx.commit().await?;
        return Ok(input_to_view(input));
    }
    if input.status != "queued" {
        return Err(AppError::Conflict(
            "message execution has already started; cancel its run instead".to_string(),
        ));
    }
    let cancelled_run_id = input.target_run_id;
    if let Some(run_id) = cancelled_run_id {
        let status = sqlx::query_scalar::<_, String>(
            "SELECT status FROM agent_runs WHERE id = $1 FOR UPDATE",
        )
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent run {run_id} not found")))?;
        if status != "queued" {
            return Err(AppError::Conflict(
                "message execution has already started; cancel its run instead".to_string(),
            ));
        }
        sqlx::query(
            r#"UPDATE agent_runs
               SET status = 'cancelled', cancel_requested_at = COALESCE(cancel_requested_at, now()),
                   cancel_requested_by = COALESCE(cancel_requested_by, 'user'),
                   completed_at = now(), error_code = 'cancelled_by_user'
               WHERE id = $1 AND status = 'queued'"#,
        )
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
    }
    let cancelled = sqlx::query_as::<_, SessionRunInputRow>(
        r#"UPDATE session_run_inputs SET status = 'cancelled'
           WHERE id = $1 AND status = 'queued'
           RETURNING id, session_id, client_request_id, target_run_id, kind,
                     content, options, status, sequence, created_at, applied_at"#,
    )
    .bind(input_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    if let Some(run_id) = cancelled_run_id {
        let event = ChatSseEvent::RunStatus {
            run_id: run_id.to_string(),
            status: "cancelled".to_string(),
            cancel_requested: true,
        };
        append_event(
            state,
            run_id,
            "run_finished",
            serde_json::to_value(event).map_err(|err| {
                AppError::Internal(format!("cancel event serialization failed: {err}"))
            })?,
            Some("run-finished"),
        )
        .await?;
    }
    state.agent_run_notify.notify_waiters();
    Ok(input_to_view(cancelled))
}

async fn fetch_input_for_update(
    tx: &mut Transaction<'_, Postgres>,
    input_id: Uuid,
) -> AppResult<SessionRunInputRow> {
    sqlx::query_as::<_, SessionRunInputRow>(
        r#"SELECT id, session_id, client_request_id, target_run_id, kind,
                  content, options, status, sequence, created_at, applied_at
           FROM session_run_inputs WHERE id = $1 FOR UPDATE"#,
    )
    .bind(input_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("session run input {input_id} not found")))
}

async fn validate_run_origin(state: &AppState, run: &AgentRunRow) -> AppResult<()> {
    if let Some(session_id) = run.session_id {
        let valid = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                 SELECT 1 FROM chat_sessions s
                 INNER JOIN native_agents a ON a.profile = s.profile
                 WHERE s.id = $1 AND s.profile = $2
                   AND ($3::uuid IS NULL OR s.project_id IS NOT DISTINCT FROM $3)
               )"#,
        )
        .bind(session_id)
        .bind(&run.agent_profile)
        .bind(run.project_id)
        .fetch_one(&state.db)
        .await?;
        if !valid {
            return Err(AppError::Conflict(
                "run origin no longer matches its session, agent, or project".to_string(),
            ));
        }
    }
    Ok(())
}

async fn fetch_input_by_client_request(
    tx: &mut Transaction<'_, Postgres>,
    session_id: Uuid,
    client_request_id: &str,
) -> AppResult<SessionRunInputRow> {
    sqlx::query_as::<_, SessionRunInputRow>(
        r#"SELECT id, session_id, client_request_id, target_run_id, kind,
                  content, options, status, sequence, created_at, applied_at
           FROM session_run_inputs
           WHERE session_id = $1 AND client_request_id = $2"#,
    )
    .bind(session_id)
    .bind(client_request_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(Into::into)
}

async fn insert_chat_run(
    tx: &mut Transaction<'_, Postgres>,
    session: &SessionIdentityRow,
    input: &SessionRunInputRow,
) -> AppResult<AgentRunRow> {
    let objective = truncate_chars(&redact_sensitive_text(&input.content), 240);
    sqlx::query_as::<_, AgentRunRow>(&format!(
        r#"INSERT INTO agent_runs
             (session_id, agent_profile, trigger_type, trigger_ref, project_id,
              objective, prompt_version, authorization_context)
           VALUES ($1, $2, 'chat', $3, $4, $5, $6, $7)
           RETURNING {}"#,
        run_columns()
    ))
    .bind(input.session_id)
    .bind(&session.profile)
    .bind(input.id.to_string())
    .bind(session.project_id)
    .bind(objective)
    .bind(PROMPT_VERSION)
    .bind(serde_json::json!({
        "explicitUserAction": true,
        "budget": {
            "maxToolCalls": INTERACTIVE_MAX_TOOL_CALLS,
            "maxRuntimeSeconds": INTERACTIVE_MAX_RUNTIME_SECONDS,
            "maxTotalTokens": INTERACTIVE_MAX_TOTAL_TOKENS,
        }
    }))
    .fetch_one(&mut **tx)
    .await
    .map_err(Into::into)
}

async fn fetch_run_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> AppResult<Option<AgentRunRow>> {
    sqlx::query_as::<_, AgentRunRow>(&format!("{} WHERE id = $1", run_select()))
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(Into::into)
}
