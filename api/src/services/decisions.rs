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
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::execution::{DecisionCoordinator, DurableDecision, ToolExecutionContext};
use crate::agent::providers::Message;
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::models::decision::{DecisionView, DecisionsQuery, ResolveDecisionResponse};
use crate::services::agent_runs;
use crate::state::AppState;

use self::projection::{row_to_durable, row_to_view, truncate};
use self::target::{hash_value, versions_equal};
use self::validation::{
    validate_answer_not_secret, validate_choice, validate_proposed_action_hash,
};

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
    proposed_action: Option<Value>,
    proposed_action_hash: Option<String>,
    target_version: Option<String>,
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
) -> AppResult<Vec<DecisionView>> {
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
    let rows = sqlx::query_as::<_, DecisionRow>(
        r#"SELECT d.id, d.run_id, d.session_id, d.cron_job_id, d.kind,
                  d.context, d.reason, d.question, d.choices, d.suspend,
                  d.status, d.answer, d.dedupe_key, d.proposed_action,
                  d.proposed_action_hash, d.target_version, d.expires_at,
                  d.created_at, d.resolved_at
           FROM decisions d
           INNER JOIN agent_runs r ON r.id = d.run_id
           WHERE ($1::text IS NULL OR d.status = $1)
             AND ($2::uuid IS NULL OR d.run_id = $2)
             AND ($3::uuid IS NULL OR d.session_id = $3)
             AND ($4::text IS NULL OR r.agent_profile = $4)
           ORDER BY d.created_at DESC
           LIMIT $5"#,
    )
    .bind(query.status)
    .bind(query.run_id)
    .bind(query.session_id)
    .bind(query.agent_profile)
    .bind(query.limit.clamp(1, 200))
    .fetch_all(&state.db)
    .await?;
    Ok(rows.into_iter().map(row_to_view).collect())
}

