//! Durable user Decisions and queue-based run resume.
//!
//! A Decision is written before a run releases its lease. Resolving it never
//! depends on an open browser or one-shot channel: the transaction records the
//! answer and moves a suspended run back to the durable queue.

mod projection;
mod target;
mod validation;

use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine as _;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::execution::{DecisionCoordinator, DurableDecision, ToolExecutionContext};
use crate::agent::providers::Message;
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::models::decision::{
    DecisionView, DecisionsQuery, DecisionsResponse, ResolveDecisionResponse,
};
use crate::services::agent_runs;
use crate::state::AppState;

use self::projection::{row_to_durable, row_to_view, truncate};
use self::target::{hash_value, versions_equal};
use self::validation::{validate_answer_not_secret, validate_choice, validate_prompt_not_secret};

const MAX_QUESTION_CHARS: usize = 4_000;
const MAX_CONTEXT_CHARS: usize = 8_000;

#[derive(Debug, Clone, FromRow)]
pub(super) struct DecisionRow {
    id: Uuid,
    run_id: Uuid,
    session_id: Option<Uuid>,
    cron_job_id: Option<String>,
    kind: String,
    context: String,
    reason: String,
    question: String,
    choices: Value,
    suspend: bool,
    status: String,
    answer: Option<Value>,
    expires_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
}

pub fn coordinator(state: AppState) -> Arc<dyn DecisionCoordinator> {
    Arc::new(DurableDecisionCoordinator { state })
}

pub async fn list_decisions(
    state: &AppState,
    query: DecisionsQuery,
) -> AppResult<DecisionsResponse> {
    if query.status.as_deref().is_some_and(|status| {
        !matches!(
            status,
            "pending" | "resolved" | "dismissed" | "expired" | "cancelled" | "superseded"
        )
    }) {
        return Err(AppError::BadRequest(
            "invalid decision status filter".to_string(),
        ));
    }
    if query
        .kind
        .as_deref()
        .is_some_and(|kind| !matches!(kind, "choice" | "input"))
    {
        return Err(AppError::BadRequest(
            "invalid decision kind filter".to_string(),
        ));
    }
    if !(1..=100).contains(&query.limit) {
        return Err(AppError::BadRequest(
            "decision limit must be between 1 and 100".to_string(),
        ));
    }
    let cursor = query
        .cursor
        .as_deref()
        .map(decode_decision_cursor)
        .transpose()?;
    if cursor
        .as_ref()
        .is_some_and(|cursor| !cursor.matches_query(&query))
    {
        return Err(AppError::BadRequest(
            "decision cursor does not match the active filters".to_string(),
        ));
    }
    let cursor_pending_rank = cursor.as_ref().map(|cursor| cursor.pending_rank);
    let cursor_blocking_rank = cursor.as_ref().map(|cursor| cursor.blocking_rank);
    let cursor_created_at = cursor.as_ref().map(|cursor| cursor.created_at);
    let cursor_id = cursor.as_ref().map(|cursor| cursor.id);
    let fetch_limit = query.limit + 1;
    let mut rows = sqlx::query_as::<_, DecisionRow>(
        r#"SELECT d.id, d.run_id, d.session_id, d.cron_job_id, d.kind,
                  d.context, d.reason, d.question, d.choices, d.suspend,
                  d.status, d.answer, d.expires_at,
                  d.created_at, d.resolved_at
           FROM decisions d
           INNER JOIN agent_runs r ON r.id = d.run_id
           WHERE d.kind IN ('choice', 'input')
             AND ($1::text IS NULL OR d.status = $1)
             AND ($2::uuid IS NULL OR d.run_id = $2)
             AND ($3::uuid IS NULL OR d.session_id = $3)
             AND ($4::text IS NULL OR r.agent_profile = $4)
             AND ($5::text IS NULL OR d.kind = $5)
             AND ($6::boolean IS NULL OR d.suspend = $6)
             AND ($7::uuid IS NULL OR r.project_id = $7)
             AND (
                 $8::smallint IS NULL OR
                 (CASE WHEN d.status = 'pending' THEN 0 ELSE 1 END,
                  CASE WHEN d.status = 'pending' AND d.suspend THEN 0 ELSE 1 END,
                  d.created_at, d.id)
                 > ($8::smallint, $9::smallint, $10::timestamptz, $11::uuid)
             )
           ORDER BY CASE WHEN d.status = 'pending' THEN 0 ELSE 1 END ASC,
                    CASE WHEN d.status = 'pending' AND d.suspend THEN 0 ELSE 1 END ASC,
                    d.created_at ASC, d.id ASC
           LIMIT $12"#,
    )
    .bind(query.status.as_deref())
    .bind(query.run_id)
    .bind(query.session_id)
    .bind(query.agent_profile.as_deref())
    .bind(query.kind.as_deref())
    .bind(query.blocking)
    .bind(query.project_id)
    .bind(cursor_pending_rank)
    .bind(cursor_blocking_rank)
    .bind(cursor_created_at)
    .bind(cursor_id)
    .bind(fetch_limit)
    .fetch_all(&state.db)
    .await?;
    let has_more = rows.len() > query.limit as usize;
    if has_more {
        rows.pop();
    }
    let next_cursor = if has_more {
        rows.last()
            .map(|row| encode_decision_cursor(DecisionCursor::for_row(row, &query)))
            .transpose()?
    } else {
        None
    };
    let filtered_pending_count = filtered_pending_count(state, &query).await?;
    Ok(DecisionsResponse {
        decisions: rows.into_iter().map(row_to_view).collect(),
        next_cursor,
        filtered_pending_count,
    })
}

