//! Durable run lease transitions and stale-owner reconciliation.
//!
//! A lease epoch is the fencing token for every worker-owned transition. This
//! module keeps claim, heartbeat, pause, finish, and crash recovery under one
//! policy boundary so event persistence and worker orchestration cannot invent
//! subtly different ownership rules.

use serde_json::Value;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::chat::ChatSseEvent;
use crate::state::AppState;

use super::event_payload::sanitize_event_payload;
use super::repository::{run_columns, run_select};
use super::{append_event, insert_event_in_tx, AgentRunRow, RUN_LEASE_SECONDS};

const DURABLE_PROVIDER_RETRY_MINUTES: i32 = 30;

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
             AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
             AND (
               (r.lease_epoch = 0 AND i.status = 'queued')
               OR (r.lease_epoch > 0 AND i.status IN ('queued', 'claimed', 'applied'))
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
               heartbeat_at = now(), started_at = COALESCE(started_at, now()),
               next_attempt_at = NULL, error_code = NULL
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

/// Release a provider-blocked run without losing its stable request identity.
///
/// The worker must not occupy a lease or process slot during the 30-minute
/// interval. Re-queuing the same run preserves event history, makes retries
/// survive API restarts, and prevents a second user message from being created.
pub(super) async fn defer_run_for_provider_retry(
    state: &AppState,
    run: &AgentRunRow,
    message: &str,
) -> AppResult<()> {
    let mut tx = state.db.begin().await?;
    let scheduled = sqlx::query_as::<_, (chrono::DateTime<chrono::Utc>, i32)>(
        r#"UPDATE agent_runs
           SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
               heartbeat_at = now(),
               next_attempt_at = now() + make_interval(mins => $4),
               provider_retry_count = provider_retry_count + 1,
               error_code = 'provider_retry_scheduled'
           WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
             AND status = 'running' AND cancel_requested_at IS NULL
           RETURNING next_attempt_at, provider_retry_count"#,
    )
    .bind(run.id)
    .bind(run.lease_owner.as_deref())
    .bind(run.lease_epoch)
    .bind(DURABLE_PROVIDER_RETRY_MINUTES)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::Conflict(format!(
            "agent run {} lost its lease before provider retry scheduling",
            run.id
        ))
    })?;
    if run.trigger_type == "cron" {
        sqlx::query(
            "UPDATE cron_occurrences SET status = 'enqueued' WHERE run_id = $1 AND status = 'claimed'",
        )
        .bind(run.id)
        .execute(&mut *tx)
        .await?;
    }
    let event = ChatSseEvent::ProviderRetryScheduled {
        run_id: run.id.to_string(),
        retry_at: scheduled.0.to_rfc3339(),
        retry_count: scheduled.1,
        message: message.to_string(),
    };
    insert_event_in_tx(
        &mut tx,
        run.id,
        "provider_retry_scheduled",
        serde_json::to_value(event).map_err(|error| {
            AppError::Internal(format!(
                "provider retry event serialization failed: {error}"
            ))
        })?,
        Some(&format!("provider-retry-scheduled:{}", scheduled.1)),
    )
    .await?;
    tx.commit().await?;
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
    // A suspended run keeps its input claimed while it waits for a Decision;
    // the final lease, rather than the first lease, owns input completion.
    // This makes resumed work claimable without presenting terminal inputs as
    // permanently in flight.
    sqlx::query(
        r#"UPDATE session_run_inputs
           SET status = CASE WHEN $2 = 'cancelled' THEN 'cancelled' ELSE 'applied' END,
               applied_at = CASE WHEN $2 = 'cancelled' THEN applied_at ELSE COALESCE(applied_at, now()) END
           WHERE target_run_id = $1 AND status = 'claimed'"#,
    )
    .bind(run.id)
    .bind(status)
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
