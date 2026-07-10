//! Durable agent-run repository and orchestration boundary.
//!
//! Run state, queued session inputs, and replay events live in PostgreSQL.
//! HTTP connections and in-process notifications are projections over this
//! state and therefore never own execution lifetime or correctness.

mod worker;

use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::agent::execution::{
    RunProgressStore, SessionTrigger, ToolExecutionContext, ToolExecutionGuard,
};
use crate::agent::loop_engine::delegate::{
    DelegateRunCoordinator, DelegateRunHandle, DelegateTaskResult, DelegateTaskSpec,
};
use crate::agent::prompt::PROMPT_VERSION;
use crate::agent::providers::Message;
use crate::agent::security::redact_sensitive_text;
use crate::agent::tools::{ToolCapability, ToolEffect};
use crate::error::{AppError, AppResult};
use crate::models::agent_run::{
    AgentRunEventView, AgentRunEventsResponse, AgentRunView, AgentRunsQuery,
    CancelAgentRunResponse, EnqueueChatRunRequest, EnqueueChatRunResponse, SessionRunInputView,
    SessionRuntimeResponse, UpdateSessionRunInputRequest,
};
use crate::models::chat::ChatSseEvent;
use crate::state::AppState;

pub use worker::start_agent_run_worker;

pub(crate) fn delegate_run_coordinator(state: AppState) -> Arc<dyn DelegateRunCoordinator> {
    Arc::new(DurableDelegateRunCoordinator { state })
}

pub(crate) fn run_progress_store(state: AppState) -> Arc<dyn RunProgressStore> {
    crate::services::run_progress::coordinator(state)
}

const MAX_CLIENT_REQUEST_ID_CHARS: usize = 128;
const MAX_EVENT_PAYLOAD_BYTES: usize = 64 * 1024;
const RUN_LEASE_SECONDS: i64 = 30;
const INTERACTIVE_MAX_TOOL_CALLS: u32 = 500;
const INTERACTIVE_MAX_RUNTIME_SECONDS: u32 = 7_200;
const INTERACTIVE_MAX_TOTAL_TOKENS: u32 = 1_000_000;