pub async fn get_decision(state: &AppState, id: Uuid) -> AppResult<DecisionView> {
    fetch_decision(&state.db, id).await.map(row_to_view)
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
    validate_proposed_action_hash(&decision)?;
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
    if decision.kind == "approval" && !live_target_matches(state, &decision).await? {
        sqlx::query(
            "UPDATE decisions SET status = 'superseded', resolved_at = now(), resolved_by = $2 WHERE id = $1",
        )
        .bind(id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        release_checklist_blocker(&mut tx, id).await?;
        if decision.suspend {
            sqlx::query(
                r#"UPDATE agent_runs SET status = 'queued'
                   WHERE id = $1 AND status = 'waiting_decision'
                     AND cancel_requested_at IS NULL"#,
            )
            .bind(decision.run_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        agent_runs::append_event(
            state,
            decision.run_id,
            "decision_superseded",
            serde_json::json!({
                "type": "decision_superseded",
                "decision_id": id,
                "reason": "target_version_changed",
            }),
            Some(&format!("decision-superseded:{id}")),
        )
        .await?;
        state.agent_run_notify.notify_waiters();
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
    if decision.suspend {
        let updated = sqlx::query(
            r#"UPDATE agent_runs SET status = 'queued'
               WHERE id = $1 AND status = 'waiting_decision'
                 AND cancel_requested_at IS NULL"#,
        )
        .bind(decision.run_id)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Conflict(
                "waiting run changed before decision resolution".to_string(),
            ));
        }
    }
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
    if let Err(err) = crate::services::runtime_memory::create_decision_memory(state, id).await {
        tracing::warn!(error = %err, decision_id = %id, "failed to create decision memory candidate");
    }
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
    if decision.suspend && run_status.0 == "waiting_decision" && !run_status.1 {
        sqlx::query("UPDATE agent_runs SET status = 'queued' WHERE id = $1")
            .bind(decision.run_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    state.agent_run_notify.notify_waiters();
    Ok(ResolveDecisionResponse {
        decision: get_decision(state, id).await?,
        applied: true,
    })
}

pub async fn resolved_answers_for_run(state: &AppState, run_id: Uuid) -> AppResult<Vec<String>> {
    let rows = sqlx::query_as::<_, (String, String, Option<Value>)>(
        r#"SELECT question, status, answer
           FROM decisions
           WHERE run_id = $1
             AND (status = 'dismissed' OR (status = 'resolved' AND answer IS NOT NULL))
           ORDER BY resolved_at, created_at"#,
    )
    .bind(run_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
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
        .collect())
}

pub async fn approved_action_hashes(state: &AppState, run_id: Uuid) -> AppResult<Vec<String>> {
    sqlx::query_scalar::<_, String>(
        r#"SELECT proposed_action_hash
           FROM decisions
           WHERE run_id = $1 AND kind = 'approval' AND status = 'resolved'
             AND answer = '"approve"'::jsonb
             AND proposed_action_hash IS NOT NULL
           ORDER BY resolved_at, created_at"#,
    )
    .bind(run_id)
    .fetch_all(&state.db)
    .await
    .map_err(Into::into)
}

pub async fn validate_approved_action_target(
    state: &AppState,
    run_id: Uuid,
    action_hash: &str,
) -> AppResult<()> {
    let row = sqlx::query_as::<_, (Option<String>, Value, String)>(
        r#"SELECT d.target_version, d.proposed_action, r.agent_profile
           FROM decisions d
           INNER JOIN agent_runs r ON r.id = d.run_id
           WHERE d.run_id = $1 AND d.kind = 'approval'
             AND d.status = 'resolved' AND d.answer = '"approve"'::jsonb
             AND d.proposed_action_hash = $2
           ORDER BY d.resolved_at DESC LIMIT 1"#,
    )
    .bind(run_id)
    .bind(action_hash)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Conflict("approved action record is no longer valid".to_string()))?;
    if let Some(expected) = row.0 {
        let resource_key = row
            .1
            .get("resourceKey")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AppError::Conflict("approved action is missing its resource key".to_string())
            })?;
        let current = current_resource_version(state, &row.2, resource_key).await?;
        if !current.is_some_and(|current| versions_equal(&expected, &current)) {
            return Err(AppError::Conflict(
                "approved target changed after the Decision was resolved; request a new approval"
                    .to_string(),
            ));
        }
    }
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
    let expired = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE decisions
           SET status = 'expired', resolved_at = now(), resolved_by = 'system'
           WHERE status = 'pending' AND expires_at <= now()
           RETURNING run_id"#,
    )
    .fetch_all(&state.db)
    .await?;
    for run_id in &expired {
        let trigger = sqlx::query_scalar::<_, String>(
            r#"UPDATE agent_runs
               SET status = 'failed', error_code = 'decision_expired', completed_at = now()
               WHERE id = $1 AND status = 'waiting_decision'
               RETURNING trigger_type"#,
        )
        .bind(run_id)
        .fetch_optional(&state.db)
        .await?;
        if let Some(trigger) = trigger {
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
        sqlx::query(
            r#"UPDATE decisions
               SET status = 'superseded', resolved_at = now(), resolved_by = 'agent'
               WHERE run_id = $1 AND status = 'pending' AND suspend"#,
        )
        .bind(context.run_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        let row = sqlx::query_as::<_, DecisionRow>(
            r#"INSERT INTO decisions
                 (run_id, session_id, kind, context, reason, question,
                  choices, suspend, dedupe_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
               RETURNING id, run_id, session_id, cron_job_id, kind, context,
                         reason, question, choices, suspend, status, answer,
                         dedupe_key, proposed_action, proposed_action_hash,
                         target_version, expires_at, created_at, resolved_at"#,
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
            }),
            Some(&format!("decision-created:{}", row.id)),
        )
        .await
        .map_err(|err| err.to_string())?;
        Ok(row_to_durable(row))
    }

    async fn create_approval(
        &self,
        context: &ToolExecutionContext,
        question: &str,
        proposed_action: Value,
        target_version: Option<String>,
        messages: &[Message],
    ) -> Result<DurableDecision, String> {
        if let Some(progress) = &context.progress {
            progress.create_checkpoint(context, messages).await?;
        }
        let action_hash = hash_value(&proposed_action)?;
        let dedupe_key = hash_value(&serde_json::json!({
            "runId": context.run_id,
            "kind": "approval",
            "actionHash": action_hash,
            "targetVersion": target_version,
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
            return Err("run changed before approval creation".to_string());
        }
        if let Some(existing) = fetch_pending_by_dedupe(&mut tx, &dedupe_key)
            .await
            .map_err(|err| err.to_string())?
        {
            tx.commit().await.map_err(|err| err.to_string())?;
            return Ok(row_to_durable(existing));
        }
        sqlx::query(
            r#"UPDATE decisions
               SET status = 'superseded', resolved_at = now(), resolved_by = 'agent'
               WHERE run_id = $1 AND status = 'pending' AND suspend"#,
        )
        .bind(context.run_id)
        .execute(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        let row = sqlx::query_as::<_, DecisionRow>(
            r#"INSERT INTO decisions
                 (run_id, session_id, kind, context, reason, question,
                  choices, suspend, dedupe_key, proposed_action,
                  proposed_action_hash, target_version)
               VALUES ($1, $2, 'approval', $3, $4, $5,
                       '["approve","reject"]'::jsonb, true, $6, $7, $8, $9)
               RETURNING id, run_id, session_id, cron_job_id, kind, context,
                         reason, question, choices, suspend, status, answer,
                         dedupe_key, proposed_action, proposed_action_hash,
                         target_version, expires_at, created_at, resolved_at"#,
        )
        .bind(context.run_id)
        .bind(context.session_id)
        .bind(truncate(
            &format!(
                "Autonomous {} action requires approval",
                context.trigger.name()
            ),
            MAX_CONTEXT_CHARS,
        ))
        .bind("Runtime capability policy requires explicit approval for this effect.")
        .bind(question)
        .bind(&dedupe_key)
        .bind(&proposed_action)
        .bind(&action_hash)
        .bind(target_version)
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
                "kind": "approval",
                "question": redact_sensitive_text(&row.question),
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
                  question, choices, suspend, status, answer, dedupe_key,
                  proposed_action, proposed_action_hash, target_version,
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
                  question, choices, suspend, status, answer, dedupe_key,
                  proposed_action, proposed_action_hash, target_version,
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
                  question, choices, suspend, status, answer, dedupe_key,
                  proposed_action, proposed_action_hash, target_version,
                  expires_at, created_at, resolved_at
           FROM decisions WHERE dedupe_key = $1 AND status = 'pending'"#,
    )
    .bind(dedupe_key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Into::into)
}

async fn live_target_matches(state: &AppState, decision: &DecisionRow) -> AppResult<bool> {
    let Some(expected) = decision.target_version.as_deref() else {
        return Ok(true);
    };
    let resource_key = decision
        .proposed_action
        .as_ref()
        .and_then(|action| action.get("resourceKey"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::Conflict("versioned approval is missing its resource key".to_string())
        })?;
    let profile =
        sqlx::query_scalar::<_, String>("SELECT agent_profile FROM agent_runs WHERE id = $1")
            .bind(decision.run_id)
            .fetch_one(&state.db)
            .await?;
    let current = current_resource_version(state, &profile, resource_key).await?;
    Ok(current.is_some_and(|current| versions_equal(expected, &current)))
}

async fn current_resource_version(
    state: &AppState,
    agent_profile: &str,
    resource_key: &str,
) -> AppResult<Option<String>> {
    let (kind, identifier) = resource_key.split_once(':').ok_or_else(|| {
        AppError::Conflict("versioned approval has an invalid resource key".to_string())
    })?;
    if identifier == "*" || identifier.trim().is_empty() {
        return Err(AppError::Conflict(
            "versioned approval target cannot be identified".to_string(),
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
        AppError::Conflict(format!("versioned approval target id is invalid: {err}"))
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
                "versioned approval does not support resource type {kind}"
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
    async fn approval_is_superseded_when_target_changes_before_resolution(pool: sqlx::PgPool) {
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
        .await
        .unwrap();
        assert!(!resolution.applied);
        assert_eq!(resolution.decision.status, "superseded");
        let run_status =
            sqlx::query_scalar::<_, String>("SELECT status FROM agent_runs WHERE id = $1")
                .bind(run_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_status, "queued");
        let event_exists = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(SELECT 1 FROM agent_run_events
               WHERE run_id = $1 AND event_type = 'decision_superseded')"#,
        )
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(event_exists);
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
