//! Durable run checklist and structured compaction checkpoints.
//!
//! Runtime progress is scoped to an AgentRun and never creates workspace Task
//! records implicitly. PostgreSQL owns ordering and the one-in-progress
//! invariant; the legacy file importer is a one-time compatibility bridge.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::agent::execution::{RunProgressStore, ToolExecutionContext};
use crate::agent::providers::{Message, MessageRole};
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::models::chat::{ChatSseEvent, RunChecklistEventItem};
use crate::services::agent_runs;
use crate::state::AppState;

const MAX_CHECKLIST_ITEMS: usize = 256;
const MAX_CHECKLIST_CONTENT_CHARS: usize = 4_000;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RunChecklistItem {
    pub id: Uuid,
    pub run_id: Uuid,
    pub item_key: String,
    pub content: String,
    pub status: String,
    pub position: i32,
    pub blocked_decision_id: Option<Uuid>,
    pub verification_event_id: Option<Uuid>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChecklistInput {
    pub id: String,
    pub content: String,
    pub status: String,
}

pub fn coordinator(state: AppState) -> Arc<dyn RunProgressStore> {
    Arc::new(DurableRunProgressStore { state })
}

pub async fn list_checklist(state: &AppState, run_id: Uuid) -> AppResult<Vec<RunChecklistItem>> {
    agent_runs::get_run(state, run_id).await?;
    fetch_checklist(&state.db, run_id).await
}

pub async fn update_checklist(
    state: &AppState,
    context: &ToolExecutionContext,
    incoming: Option<Vec<ChecklistInput>>,
    merge: bool,
    legacy_path: &Path,
) -> AppResult<Vec<RunChecklistItem>> {
    import_legacy_todo_once(state, context, legacy_path).await?;
    let Some(incoming) = incoming else {
        return fetch_checklist(&state.db, context.run_id).await;
    };
    let incoming = normalize_inputs(incoming)?;
    let mut tx = state.db.begin().await?;
    lock_active_run(&mut tx, context).await?;
    let next = if merge {
        let current = fetch_checklist_tx(&mut tx, context.run_id).await?;
        merge_inputs(current, incoming)
    } else {
        incoming
    };
    validate_in_progress(&next)?;
    replace_checklist_tx(&mut tx, context.run_id, &next).await?;
    tx.commit().await?;
    let items = fetch_checklist(&state.db, context.run_id).await?;
    agent_runs::append_user_event_for_context(
        state,
        context,
        "checklist_changed",
        serde_json::to_value(ChatSseEvent::ChecklistChanged {
            items: items
                .iter()
                .map(|item| RunChecklistEventItem {
                    id: item.item_key.clone(),
                    content: redact_sensitive_text(&item.content),
                    status: item.status.clone(),
                    position: item.position,
                })
                .collect(),
        })
        .map_err(|err| {
            AppError::Internal(format!("checklist event serialization failed: {err}"))
        })?,
        None,
    )
    .await?;
    Ok(items)
}

pub async fn latest_resume_input(state: &AppState, run_id: Uuid) -> AppResult<Option<String>> {
    sqlx::query_scalar::<_, String>(
        r#"SELECT resume_input FROM agent_run_checkpoints
           WHERE run_id = $1 ORDER BY sequence DESC LIMIT 1"#,
    )
    .bind(run_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Into::into)
}

struct DurableRunProgressStore {
    state: AppState,
}

#[async_trait]
impl RunProgressStore for DurableRunProgressStore {
    async fn completion_reminder(
        &self,
        context: &ToolExecutionContext,
    ) -> Result<Option<String>, String> {
        let items = fetch_checklist(&self.state.db, context.run_id)
            .await
            .map_err(|err| err.to_string())?;
        let incomplete = items
            .into_iter()
            .filter(|item| matches!(item.status.as_str(), "pending" | "in_progress" | "blocked"))
            .collect::<Vec<_>>();
        if incomplete.is_empty() {
            return Ok(None);
        }
        let lines = incomplete
            .iter()
            .map(|item| {
                format!(
                    "- [{}] {}",
                    item.status,
                    redact_sensitive_text(&item.content)
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        Ok(Some(format!(
            "[Run checklist reminder]\nThe following runtime checklist items are not terminal:\n{lines}\nContinue the work, or mark an item blocked only when a durable Decision is required. Do not claim completion while actionable items remain."
        )))
    }

    async fn create_checkpoint(
        &self,
        context: &ToolExecutionContext,
        messages: &[Message],
    ) -> Result<String, String> {
        let mut tx = self.state.db.begin().await.map_err(|err| err.to_string())?;
        let (objective, constraints) = sqlx::query_as::<_, (String, Value)>(
            r#"SELECT objective, authorization_context
               FROM agent_runs
               WHERE id = $1 AND lease_epoch = $2 AND status = 'running'
               FOR UPDATE"#,
        )
        .bind(context.run_id)
        .bind(context.lease_epoch)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "run lease changed before checkpoint".to_string())?;
        let checklist = fetch_checklist_tx(&mut tx, context.run_id)
            .await
            .map_err(|err| err.to_string())?;
        let pending_work = checklist
            .iter()
            .filter(|item| !matches!(item.status.as_str(), "completed" | "cancelled"))
            .map(|item| {
                serde_json::json!({
                    "id": item.item_key,
                    "content": redact_sensitive_text(&item.content),
                    "status": item.status,
                })
            })
            .collect::<Vec<_>>();
        let completed_work = checklist
            .iter()
            .filter(|item| item.status == "completed")
            .map(|item| redact_sensitive_text(&item.content))
            .collect::<Vec<_>>();
        let decisions = sqlx::query_as::<_, (String, String, String, Option<Value>)>(
            r#"SELECT kind, question, status, answer
               FROM decisions WHERE run_id = $1
               ORDER BY created_at"#,
        )
        .bind(context.run_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|err| err.to_string())?
        .into_iter()
        .map(|(kind, question, status, answer)| {
            serde_json::json!({
                "kind": kind,
                "question": redact_sensitive_text(&question),
                "status": status,
                "answer": answer.map(|value| redact_sensitive_text(&value.to_string())),
            })
        })
        .collect::<Vec<_>>();
        let sequence = sqlx::query_scalar::<_, i32>(
            r#"SELECT COALESCE(MAX(sequence), 0)::integer + 1
               FROM agent_run_checkpoints WHERE run_id = $1"#,
        )
        .bind(context.run_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        let summary = summarize_messages(messages);
        let resume_input = build_resume_input(
            &objective,
            &constraints,
            &decisions,
            &pending_work,
            &completed_work,
            &summary,
        );
        let checkpoint_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO agent_run_checkpoints
                 (run_id, sequence, objective, constraints, decisions,
                  pending_work, summary, resume_input)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id"#,
        )
        .bind(context.run_id)
        .bind(sequence)
        .bind(&objective)
        .bind(&constraints)
        .bind(serde_json::to_value(&decisions).map_err(|err| err.to_string())?)
        .bind(serde_json::to_value(&pending_work).map_err(|err| err.to_string())?)
        .bind(&summary)
        .bind(&resume_input)
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| err.to_string())?;
        tx.commit().await.map_err(|err| err.to_string())?;
        agent_runs::append_user_event_for_context(
            &self.state,
            context,
            "checkpoint_created",
            serde_json::to_value(ChatSseEvent::CheckpointCreated {
                checkpoint_id,
                sequence,
            })
            .map_err(|err| format!("checkpoint event serialization failed: {err}"))?,
            Some(&format!("checkpoint:{sequence}")),
        )
        .await
        .map_err(|err| err.to_string())?;
        Ok(resume_input)
    }
}

async fn import_legacy_todo_once(
    state: &AppState,
    context: &ToolExecutionContext,
    path: &Path,
) -> AppResult<()> {
    let mut tx = state.db.begin().await?;
    let imported = sqlx::query_scalar::<_, bool>(
        r#"SELECT legacy_todo_imported_at IS NOT NULL
           FROM agent_runs
           WHERE id = $1 AND lease_epoch = $2 AND status = 'running'
           FOR UPDATE"#,
    )
    .bind(context.run_id)
    .bind(context.lease_epoch)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Conflict("run lease changed before todo import".to_string()))?;
    if imported {
        tx.commit().await?;
        return Ok(());
    }
    let existing = fetch_checklist_tx(&mut tx, context.run_id).await?;
    if existing.is_empty() {
        let legacy = std::fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str::<Vec<ChecklistInput>>(&content).ok())
            .map(normalize_inputs)
            .transpose()?;
        if let Some(items) = legacy.filter(|items| !items.is_empty()) {
            validate_in_progress(&items)?;
            replace_checklist_tx(&mut tx, context.run_id, &items).await?;
        }
    }
    sqlx::query("UPDATE agent_runs SET legacy_todo_imported_at = now() WHERE id = $1")
        .bind(context.run_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

fn normalize_inputs(items: Vec<ChecklistInput>) -> AppResult<Vec<ChecklistInput>> {
    let mut normalized = Vec::new();
    for item in items.into_iter().take(MAX_CHECKLIST_ITEMS) {
        let id = item.id.trim();
        let content = item.content.trim();
        if id.is_empty() || content.is_empty() {
            continue;
        }
        if content.chars().count() > MAX_CHECKLIST_CONTENT_CHARS {
            return Err(AppError::BadRequest(format!(
                "checklist content must be at most {MAX_CHECKLIST_CONTENT_CHARS} characters"
            )));
        }
        if !matches!(
            item.status.as_str(),
            "pending" | "in_progress" | "blocked" | "completed" | "cancelled"
        ) {
            return Err(AppError::BadRequest(format!(
                "invalid checklist status: {}",
                item.status
            )));
        }
        normalized.push(ChecklistInput {
            id: id.to_string(),
            content: content.to_string(),
            status: item.status,
        });
    }
    Ok(normalized)
}

fn validate_in_progress(items: &[ChecklistInput]) -> AppResult<()> {
    if items
        .iter()
        .filter(|item| item.status == "in_progress")
        .count()
        > 1
    {
        return Err(AppError::BadRequest(
            "a run checklist may have at most one in-progress item".to_string(),
        ));
    }
    Ok(())
}

fn merge_inputs(
    current: Vec<RunChecklistItem>,
    incoming: Vec<ChecklistInput>,
) -> Vec<ChecklistInput> {
    let mut incoming_by_id = incoming
        .into_iter()
        .map(|item| (item.id.clone(), item))
        .collect::<HashMap<_, _>>();
    let mut merged = current
        .into_iter()
        .map(|item| {
            incoming_by_id
                .remove(&item.item_key)
                .unwrap_or(ChecklistInput {
                    id: item.item_key,
                    content: item.content,
                    status: item.status,
                })
        })
        .collect::<Vec<_>>();
    let mut remaining = incoming_by_id.into_values().collect::<Vec<_>>();
    remaining.sort_by(|left, right| left.id.cmp(&right.id));
    merged.extend(remaining);
    merged
}

async fn lock_active_run(
    tx: &mut Transaction<'_, Postgres>,
    context: &ToolExecutionContext,
) -> AppResult<()> {
    let locked = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM agent_runs
           WHERE id = $1 AND lease_epoch = $2 AND status = 'running'
             AND cancel_requested_at IS NULL
           FOR UPDATE"#,
    )
    .bind(context.run_id)
    .bind(context.lease_epoch)
    .fetch_optional(&mut **tx)
    .await?;
    if locked.is_none() {
        return Err(AppError::Conflict(
            "run lease changed before checklist update".to_string(),
        ));
    }
    Ok(())
}

async fn replace_checklist_tx(
    tx: &mut Transaction<'_, Postgres>,
    run_id: Uuid,
    items: &[ChecklistInput],
) -> AppResult<()> {
    sqlx::query("DELETE FROM run_checklist_items WHERE run_id = $1")
        .bind(run_id)
        .execute(&mut **tx)
        .await?;
    for (position, item) in items.iter().enumerate() {
        sqlx::query(
            r#"INSERT INTO run_checklist_items
                 (run_id, item_key, content, status, position)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(run_id)
        .bind(&item.id)
        .bind(&item.content)
        .bind(&item.status)
        .bind(i32::try_from(position).unwrap_or(i32::MAX))
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn fetch_checklist(pool: &sqlx::PgPool, run_id: Uuid) -> AppResult<Vec<RunChecklistItem>> {
    sqlx::query_as::<_, RunChecklistItem>(
        r#"SELECT id, run_id, item_key, content, status, position,
                  blocked_decision_id, verification_event_id
           FROM run_checklist_items WHERE run_id = $1 ORDER BY position"#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

async fn fetch_checklist_tx(
    tx: &mut Transaction<'_, Postgres>,
    run_id: Uuid,
) -> AppResult<Vec<RunChecklistItem>> {
    sqlx::query_as::<_, RunChecklistItem>(
        r#"SELECT id, run_id, item_key, content, status, position,
                  blocked_decision_id, verification_event_id
           FROM run_checklist_items WHERE run_id = $1 ORDER BY position"#,
    )
    .bind(run_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(Into::into)
}

fn summarize_messages(messages: &[Message]) -> String {
    let mut user = 0;
    let mut assistant = 0;
    let mut tool = 0;
    let mut recent = Vec::new();
    for message in messages.iter().rev() {
        match message.role {
            MessageRole::User => user += 1,
            MessageRole::Assistant => assistant += 1,
            MessageRole::Tool => tool += 1,
            MessageRole::System => {}
        }
        if recent.len() < 4 {
            if let Some(content) = message
                .content
                .as_deref()
                .filter(|value| !value.trim().is_empty())
            {
                recent.push(
                    redact_sensitive_text(content)
                        .chars()
                        .take(500)
                        .collect::<String>(),
                );
            }
        }
    }
    recent.reverse();
    format!(
        "messages={}, user={user}, assistant={assistant}, tool={tool}\n{}",
        messages.len(),
        recent.join("\n")
    )
}

fn build_resume_input(
    objective: &str,
    constraints: &Value,
    decisions: &[Value],
    pending_work: &[Value],
    completed_work: &[String],
    summary: &str,
) -> String {
    format!(
        "[Structured run checkpoint]\nObjective: {}\nConstraints: {}\nDecisions: {}\nPending work: {}\nCompleted work (do not repeat): {}\nRecent execution summary: {}\nResume from the pending work, revalidate live state before mutation, and do not assume an unrecorded tool effect succeeded.",
        redact_sensitive_text(objective),
        constraints,
        serde_json::to_string(decisions).unwrap_or_else(|_| "[]".to_string()),
        serde_json::to_string(pending_work).unwrap_or_else(|_| "[]".to_string()),
        serde_json::to_string(completed_work).unwrap_or_else(|_| "[]".to_string()),
        summary,
    )
}