#[derive(Debug, Clone, FromRow)]
pub(super) struct AgentRunRow {
    pub id: Uuid,
    pub session_id: Option<Uuid>,
    pub agent_profile: String,
    pub trigger_type: String,
    pub trigger_ref: Option<String>,
    pub parent_run_id: Option<Uuid>,
    pub parent_event_id: Option<Uuid>,
    pub delegate_index: Option<i32>,
    pub project_id: Option<Uuid>,
    pub status: String,
    pub objective: String,
    pub prompt_version: String,
    pub authorization_context: Value,
    pub lease_owner: Option<String>,
    pub lease_epoch: i64,
    pub next_event_sequence: i64,
    pub lease_expires_at: Option<DateTime<Utc>>,
    pub cancel_requested_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub heartbeat_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error_code: Option<String>,
    pub usage: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub(super) struct SessionRunInputRow {
    pub id: Uuid,
    pub session_id: Uuid,
    pub client_request_id: String,
    pub target_run_id: Option<Uuid>,
    pub kind: String,
    pub content: String,
    pub options: Value,
    pub status: String,
    pub sequence: i64,
    pub created_at: DateTime<Utc>,
    pub applied_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct AgentRunEventRow {
    id: Uuid,
    run_id: Uuid,
    sequence: i64,
    event_type: String,
    payload_version: i32,
    visibility: String,
    payload: Value,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct SessionIdentityRow {
    profile: String,
    project_id: Option<Uuid>,
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
        "SELECT profile, project_id FROM chat_sessions WHERE id = $1",
    )
    .bind(session_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("session {session_id} not found")))?;

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

pub async fn get_run(state: &AppState, id: Uuid) -> AppResult<AgentRunView> {
    fetch_run_row(&state.db, id).await.map(run_to_view)
}

pub async fn list_runs(state: &AppState, query: AgentRunsQuery) -> AppResult<Vec<AgentRunView>> {
    if query.status.as_deref().is_some_and(|status| {
        !matches!(
            status,
            "queued" | "running" | "waiting_decision" | "completed" | "failed" | "cancelled"
        )
    }) {
        return Err(AppError::BadRequest(
            "invalid run status filter".to_string(),
        ));
    }
    if query
        .trigger_type
        .as_deref()
        .is_some_and(|trigger| !matches!(trigger, "chat" | "cron" | "wake" | "delegate"))
    {
        return Err(AppError::BadRequest(
            "invalid run trigger filter".to_string(),
        ));
    }
    let rows = sqlx::query_as::<_, AgentRunRow>(&format!(
        r#"{} WHERE ($1::text IS NULL OR status = $1)
             AND ($2::text IS NULL OR trigger_type = $2)
             AND ($3::uuid IS NULL OR project_id = $3)
             AND ($4::text IS NULL OR agent_profile = $4)
           ORDER BY created_at DESC
           LIMIT $5"#,
        run_select()
    ))
    .bind(query.status)
    .bind(query.trigger_type)
    .bind(query.project_id)
    .bind(query.agent_profile)
    .bind(query.limit.clamp(1, 200))
    .fetch_all(&state.db)
    .await?;
    Ok(rows.into_iter().map(run_to_view).collect())
}

pub async fn list_child_runs(
    state: &AppState,
    parent_run_id: Uuid,
) -> AppResult<Vec<AgentRunView>> {
    fetch_run_row(&state.db, parent_run_id).await?;
    let rows = sqlx::query_as::<_, AgentRunRow>(&format!(
        r#"{} WHERE parent_run_id = $1
           ORDER BY parent_event_id, delegate_index, created_at"#,
        run_select()
    ))
    .bind(parent_run_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows.into_iter().map(run_to_view).collect())
}

pub async fn list_run_events(
    state: &AppState,
    id: Uuid,
    after_sequence: i64,
) -> AppResult<AgentRunEventsResponse> {
    let run = fetch_run_row(&state.db, id).await?;
    let rows = sqlx::query_as::<_, AgentRunEventRow>(
        r#"SELECT id, run_id, sequence, event_type, payload_version,
                  visibility, payload, created_at
           FROM agent_run_events
           WHERE run_id = $1 AND sequence > $2 AND visibility = 'user'
           ORDER BY sequence ASC
           LIMIT 1000"#,
    )
    .bind(id)
    .bind(after_sequence.max(0))
    .fetch_all(&state.db)
    .await?;
    let latest_sequence = sqlx::query_scalar::<_, i64>(
        r#"SELECT COALESCE(MAX(sequence), 0)
           FROM agent_run_events
           WHERE run_id = $1 AND visibility = 'user'"#,
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    Ok(AgentRunEventsResponse {
        run: run_to_view(run),
        events: rows.into_iter().map(event_to_view).collect(),
        latest_sequence,
    })
}

pub async fn get_session_runtime(
    state: &AppState,
    session_id: Uuid,
) -> AppResult<SessionRuntimeResponse> {
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id = $1)")
            .bind(session_id)
            .fetch_one(&state.db)
            .await?;
    if !exists {
        return Err(AppError::NotFound(format!(
            "session {session_id} not found"
        )));
    }
    let active_run = sqlx::query_as::<_, AgentRunRow>(&format!(
        "{} WHERE session_id = $1 AND trigger_type = 'chat' AND status IN ('running', 'waiting_decision') ORDER BY created_at ASC LIMIT 1",
        run_select()
    ))
    .bind(session_id)
    .fetch_optional(&state.db)
    .await?;
    let queued = sqlx::query_as::<_, SessionRunInputRow>(
        r#"SELECT id, session_id, client_request_id, target_run_id, kind,
                  content, options, status, sequence, created_at, applied_at
           FROM session_run_inputs
           WHERE session_id = $1 AND status IN ('queued', 'claimed')
           ORDER BY sequence ASC"#,
    )
    .bind(session_id)
    .fetch_all(&state.db)
    .await?;
    let latest_sequence = active_run
        .as_ref()
        .map(|run| run.next_event_sequence)
        .unwrap_or(0);
    Ok(SessionRuntimeResponse {
        active_run: active_run.map(run_to_view),
        queued_inputs: queued.into_iter().map(input_to_view).collect(),
        latest_sequence,
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
        "approvalCeiling": {},
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

pub(super) async fn fetch_run_row(pool: &sqlx::PgPool, id: Uuid) -> AppResult<AgentRunRow> {
    sqlx::query_as::<_, AgentRunRow>(&format!("{} WHERE id = $1", run_select()))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent run {id} not found")))
}

pub(super) async fn append_event(
    state: &AppState,
    run_id: Uuid,
    event_type: &str,
    payload: Value,
    idempotency_key: Option<&str>,
) -> AppResult<AgentRunEventView> {
    append_event_with_lease(state, run_id, None, event_type, payload, idempotency_key).await
}

pub(super) async fn append_event_for_lease(
    state: &AppState,
    run: &AgentRunRow,
    event_type: &str,
    payload: Value,
    idempotency_key: Option<&str>,
) -> AppResult<AgentRunEventView> {
    append_event_with_lease(
        state,
        run.id,
        Some(run),
        event_type,
        payload,
        idempotency_key,
    )
    .await
}

pub(crate) async fn append_event_for_context(
    state: &AppState,
    context: &ToolExecutionContext,
    event_type: &str,
    payload: Value,
    idempotency_key: Option<&str>,
) -> AppResult<AgentRunEventView> {
    let run = fetch_run_row(&state.db, context.run_id).await?;
    if run.lease_epoch != context.lease_epoch || run.status != "running" {
        return Err(AppError::Conflict(format!(
            "agent run {} lease ownership changed",
            context.run_id
        )));
    }
    append_event_for_lease(state, &run, event_type, payload, idempotency_key).await
}

async fn append_event_with_lease(
    state: &AppState,
    run_id: Uuid,
    lease: Option<&AgentRunRow>,
    event_type: &str,
    payload: Value,
    idempotency_key: Option<&str>,
) -> AppResult<AgentRunEventView> {
    let append_started = std::time::Instant::now();
    let result =
        append_event_with_lease_inner(state, run_id, lease, event_type, payload, idempotency_key)
            .await;
    metrics::histogram!("mymy_agent_event_append_duration_seconds")
        .record(append_started.elapsed().as_secs_f64());
    if result.is_err() {
        metrics::counter!("mymy_agent_event_append_failures_total").increment(1);
    }
    result
}

async fn append_event_with_lease_inner(
    state: &AppState,
    run_id: Uuid,
    lease: Option<&AgentRunRow>,
    event_type: &str,
    payload: Value,
    idempotency_key: Option<&str>,
) -> AppResult<AgentRunEventView> {
    if event_type == "reasoning_delta" {
        return Err(AppError::BadRequest(
            "raw reasoning events are not persistable".to_string(),
        ));
    }
    let payload = sanitize_event_payload(payload);
    let mut tx = state.db.begin().await?;
    let locked = match lease {
        Some(lease) => {
            sqlx::query_scalar::<_, Uuid>(
                r#"SELECT id FROM agent_runs
                   WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
                     AND status = 'running'
                   FOR UPDATE"#,
            )
            .bind(run_id)
            .bind(lease.lease_owner.as_deref())
            .bind(lease.lease_epoch)
            .fetch_optional(&mut *tx)
            .await?
        }
        None => {
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM agent_runs WHERE id = $1 FOR UPDATE")
                .bind(run_id)
                .fetch_optional(&mut *tx)
                .await?
        }
    };
    if locked.is_none() {
        return Err(AppError::Conflict(format!(
            "agent run {run_id} lease ownership changed"
        )));
    }
    if let Some(key) = idempotency_key {
        if let Some(existing) = fetch_event_by_idempotency_in_tx(&mut tx, run_id, key).await? {
            tx.commit().await?;
            return Ok(event_to_view(existing));
        }
    }
    let sequence = sqlx::query_scalar::<_, i64>(
        r#"UPDATE agent_runs
           SET next_event_sequence = next_event_sequence + 1
           WHERE id = $1
           RETURNING next_event_sequence"#,
    )
    .bind(run_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent run {run_id} not found")))?;
    let row = sqlx::query_as::<_, AgentRunEventRow>(
        r#"INSERT INTO agent_run_events
             (run_id, sequence, event_type, idempotency_key, payload)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, run_id, sequence, event_type, payload_version,
                     visibility, payload, created_at"#,
    )
    .bind(run_id)
    .bind(sequence)
    .bind(event_type)
    .bind(idempotency_key)
    .bind(payload)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    state.agent_run_notify.notify_waiters();
    Ok(event_to_view(row))
}

pub(super) async fn reconcile_one_stale_run(state: &AppState) -> AppResult<bool> {
    let mut tx = state.db.begin().await?;
    let stale = sqlx::query_as::<_, AgentRunRow>(&format!(
        r#"{} WHERE status = 'running' AND lease_expires_at < now()
           ORDER BY lease_expires_at ASC
           FOR UPDATE SKIP LOCKED LIMIT 1"#,
        run_select()
    ))
    .fetch_optional(&mut *tx)
    .await?;
    let Some(run) = stale else {
        tx.commit().await?;
        return Ok(false);
    };
    metrics::counter!(
        "mymy_agent_run_lease_recoveries_total",
        "trigger" => run.trigger_type.clone(),
    )
    .increment(1);
    let pending_decision_id = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM decisions
           WHERE run_id = $1 AND status = 'pending' AND suspend
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(run.id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(decision_id) = pending_decision_id {
        sqlx::query(
            r#"UPDATE agent_runs
               SET status = 'waiting_decision', lease_owner = NULL,
                   lease_expires_at = NULL, heartbeat_at = now()
               WHERE id = $1 AND status = 'running'"#,
        )
        .bind(run.id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        append_event(
            state,
            run.id,
            "run_paused",
            serde_json::json!({
                "type": "run_status",
                "run_id": run.id,
                "status": "waiting_decision",
                "cancel_requested": false,
                "decision_id": decision_id,
            }),
            Some(&format!("run-paused:{decision_id}")),
        )
        .await?;
        if run.trigger_type == "cron" {
            crate::services::cron::mark_occurrence_waiting(state, run.id).await?;
        }
        state.agent_run_notify.notify_waiters();
        return Ok(true);
    }
    let has_unknown_effect = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
             SELECT 1
             FROM agent_run_events started
             WHERE started.run_id = $1
               AND started.event_type = 'tool_call_start'
               AND NOT EXISTS (
                 SELECT 1
                 FROM agent_run_events finished
                 WHERE finished.run_id = started.run_id
                   AND finished.event_type = 'tool_call_finish'
                   AND finished.payload->>'call_id' = started.payload->>'call_id'
               )
           )"#,
    )
    .bind(run.id)
    .fetch_one(&mut *tx)
    .await?;
    let retry_disabled = run.trigger_type == "cron"
        && run
            .authorization_context
            .get("retryPolicy")
            .and_then(Value::as_str)
            == Some("none");
    let reconciliation_failure =
        has_unknown_effect || run.trigger_type == "delegate" || retry_disabled;
    if reconciliation_failure {
        sqlx::query(
            r#"UPDATE agent_runs
               SET status = 'failed', completed_at = now(),
                   error_code = $2,
                   lease_owner = NULL, lease_expires_at = NULL
               WHERE id = $1"#,
        )
        .bind(run.id)
        .bind(if has_unknown_effect {
            "reconciliation_required"
        } else if retry_disabled {
            "retry_disabled"
        } else {
            "delegate_interrupted"
        })
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            r#"UPDATE agent_runs
               SET status = 'queued', lease_owner = NULL,
                   lease_expires_at = NULL, heartbeat_at = NULL
               WHERE id = $1"#,
        )
        .bind(run.id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE session_run_inputs SET status = 'queued' WHERE target_run_id = $1 AND status = 'claimed'",
        )
        .bind(run.id)
        .execute(&mut *tx)
        .await?;
        if run.trigger_type == "cron" {
            sqlx::query(
                "UPDATE cron_occurrences SET status = 'enqueued' WHERE run_id = $1 AND status = 'claimed'",
            )
            .bind(run.id)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    if has_unknown_effect {
        let event = ChatSseEvent::OutcomeUnknown {
            run_id: run.id.to_string(),
            message: "A tool effect may have completed before the worker lease was lost. Review the resulting state before retrying.".to_string(),
        };
        append_event(
            state,
            run.id,
            "tool_outcome_unknown",
            serde_json::to_value(event).map_err(|err| {
                AppError::Internal(format!("outcome event serialization failed: {err}"))
            })?,
            Some("stale-tool-outcome"),
        )
        .await?;
    }
    if reconciliation_failure {
        append_event(
            state,
            run.id,
            "run_finished",
            serde_json::to_value(ChatSseEvent::RunStatus {
                run_id: run.id.to_string(),
                status: "failed".to_string(),
                cancel_requested: run.cancel_requested_at.is_some(),
            })
            .map_err(|err| {
                AppError::Internal(format!(
                    "delegate recovery event serialization failed: {err}"
                ))
            })?,
            Some("run-finished"),
        )
        .await?;
        if run.trigger_type == "cron" {
            crate::services::cron::finalize_occurrence(state, run.id, "failed").await?;
        }
        crate::services::runtime_memory::spawn_run_summary(state.clone(), run.id);
    }
    state.agent_run_notify.notify_waiters();
    Ok(true)
}

pub(super) async fn claim_next_run(
    state: &AppState,
    worker_id: &str,
) -> AppResult<Option<AgentRunRow>> {
    if state.encryption_key.read().await.is_none() {
        return Ok(None);
    }
    let mut tx = state.db.begin().await?;
    let candidate = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT r.id
           FROM agent_runs r
           INNER JOIN session_run_inputs i ON i.target_run_id = r.id
           WHERE r.status = 'queued' AND r.trigger_type IN ('chat', 'cron', 'wake')
             AND (
               (r.lease_epoch = 0 AND i.status = 'queued')
               OR (r.lease_epoch > 0 AND i.status IN ('queued', 'applied'))
             )
             AND r.cancel_requested_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM agent_runs active
               WHERE active.session_id = r.session_id
                 AND active.trigger_type IN ('chat', 'cron', 'wake')
                 AND active.status IN ('running', 'waiting_decision')
             )
           ORDER BY i.sequence ASC
           FOR UPDATE OF r SKIP LOCKED
           LIMIT 1"#,
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some(id) = candidate else {
        tx.commit().await?;
        return Ok(None);
    };
    let run = sqlx::query_as::<_, AgentRunRow>(&format!(
        r#"UPDATE agent_runs
           SET status = 'running', lease_owner = $2,
               lease_epoch = lease_epoch + 1,
               lease_expires_at = now() + make_interval(secs => $3),
               heartbeat_at = now(), started_at = COALESCE(started_at, now())
           WHERE id = $1 AND status = 'queued'
           RETURNING {}"#,
        run_columns()
    ))
    .bind(id)
    .bind(worker_id)
    .bind(RUN_LEASE_SECONDS as f64)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE session_run_inputs SET status = 'claimed' WHERE target_run_id = $1 AND status = 'queued'",
    )
    .bind(run.id)
    .execute(&mut *tx)
    .await?;
    if run.trigger_type == "cron" {
        sqlx::query(
            r#"UPDATE cron_occurrences
               SET status = 'claimed', claimed_at = now(), attempts = attempts + 1
               WHERE run_id = $1 AND status IN ('enqueued', 'waiting_decision')"#,
        )
        .bind(run.id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Some(run))
}

pub(super) async fn load_trigger_input(
    state: &AppState,
    run: &AgentRunRow,
) -> AppResult<SessionRunInputRow> {
    sqlx::query_as::<_, SessionRunInputRow>(
        r#"SELECT id, session_id, client_request_id, target_run_id, kind,
                  content, options, status, sequence, created_at, applied_at
           FROM session_run_inputs WHERE target_run_id = $1"#,
    )
    .bind(run.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("run input for {} not found", run.id)))
}

pub(super) async fn mark_input_applied(state: &AppState, input_id: Uuid) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE session_run_inputs
           SET status = 'applied', applied_at = COALESCE(applied_at, now())
           WHERE id = $1"#,
    )
    .bind(input_id)
    .execute(&state.db)
    .await?;
    state.agent_run_notify.notify_waiters();
    Ok(())
}

pub(super) async fn update_run_snapshot(
    state: &AppState,
    run: &AgentRunRow,
    tool_schema_fingerprint: &str,
    prompt_chars: usize,
    tool_count: usize,
) -> AppResult<()> {
    let updated = sqlx::query(
        r#"UPDATE agent_runs
           SET tool_schema_fingerprint = $4,
               usage = usage || jsonb_build_object(
                 'promptChars', $5::bigint,
                 'toolCount', $6::bigint
               )
           WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3 AND status = 'running'"#,
    )
    .bind(run.id)
    .bind(run.lease_owner.as_deref())
    .bind(run.lease_epoch)
    .bind(tool_schema_fingerprint)
    .bind(i64::try_from(prompt_chars).unwrap_or(i64::MAX))
    .bind(i64::try_from(tool_count).unwrap_or(i64::MAX))
    .execute(&state.db)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(AppError::Conflict(format!(
            "agent run {} lease ownership changed",
            run.id
        )));
    }
    Ok(())
}

pub(super) async fn heartbeat_run(state: &AppState, run: &AgentRunRow) -> AppResult<bool> {
    let updated = sqlx::query(
        r#"UPDATE agent_runs
           SET heartbeat_at = now(),
               lease_expires_at = now() + make_interval(secs => $4)
           WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
             AND status = 'running'"#,
    )
    .bind(run.id)
    .bind(run.lease_owner.as_deref())
    .bind(run.lease_epoch)
    .bind(RUN_LEASE_SECONDS as f64)
    .execute(&state.db)
    .await?;
    Ok(updated.rows_affected() == 1)
}

pub(super) async fn cancel_requested(state: &AppState, run_id: Uuid) -> AppResult<bool> {
    sqlx::query_scalar::<_, bool>(
        "SELECT cancel_requested_at IS NOT NULL FROM agent_runs WHERE id = $1",
    )
    .bind(run_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent run {run_id} not found")))
}

pub(super) async fn finish_run(
    state: &AppState,
    run: &AgentRunRow,
    requested_status: &str,
    error_code: Option<&str>,
    usage: Value,
) -> AppResult<String> {
    let mut tx = state.db.begin().await?;
    let cancellation_requested = sqlx::query_scalar::<_, bool>(
        r#"SELECT cancel_requested_at IS NOT NULL
           FROM agent_runs
           WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
             AND status = 'running'
           FOR UPDATE"#,
    )
    .bind(run.id)
    .bind(run.lease_owner.as_deref())
    .bind(run.lease_epoch)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::Conflict(format!(
            "agent run {} terminal transition lost its lease",
            run.id
        ))
    })?;
    let status = if cancellation_requested {
        "cancelled"
    } else {
        requested_status
    };
    let terminal_payload = serde_json::to_value(ChatSseEvent::RunStatus {
        run_id: run.id.to_string(),
        status: status.to_string(),
        cancel_requested: cancellation_requested,
    })
    .map_err(|err| AppError::Internal(format!("terminal event serialization failed: {err}")))?;
    let terminal_payload = sanitize_event_payload(terminal_payload);
    let sequence = sqlx::query_scalar::<_, i64>(
        "UPDATE agent_runs SET next_event_sequence = next_event_sequence + 1 WHERE id = $1 RETURNING next_event_sequence",
    )
    .bind(run.id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO agent_run_events
             (run_id, sequence, event_type, idempotency_key, payload)
           VALUES ($1, $2, 'run_finished', 'run-finished', $3)"#,
    )
    .bind(run.id)
    .bind(sequence)
    .bind(terminal_payload)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE agent_runs
           SET status = $4,
               error_code = CASE WHEN $4 = 'cancelled' THEN 'cancelled_by_user' ELSE $5 END,
               usage = usage || $6, completed_at = now(), heartbeat_at = now(),
               lease_owner = NULL, lease_expires_at = NULL
           WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
             AND status = 'running'"#,
    )
    .bind(run.id)
    .bind(run.lease_owner.as_deref())
    .bind(run.lease_epoch)
    .bind(status)
    .bind(error_code)
    .bind(usage)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    state.agent_run_notify.notify_waiters();
    Ok(status.to_string())
}

