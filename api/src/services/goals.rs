//! Goal / OKR domain operations.
//!
//! Progress is computed on-demand:
//!   * manual KR           — current_value / target_value * 100 (capped 100)
//!   * task_completion KR  — completed linked tasks / total linked tasks * 100
//!   * finance KR          — TODO(backend): aggregate from transactions table
//!
//! Goal progress = average of its key results' progress (0 if none).

use serde::Deserialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::goal::{
    CreateGoalRequest, CreateKeyResultRequest, Goal, GoalResponse, GoalsResponse, KeyResult,
    KeyResultResponse, UpdateGoalRequest, UpdateKeyResultRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

mod model;
mod validation;

use model::{average_progress, row_to_goal, row_to_key_result, KeyResultRow};
use validation::{
    validate_current_value, validate_goal_status, validate_goal_type, validate_kpi_type,
    validate_target_value,
};

/// Query params for GET /api/goals.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalQuery {
    /// Filter by status (null/absent = all statuses).
    pub status: Option<String>,
    /// Filter by type (null/absent = all types).
    pub r#type: Option<String>,
    /// Filter by period label (null/absent = all periods).
    pub period: Option<String>,
}

/// GET /api/goals
///
/// Ordered by created_at DESC (newest first). Each goal includes its key
/// results and a computed `progress` (average of KR progress).
///
/// Note: key results are always loaded so the frontend list view can render
/// KRs inline without a second round-trip per goal.
pub async fn list_goals(state: &AppState, q: GoalQuery) -> AppResult<GoalsResponse> {
    if let Some(ref s) = q.status {
        validate_goal_status(s)?;
    }
    if let Some(ref t) = q.r#type {
        validate_goal_type(t)?;
    }

    // Single query with optional predicate filters. Avoids the combinatorial
    // explosion of enumerating every filter combination.
    let rows = sqlx::query_as!(
        model::GoalRow,
        r#"SELECT id, title, description, type, period, status,
                  created_at, updated_at
           FROM goals
           WHERE ($1::text IS NULL OR status = $1)
             AND ($2::text IS NULL OR type = $2)
             AND ($3::text IS NULL OR period = $3)
           ORDER BY created_at DESC"#,
        q.status.as_deref() as Option<&str>,
        q.r#type.as_deref() as Option<&str>,
        q.period.as_deref() as Option<&str>,
    )
    .fetch_all(&state.db)
    .await?;

    // Load each goal with its key results so the frontend list view can
    // render KRs inline. fetch_goal already computes per-KR progress and
    // the goal-level average.
    let mut goals = Vec::with_capacity(rows.len());
    for row in rows {
        goals.push(fetch_goal(state, row.id).await?);
    }
    Ok(GoalsResponse { goals })
}

/// GET /api/goals/{id}
///
/// Returns a single goal with its key results and computed progress.
pub async fn get_goal(state: &AppState, id: Uuid) -> AppResult<GoalResponse> {
    let goal = fetch_goal(state, id).await?;
    Ok(GoalResponse { goal })
}

