//! Task domain operations.
//!
//! Handlers own HTTP extraction; this service owns validation, persistence,
//! row mapping, and audit logging for task mutations.

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::task::{CreateTaskRequest, Task, UpdateTaskRequest};
use crate::services::audit::log_audit_safe;

/// A task / to-do row.
#[derive(Debug, FromRow)]
struct TaskRow {
    id: Uuid,
    project_id: Option<Uuid>,
    title: String,
    description: String,
    status: String,
    priority: String,
    due_date: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub struct TaskFilter {
    pub project_id: Option<Uuid>,
    pub status: Option<String>,
}

/// List tasks with optional project/status filters.
pub async fn list_tasks(db: &PgPool, filter: TaskFilter) -> AppResult<Vec<Task>> {
    if let Some(ref status) = filter.status {
        validate_status(db, status).await?;
    }

    // ORDER BY: non-done tasks first (via join to task_statuses.is_done),
    // then priority weight, then due date, then newest.
    let rows = match (filter.project_id, filter.status.as_deref()) {
        (Some(pid), Some(status)) => {
            sqlx::query_as!(
                TaskRow,
                r#"SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
                          t.due_date, t.completed_at, t.created_at, t.updated_at
                   FROM tasks t
                   JOIN task_statuses ts ON ts.slug = t.status
                   WHERE t.project_id = $1 AND t.status = $2
                   ORDER BY ts.is_done ASC,
                            CASE t.priority
                                WHEN 'urgent' THEN 0
                                WHEN 'high'    THEN 1
                                WHEN 'medium'  THEN 2
                                WHEN 'low'     THEN 3
                                ELSE 4
                            END ASC,
                            t.due_date ASC NULLS LAST,
                            t.created_at DESC"#,
                pid,
                status,
            )
            .fetch_all(db)
            .await?
        }
        (Some(pid), None) => {
            sqlx::query_as!(
                TaskRow,
                r#"SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
                          t.due_date, t.completed_at, t.created_at, t.updated_at
                   FROM tasks t
                   JOIN task_statuses ts ON ts.slug = t.status
                   WHERE t.project_id = $1
                   ORDER BY ts.is_done ASC,
                            CASE t.priority
                                WHEN 'urgent' THEN 0
                                WHEN 'high'    THEN 1
                                WHEN 'medium'  THEN 2
                                WHEN 'low'     THEN 3
                                ELSE 4
                            END ASC,
                            t.due_date ASC NULLS LAST,
                            t.created_at DESC"#,
                pid,
            )
            .fetch_all(db)
            .await?
        }
        (None, Some(status)) => {
            sqlx::query_as!(
                TaskRow,
                r#"SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
                          t.due_date, t.completed_at, t.created_at, t.updated_at
                   FROM tasks t
                   JOIN task_statuses ts ON ts.slug = t.status
                   WHERE t.status = $1
                   ORDER BY ts.is_done ASC,
                            CASE t.priority
                                WHEN 'urgent' THEN 0
                                WHEN 'high'    THEN 1
                                WHEN 'medium'  THEN 2
                                WHEN 'low'     THEN 3
                                ELSE 4
                            END ASC,
                            t.due_date ASC NULLS LAST,
                            t.created_at DESC"#,
                status,
            )
            .fetch_all(db)
            .await?
        }
        (None, None) => {
            sqlx::query_as!(
                TaskRow,
                r#"SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
                          t.due_date, t.completed_at, t.created_at, t.updated_at
                   FROM tasks t
                   JOIN task_statuses ts ON ts.slug = t.status
                   ORDER BY ts.is_done ASC,
                            CASE t.priority
                                WHEN 'urgent' THEN 0
                                WHEN 'high'    THEN 1
                                WHEN 'medium'  THEN 2
                                WHEN 'low'     THEN 3
                                ELSE 4
                            END ASC,
                            t.due_date ASC NULLS LAST,
                            t.created_at DESC"#
            )
            .fetch_all(db)
            .await?
        }
    };

    Ok(rows.into_iter().map(row_to_task).collect())
}

/// Create a task and write an audit log entry.
pub async fn create_task(db: &PgPool, req: CreateTaskRequest) -> AppResult<Task> {
    let id = Uuid::new_v4();
    let project_uuid = parse_optional_uuid(req.project_id.as_deref(), "projectId")?;

    // Coerce absent fields to DB defaults (same lesson as notes `content`):
    // NOT NULL columns with defaults reject explicit NULL.
    let description = req.description.unwrap_or_default();
    let status = req.status.unwrap_or_else(|| "todo".to_string());
    let priority = req.priority.unwrap_or_else(|| "medium".to_string());

    validate_status(db, &status).await?;
    validate_priority(&priority)?;

    let due = parse_due_date(req.due_date.as_deref())?;

    sqlx::query!(
        r#"INSERT INTO tasks (id, project_id, title, description, status, priority, due_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        id,
        project_uuid,
        req.title,
        description,
        status,
        priority,
        due,
    )
    .execute(db)
    .await?;

    let task = fetch_task(db, id).await?;
    log_audit_safe(
        db,
        "user",
        "user",
        "create",
        "task",
        Some(&task.id),
        Some(serde_json::json!({ "after": { "title": task.title, "status": task.status, "priority": task.priority } })),
    )
    .await;

    Ok(task)
}

/// Update a task and write an audit log entry.
pub async fn update_task(db: &PgPool, id: Uuid, req: UpdateTaskRequest) -> AppResult<Task> {
    sqlx::query!(r#"SELECT 1 AS x FROM tasks WHERE id = $1"#, id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("task {id} not found")))?;

    let project_uuid = parse_optional_uuid(req.project_id.as_deref(), "projectId")?;

    if let Some(ref status) = req.status {
        validate_status(db, status).await?;
    }
    if let Some(ref priority) = req.priority {
        validate_priority(priority)?;
    }

    // Tri-state due_date: None=preserve, Some(None)=clear, Some(Some)=set.
    let due: Option<Option<DateTime<Utc>>> = match req.due_date.as_deref() {
        None => None,
        Some("") => Some(None),
        Some(ts) => Some(parse_due_date(Some(ts))?),
    };

    // completed_at handling: when status changes, set now() if the target
    // status is marked is_done in task_statuses, otherwise NULL. When status
    // is unchanged, preserve completed_at.
    let completed_clause = match req.status.as_deref() {
        Some(new_status) => {
            let is_done: bool = sqlx::query_scalar!(
                r#"SELECT is_done FROM task_statuses WHERE slug = $1"#,
                new_status
            )
            .fetch_optional(db)
            .await?
            .ok_or_else(|| AppError::BadRequest(format!("unknown status: {new_status}")))?;
            if is_done {
                "completed_at = now()"
            } else {
                "completed_at = NULL"
            }
        }
        None => "completed_at = completed_at",
    };

    let (due_clause, due_value): (&str, Option<DateTime<Utc>>) = match due {
        None => ("due_date = due_date", None),
        Some(None) => ("due_date = NULL", None),
        Some(Some(dt)) => ("due_date = $7", Some(dt)),
    };

    sqlx::query(&format!(
        r#"UPDATE tasks SET
             project_id = COALESCE($2, project_id),
             title = COALESCE($3, title),
             description = COALESCE($4, description),
             status = COALESCE($5, status),
             priority = COALESCE($6, priority),
             {due_clause},
             {completed_clause},
             updated_at = now()
           WHERE id = $1"#,
    ))
    .bind(id)
    .bind(project_uuid)
    .bind(req.title.as_deref())
    .bind(req.description.as_deref())
    .bind(req.status.as_deref())
    .bind(req.priority.as_deref())
    .bind(due_value)
    .execute(db)
    .await?;

    let task = fetch_task(db, id).await?;
    log_audit_safe(
        db,
        "user",
        "user",
        "update",
        "task",
        Some(&task.id),
        Some(serde_json::json!({ "after": { "title": task.title, "status": task.status, "priority": task.priority } })),
    )
    .await;

    Ok(task)
}

/// Delete a task and write an audit log entry.
pub async fn delete_task(db: &PgPool, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query!("DELETE FROM tasks WHERE id = $1", id)
        .execute(db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("task {id} not found")));
    }