pub async fn pending_decision_count(state: &AppState) -> AppResult<i64> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM decisions WHERE status = 'pending' AND kind IN ('choice', 'input')",
    )
    .fetch_one(&state.db)
    .await
    .map_err(Into::into)
}

async fn filtered_pending_count(state: &AppState, query: &DecisionsQuery) -> AppResult<i64> {
    sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*)
           FROM decisions d
           INNER JOIN agent_runs r ON r.id = d.run_id
           WHERE d.status = 'pending' AND d.kind IN ('choice', 'input')
             AND ($1::uuid IS NULL OR d.run_id = $1)
             AND ($2::uuid IS NULL OR d.session_id = $2)
             AND ($3::text IS NULL OR r.agent_profile = $3)
             AND ($4::text IS NULL OR d.kind = $4)
             AND ($5::boolean IS NULL OR d.suspend = $5)
             AND ($6::uuid IS NULL OR r.project_id = $6)"#,
    )
    .bind(query.run_id)
    .bind(query.session_id)
    .bind(query.agent_profile.as_deref())
    .bind(query.kind.as_deref())
    .bind(query.blocking)
    .bind(query.project_id)
    .fetch_one(&state.db)
    .await
    .map_err(Into::into)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionCursor {
    version: u8,
    pending_rank: i16,
    blocking_rank: i16,
    created_at: DateTime<Utc>,
    id: Uuid,
    status: Option<String>,
    kind: Option<String>,
    blocking: Option<bool>,
    run_id: Option<Uuid>,
    session_id: Option<Uuid>,
    agent_profile: Option<String>,
    project_id: Option<Uuid>,
}

impl DecisionCursor {
    fn for_row(row: &DecisionRow, query: &DecisionsQuery) -> Self {
        Self {
            version: 1,
            pending_rank: i16::from(row.status != "pending"),
            blocking_rank: i16::from(row.status != "pending" || !row.suspend),
            created_at: row.created_at,
            id: row.id,
            status: query.status.clone(),
            kind: query.kind.clone(),
            blocking: query.blocking,
            run_id: query.run_id,
            session_id: query.session_id,
            agent_profile: query.agent_profile.clone(),
            project_id: query.project_id,
        }
    }

    fn matches_query(&self, query: &DecisionsQuery) -> bool {
        self.version == 1
            && self.status == query.status
            && self.kind == query.kind
            && self.blocking == query.blocking
            && self.run_id == query.run_id
            && self.session_id == query.session_id
            && self.agent_profile == query.agent_profile
            && self.project_id == query.project_id
    }
}

fn encode_decision_cursor(cursor: DecisionCursor) -> AppResult<String> {
    let bytes = serde_json::to_vec(&cursor)
        .map_err(|error| AppError::Internal(format!("decision cursor encode failed: {error}")))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_decision_cursor(value: &str) -> AppResult<DecisionCursor> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| AppError::BadRequest("invalid decision cursor".to_string()))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::BadRequest("invalid decision cursor".to_string()))
}

pub async fn get_decision(state: &AppState, id: Uuid) -> AppResult<DecisionView> {
    let decision = fetch_decision(&state.db, id).await?;
    if decision.kind == "approval" {
        return Err(AppError::NotFound(format!("decision {id} not found")));
    }
    Ok(row_to_view(decision))
}