/// POST /api/goals
pub async fn create_goal(state: &AppState, req: CreateGoalRequest) -> AppResult<GoalResponse> {
    let id = Uuid::new_v4();

    // Coerce absent fields to DB defaults (NOT NULL columns reject NULL).
    let description = req.description.unwrap_or_default();
    let gtype = req.r#type.unwrap_or_else(|| "quarterly".to_string());
    let period = req.period.unwrap_or_default();
    let status = req.status.unwrap_or_else(|| "active".to_string());

    validate_goal_type(&gtype)?;
    validate_goal_status(&status)?;

    sqlx::query!(
        r#"INSERT INTO goals (id, title, description, type, period, status)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
        id,
        req.title,
        description,
        gtype,
        period,
        status,
    )
    .execute(&state.db)
    .await?;

    let goal = fetch_goal(state, id).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "goal",
        Some(&goal.id),
        Some(serde_json::json!({ "after": { "title": goal.title, "type": goal.r#type, "period": goal.period, "status": goal.status } })),
    )
    .await;
    Ok(GoalResponse { goal })
}

/// PATCH /api/goals/{id}
///
/// COALESCE patch for title/description/type/period/status.
pub async fn update_goal(
    state: &AppState,
    id: Uuid,
    req: UpdateGoalRequest,
) -> AppResult<GoalResponse> {
    // Verify existence.
    sqlx::query!(r#"SELECT 1 AS x FROM goals WHERE id = $1"#, id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("goal {id} not found")))?;

    if let Some(ref t) = req.r#type {
        validate_goal_type(t)?;
    }
    if let Some(ref s) = req.status {
        validate_goal_status(s)?;
    }

    sqlx::query!(
        r#"UPDATE goals SET
             title = COALESCE($2, title),
             description = COALESCE($3, description),
             type = COALESCE($4, type),
             period = COALESCE($5, period),
             status = COALESCE($6, status),
             updated_at = now()
           WHERE id = $1"#,
        id,
        req.title.as_deref(),
        req.description.as_deref(),
        req.r#type.as_deref(),
        req.period.as_deref(),
        req.status.as_deref(),
    )
    .execute(&state.db)
    .await?;

    let goal = fetch_goal(state, id).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "goal",
        Some(&goal.id),
        Some(serde_json::json!({ "after": { "title": goal.title, "type": goal.r#type, "period": goal.period, "status": goal.status } })),
    )
    .await;
    Ok(GoalResponse { goal })
}

/// DELETE /api/goals/{id}
///
/// Cascade: key_results and goal_tasks are removed via ON DELETE CASCADE.
pub async fn delete_goal(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query!("DELETE FROM goals WHERE id = $1", id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("goal {id} not found")));
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "goal",
        Some(&id.to_string()),
        Some(serde_json::json!({ "before": { "id": id.to_string() } })),
    )
    .await;
    Ok(true)
}

// ---- Key Result handlers ----

/// POST /api/goals/{id}/key-results
pub async fn create_key_result(
    state: &AppState,
    id: Uuid,
    req: CreateKeyResultRequest,
) -> AppResult<KeyResultResponse> {
    // Verify parent goal exists.
    sqlx::query!(r#"SELECT 1 AS x FROM goals WHERE id = $1"#, id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("goal {id} not found")))?;

    let kr_id = Uuid::new_v4();
    let kpi_type = req.kpi_type.unwrap_or_else(|| "manual".to_string());
    validate_kpi_type(&kpi_type)?;
    let target_value = req.target_value.unwrap_or(100.0);
    validate_target_value(target_value)?;
    let current_value = req.current_value.unwrap_or(0.0);
    validate_current_value(current_value)?;
    let unit = req.unit.unwrap_or_else(|| "%".to_string());

    sqlx::query!(
        r#"INSERT INTO key_results
             (id, goal_id, title, kpi_type, target_value, current_value, unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        kr_id,
        id,
        req.title,
        kpi_type,
        target_value,
        current_value,
        unit,
    )
    .execute(&state.db)
    .await?;

    let kr = fetch_key_result(state, kr_id).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "key_result",
        Some(&kr.id),
        Some(serde_json::json!({ "after": { "goalId": kr.goal_id, "title": kr.title, "kpiType": kr.kpi_type, "targetValue": kr.target_value, "currentValue": kr.current_value } })),
    )
    .await;
    Ok(KeyResultResponse { key_result: kr })
}

/// PATCH /api/goals/{id}/key-results/{kr_id}
///
/// COALESCE patch for title/kpi_type/target_value/current_value/unit.
/// For task_completion KRs, current_value is recomputed from linked tasks
/// on read, so a manual current_value patch is ignored for that type.
pub async fn update_key_result(
    state: &AppState,
    id: Uuid,
    kr_id: Uuid,
    req: UpdateKeyResultRequest,
) -> AppResult<KeyResultResponse> {
    // Verify existence and ownership.
    sqlx::query!(
        r#"SELECT 1 AS x FROM key_results WHERE id = $1 AND goal_id = $2"#,
        kr_id,
        id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("key_result {kr_id} not found")))?;

    if let Some(ref k) = req.kpi_type {
        validate_kpi_type(k)?;
    }
    if let Some(v) = req.target_value {
        validate_target_value(v)?;
    }
    if let Some(v) = req.current_value {
        validate_current_value(v)?;
    }

    sqlx::query!(
        r#"UPDATE key_results SET
             title = COALESCE($2, title),
             kpi_type = COALESCE($3, kpi_type),
             target_value = COALESCE($4, target_value),
             current_value = COALESCE($5, current_value),
             unit = COALESCE($6, unit),
             updated_at = now()
           WHERE id = $1"#,
        kr_id,
        req.title.as_deref(),
        req.kpi_type.as_deref(),
        req.target_value,
        req.current_value,
        req.unit.as_deref(),
    )
    .execute(&state.db)
    .await?;

    let kr = fetch_key_result(state, kr_id).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "key_result",
        Some(&kr.id),
        Some(serde_json::json!({ "after": { "title": kr.title, "kpiType": kr.kpi_type, "targetValue": kr.target_value, "currentValue": kr.current_value } })),
    )
    .await;
    Ok(KeyResultResponse { key_result: kr })
}

/// DELETE /api/goals/{id}/key-results/{kr_id}
pub async fn delete_key_result(state: &AppState, id: Uuid, kr_id: Uuid) -> AppResult<bool> {
    let result = sqlx::query!(
        r#"DELETE FROM key_results WHERE id = $1 AND goal_id = $2"#,
        kr_id,
        id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("key_result {kr_id} not found")));
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "key_result",
        Some(&kr_id.to_string()),
        Some(serde_json::json!({ "before": { "id": kr_id.to_string() } })),
    )
    .await;
    Ok(true)
}

// ---- helpers ----

/// Fetch a single goal with its key results and computed progress.
async fn fetch_goal(state: &AppState, id: Uuid) -> AppResult<Goal> {
    let row = sqlx::query_as!(
        model::GoalRow,
        r#"SELECT id, title, description, type, period, status,
                  created_at, updated_at
           FROM goals WHERE id = $1"#,
        id,
    )
    .fetch_one(&state.db)
    .await?;

    let krs = fetch_key_results_for_goal(state, id).await?;
    let progress = average_progress(&krs);
    Ok(row_to_goal(row, progress, Some(krs)))
}

/// Fetch all key results for a goal, with progress computed per KR.
async fn fetch_key_results_for_goal(state: &AppState, goal_id: Uuid) -> AppResult<Vec<KeyResult>> {
    let rows = sqlx::query_as!(
        KeyResultRow,
        r#"SELECT id, goal_id, title, kpi_type, target_value,
                  current_value, unit, created_at, updated_at
           FROM key_results WHERE goal_id = $1
           ORDER BY created_at ASC"#,
        goal_id,
    )
    .fetch_all(&state.db)
    .await?;

    let mut krs = Vec::with_capacity(rows.len());
    for row in rows {
        let current_value = resolve_current_value(state, &row).await;
        krs.push(row_to_key_result(row, current_value));
    }
    Ok(krs)
}

/// Fetch a single key result with computed progress.
async fn fetch_key_result(state: &AppState, id: Uuid) -> AppResult<KeyResult> {
    let row = sqlx::query_as!(
        KeyResultRow,
        r#"SELECT id, goal_id, title, kpi_type, target_value,
                  current_value, unit, created_at, updated_at
           FROM key_results WHERE id = $1"#,
        id,
    )
    .fetch_one(&state.db)
    .await?;

    let current_value = resolve_current_value(state, &row).await;
    Ok(row_to_key_result(row, current_value))
}

/// Resolve the effective current_value for a KR based on its kpi_type.
///
/// * `manual` — use the stored value as-is.
/// * `task_completion` — count linked tasks done / total (recomputed on read).
/// * `finance` — TODO(backend): aggregate from transactions. Until then the
///   stored value is returned.
async fn resolve_current_value(state: &AppState, kr: &KeyResultRow) -> f64 {
    match kr.kpi_type.as_str() {
        "task_completion" => {
            // Count linked tasks and how many are done.
            let row = sqlx::query!(
                r#"SELECT
                     COUNT(*)::bigint AS "total!: i64",
                     COUNT(*) FILTER (WHERE t.status = 'done')::bigint AS "done!: i64"
                   FROM goal_tasks gt
                   JOIN tasks t ON t.id = gt.task_id
                   WHERE gt.goal_id = $1"#,
                kr.goal_id,
            )
            .fetch_one(&state.db)
            .await;

            match row {
                Ok(r) => {
                    if r.total == 0 {
                        0.0
                    } else {
                        r.done as f64 / r.total as f64 * 100.0
                    }
                }
                // On error, fall back to the stored value rather than failing
                // the read — progress is a derived display field.
                Err(_) => kr.current_value,
            }
        }
        // finance: TODO(backend) — once transactions are wired, sum by period.
        _ => kr.current_value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn key_result_row(target_value: f64, current_value: f64) -> KeyResultRow {
        let now = Utc::now();
        KeyResultRow {
            id: Uuid::new_v4(),
            goal_id: Uuid::new_v4(),
            title: "Progress".to_string(),
            kpi_type: "manual".to_string(),
            target_value,
            current_value,
            unit: "%".to_string(),
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn row_to_key_result_caps_progress_at_one_hundred() {
        let kr = row_to_key_result(key_result_row(10.0, 25.0), 25.0);
        assert_eq!(kr.progress, 100.0);
    }

    #[test]
    fn row_to_key_result_uses_zero_progress_for_non_positive_target() {
        let kr = row_to_key_result(key_result_row(0.0, 25.0), 25.0);
        assert_eq!(kr.progress, 0.0);
    }

    #[test]
    fn average_progress_returns_zero_for_empty_results() {
        assert_eq!(average_progress(&[]), 0.0);
    }

    #[test]
    fn average_progress_returns_mean_value() {
        let krs = vec![
            row_to_key_result(key_result_row(100.0, 25.0), 25.0),
            row_to_key_result(key_result_row(100.0, 75.0), 75.0),
        ];
        assert_eq!(average_progress(&krs), 50.0);
    }

    #[test]
    fn validators_reject_invalid_goal_inputs() {
        assert!(validate_goal_type("weekly").is_err());
        assert!(validate_goal_status("paused").is_err());
        assert!(validate_kpi_type("custom").is_err());
        assert!(validate_target_value(0.0).is_err());
        assert!(validate_current_value(-1.0).is_err());
    }
}
