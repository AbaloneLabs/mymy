//! Task custom status domain operations.

use serde::Deserialize;
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::models::task_status::{
    CreateTaskStatusRequest, ReorderTaskStatusesRequest, TaskStatus, TaskStatusResponse,
    TaskStatusesResponse, UpdateTaskStatusRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

/// Supported color palette tokens. The frontend maps these to CSS classes.
const VALID_COLORS: &[&str] = &["gray", "blue", "green", "orange", "red", "purple"];

/// GET /api/task-statuses
///
/// Returns all statuses ordered by `sort_order`.
pub async fn list_task_statuses(state: &AppState) -> AppResult<TaskStatusesResponse> {
    let rows = sqlx::query(
        r#"SELECT slug, label, color, sort_order, is_done, is_system,
                  created_at, updated_at
           FROM task_statuses
           ORDER BY sort_order ASC, slug ASC"#,
    )
    .fetch_all(&state.db)
    .await?;

    let statuses = rows.into_iter().map(row_to_status).collect();
    Ok(TaskStatusesResponse { statuses })
}

/// POST /api/task-statuses
pub async fn create_task_status(
    state: &AppState,
    req: CreateTaskStatusRequest,
) -> AppResult<TaskStatusResponse> {
    let color = req.color.as_deref().unwrap_or("gray").to_string();
    validate_color(&color)?;

    let label = req.label.trim();
    if label.is_empty() {
        return Err(AppError::BadRequest("label must not be empty".into()));
    }

    // Derive slug from label if not provided.
    let slug = match req.slug.as_deref() {
        Some(s) => slugify(s),
        None => slugify(label),
    };
    if slug.is_empty() {
        return Err(AppError::BadRequest(
            "could not derive a valid slug from label".into(),
        ));
    }

    // next sort_order = max + 1
    let next_order: i32 =
        sqlx::query_scalar(r#"SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_statuses"#)
            .fetch_one(&state.db)
            .await?;

    let is_done = req.is_done.unwrap_or(false);

    sqlx::query(
        r#"INSERT INTO task_statuses (slug, label, color, sort_order, is_done, is_system)
           VALUES ($1, $2, $3, $4, $5, FALSE)"#,
    )
    .bind(&slug)
    .bind(label)
    .bind(&color)
    .bind(next_order)
    .bind(is_done)
    .execute(&state.db)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            AppError::BadRequest(format!("status slug '{slug}' already exists"))
        } else {
            AppError::Internal(format!("failed to create status: {e}"))
        }
    })?;

    let status = fetch_status(state, &slug).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "task_status",
        Some(&status.slug),
        Some(serde_json::json!({ "after": { "slug": status.slug, "label": status.label } })),
    )
    .await;
    Ok(TaskStatusResponse { status })
}

/// PATCH /api/task-statuses/{slug}
pub async fn update_task_status(
    state: &AppState,
    slug: String,
    req: UpdateTaskStatusRequest,
) -> AppResult<TaskStatusResponse> {
    // Verify existence.
    let existing = fetch_status(state, &slug).await?;

    if let Some(ref c) = req.color {
        validate_color(c)?;
    }

    sqlx::query(
        r#"UPDATE task_statuses SET
             label = COALESCE($2, label),
             color = COALESCE($3, color),
             is_done = COALESCE($4, is_done),
             updated_at = now()
           WHERE slug = $1"#,
    )
    .bind(&slug)
    .bind(req.label.as_deref())
    .bind(req.color.as_deref())
    .bind(req.is_done)
    .execute(&state.db)
    .await?;

    let status = fetch_status(state, &slug).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "task_status",
        Some(&status.slug),
        Some(serde_json::json!({
            "before": { "label": existing.label, "color": existing.color, "isDone": existing.is_done },
            "after": { "label": status.label, "color": status.color, "isDone": status.is_done }
        })),
    )
    .await;
    Ok(TaskStatusResponse { status })
}