pub(super) async fn pause_run_for_decision(
    state: &AppState,
    run: &AgentRunRow,
    decision_id: &str,
) -> AppResult<()> {
    let mut tx = state.db.begin().await?;
    let locked = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM agent_runs
           WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
             AND status = 'running' AND cancel_requested_at IS NULL
           FOR UPDATE"#,
    )
    .bind(run.id)
    .bind(run.lease_owner.as_deref())
    .bind(run.lease_epoch)
    .fetch_optional(&mut *tx)
    .await?;
    if locked.is_none() {
        return Err(AppError::Conflict(format!(
            "agent run {} lost its lease before decision pause",
            run.id
        )));
    }
    insert_event_in_tx(
        &mut tx,
        run.id,
        "run_paused",
        serde_json::json!({
            "type": "run_status",
            "run_id": run.id,
            "status": "waiting_decision",
            "cancel_requested": false,
            "decision_id": decision_id,
        }),
        Some(&format!("run-paused:{decision_id}")),
    )
    .await?;
    sqlx::query(
        r#"UPDATE agent_runs
           SET status = 'waiting_decision', heartbeat_at = now(),
               lease_owner = NULL, lease_expires_at = NULL
           WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
             AND status = 'running'"#,
    )
    .bind(run.id)
    .bind(run.lease_owner.as_deref())
    .bind(run.lease_epoch)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    state.agent_run_notify.notify_waiters();
    Ok(())
}

