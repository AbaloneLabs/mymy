//! Durable agent-run repository and orchestration boundary.
//!
//! Run state, queued session inputs, and replay events live in PostgreSQL.
//! HTTP connections and in-process notifications are projections over this
//! state and therefore never own execution lifetime or correctness.

mod commands;
mod event;
mod event_payload;
mod lease;
mod projection;
mod repository;
mod tool_guard;
mod worker;

use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

#[cfg(test)]
use crate::agent::execution::SessionTrigger;
use crate::agent::execution::{RunProgressStore, ToolExecutionContext};
use crate::agent::loop_engine::delegate::{
    DelegateRunCoordinator, DelegateRunHandle, DelegateTaskResult, DelegateTaskSpec,
};
use crate::agent::prompt::PROMPT_VERSION;
use crate::agent::providers::Message;
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
#[cfg(test)]
use crate::models::agent_run::EnqueueChatRunRequest;
use crate::models::agent_run::{
    AgentRunEventsResponse, AgentRunView, AgentRunsQuery, SessionRuntimeResponse,
};
use crate::models::chat::ChatSseEvent;
use crate::state::AppState;

pub use self::commands::{
    cancel_queued_input, enqueue_chat_run, request_cancel, update_queued_input,
};
pub(super) use self::event::append_event;
pub(crate) use self::event::append_event_for_context;
pub use worker::start_agent_run_worker;

use self::event::{append_event_for_lease, insert_event_in_tx};
use self::projection::{event_to_view, input_to_view, run_to_view, truncate_chars};
use self::repository::{fetch_run_row, run_columns, run_select};

use self::lease::{
    cancel_requested, claim_next_run, finish_run, heartbeat_run, pause_run_for_decision,
    reconcile_one_stale_run, update_run_snapshot,
};
pub(crate) use self::tool_guard::tool_execution_guard;

pub(crate) fn delegate_run_coordinator(state: AppState) -> Arc<dyn DelegateRunCoordinator> {
    Arc::new(DurableDelegateRunCoordinator { state })
}

pub(crate) fn run_progress_store(state: AppState) -> Arc<dyn RunProgressStore> {
    crate::services::run_progress::coordinator(state)
}

/// Claim one deterministic release-harness run through the same lease
/// transition used by the production worker. The helper exists only in a
/// feature-gated binary and deliberately refuses to claim a different queued
/// run, preventing fixture setup from reordering unrelated work.
#[cfg(feature = "release-harness")]
pub async fn claim_release_fixture_run(
    state: &AppState,
    expected_run_id: Uuid,
) -> AppResult<ToolExecutionContext> {
    let run = claim_next_run(state, "release-harness")
        .await?
        .ok_or_else(|| AppError::Conflict("release fixture run was not claimable".to_string()))?;
    if run.id != expected_run_id {
        return Err(AppError::Conflict(
            "release fixture would claim unrelated queued work".to_string(),
        ));
    }
    Ok(ToolExecutionContext {
        run_id: run.id,
        session_id: run.session_id,
        agent_profile: run.agent_profile,
        trigger: crate::agent::execution::SessionTrigger::Chat,
        project_id: run.project_id,
        authorization: serde_json::from_value(run.authorization_context).map_err(|error| {
            AppError::Internal(format!(
                "release fixture authorization decode failed: {error}"
            ))
        })?,
        invocation_id: format!("release-harness:{}:{}", run.id, run.lease_epoch),
        lease_epoch: run.lease_epoch,
        cancellation: crate::agent::execution::RunCancellation::new(),
        guard: None,
        progress: None,
        decisions: Some(crate::services::decisions::coordinator(state.clone())),
    })
}

#[cfg(feature = "release-harness")]
pub async fn complete_release_fixture_run(
    state: &AppState,
    context: &ToolExecutionContext,
) -> AppResult<()> {
    let run = fetch_run_row(&state.db, context.run_id).await?;
    finish_run(state, &run, "completed", None, serde_json::json!({})).await?;
    Ok(())
}

#[cfg(feature = "release-harness")]
pub async fn pause_release_fixture_run(
    state: &AppState,
    context: &ToolExecutionContext,
    decision_id: Uuid,
) -> AppResult<()> {
    let run = fetch_run_row(&state.db, context.run_id).await?;
    pause_run_for_decision(state, &run, &decision_id.to_string()).await
}

/// Finish every queued run owned by one release fixture after its Decisions
/// have been closed through the production coordinator. Cleanup intentionally
/// claims leases through the regular scheduler so it exercises the same
/// terminal transition and refuses to consume another agent's work.
#[cfg(any(test, feature = "release-harness"))]
pub async fn drain_release_fixture_runs(state: &AppState, profile: &str) -> AppResult<()> {
    loop {
        let remaining = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM agent_runs
               WHERE agent_profile = $1
                 AND status IN ('queued', 'running', 'waiting_decision')"#,
        )
        .bind(profile)
        .fetch_one(&state.db)
        .await?;
        if remaining == 0 {
            return Ok(());
        }
        let run = claim_next_run(state, "release-harness-cleanup")
            .await?
            .ok_or_else(|| {
                AppError::Conflict(
                    "release fixture has non-terminal work that is not claimable".to_string(),
                )
            })?;
        if run.agent_profile != profile {
            return Err(AppError::Conflict(
                "release fixture cleanup would claim unrelated queued work".to_string(),
            ));
        }
        finish_run(state, &run, "completed", None, serde_json::json!({})).await?;
    }
}

const MAX_CLIENT_REQUEST_ID_CHARS: usize = 128;
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
    pub tool_schema_fingerprint: Option<String>,
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

struct DurableDelegateRunCoordinator {
    state: AppState,
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