pub async fn resolve_decision(
    state: &AppState,
    id: Uuid,
    answer: Value,
    actor: &str,
) -> AppResult<ResolveDecisionResponse> {
    validate_answer_not_secret(&answer)?;
    let mut tx = state.db.begin().await?;
    let decision = fetch_decision_for_update(&mut tx, id).await?;
    if decision.kind == "approval" {
        return Err(AppError::Conflict(
            "legacy approval records are audit-only and cannot authorize execution".to_string(),
        ));
    }
    if decision.status != "pending" {
        tx.commit().await?;
        return Ok(ResolveDecisionResponse {
            decision: row_to_view(decision),
            applied: false,
        });
    }
    if decision
        .expires_at
        .is_some_and(|expires| expires <= Utc::now())
    {
        sqlx::query(
            "UPDATE decisions SET status = 'expired', resolved_at = now(), resolved_by = $2 WHERE id = $1",
        )
        .bind(id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(ResolveDecisionResponse {
            decision: get_decision(state, id).await?,
            applied: false,
        });
    }
    validate_choice(&decision, &answer)?;
    let run_status = sqlx::query_as::<_, (String, bool)>(
        r#"SELECT status, cancel_requested_at IS NOT NULL
           FROM agent_runs WHERE id = $1 FOR UPDATE"#,
    )
    .bind(decision.run_id)
    .fetch_one(&mut *tx)
    .await?;
    if run_status.1 || matches!(run_status.0.as_str(), "completed" | "failed" | "cancelled") {
        sqlx::query(
            "UPDATE decisions SET status = 'cancelled', resolved_at = now(), resolved_by = $2 WHERE id = $1",
        )
        .bind(id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(ResolveDecisionResponse {
            decision: get_decision(state, id).await?,
            applied: false,
        });
    }
    sqlx::query(
        r#"UPDATE decisions
           SET status = 'resolved', answer = $2, resolved_at = now(), resolved_by = $3
           WHERE id = $1 AND status = 'pending'"#,
    )
    .bind(id)
    .bind(&answer)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    release_checklist_blocker(&mut tx, id).await?;
    sqlx::query(
        r#"UPDATE agent_runs
           SET decision_inbox_revision = decision_inbox_revision + 1
           WHERE id = $1"#,
    )
    .bind(decision.run_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    agent_runs::append_event(
        state,
        decision.run_id,
        "decision_resolved",
        serde_json::json!({
            "type": "decision_resolved",
            "decision_id": id,
            "kind": decision.kind,
        }),
        Some(&format!("decision-resolved:{id}")),
    )
    .await?;
    let (profile, project_id) = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT agent_profile, project_id FROM agent_runs WHERE id = $1",
    )
    .bind(decision.run_id)
    .fetch_one(&state.db)
    .await?;
    crate::services::proactive::record_activity(
        state,
        Some(&profile),
        project_id,
        "decision_resolved",
        &id.to_string(),
    )
    .await?;
    requeue_waiting_run_after_decision(state, decision.run_id).await?;
    state.agent_run_notify.notify_waiters();
    Ok(ResolveDecisionResponse {
        decision: get_decision(state, id).await?,
        applied: true,
    })
}

pub async fn dismiss_decision(
    state: &AppState,
    id: Uuid,
    actor: &str,
) -> AppResult<ResolveDecisionResponse> {
    let mut tx = state.db.begin().await?;
    let decision = fetch_decision_for_update(&mut tx, id).await?;
    if decision.kind == "approval" {
        return Err(AppError::Conflict(
            "legacy approval records are audit-only and cannot resume execution".to_string(),
        ));
    }
    if decision.status != "pending" {
        tx.commit().await?;
        return Ok(ResolveDecisionResponse {
            decision: row_to_view(decision),
            applied: false,
        });
    }
    let run_status = sqlx::query_as::<_, (String, bool)>(
        r#"SELECT status, cancel_requested_at IS NOT NULL
           FROM agent_runs WHERE id = $1 FOR UPDATE"#,
    )
    .bind(decision.run_id)
    .fetch_one(&mut *tx)
    .await?;
    if matches!(run_status.0.as_str(), "completed" | "failed" | "cancelled") {
        sqlx::query(
            "UPDATE decisions SET status = 'cancelled', resolved_at = now(), resolved_by = $2 WHERE id = $1",
        )
        .bind(id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(ResolveDecisionResponse {
            decision: get_decision(state, id).await?,
            applied: false,
        });
    }
    let status = if run_status.1 {
        "cancelled"
    } else {
        "dismissed"
    };
    sqlx::query(
        r#"UPDATE decisions
           SET status = $2, resolved_at = now(), resolved_by = $3
           WHERE id = $1 AND status = 'pending'"#,
    )
    .bind(id)
    .bind(status)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    release_checklist_blocker(&mut tx, id).await?;
    if !run_status.1 {
        sqlx::query(
            r#"UPDATE agent_runs
               SET decision_inbox_revision = decision_inbox_revision + 1
               WHERE id = $1"#,
        )
        .bind(decision.run_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    requeue_waiting_run_after_decision(state, decision.run_id).await?;
    state.agent_run_notify.notify_waiters();
    Ok(ResolveDecisionResponse {
        decision: get_decision(state, id).await?,
        applied: true,
    })
}

#[derive(Debug)]
pub struct ResolvedDecisionInbox {
    pub revision: i64,
    pub messages: Vec<String>,
}

pub async fn resolved_answer_inbox(
    state: &AppState,
    run_id: Uuid,
) -> AppResult<ResolvedDecisionInbox> {
    let revision = sqlx::query_scalar::<_, i64>(
        "SELECT decision_inbox_revision FROM agent_runs WHERE id = $1",
    )
    .bind(run_id)
    .fetch_one(&state.db)
    .await?;
    let rows = sqlx::query_as::<_, (String, String, Option<Value>)>(
        r#"SELECT question, status, answer
           FROM decisions
           WHERE run_id = $1
             AND kind IN ('choice', 'input')
             AND (status IN ('dismissed', 'expired', 'superseded')
                  OR (status = 'resolved' AND answer IS NOT NULL))
           ORDER BY resolved_at, created_at"#,
    )
    .bind(run_id)
    .fetch_all(&state.db)
    .await?;
    let messages = rows
        .into_iter()
        .map(|(question, status, answer)| {
            let outcome = answer
                .map(|answer| format!("Resolved answer: {}", redact_sensitive_text(&answer.to_string())))
                .unwrap_or_else(|| format!("Decision status: {status}; do not ask the same question again unless live state materially changed."));
            format!(
                "Decision question: {}\n{outcome}",
                redact_sensitive_text(&question),
            )
        })
        .collect();
    Ok(ResolvedDecisionInbox { revision, messages })
}

#[cfg(test)]
pub async fn resolved_answers_for_run(state: &AppState, run_id: Uuid) -> AppResult<Vec<String>> {
    Ok(resolved_answer_inbox(state, run_id).await?.messages)
}

pub async fn mark_inbox_delivered(
    state: &AppState,
    run_id: Uuid,
    lease_epoch: i64,
    agent_profile: &str,
    revision: i64,
) -> AppResult<()> {
    let updated = sqlx::query(
        r#"UPDATE agent_runs
           SET decision_delivered_revision = GREATEST(decision_delivered_revision, $4)
           WHERE id = $1 AND lease_epoch = $2 AND lease_owner IS NOT NULL
             AND status = 'running' AND agent_profile = $3
             AND decision_inbox_revision >= $4"#,
    )
    .bind(run_id)
    .bind(lease_epoch)
    .bind(agent_profile)
    .bind(revision)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(AppError::Conflict(
            "decision inbox delivery lost its active Run lease".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct PendingDecision {
    pub id: Uuid,
    pub question: String,
    pub blocking: bool,
}

pub async fn pending_decision_for_run(
    state: &AppState,
    run_id: Uuid,
) -> AppResult<Option<PendingDecision>> {
    sqlx::query_as::<_, (Uuid, String, bool)>(
        r#"SELECT id, question, suspend
           FROM decisions
           WHERE run_id = $1 AND status = 'pending' AND kind IN ('choice', 'input')
           ORDER BY suspend DESC, created_at ASC
           LIMIT 1"#,
    )
    .bind(run_id)
    .fetch_optional(&state.db)
    .await
    .map(|row| {
        row.map(|(id, question, blocking)| PendingDecision {
            id,
            question,
            blocking,
        })
    })
    .map_err(Into::into)
}

async fn requeue_waiting_run_after_decision(state: &AppState, run_id: Uuid) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE agent_runs r
           SET status = 'queued', next_attempt_at = NULL
           WHERE r.id = $1 AND r.status = 'waiting_decision'
             AND r.cancel_requested_at IS NULL
             AND NOT EXISTS (
                 SELECT 1 FROM decisions d
                 WHERE d.run_id = r.id AND d.status = 'pending'
                   AND d.kind IN ('choice', 'input') AND d.suspend
             )"#,
    )
    .bind(run_id)
    .execute(&state.db)
    .await?;
    Ok(())
}

pub async fn validate_resource_target_version(
    state: &AppState,
    agent_profile: &str,
    resource_key: &str,
    expected: &str,
) -> AppResult<()> {
    let current = current_resource_version(state, agent_profile, resource_key).await?;
    if !current.is_some_and(|current| versions_equal(expected, &current)) {
        return Err(AppError::Conflict(
            "target changed before tool execution; read the live resource and retry".to_string(),
        ));
    }
    Ok(())
}

pub async fn expire_pending_decisions(state: &AppState) -> AppResult<usize> {
    let expired = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"UPDATE decisions
           SET status = 'expired', resolved_at = now(), resolved_by = 'system'
           WHERE status = 'pending' AND expires_at <= now()
           RETURNING id, run_id"#,
    )
    .fetch_all(&state.db)
    .await?;
    for (decision_id, run_id) in &expired {
        let mut tx = state.db.begin().await?;
        release_checklist_blocker(&mut tx, *decision_id).await?;
        sqlx::query(
            r#"UPDATE agent_runs
               SET decision_inbox_revision = decision_inbox_revision + 1
               WHERE id = $1"#,
        )
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
        let terminal = sqlx::query_as::<_, (String, Option<Uuid>)>(
            r#"UPDATE agent_runs
               SET status = 'failed', error_code = 'decision_expired', completed_at = now()
               WHERE id = $1 AND status = 'waiting_decision'
               RETURNING trigger_type, session_id"#,
        )
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await?;
        if terminal.is_some() {
            sqlx::query(
                r#"UPDATE session_run_inputs
                   SET status = 'applied', applied_at = COALESCE(applied_at, now())
                   WHERE target_run_id = $1 AND status = 'claimed'"#,
            )
            .bind(run_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        if let Some((trigger, session_id)) = terminal {
            if let Some(session_id) = session_id {
                crate::services::chat::save_run_status_message(
                    state,
                    *run_id,
                    session_id,
                    &format!("decision-expired:{decision_id}"),
                    "작업이 실패했습니다.\n사유: decision_expired — 필요한 사용자 판단이 만료되었습니다.\n실행 상태: failed\n다음 단계: 이 세션에서 현재 조건에 맞는 새 요청을 보내세요.",
                    serde_json::json!({
                        "type": "run_status",
                        "status": "failed",
                        "reasonCode": "decision_expired",
                        "decisionId": decision_id,
                        "agentRunId": run_id,
                    }),
                )
                .await?;
            }
            agent_runs::append_event(
                state,
                *run_id,
                "run_finished",
                serde_json::json!({
                    "type": "run_status",
                    "run_id": run_id,
                    "status": "failed",
                    "cancel_requested": false,
                    "error_code": "decision_expired",
                }),
                Some("run-finished"),
            )
            .await?;
            if trigger == "cron" {
                crate::services::cron::finalize_occurrence(state, *run_id, "failed").await?;
            }
            crate::services::runtime_memory::spawn_run_summary(state.clone(), *run_id);
        }
    }
    if !expired.is_empty() {
        state.agent_run_notify.notify_waiters();
    }
    Ok(expired.len())
}

struct DurableDecisionCoordinator {
    state: AppState,
}

async fn link_current_checklist_blocker(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    run_id: Uuid,
    decision_id: Uuid,
) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE run_checklist_items
           SET status = 'blocked', blocked_decision_id = $2
           WHERE run_id = $1 AND status = 'in_progress'"#,
    )
    .bind(run_id)
    .bind(decision_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn release_checklist_blocker(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    decision_id: Uuid,
) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE run_checklist_items
           SET status = 'pending', blocked_decision_id = NULL
           WHERE blocked_decision_id = $1 AND status = 'blocked'"#,
    )
    .bind(decision_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[async_trait]
impl DecisionCoordinator for DurableDecisionCoordinator {
    async fn create_choice(
        &self,
        context: &ToolExecutionContext,
        question: &str,
        choices: &[String],
        blocking: bool,
        messages: &[Message],
    ) -> Result<DurableDecision, String> {
        let question = question.trim();
        if question.is_empty() || question.chars().count() > MAX_QUESTION_CHARS {
            return Err("decision question must contain 1 to 4000 characters".to_string());
        }
        if let Some(progress) = &context.progress {
            progress.create_checkpoint(context, messages).await?;
        }
        let choices = choices
            .iter()
            .map(|choice| choice.trim())
            .filter(|choice| !choice.is_empty())
            .take(8)
            .map(str::to_string)
            .collect::<Vec<_>>();
        validate_prompt_not_secret(question, &choices).map_err(|error| error.to_string())?;
        let kind = if choices.is_empty() {
            "input"
        } else {
            "choice"
        };
        let dedupe_key = hash_value(&serde_json::json!({
            "runId": context.run_id,
            "kind": kind,
            "question": question.to_lowercase(),
            "choices": choices,
            "blocking": blocking,
        }))?;
        let mut tx = self.state.db.begin().await.map_err(|err| err.to_string())?;
        let run_valid = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                 SELECT 1 FROM agent_runs
                 WHERE id = $1 AND lease_epoch = $2 AND status = 'running'
                   AND cancel_requested_at IS NULL
               )"#,
        )
        .bind(context.run_id)
        .bind(context.lease_epoch)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        if !run_valid {
            return Err("run changed before decision creation".to_string());
        }
        if let Some(existing) = fetch_pending_by_dedupe(&mut tx, &dedupe_key)
            .await
            .map_err(|err| err.to_string())?
        {
            tx.commit().await.map_err(|err| err.to_string())?;
            return Ok(row_to_durable(existing));
        }
        if blocking {
            let superseded = sqlx::query_scalar::<_, Uuid>(
                r#"UPDATE decisions
                   SET status = 'superseded', resolved_at = now(), resolved_by = 'agent'
                   WHERE run_id = $1 AND status = 'pending' AND suspend
                   RETURNING id"#,
            )
            .bind(context.run_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|err| err.to_string())?;
            for decision_id in superseded {
                release_checklist_blocker(&mut tx, decision_id)
                    .await
                    .map_err(|err| err.to_string())?;
            }
        }
        let row = sqlx::query_as::<_, DecisionRow>(
            r#"INSERT INTO decisions
                 (run_id, session_id, kind, context, reason, question,
                  choices, suspend, dedupe_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id, run_id, session_id, cron_job_id, kind, context,
                         reason, question, choices, suspend, status, answer,
                         expires_at, created_at, resolved_at"#,
        )
        .bind(context.run_id)
        .bind(context.session_id)
        .bind(kind)
        .bind(truncate(
            &format!("Agent {} requires user input", context.agent_profile),
            MAX_CONTEXT_CHARS,
        ))
        .bind("The missing choice materially changes the run outcome.")
        .bind(question)
        .bind(serde_json::to_value(&choices).map_err(|err| err.to_string())?)
        .bind(blocking)
        .bind(&dedupe_key)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        link_current_checklist_blocker(&mut tx, context.run_id, row.id)
            .await
            .map_err(|err| err.to_string())?;
        tx.commit().await.map_err(|err| err.to_string())?;
        agent_runs::append_event_for_context(
            &self.state,
            context,
            "decision_created",
            serde_json::json!({
                "type": "decision_created",
                "decision_id": row.id,
                "kind": row.kind,
                "question": redact_sensitive_text(&row.question),
                "choices": row.choices,
                "blocking": row.suspend,
            }),
            Some(&format!("decision-created:{}", row.id)),
        )
        .await
        .map_err(|err| err.to_string())?;
        Ok(row_to_durable(row))
    }
}

async fn fetch_decision(pool: &sqlx::PgPool, id: Uuid) -> AppResult<DecisionRow> {
    sqlx::query_as::<_, DecisionRow>(
        r#"SELECT id, run_id, session_id, cron_job_id, kind, context, reason,
                  question, choices, suspend, status, answer,
                  expires_at, created_at, resolved_at
           FROM decisions WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("decision {id} not found")))
}

async fn fetch_decision_for_update(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: Uuid,
) -> AppResult<DecisionRow> {
    sqlx::query_as::<_, DecisionRow>(
        r#"SELECT id, run_id, session_id, cron_job_id, kind, context, reason,
                  question, choices, suspend, status, answer,
                  expires_at, created_at, resolved_at
           FROM decisions WHERE id = $1 FOR UPDATE"#,
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("decision {id} not found")))
}

async fn fetch_pending_by_dedupe(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    dedupe_key: &str,
) -> AppResult<Option<DecisionRow>> {
    sqlx::query_as::<_, DecisionRow>(
        r#"SELECT id, run_id, session_id, cron_job_id, kind, context, reason,
                  question, choices, suspend, status, answer,
                  expires_at, created_at, resolved_at
           FROM decisions WHERE dedupe_key = $1 AND status = 'pending'"#,
    )
    .bind(dedupe_key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Into::into)
}

async fn current_resource_version(
    state: &AppState,
    agent_profile: &str,
    resource_key: &str,
) -> AppResult<Option<String>> {
    let (kind, identifier) = resource_key.split_once(':').ok_or_else(|| {
        AppError::Conflict("versioned write target has an invalid resource key".to_string())
    })?;
    if identifier == "*" || identifier.trim().is_empty() {
        return Err(AppError::Conflict(
            "versioned write target cannot be identified".to_string(),
        ));
    }
    if kind == "file" {
        let logical_path = if identifier.starts_with("/drive/") {
            identifier.to_string()
        } else {
            format!(
                "{}/{}",
                crate::services::drive::logical_agent_path(agent_profile),
                identifier.trim_start_matches('/')
            )
        };
        let resolved = crate::services::drive::resolve_drive_path(
            &state.config.agent_data_dir,
            &logical_path,
        )?;
        if !resolved.physical_path.is_file() {
            return Ok(None);
        }
        let fingerprint =
            crate::services::file_observations::fingerprint_path(&resolved.physical_path)
                .await
                .map_err(AppError::Conflict)?;
        return Ok(Some(fingerprint.hash));
    }
    if kind == "agent" {
        return Ok(sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT updated_at FROM native_agents WHERE profile = $1",
        )
        .bind(identifier)
        .fetch_optional(&state.db)
        .await?
        .map(|value| value.to_rfc3339()));
    }
    let id = Uuid::parse_str(identifier).map_err(|err| {
        AppError::Conflict(format!("versioned write target id is invalid: {err}"))
    })?;
    let version = match kind {
        "task" => resource_updated_at(state, "tasks", id).await?,
        "note" => resource_updated_at(state, "notes", id).await?,
        "goal" => resource_updated_at(state, "goals", id).await?,
        "calendar" => resource_updated_at(state, "calendar_events", id).await?,
        "knowledge" => resource_updated_at(state, "knowledge_articles", id).await?,
        "knowledge_resource" => resource_updated_at(state, "knowledge_resources", id).await?,
        "finance" => resource_updated_at(state, "transactions", id).await?,
        "cron" => resource_updated_at(state, "cron_jobs", id).await?,
        "investment" => {
            sqlx::query_scalar::<_, DateTime<Utc>>(
                r#"SELECT updated_at FROM (
                     SELECT updated_at FROM investment_accounts WHERE id = $1
                     UNION ALL SELECT updated_at FROM investment_assets WHERE id = $1
                     UNION ALL SELECT updated_at FROM investment_positions WHERE id = $1
                     UNION ALL SELECT updated_at FROM investment_cashflows WHERE id = $1
                   ) versions ORDER BY updated_at DESC LIMIT 1"#,
            )
            .bind(id)
            .fetch_optional(&state.db)
            .await?
        }
        _ => {
            return Err(AppError::Conflict(format!(
                "versioned write does not support resource type {kind}"
            )))
        }
    };
    Ok(version.map(|value| value.to_rfc3339()))
}

async fn resource_updated_at(
    state: &AppState,
    table: &str,
    id: Uuid,
) -> AppResult<Option<DateTime<Utc>>> {
    let query = match table {
        "tasks" => "SELECT updated_at FROM tasks WHERE id = $1 AND deleted_at IS NULL",
        "notes" => "SELECT updated_at FROM notes WHERE id = $1",
        "goals" => "SELECT updated_at FROM goals WHERE id = $1",
        "calendar_events" => "SELECT updated_at FROM calendar_events WHERE id = $1",
        "knowledge_articles" => "SELECT updated_at FROM knowledge_articles WHERE id = $1",
        "knowledge_resources" => "SELECT updated_at FROM knowledge_resources WHERE id = $1",
        "transactions" => "SELECT updated_at FROM transactions WHERE id = $1",
        "cron_jobs" => "SELECT updated_at FROM cron_jobs WHERE id = $1 AND deleted_at IS NULL",
        _ => {
            return Err(AppError::Internal(
                "unsupported resource version table".to_string(),
            ))
        }
    };
    Ok(sqlx::query_scalar::<_, DateTime<Utc>>(query)
        .bind(id)
        .fetch_optional(&state.db)
        .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "./migrations")]
    async fn inbox_cursor_keeps_blocking_priority_and_filter_scope(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        let mut run_ids = Vec::new();
        for objective in ["first", "second", "third"] {
            run_ids.push(
                sqlx::query_scalar::<_, Uuid>(
                    r#"INSERT INTO agent_runs
                         (agent_profile, trigger_type, status, objective, prompt_version)
                       VALUES ('inbox', 'wake', 'waiting_decision', $1, 'test')
                       RETURNING id"#,
                )
                .bind(objective)
                .fetch_one(&pool)
                .await
                .unwrap(),
            );
        }
        for (index, (run_id, suspend)) in run_ids.iter().zip([false, true, false]).enumerate() {
            sqlx::query(
                r#"INSERT INTO decisions
                     (run_id, kind, question, choices, suspend, created_at)
                   VALUES ($1, 'input', $2, '[]'::jsonb, $3,
                           TIMESTAMPTZ '2026-07-11 00:00:00+00' + $4 * INTERVAL '1 minute')"#,
            )
            .bind(run_id)
            .bind(format!("question-{index}"))
            .bind(suspend)
            .bind(index as i32)
            .execute(&pool)
            .await
            .unwrap();
        }

        let first = list_decisions(
            &state,
            DecisionsQuery {
                status: Some("pending".to_string()),
                kind: None,
                blocking: None,
                run_id: None,
                session_id: None,
                agent_profile: Some("inbox".to_string()),
                project_id: None,
                cursor: None,
                limit: 2,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.filtered_pending_count, 3);
        assert!(first.decisions[0].suspend);
        assert_eq!(first.decisions[1].question, "question-0");

        let second = list_decisions(
            &state,
            DecisionsQuery {
                status: Some("pending".to_string()),
                kind: None,
                blocking: None,
                run_id: None,
                session_id: None,
                agent_profile: Some("inbox".to_string()),
                project_id: None,
                cursor: first.next_cursor,
                limit: 2,
            },
        )
        .await
        .unwrap();
        assert_eq!(second.decisions.len(), 1);
        assert_eq!(second.decisions[0].question, "question-2");
        assert!(second.next_cursor.is_none());
        assert_eq!(pending_decision_count(&state).await.unwrap(), 3);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn legacy_approval_cannot_authorize_execution(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents
                 (profile, name, drive_path, sandbox_status)
               VALUES ('decision-test', 'Decision test',
                       '/drive/agents/decision-test', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_sessions (agent_id, profile)
               VALUES ('native-decision-test', 'decision-test') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let run_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO agent_runs
                 (session_id, agent_profile, trigger_type, status,
                  objective, prompt_version)
               VALUES ($1, 'decision-test', 'wake', 'waiting_decision',
                       'Review target', 'test') RETURNING id"#,
        )
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let task_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO tasks (title) VALUES ('Versioned target') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let resource_key = format!("task:{task_id}");
        let target_version = current_resource_version(&state, "decision-test", &resource_key)
            .await
            .unwrap()
            .unwrap();
        let proposed_action = serde_json::json!({
            "tool": "tasks_update",
            "effect": "update",
            "resourceKey": resource_key,
            "argumentsHash": "test",
        });
        let action_hash = hash_value(&proposed_action).unwrap();
        let decision_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO decisions
                 (run_id, session_id, kind, question, choices, suspend,
                  proposed_action, proposed_action_hash, target_version)
               VALUES ($1, $2, 'approval', 'Approve target update?',
                       '["approve", "reject"]'::jsonb, true, $3, $4, $5)
               RETURNING id"#,
        )
        .bind(run_id)
        .bind(session_id)
        .bind(&proposed_action)
        .bind(action_hash)
        .bind(target_version)
        .fetch_one(&pool)
        .await
        .unwrap();

        sqlx::query("UPDATE tasks SET updated_at = updated_at + interval '1 second' WHERE id = $1")
            .bind(task_id)
            .execute(&pool)
            .await
            .unwrap();
        let resolution = resolve_decision(
            &state,
            decision_id,
            Value::String("approve".to_string()),
            "user",
        )
        .await;
        assert!(matches!(resolution, Err(AppError::Conflict(_))));
        let run_status =
            sqlx::query_scalar::<_, String>("SELECT status FROM agent_runs WHERE id = $1")
                .bind(run_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_status, "waiting_decision");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn choice_resolution_resumes_once_and_duplicate_delivery_is_idempotent(
        pool: sqlx::PgPool,
    ) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents
                 (profile, name, drive_path, sandbox_status)
               VALUES ('decision-resume', 'Decision resume',
                       '/drive/agents/decision-resume', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_sessions (agent_id, profile)
               VALUES ('native-decision-resume', 'decision-resume') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let run_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO agent_runs
                 (session_id, agent_profile, trigger_type, status,
                  objective, prompt_version)
               VALUES ($1, 'decision-resume', 'chat', 'waiting_decision',
                       'Choose a deterministic path', 'test') RETURNING id"#,
        )
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let decision_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO decisions
                 (run_id, session_id, kind, question, choices, suspend)
               VALUES ($1, $2, 'choice', 'Choose one?',
                       '["first", "second"]'::jsonb, true)
               RETURNING id"#,
        )
        .bind(run_id)
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        let first = resolve_decision(
            &state,
            decision_id,
            Value::String("second".to_string()),
            "user",
        )
        .await
        .unwrap();
        let duplicate = resolve_decision(
            &state,
            decision_id,
            Value::String("second".to_string()),
            "user",
        )
        .await
        .unwrap();

        assert!(first.applied);
        assert!(!duplicate.applied);
        assert_eq!(first.decision.status, "resolved");
        assert_eq!(duplicate.decision.status, "resolved");
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM agent_runs WHERE id = $1")
                .bind(run_id)
                .fetch_one(&pool)
                .await
                .unwrap(),
            "queued"
        );
        assert_eq!(
            resolved_answers_for_run(&state, run_id).await.unwrap(),
            vec!["Decision question: Choose one?\nResolved answer: \"second\"".to_string()]
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM agent_run_events WHERE run_id = $1 AND event_type = 'decision_resolved'",
            )
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
    }

    fn test_config() -> crate::config::Config {
        crate::config::Config {
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
}