pub(super) async fn queue_message_projection(
    state: &AppState,
    run: &AgentRunRow,
    session_id: Uuid,
    messages: &[Message],
) -> AppResult<()> {
    let payload = serde_json::json!({
        "sessionId": session_id,
        "messages": messages,
    });
    sqlx::query(
        r#"INSERT INTO agent_run_message_outbox (run_id, projection_key, payload)
           SELECT $1, 'final-messages-v1', $2
           WHERE EXISTS (
             SELECT 1 FROM agent_runs
             WHERE id = $1 AND lease_owner = $3 AND lease_epoch = $4
               AND status = 'running'
           )
           ON CONFLICT (run_id, projection_key) DO NOTHING"#,
    )
    .bind(run.id)
    .bind(payload)
    .bind(run.lease_owner.as_deref())
    .bind(run.lease_epoch)
    .execute(&state.db)
    .await?;
    let queued = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1 FROM agent_run_message_outbox
             WHERE run_id = $1 AND projection_key = 'final-messages-v1'
           )"#,
    )
    .bind(run.id)
    .fetch_one(&state.db)
    .await?;
    if !queued {
        return Err(AppError::Conflict(format!(
            "agent run {} lease ownership changed before message projection",
            run.id
        )));
    }
    state.agent_run_notify.notify_waiters();
    Ok(())
}

pub(super) async fn apply_message_projection(
    state: &AppState,
    run_id: Uuid,
) -> AppResult<Option<crate::models::chat::ChatMessage>> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ProjectionPayload {
        session_id: Uuid,
        messages: Vec<Message>,
    }

    let payload = sqlx::query_scalar::<_, Value>(
        r#"SELECT payload FROM agent_run_message_outbox
           WHERE run_id = $1 AND projection_key = 'final-messages-v1'
             AND status <> 'applied'"#,
    )
    .bind(run_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(payload) = payload else {
        return Ok(None);
    };
    let projection: ProjectionPayload = serde_json::from_value(payload).map_err(|err| {
        AppError::Internal(format!("invalid agent run message projection: {err}"))
    })?;
    match crate::services::chat::save_agent_messages_for_run(
        state,
        run_id,
        projection.session_id,
        &projection.messages,
    )
    .await
    {
        Ok(message) => {
            sqlx::query(
                r#"UPDATE agent_run_message_outbox
                   SET status = 'applied', applied_at = now(), attempts = attempts + 1,
                       last_error_code = NULL
                   WHERE run_id = $1 AND projection_key = 'final-messages-v1'"#,
            )
            .bind(run_id)
            .execute(&state.db)
            .await?;
            Ok(message)
        }
        Err(err) => {
            sqlx::query(
                r#"UPDATE agent_run_message_outbox
                   SET status = CASE WHEN attempts >= 9 THEN 'failed' ELSE 'pending' END,
                       attempts = attempts + 1,
                       last_error_code = 'projection_apply_failed'
                   WHERE run_id = $1 AND projection_key = 'final-messages-v1'"#,
            )
            .bind(run_id)
            .execute(&state.db)
            .await?;
            Err(err)
        }
    }
}

pub(super) async fn apply_one_pending_projection(state: &AppState) -> AppResult<bool> {
    let run_id = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT run_id FROM agent_run_message_outbox
           WHERE status = 'pending'
           ORDER BY created_at ASC
           LIMIT 1"#,
    )
    .fetch_optional(&state.db)
    .await?;
    let Some(run_id) = run_id else {
        return Ok(false);
    };
    apply_message_projection(state, run_id).await?;
    Ok(true)
}