/// POST /api/task-statuses/reorder
///
/// Rewrites `sort_order` for all statuses to match the provided slug order.
pub async fn reorder_task_statuses(
    state: &AppState,
    req: ReorderTaskStatusesRequest,
) -> AppResult<TaskStatusesResponse> {
    if req.slugs.is_empty() {
        return Err(AppError::BadRequest("slugs must not be empty".into()));
    }

    let mut tx = state.db.begin().await?;
    for (i, slug) in req.slugs.iter().enumerate() {
        sqlx::query("UPDATE task_statuses SET sort_order = $2, updated_at = now() WHERE slug = $1")
            .bind(slug)
            .bind(i as i32)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "reorder",
        "task_status",
        None,
        Some(serde_json::json!({ "order": req.slugs })),
    )
    .await;

    // Re-fetch ordered list.
    let rows = sqlx::query(
        r#"SELECT slug, label, color, sort_order, is_done, is_system,
                  created_at, updated_at
           FROM task_statuses
           ORDER BY sort_order ASC, slug ASC"#,
    )
    .fetch_all(&state.db)
    .await?;
    let statuses = rows.into_iter().map(row_to_status).collect();
    Ok(TaskStatusesResponse { statuses })
}

/// DELETE /api/task-statuses/{slug}
///
/// System statuses cannot be deleted. If any tasks reference this status,
/// `reassign_to` must be provided (and must differ from the deleted slug).
pub async fn delete_task_status(
    state: &AppState,
    slug: String,
    req: DeleteTaskStatusQuery,
) -> AppResult<bool> {
    let existing = fetch_status(state, &slug).await?;
    if existing.is_system {
        return Err(AppError::BadRequest(format!(
            "system status '{slug}' cannot be deleted"
        )));
    }

    // Count tasks referencing this status.
    let count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM tasks WHERE status = $1"#)
        .bind(&slug)
        .fetch_one(&state.db)
        .await?;

    let reassign_to = req.reassign_to.clone();
    if count > 0 {
        let reassign = reassign_to.clone().ok_or_else(|| {
            AppError::BadRequest(format!(
                "{count} task(s) use status '{slug}'; provide reassignTo to migrate them"
            ))
        })?;
        if reassign == slug {
            return Err(AppError::BadRequest(
                "reassignTo must differ from the deleted slug".into(),
            ));
        }
        // Verify target exists.
        let _ = fetch_status(state, &reassign).await?;

        let mut tx = state.db.begin().await?;
        sqlx::query("UPDATE tasks SET status = $2, updated_at = now() WHERE status = $1")
            .bind(&slug)
            .bind(&reassign)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM task_statuses WHERE slug = $1")
            .bind(&slug)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    } else {
        sqlx::query("DELETE FROM task_statuses WHERE slug = $1")
            .bind(&slug)
            .execute(&state.db)
            .await?;
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "task_status",
        Some(&slug),
        Some(serde_json::json!({
            "before": { "label": existing.label },
            "reassigned_tasks": count,
            "reassign_to": reassign_to
        })),
    )
    .await;
    Ok(true)
}

/// Query parameter for status deletion: `?reassignTo=<slug>`.
#[derive(Debug, Deserialize)]
pub struct DeleteTaskStatusQuery {
    #[serde(default, rename = "reassignTo")]
    pub reassign_to: Option<String>,
}

// ---- helpers ----

async fn fetch_status(state: &AppState, slug: &str) -> AppResult<TaskStatus> {
    let row = sqlx::query(
        r#"SELECT slug, label, color, sort_order, is_done, is_system,
                  created_at, updated_at
           FROM task_statuses WHERE slug = $1"#,
    )
    .bind(slug)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("task status '{slug}' not found")))?;
    Ok(row_to_status(row))
}

fn row_to_status(row: sqlx::postgres::PgRow) -> TaskStatus {
    TaskStatus {
        slug: row.get("slug"),
        label: row.get("label"),
        color: row.get("color"),
        sort_order: row.get("sort_order"),
        is_done: row.get("is_done"),
        is_system: row.get("is_system"),
        created_at: {
            let d: chrono::DateTime<chrono::Utc> = row.get("created_at");
            Some(d.to_rfc3339())
        },
        updated_at: {
            let d: chrono::DateTime<chrono::Utc> = row.get("updated_at");
            Some(d.to_rfc3339())
        },
    }
}

fn validate_color(c: &str) -> AppResult<()> {
    if VALID_COLORS.contains(&c) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!(
            "invalid color '{c}'; must be one of: {}",
            VALID_COLORS.join(", ")
        )))
    }
}

fn is_unique_violation(e: &sqlx::Error) -> bool {
    if let Some(db) = e.as_database_error() {
        return db.code().as_deref() == Some("23505");
    }
    false
}

/// Lowercase, replace runs of non-alphanumeric with single hyphen, trim.
fn slugify(s: &str) -> String {
    let s = s.trim().to_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}