    log_audit_safe(
        db,
        "user",
        "user",
        "delete",
        "task",
        Some(&id.to_string()),
        Some(serde_json::json!({ "before": { "id": id.to_string() } })),
    )
    .await;

    Ok(true)
}

async fn fetch_task(db: &PgPool, id: Uuid) -> AppResult<Task> {
    let row = sqlx::query_as!(
        TaskRow,
        r#"SELECT id, project_id, title, description, status, priority,
                  due_date, completed_at, created_at, updated_at
           FROM tasks WHERE id = $1"#,
        id
    )
    .fetch_one(db)
    .await?;
    Ok(row_to_task(row))
}

fn row_to_task(row: TaskRow) -> Task {
    Task {
        id: row.id.to_string(),
        project_id: row.project_id.map(|u| u.to_string()),
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        due_date: row.due_date.map(|d| d.to_rfc3339()),
        completed_at: row.completed_at.map(|d| d.to_rfc3339()),
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

/// Validate that the given status slug exists in the `task_statuses`
/// table. This supports user-defined custom statuses in addition to the
/// three system defaults (todo / in_progress / done).
async fn validate_status(db: &PgPool, status: &str) -> AppResult<()> {
    let exists: Option<bool> = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM task_statuses WHERE slug = $1) AS "exists!""#,
        status
    )
    .fetch_optional(db)
    .await?;
    match exists {
        Some(true) => Ok(()),
        _ => Err(AppError::BadRequest(format!("invalid status: {status}"))),
    }
}

fn validate_priority(priority: &str) -> AppResult<()> {
    if matches!(priority, "low" | "medium" | "high" | "urgent") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!(
            "invalid priority: {priority}"
        )))
    }
}

/// Parse a non-empty RFC3339 timestamp into UTC. Empty strings must be
/// handled by the caller (they mean "clear" in PATCH semantics).
fn parse_due_date(value: Option<&str>) -> AppResult<Option<DateTime<Utc>>> {
    match value {
        Some(ts) if !ts.is_empty() => {
            let dt = DateTime::parse_from_rfc3339(ts)
                .map_err(|e| AppError::BadRequest(format!("invalid dueDate: {e}")))?
                .with_timezone(&Utc);
            Ok(Some(dt))
        }
        _ => Ok(None),
    }
}

fn parse_optional_uuid(value: Option<&str>, field: &str) -> AppResult<Option<Uuid>> {
    value
        .map(|raw| {
            Uuid::parse_str(raw).map_err(|e| AppError::BadRequest(format!("invalid {field}: {e}")))
        })
        .transpose()
}