pub(super) async fn cancel_one_queued_run(state: &AppState) -> AppResult<bool> {
    let mut tx = state.db.begin().await?;
    let run = sqlx::query_as::<_, AgentRunRow>(&format!(
        r#"{} WHERE status IN ('queued', 'waiting_decision') AND cancel_requested_at IS NOT NULL
           ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1"#,
        run_select()
    ))
    .fetch_optional(&mut *tx)
    .await?;
    let Some(run) = run else {
        tx.commit().await?;
        return Ok(false);
    };
    sqlx::query(
        r#"UPDATE agent_runs
           SET status = 'cancelled', completed_at = now(), error_code = 'cancelled_by_user'
           WHERE id = $1 AND status IN ('queued', 'waiting_decision')"#,
    )
    .bind(run.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE session_run_inputs SET status = 'cancelled' WHERE target_run_id = $1 AND status IN ('queued', 'claimed')",
    )
    .bind(run.id)
    .execute(&mut *tx)
    .await?;
    if run.trigger_type == "cron" {
        sqlx::query(
            "UPDATE cron_occurrences SET status = 'cancelled', completed_at = now() WHERE run_id = $1",
        )
        .bind(run.id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        r#"UPDATE decisions SET status = 'cancelled', resolved_at = now(), resolved_by = 'system'
           WHERE run_id = $1 AND status = 'pending'"#,
    )
    .bind(run.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if run.trigger_type == "cron" {
        crate::services::cron::finalize_occurrence(state, run.id, "cancelled").await?;
    }
    let event = ChatSseEvent::RunStatus {
        run_id: run.id.to_string(),
        status: "cancelled".to_string(),
        cancel_requested: true,
    };
    append_event(
        state,
        run.id,
        "run_finished",
        serde_json::to_value(event).map_err(|err| {
            AppError::Internal(format!("cancel event serialization failed: {err}"))
        })?,
        Some("run-finished"),
    )
    .await?;
    crate::services::runtime_memory::spawn_run_summary(state.clone(), run.id);
    state.agent_run_notify.notify_waiters();
    Ok(true)
}

async fn fetch_event_by_idempotency_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    run_id: Uuid,
    key: &str,
) -> AppResult<Option<AgentRunEventRow>> {
    sqlx::query_as::<_, AgentRunEventRow>(
        r#"SELECT id, run_id, sequence, event_type, payload_version,
                  visibility, payload, created_at
           FROM agent_run_events
           WHERE run_id = $1 AND idempotency_key = $2"#,
    )
    .bind(run_id)
    .bind(key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Into::into)
}

fn sanitize_event_payload(mut payload: Value) -> Value {
    redact_json_strings(&mut payload);
    let exceeds_limit =
        serde_json::to_vec(&payload).is_ok_and(|bytes| bytes.len() > MAX_EVENT_PAYLOAD_BYTES);
    if exceeds_limit {
        truncated_event_envelope(&payload)
    } else {
        payload
    }
}

fn truncated_event_envelope(payload: &Value) -> Value {
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("error");
    let mut envelope = serde_json::Map::new();
    envelope.insert("type".to_string(), Value::String(event_type.to_string()));
    envelope.insert("truncated".to_string(), Value::Bool(true));
    for key in ["run_id", "call_id", "tool_name"] {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            envelope.insert(key.to_string(), Value::String(truncate_chars(value, 512)));
        }
    }
    let notice = "Event payload exceeded the persisted size limit.";
    match event_type {
        "text_delta" => {
            envelope.insert("content".to_string(), Value::String(notice.to_string()));
        }
        "tool_call_start" => {
            envelope.insert("arguments".to_string(), Value::String(notice.to_string()));
        }
        "tool_call_finish" => {
            envelope.insert("result".to_string(), Value::String(notice.to_string()));
            envelope.insert("error".to_string(), Value::Null);
        }
        _ => {
            envelope.insert("message".to_string(), Value::String(notice.to_string()));
        }
    }
    Value::Object(envelope)
}

fn redact_json_strings(value: &mut Value) {
    match value {
        Value::String(text) => *text = redact_sensitive_text(text),
        Value::Array(items) => items.iter_mut().for_each(redact_json_strings),
        Value::Object(map) => map.values_mut().for_each(redact_json_strings),
        _ => {}
    }
}

fn run_select() -> String {
    format!("SELECT {} FROM agent_runs", run_columns())
}

fn run_columns() -> &'static str {
    "id, session_id, agent_profile, trigger_type, trigger_ref, parent_run_id, \
     parent_event_id, delegate_index, project_id, status, objective, prompt_version, authorization_context, \
     lease_owner, lease_epoch, next_event_sequence, lease_expires_at, cancel_requested_at, started_at, \
     heartbeat_at, completed_at, error_code, usage, created_at"
}

fn run_to_view(row: AgentRunRow) -> AgentRunView {
    AgentRunView {
        id: row.id.to_string(),
        session_id: row.session_id.map(|id| id.to_string()),
        agent_profile: row.agent_profile,
        trigger_type: row.trigger_type,
        trigger_ref: row.trigger_ref,
        parent_run_id: row.parent_run_id.map(|id| id.to_string()),
        parent_event_id: row.parent_event_id.map(|id| id.to_string()),
        delegate_index: row.delegate_index,
        project_id: row.project_id.map(|id| id.to_string()),
        status: row.status,
        objective: row.objective,
        prompt_version: row.prompt_version,
        lease_epoch: row.lease_epoch,
        latest_sequence: row.next_event_sequence,
        lease_expires_at: row.lease_expires_at.map(|time| time.to_rfc3339()),
        cancel_requested_at: row.cancel_requested_at.map(|time| time.to_rfc3339()),
        started_at: row.started_at.map(|time| time.to_rfc3339()),
        heartbeat_at: row.heartbeat_at.map(|time| time.to_rfc3339()),
        completed_at: row.completed_at.map(|time| time.to_rfc3339()),
        error_code: row.error_code,
        usage: row.usage,
        created_at: row.created_at.to_rfc3339(),
    }
}

fn event_to_view(row: AgentRunEventRow) -> AgentRunEventView {
    AgentRunEventView {
        id: row.id.to_string(),
        run_id: row.run_id.to_string(),
        sequence: row.sequence,
        event_type: row.event_type,
        payload_version: row.payload_version,
        visibility: row.visibility,
        payload: row.payload,
        created_at: row.created_at.to_rfc3339(),
    }
}

