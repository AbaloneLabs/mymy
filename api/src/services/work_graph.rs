//! Durable links between workspace tasks and agent execution history.
//!
//! Links are created only by explicit association or a concrete mutation.
//! Broad task list reads intentionally remain side-effect free.

use chrono::{DateTime, Utc};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::agent::execution::ToolExecutionContext;
use crate::error::{AppError, AppResult};
use crate::models::work_graph::{RelatedTaskRun, TaskRuntimeResponse};
use crate::services::audit::RuntimeMutationOrigin;
use crate::state::AppState;

#[derive(Debug, FromRow)]
struct RelatedRunRow {
    run_id: Uuid,
    session_id: Option<Uuid>,
    agent_profile: String,
    status: String,
    trigger_type: String,
    link_kind: String,
    operation: Option<String>,
    error_code: Option<String>,
    created_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
}

pub async fn link_task_mutation(
    tx: &mut Transaction<'_, Postgres>,
    origin: Option<&RuntimeMutationOrigin>,
    task_id: Uuid,
    title: &str,
    project_id: Option<Uuid>,
    operation: &str,
) -> AppResult<()> {
    let Some(origin) = origin else {
        return Ok(());
    };
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))")
        .bind(task_id)
        .execute(&mut **tx)
        .await?;
    let conflicting = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT rtl.run_id
           FROM run_task_links rtl
           INNER JOIN agent_runs r ON r.id = rtl.run_id
           WHERE rtl.task_identity = $1 AND rtl.run_id <> $2
             AND rtl.link_kind IN ('explicit', 'mutation')
             AND r.status IN ('queued', 'running', 'waiting_decision')
           ORDER BY rtl.created_at DESC LIMIT 1"#,
    )
    .bind(task_id)
    .bind(origin.run_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(run_id) = conflicting {
        return Err(AppError::Conflict(format!(
            "task {task_id} is already active in agent run {run_id}"
        )));
    }
    insert_link(
        tx,
        origin.run_id,
        task_id,
        title,
        project_id,
        "mutation",
        Some(operation),
    )
    .await?;
    let (profile, run_project_id) = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT agent_profile, project_id FROM agent_runs WHERE id = $1",
    )
    .bind(origin.run_id)
    .fetch_one(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO meaningful_activity
             (agent_profile, project_id, activity_type, source_id)
           VALUES ($1, $2, 'task_mutation', $3)
           ON CONFLICT (activity_type, source_id) DO NOTHING"#,
    )
    .bind(profile)
    .bind(run_project_id)
    .bind(format!("{}:{task_id}:{operation}", origin.run_id))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn link_task_explicit(
    state: &AppState,
    context: &ToolExecutionContext,
    task_id: Uuid,
) -> AppResult<()> {
    let mut tx = state.db.begin().await?;
    let task = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT title, project_id FROM tasks WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(task_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("task {task_id} not found")))?;
    let origin = RuntimeMutationOrigin {
        run_id: context.run_id,
    };
    link_task_mutation(&mut tx, Some(&origin), task_id, &task.0, task.1, "claim").await?;
    insert_link(
        &mut tx,
        context.run_id,
        task_id,
        &task.0,
        task.1,
        "explicit",
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn insert_link(
    tx: &mut Transaction<'_, Postgres>,
    run_id: Uuid,
    task_id: Uuid,
    title: &str,
    project_id: Option<Uuid>,
    kind: &str,
    operation: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        r#"INSERT INTO run_task_links
             (run_id, task_id, task_identity, link_kind, operation,
              title_snapshot, project_id_snapshot)
           VALUES ($1, $2, $2, $3, $4, $5, $6)
           ON CONFLICT (run_id, task_identity, link_kind, operation) DO NOTHING"#,
    )
    .bind(run_id)
    .bind(task_id)
    .bind(kind)
    .bind(operation)
    .bind(title)
    .bind(project_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn record_task_history(
    tx: &mut Transaction<'_, Postgres>,
    origin: Option<&RuntimeMutationOrigin>,
    task_id: Uuid,
    operation: &str,
    snapshot: serde_json::Value,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO task_history (task_id, run_id, operation, snapshot) VALUES ($1, $2, $3, $4)",
    )
    .bind(task_id)
    .bind(origin.map(|origin| origin.run_id))
    .bind(operation)
    .bind(snapshot)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn task_runtime(state: &AppState, task_id: Uuid) -> AppResult<TaskRuntimeResponse> {
    let deleted_at = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT deleted_at FROM tasks WHERE id = $1",
    )
    .bind(task_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("task {task_id} not found")))?;
    let rows = sqlx::query_as::<_, RelatedRunRow>(
        r#"SELECT r.id AS run_id, r.session_id, r.agent_profile, r.status,
                  r.trigger_type, rtl.link_kind, rtl.operation, r.error_code,
                  rtl.created_at, r.completed_at
           FROM run_task_links rtl
           INNER JOIN agent_runs r ON r.id = rtl.run_id
           WHERE rtl.task_identity = $1
           ORDER BY rtl.created_at DESC LIMIT 100"#,
    )
    .bind(task_id)
    .fetch_all(&state.db)
    .await?;
    let active_run_count = rows
        .iter()
        .filter(|row| {
            matches!(
                row.status.as_str(),
                "queued" | "running" | "waiting_decision"
            )
        })
        .map(|row| row.run_id)
        .collect::<std::collections::HashSet<_>>()
        .len() as i64;
    Ok(TaskRuntimeResponse {
        task_id: task_id.to_string(),
        task_deleted: deleted_at.is_some(),
        active_run_count,
        runs: rows
            .into_iter()
            .map(|row| RelatedTaskRun {
                run_id: row.run_id.to_string(),
                session_id: row.session_id.map(|id| id.to_string()),
                agent_profile: row.agent_profile,
                status: row.status,
                trigger_type: row.trigger_type,
                link_kind: row.link_kind,
                operation: row.operation,
                outcome: row.error_code,
                created_at: row.created_at.to_rfc3339(),
                completed_at: row.completed_at.map(|value| value.to_rfc3339()),
            })
            .collect(),
    })
}
