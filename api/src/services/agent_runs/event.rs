//! Ordered, sanitized, idempotent durable run events.
//!
//! Event sequence allocation and payload redaction are one transaction. Lease-
//! owned producers pass a fencing token while command-side lifecycle events may
//! append without one only after their state transition has committed.

use serde_json::Value;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::agent::execution::ToolExecutionContext;
use crate::error::{AppError, AppResult};
use crate::models::agent_run::AgentRunEventView;
use crate::state::AppState;

use super::event_payload::sanitize_event_payload;
use super::projection::event_to_view;
use super::repository::fetch_run_row;
use super::{AgentRunEventRow, AgentRunRow};

const USER_VISIBILITY: &str = "user";
const AUDIT_VISIBILITY: &str = "audit";

pub(crate) async fn append_user_event(
    state: &AppState,
    run_id: Uuid,
    event_type: &str,
    payload: Value,
    idempotency_key: Option<&str>,
) -> AppResult<AgentRunEventView> {
    append_event_with_lease(
        state,
        run_id,
        None,
        USER_VISIBILITY,
        event_type,
        payload,
        idempotency_key,
    )
    .await
}

pub(crate) async fn append_user_event_for_lease(
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
        USER_VISIBILITY,
        event_type,
        payload,
        idempotency_key,
    )
    .await
}

pub(crate) async fn append_user_event_for_context(
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
    append_user_event_for_lease(state, &run, event_type, payload, idempotency_key).await
}

pub(crate) async fn append_audit_event_for_context(
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
    append_event_with_lease(
        state,
        run.id,
        Some(&run),
        AUDIT_VISIBILITY,
        event_type,
        payload,
        idempotency_key,
    )
    .await
}

async fn append_event_with_lease(
    state: &AppState,
    run_id: Uuid,
    lease: Option<&AgentRunRow>,
    visibility: &'static str,
    event_type: &str,
    payload: Value,
    idempotency_key: Option<&str>,
) -> AppResult<AgentRunEventView> {
    let append_started = std::time::Instant::now();
    let result = append_event_with_lease_inner(
        state,
        run_id,
        lease,
        visibility,
        event_type,
        payload,
        idempotency_key,
    )
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
    visibility: &'static str,
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
             (run_id, sequence, event_type, idempotency_key, visibility, payload)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, run_id, sequence, event_type, payload_version,
                     visibility, payload, created_at"#,
    )
    .bind(run_id)
    .bind(sequence)
    .bind(event_type)
    .bind(idempotency_key)
    .bind(visibility)
    .bind(payload)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    state.agent_run_notify.notify_waiters();
    Ok(event_to_view(row))
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

pub(crate) async fn insert_user_event_in_tx(
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
             (run_id, sequence, event_type, idempotency_key, visibility, payload)
           VALUES ($1, $2, $3, $4, 'user', $5)"#,
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