fn input_to_view(row: SessionRunInputRow) -> SessionRunInputView {
    SessionRunInputView {
        id: row.id.to_string(),
        session_id: row.session_id.to_string(),
        client_request_id: row.client_request_id,
        target_run_id: row.target_run_id.map(|id| id.to_string()),
        kind: row.kind,
        content: row.content,
        options: row.options,
        status: row.status,
        sequence: row.sequence,
        created_at: row.created_at.to_rfc3339(),
        applied_at: row.applied_at.map(|time| time.to_rfc3339()),
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

struct DurableDelegateRunCoordinator {
    state: AppState,
}

pub(crate) struct DurableToolExecutionGuard {
    state: AppState,
}

pub(crate) fn tool_execution_guard(state: AppState) -> Arc<dyn ToolExecutionGuard> {
    Arc::new(DurableToolExecutionGuard { state })
}

#[async_trait]
impl ToolExecutionGuard for DurableToolExecutionGuard {
    async fn validate(
        &self,
        context: &ToolExecutionContext,
        _tool_name: &str,
        toolset: &str,
        capability: &ToolCapability,
        arguments: &Value,
    ) -> Result<(), String> {
        if context.cancellation.is_cancelled() {
            return Err("run cancellation was requested before tool start".to_string());
        }
        if matches!(context.trigger, SessionTrigger::Wake) && capability.effect != ToolEffect::Read
        {
            return Err(
                "proactive wake discovery is read-only; create a visible proposal instead"
                    .to_string(),
            );
        }
        let origin_valid = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                 SELECT 1
                 FROM agent_runs r
                 LEFT JOIN chat_sessions s ON s.id = r.session_id
                 INNER JOIN native_agents a ON a.profile = r.agent_profile
                 WHERE r.id = $1 AND r.lease_epoch = $2 AND r.status = 'running'
                   AND r.cancel_requested_at IS NULL
                   AND r.agent_profile = $3
                   AND r.project_id IS NOT DISTINCT FROM $4
                   AND r.session_id IS NOT DISTINCT FROM $5
                   AND (r.session_id IS NULL OR (
                     s.profile = r.agent_profile
                     AND s.project_id IS NOT DISTINCT FROM r.project_id
                   ))
               )"#,
        )
        .bind(context.run_id)
        .bind(context.lease_epoch)
        .bind(&context.agent_profile)
        .bind(context.project_id)
        .bind(context.session_id)
        .fetch_one(&self.state.db)
        .await
        .map_err(|err| format!("tool origin revalidation failed: {err}"))?;
        if !origin_valid {
            return Err(
                "run ownership, session, agent, or project changed before tool execution"
                    .to_string(),
            );
        }

        if let Some((domain, write)) = permission_domain_for_toolset(toolset) {
            let policy = crate::services::agent_permissions::load_policy(
                &self.state,
                &context.agent_profile,
            )
            .await
            .map_err(|err| format!("tool permission revalidation failed: {err}"))?;
            let permitted = if write {
                policy.can_write(domain)
            } else {
                policy.can_read(domain)
            };
            if !permitted {
                return Err("agent tool permission changed before execution".to_string());
            }
        }

        let autonomous = !matches!(context.trigger, SessionTrigger::Chat)
            || !context.authorization.explicit_user_action;
        let approval_required = capability.requires_approval(autonomous);
        let action =
            crate::agent::tools::proposed_action_descriptor(_tool_name, capability, arguments);
        let action_hash = crate::agent::tools::proposed_action_hash(&action);
        let expected_version = [
            "expectedVersion",
            "expectedFingerprint",
            "targetVersion",
            "version",
            "updatedAt",
        ]
        .into_iter()
        .find_map(|key| arguments.get(key))
        .or_else(|| {
            arguments.get("data").and_then(|data| {
                [
                    "expectedVersion",
                    "expectedFingerprint",
                    "targetVersion",
                    "version",
                    "updatedAt",
                ]
                .into_iter()
                .find_map(|key| data.get(key))
            })
        })
        .and_then(|value| match value {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            _ => None,
        });
        if capability.effect != ToolEffect::Read {
            if let Some(expected_version) = expected_version {
                crate::services::decisions::validate_resource_target_version(
                    &self.state,
                    &context.agent_profile,
                    &capability.resource_key(arguments),
                    &expected_version,
                )
                .await
                .map_err(|err| err.to_string())?;
            }
        }
        let approved = context
            .authorization
            .approval_ceiling
            .get("approvedActionHashes")
            .and_then(Value::as_array)
            .is_some_and(|hashes| {
                hashes
                    .iter()
                    .any(|hash| hash.as_str() == Some(&action_hash))
            });
        if approval_required && !approved {
            return Err(
                "this action requires a durable user decision before autonomous execution"
                    .to_string(),
            );
        }
        if approval_required && approved {
            crate::services::decisions::validate_approved_action_target(
                &self.state,
                context.run_id,
                &action_hash,
            )
            .await
            .map_err(|err| err.to_string())?;
        }
        Ok(())
    }
}

fn permission_domain_for_toolset(
    toolset: &str,
) -> Option<(crate::models::agent::AgentToolDomain, bool)> {
    let (domain, write) = toolset
        .strip_suffix("_read")
        .map(|domain| (domain, false))
        .or_else(|| toolset.strip_suffix("_write").map(|domain| (domain, true)))?;
    crate::services::agent_permissions::parse_domain(domain)
        .ok()
        .map(|domain| (domain, write))
}

#[async_trait]
impl DelegateRunCoordinator for DurableDelegateRunCoordinator {
    async fn start_children(
        &self,
        parent: &ToolExecutionContext,
        parent_invocation_id: &str,
        tasks: &[DelegateTaskSpec],
    ) -> Result<Vec<DelegateRunHandle>, String> {
        let mut tx = self.state.db.begin().await.map_err(|err| err.to_string())?;
        let parent_valid = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                 SELECT 1 FROM agent_runs
                 WHERE id = $1 AND lease_epoch = $2 AND status = 'running'
                   AND cancel_requested_at IS NULL
               )"#,
        )
        .bind(parent.run_id)
        .bind(parent.lease_epoch)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        if !parent_valid {
            return Err("parent run is no longer an active lease owner".to_string());
        }
        let parent_event_id = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id FROM agent_run_events
               WHERE run_id = $1 AND idempotency_key = $2"#,
        )
        .bind(parent.run_id)
        .bind(format!("tool-start:{parent_invocation_id}"))
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "parent delegate tool event is not durable yet".to_string())?;
        let lease_owner = format!("delegate:{}:{}", parent.run_id, parent.lease_epoch);
        let mut children = Vec::with_capacity(tasks.len());
        for task in tasks {
            let mut authorization = parent.authorization.clone();
            authorization.explicit_user_action = false;
            if let Some(value) = task.max_tool_calls {
                authorization.budget["maxToolCalls"] = Value::from(value);
            }
            if let Some(value) = task.max_total_tokens {
                authorization.budget["maxTotalTokens"] = Value::from(value);
            }
            let authorization = serde_json::to_value(authorization)
                .map_err(|err| format!("authorization serialization failed: {err}"))?;
            let delegate_index = i32::try_from(task.index)
                .map_err(|_| "delegate index exceeds database range".to_string())?;
            let row = sqlx::query_as::<_, AgentRunRow>(&format!(
                r#"INSERT INTO agent_runs
                     (session_id, agent_profile, trigger_type, trigger_ref,
                      parent_run_id, parent_event_id, delegate_index, project_id,
                      status, objective, prompt_version, authorization_context,
                      lease_owner, lease_epoch, lease_expires_at, started_at, heartbeat_at)
                   VALUES ($1, $2, 'delegate', $3, $4, $5, $6, $7,
                           'running', $8, $9, $10, $11, 1,
                           now() + make_interval(secs => $12), now(), now())
                   ON CONFLICT (parent_event_id, delegate_index)
                     WHERE parent_event_id IS NOT NULL
                   DO NOTHING
                   RETURNING {}"#,
                run_columns()
            ))
            .bind(parent.session_id)
            .bind(&parent.agent_profile)
            .bind(parent_invocation_id)
            .bind(parent.run_id)
            .bind(parent_event_id)
            .bind(delegate_index)
            .bind(parent.project_id)
            .bind(truncate_chars(&redact_sensitive_text(&task.goal), 240))
            .bind(PROMPT_VERSION)
            .bind(&authorization)
            .bind(&lease_owner)
            .bind(RUN_LEASE_SECONDS as f64)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|err| err.to_string())?
            .ok_or_else(|| {
                format!(
                    "delegate child {} already exists; automatic duplicate execution is blocked",
                    task.index
                )
            })?;
            children.push(row);
        }
        tx.commit().await.map_err(|err| err.to_string())?;

        let mut handles = Vec::with_capacity(children.len());
        for child in children {
            let cancellation = self
                .state
                .register_run_cancellation(child.id, child.lease_epoch)
                .await;
            if cancel_requested(&self.state, child.id)
                .await
                .map_err(|err| err.to_string())?
            {
                cancellation.cancel();
            }
            let started = serde_json::to_value(ChatSseEvent::RunStatus {
                run_id: child.id.to_string(),
                status: "running".to_string(),
                cancel_requested: cancellation.is_cancelled(),
            })
            .map_err(|err| err.to_string())?;
            append_event_for_lease(
                &self.state,
                &child,
                "run_started",
                started,
                Some("run-started"),
            )
            .await
            .map_err(|err| err.to_string())?;
            handles.push(DelegateRunHandle {
                run_id: child.id,
                parent_event_id,
                delegate_index: child.delegate_index.unwrap_or_default() as usize,
                lease_owner: child.lease_owner.unwrap_or_else(|| lease_owner.clone()),
                lease_epoch: child.lease_epoch,
                cancellation,
            });
        }
        Ok(handles)
    }

    async fn heartbeat_child(&self, handle: &DelegateRunHandle) -> Result<(), String> {
        let cancellation_requested = sqlx::query_scalar::<_, bool>(
            r#"UPDATE agent_runs
               SET heartbeat_at = now(),
                   lease_expires_at = now() + make_interval(secs => $4)
               WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
                 AND status = 'running'
               RETURNING cancel_requested_at IS NOT NULL"#,
        )
        .bind(handle.run_id)
        .bind(&handle.lease_owner)
        .bind(handle.lease_epoch)
        .bind(RUN_LEASE_SECONDS as f64)
        .fetch_optional(&self.state.db)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "delegate child lease ownership changed".to_string())?;
        if cancellation_requested {
            handle.cancellation.cancel();
        }
        Ok(())
    }

    async fn finish_child(
        &self,
        handle: &DelegateRunHandle,
        result: &DelegateTaskResult,
    ) -> Result<(), String> {
        let mut tx = self.state.db.begin().await.map_err(|err| err.to_string())?;
        let cancellation_requested = sqlx::query_scalar::<_, bool>(
            r#"SELECT cancel_requested_at IS NOT NULL FROM agent_runs
               WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
                 AND status = 'running'
               FOR UPDATE"#,
        )
        .bind(handle.run_id)
        .bind(&handle.lease_owner)
        .bind(handle.lease_epoch)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "delegate child terminal transition lost its lease".to_string())?;

        for event in &result.visible_events {
            insert_event_in_tx(
                &mut tx,
                handle.run_id,
                &event.event_type,
                event.payload.clone(),
                None,
            )
            .await
            .map_err(|err| err.to_string())?;
        }
        if !result.result.trim().is_empty() {
            insert_event_in_tx(
                &mut tx,
                handle.run_id,
                "text_delta",
                serde_json::to_value(ChatSseEvent::TextDelta {
                    content: result.result.clone(),
                })
                .map_err(|err| err.to_string())?,
                Some("delegate-result"),
            )
            .await
            .map_err(|err| err.to_string())?;
        }
        let status = if cancellation_requested {
            "cancelled"
        } else if result.status == "completed" {
            "completed"
        } else {
            "failed"
        };
        insert_event_in_tx(
            &mut tx,
            handle.run_id,
            "run_finished",
            serde_json::to_value(ChatSseEvent::RunStatus {
                run_id: handle.run_id.to_string(),
                status: status.to_string(),
                cancel_requested: cancellation_requested,
            })
            .map_err(|err| err.to_string())?,
            Some("run-finished"),
        )
        .await
        .map_err(|err| err.to_string())?;
        sqlx::query(
            r#"UPDATE agent_runs
               SET status = $4,
                   error_code = CASE
                     WHEN $4 = 'cancelled' THEN 'cancelled_by_parent'
                     WHEN $4 = 'failed' THEN 'delegate_failed'
                     ELSE NULL
                   END,
                   usage = $5, completed_at = now(), heartbeat_at = now(),
                   lease_owner = NULL, lease_expires_at = NULL
               WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
                 AND status = 'running'"#,
        )
        .bind(handle.run_id)
        .bind(&handle.lease_owner)
        .bind(handle.lease_epoch)
        .bind(status)
        .bind(serde_json::json!({
            "apiCalls": result.total_api_calls,
            "toolCalls": result.total_tool_calls,
        }))
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        tx.commit().await.map_err(|err| err.to_string())?;
        self.state
            .unregister_run_cancellation(handle.run_id, handle.lease_epoch)
            .await;
        self.state.agent_run_notify.notify_waiters();
        Ok(())
    }
}

async fn insert_event_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    run_id: Uuid,
    event_type: &str,
    payload: Value,
    idempotency_key: Option<&str>,
) -> AppResult<()> {
    let sequence = sqlx::query_scalar::<_, i64>(
        "UPDATE agent_runs SET next_event_sequence = next_event_sequence + 1 WHERE id = $1 RETURNING next_event_sequence",
    )
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO agent_run_events
             (run_id, sequence, event_type, idempotency_key, payload)
           VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(run_id)
    .bind(sequence)
    .bind(event_type)
    .bind(idempotency_key)
    .bind(sanitize_event_payload(payload))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    #[sqlx::test(migrations = "./migrations")]
    async fn enqueue_is_idempotent_and_orders_session_inputs(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        let session_id = seed_session(&pool).await;
        let request = EnqueueChatRunRequest {
            client_request_id: "request-1".to_string(),
            text: "Inspect the workspace".to_string(),
            use_moa: false,
            moa_preset_id: None,
        };

        let first = enqueue_chat_run(&state, session_id, request.clone())
            .await
            .unwrap();
        let duplicate = enqueue_chat_run(&state, session_id, request).await.unwrap();

        assert!(!first.deduplicated);
        assert!(duplicate.deduplicated);
        assert_eq!(first.input.id, duplicate.input.id);
        assert_eq!(first.run.unwrap().id, duplicate.run.unwrap().id);
        let counts = sqlx::query_as::<_, (i64, i64)>(
            "SELECT (SELECT COUNT(*) FROM session_run_inputs), (SELECT COUNT(*) FROM agent_runs)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(counts, (1, 1));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn event_sequence_and_idempotency_are_durable(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        let session_id = seed_session(&pool).await;
        let enqueued = enqueue_chat_run(
            &state,
            session_id,
            EnqueueChatRunRequest {
                client_request_id: "request-events".to_string(),
                text: "Inspect the workspace".to_string(),
                use_moa: false,
                moa_preset_id: None,
            },
        )
        .await
        .unwrap();
        let run_id = Uuid::parse_str(&enqueued.run.unwrap().id).unwrap();

        let first = append_event(
            &state,
            run_id,
            "run_started",
            serde_json::json!({"status": "running"}),
            Some("run-started"),
        )
        .await
        .unwrap();
        let duplicate = append_event(
            &state,
            run_id,
            "run_started",
            serde_json::json!({"status": "running"}),
            Some("run-started"),
        )
        .await
        .unwrap();
        let second = append_event(
            &state,
            run_id,
            "model_turn_started",
            serde_json::json!({}),
            None,
        )
        .await
        .unwrap();

        assert_eq!(first.id, duplicate.id);
        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn follow_up_has_its_own_run_identity_while_session_is_active(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        let session_id = seed_session(&pool).await;
        let first = enqueue_chat_run(
            &state,
            session_id,
            EnqueueChatRunRequest {
                client_request_id: "first".to_string(),
                text: "First message".to_string(),
                use_moa: false,
                moa_preset_id: None,
            },
        )
        .await
        .unwrap();
        let first_run_id = Uuid::parse_str(&first.run.unwrap().id).unwrap();
        sqlx::query(
            r#"UPDATE agent_runs SET status = 'running', lease_owner = 'test-worker',
                   lease_epoch = 1, lease_expires_at = now() + interval '30 seconds'
               WHERE id = $1"#,
        )
        .bind(first_run_id)
        .execute(&pool)
        .await
        .unwrap();

        let follow_up = enqueue_chat_run(
            &state,
            session_id,
            EnqueueChatRunRequest {
                client_request_id: "follow-up".to_string(),
                text: "Second message".to_string(),
                use_moa: true,
                moa_preset_id: None,
            },
        )
        .await
        .unwrap();
        let follow_up_run_id = Uuid::parse_str(&follow_up.run.unwrap().id).unwrap();

        assert_eq!(follow_up.input.kind, "follow_up");
        assert_ne!(first_run_id, follow_up_run_id);
        assert_eq!(
            follow_up.input.target_run_id.as_deref(),
            Some(follow_up_run_id.to_string().as_str())
        );
        let runtime = get_session_runtime(&state, session_id).await.unwrap();
        assert_eq!(runtime.active_run.unwrap().id, first_run_id.to_string());
        assert_eq!(runtime.queued_inputs.len(), 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn stale_lease_cannot_append_events(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        let session_id = seed_session(&pool).await;
        let enqueued = enqueue_chat_run(
            &state,
            session_id,
            EnqueueChatRunRequest {
                client_request_id: "lease".to_string(),
                text: "Lease test".to_string(),
                use_moa: false,
                moa_preset_id: None,
            },
        )
        .await
        .unwrap();
        let run_id = Uuid::parse_str(&enqueued.run.unwrap().id).unwrap();
        sqlx::query(
            r#"UPDATE agent_runs SET status = 'running', lease_owner = 'old', lease_epoch = 1,
                   lease_expires_at = now() + interval '30 seconds' WHERE id = $1"#,
        )
        .bind(run_id)
        .execute(&pool)
        .await
        .unwrap();
        let stale = fetch_run_row(&pool, run_id).await.unwrap();
        sqlx::query("UPDATE agent_runs SET lease_owner = 'new', lease_epoch = 2 WHERE id = $1")
            .bind(run_id)
            .execute(&pool)
            .await
            .unwrap();

        let error = append_event_for_lease(
            &state,
            &stale,
            "model_turn_started",
            serde_json::json!({"type": "model_turn_started"}),
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(error, AppError::Conflict(_)));
        let count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM agent_run_events WHERE run_id = $1")
                .bind(run_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn parent_cancel_propagates_to_durable_delegate_children(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        let session_id = seed_session(&pool).await;
        let enqueued = enqueue_chat_run(
            &state,
            session_id,
            EnqueueChatRunRequest {
                client_request_id: "delegate-parent".to_string(),
                text: "Delegate work".to_string(),
                use_moa: false,
                moa_preset_id: None,
            },
        )
        .await
        .unwrap();
        let run_id = Uuid::parse_str(&enqueued.run.unwrap().id).unwrap();
        sqlx::query(
            r#"UPDATE agent_runs SET status = 'running', lease_owner = 'parent-worker',
                   lease_epoch = 1, lease_expires_at = now() + interval '30 seconds'
               WHERE id = $1"#,
        )
        .bind(run_id)
        .execute(&pool)
        .await
        .unwrap();
        let parent_row = fetch_run_row(&pool, run_id).await.unwrap();
        let invocation_id = format!("{run_id}:1:delegate-call");
        append_event_for_lease(
            &state,
            &parent_row,
            "tool_call_start",
            serde_json::json!({"type":"tool_call_start","call_id":invocation_id}),
            Some(&format!("tool-start:{invocation_id}")),
        )
        .await
        .unwrap();
        let context = ToolExecutionContext {
            run_id,
            session_id: Some(session_id),
            agent_profile: "run-test".to_string(),
            trigger: SessionTrigger::Chat,
            project_id: parent_row.project_id,
            authorization: crate::agent::execution::AuthorizationContext {
                explicit_user_action: true,
                approval_ceiling: serde_json::json!({}),
                budget: serde_json::json!({}),
            },
            invocation_id: invocation_id.clone(),
            lease_epoch: 1,
            cancellation: crate::agent::execution::RunCancellation::new(),
            guard: None,
            progress: None,
            decisions: None,
        };
        let coordinator = DurableDelegateRunCoordinator {
            state: state.clone(),
        };
        let handles = coordinator
            .start_children(
                &context,
                &invocation_id,
                &[
                    DelegateTaskSpec {
                        index: 0,
                        goal: "Read A".to_string(),
                        context: None,
                        tools: Vec::new(),
                        max_turns: 1,
                        max_tool_calls: Some(1),
                        max_total_tokens: Some(1_000),
                    },
                    DelegateTaskSpec {
                        index: 1,
                        goal: "Read B".to_string(),
                        context: None,
                        tools: Vec::new(),
                        max_turns: 1,
                        max_tool_calls: Some(1),
                        max_total_tokens: Some(1_000),
                    },
                ],
            )
            .await
            .unwrap();

        let child_authorizations = sqlx::query_scalar::<_, Value>(
            r#"SELECT authorization_context FROM agent_runs
               WHERE parent_run_id = $1 ORDER BY delegate_index"#,
        )
        .bind(run_id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(child_authorizations.len(), 2);
        assert!(child_authorizations.iter().all(|authorization| {
            authorization
                .get("explicitUserAction")
                .and_then(Value::as_bool)
                == Some(false)
                && authorization
                    .pointer("/budget/maxToolCalls")
                    .and_then(Value::as_u64)
                    == Some(1)
                && authorization
                    .pointer("/budget/maxTotalTokens")
                    .and_then(Value::as_u64)
                    == Some(1_000)
        }));

        let cancelled = request_cancel(&state, run_id, "user").await.unwrap();
        assert!(cancelled.accepted);
        assert!(handles
            .iter()
            .all(|handle| handle.cancellation.is_cancelled()));
        let child_cancel_count = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM agent_runs
               WHERE parent_run_id = $1 AND cancel_requested_at IS NOT NULL"#,
        )
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(child_cancel_count, 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn completion_loses_to_a_durable_cancel_request(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        let session_id = seed_session(&pool).await;
        let enqueued = enqueue_chat_run(
            &state,
            session_id,
            EnqueueChatRunRequest {
                client_request_id: "cancel-race".to_string(),
                text: "Cancel race".to_string(),
                use_moa: false,
                moa_preset_id: None,
            },
        )
        .await
        .unwrap();
        let run_id = Uuid::parse_str(&enqueued.run.unwrap().id).unwrap();
        sqlx::query(
            r#"UPDATE agent_runs SET status = 'running', lease_owner = 'worker', lease_epoch = 1,
                   lease_expires_at = now() + interval '30 seconds' WHERE id = $1"#,
        )
        .bind(run_id)
        .execute(&pool)
        .await
        .unwrap();
        let run = fetch_run_row(&pool, run_id).await.unwrap();
        request_cancel(&state, run_id, "user").await.unwrap();

        let status = finish_run(&state, &run, "completed", None, serde_json::json!({}))
            .await
            .unwrap();
        assert_eq!(status, "cancelled");
        let persisted = fetch_run_row(&pool, run_id).await.unwrap();
        assert_eq!(persisted.status, "cancelled");
        let terminal_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM agent_run_events WHERE run_id = $1 AND event_type = 'run_finished'",
        )
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(terminal_count, 1);
    }

    fn test_config() -> Config {
        Config {
            database_url: String::new(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: std::env::temp_dir(),
            auth_cookie_secure: false,
            cron_tick_interval_secs: 60,
            cron_timezone: "UTC".to_string(),
            cron_output_keep: 10,
            drive_s3_bucket: None,
            drive_s3_region: None,
            drive_s3_endpoint: None,
            sandbox_runner_url: None,
            sandbox_preview_host: "127.0.0.1".to_string(),
        }
    }

    async fn seed_session(pool: &sqlx::PgPool) -> Uuid {
        sqlx::query(
            r#"INSERT INTO native_agents
                 (profile, name, drive_path, sandbox_status)
               VALUES ('run-test', 'Run test agent', '/drive/agents/run-test', 'ready')"#,
        )
        .execute(pool)
        .await
        .unwrap();
        let project_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO projects (name, drive_slug, drive_path)
               VALUES ('Run test', 'run-test', '/drive/projects/run-test')
               RETURNING id"#,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_sessions (project_id, agent_id, profile)
               VALUES ($1, 'native', 'run-test') RETURNING id"#,
        )
        .bind(project_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }
}
