//! Goal / OKR domain operations.
//!
//! Progress is computed on-demand:
//!   * manual KR           — current_value / target_value * 100 (capped 100)
//!   * task_completion KR  — completed linked tasks / total linked tasks * 100
//!   * finance KR          — explicit single-currency transaction aggregate
//!
//! Goal progress = average of its key results' progress (0 if none).

use chrono::{DateTime, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::goal::{
    CreateGoalRequest, CreateKeyResultRequest, FinanceKpiDefinition, Goal, GoalResponse,
    GoalsResponse, KeyResult, KeyResultResponse, LinkTaskRequest, LinkedTask,
    TaskAssignmentSummary, UpdateGoalRequest, UpdateKeyResultRequest,
};
use crate::models::scope::PatchField;
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

mod model;
mod validation;

use model::{
    average_progress, finance_definition, row_to_goal, row_to_key_result, KeyResultRow,
    LinkedTaskRow,
};
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
    let finance = normalize_finance_definition(state, &kpi_type, req.finance_definition).await?;
    let unit = req.unit.unwrap_or_else(|| {
        finance
            .as_ref()
            .map(|definition| definition.currency.clone())
            .unwrap_or_else(|| "%".to_string())
    });

    sqlx::query(
        r#"INSERT INTO key_results
             (id, goal_id, title, kpi_type, target_value, current_value, unit,
              finance_metric, finance_currency, finance_scope,
              finance_project_id, finance_status, finance_from, finance_to,
              finance_category)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   $11, $12, $13, $14, $15)"#,
    )
    .bind(kr_id)
    .bind(id)
    .bind(req.title)
    .bind(&kpi_type)
    .bind(target_value)
    .bind(if kpi_type == "manual" {
        current_value
    } else {
        0.0
    })
    .bind(unit)
    .bind(finance.as_ref().map(|value| value.metric.as_str()))
    .bind(finance.as_ref().map(|value| value.currency.as_str()))
    .bind(finance.as_ref().map(|value| value.scope.as_str()))
    .bind(finance.as_ref().and_then(|value| value.project_id))
    .bind(finance.as_ref().map(|value| value.status.as_str()))
    .bind(finance.as_ref().and_then(|value| value.from))
    .bind(finance.as_ref().and_then(|value| value.to))
    .bind(finance.as_ref().and_then(|value| value.category.as_deref()))
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
    let existing = fetch_key_result_row(state, kr_id, Some(id)).await?;

    if let Some(ref k) = req.kpi_type {
        validate_kpi_type(k)?;
    }
    if let Some(v) = req.target_value {
        validate_target_value(v)?;
    }
    if let Some(v) = req.current_value {
        validate_current_value(v)?;
    }
    let kpi_type = req
        .kpi_type
        .clone()
        .unwrap_or_else(|| existing.kpi_type.clone());
    if req.current_value.is_some() && kpi_type != "manual" {
        return Err(AppError::BadRequest(
            "currentValue is only writable for manual key results".to_string(),
        ));
    }
    let requested_finance = match req.finance_definition {
        PatchField::Missing => finance_definition(&existing),
        PatchField::Null => None,
        PatchField::Value(definition) => Some(definition),
    };
    let finance = normalize_finance_definition(state, &kpi_type, requested_finance).await?;
    let unit = req.unit.unwrap_or_else(|| {
        if kpi_type == "finance" && existing.kpi_type != "finance" {
            finance
                .as_ref()
                .map(|definition| definition.currency.clone())
                .unwrap_or_else(|| existing.unit.clone())
        } else {
            existing.unit.clone()
        }
    });

    sqlx::query(
        r#"UPDATE key_results SET
             title = COALESCE($2, title),
             kpi_type = $3,
             target_value = COALESCE($4, target_value),
             current_value = COALESCE($5, current_value),
             unit = $6,
             finance_metric = $7, finance_currency = $8,
             finance_scope = $9, finance_project_id = $10,
             finance_status = $11, finance_from = $12,
             finance_to = $13, finance_category = $14,
             updated_at = now()
           WHERE id = $1"#,
    )
    .bind(kr_id)
    .bind(req.title.as_deref())
    .bind(&kpi_type)
    .bind(req.target_value)
    .bind(
        (kpi_type == "manual")
            .then_some(req.current_value)
            .flatten(),
    )
    .bind(unit)
    .bind(finance.as_ref().map(|value| value.metric.as_str()))
    .bind(finance.as_ref().map(|value| value.currency.as_str()))
    .bind(finance.as_ref().map(|value| value.scope.as_str()))
    .bind(finance.as_ref().and_then(|value| value.project_id))
    .bind(finance.as_ref().map(|value| value.status.as_str()))
    .bind(finance.as_ref().and_then(|value| value.from))
    .bind(finance.as_ref().and_then(|value| value.to))
    .bind(finance.as_ref().and_then(|value| value.category.as_deref()))
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
    let assignment = task_assignment_summary(state, id).await?;
    Ok(row_to_goal(row, progress, Some(krs), assignment))
}

/// Fetch all key results for a goal, with progress computed per KR.
async fn fetch_key_results_for_goal(state: &AppState, goal_id: Uuid) -> AppResult<Vec<KeyResult>> {
    let rows = sqlx::query_as!(
        KeyResultRow,
        r#"SELECT id, goal_id, title, kpi_type, target_value,
                  current_value, unit, finance_metric, finance_currency,
                  finance_scope, finance_project_id, finance_status,
                  finance_from, finance_to, finance_category,
                  created_at, updated_at
           FROM key_results WHERE goal_id = $1
           ORDER BY created_at ASC"#,
        goal_id,
    )
    .fetch_all(&state.db)
    .await?;

    // Batch-load linked tasks for all KRs in this goal to avoid N+1 queries.
    let kr_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let linked = fetch_linked_tasks_for_krs(state, &kr_ids).await?;

    let mut krs = Vec::with_capacity(rows.len());
    for row in rows {
        let resolved = resolve_current_value(state, &row).await?;
        let tasks = linked.get(&row.id).cloned().unwrap_or_default();
        krs.push(row_to_key_result(
            row,
            resolved.value,
            resolved.status,
            tasks,
        ));
    }
    Ok(krs)
}

/// Fetch a single key result with computed progress.
async fn fetch_key_result(state: &AppState, id: Uuid) -> AppResult<KeyResult> {
    let row = fetch_key_result_row(state, id, None).await?;

    let resolved = resolve_current_value(state, &row).await?;
    let linked = fetch_linked_tasks_for_krs(state, &[id]).await?;
    let tasks = linked.get(&id).cloned().unwrap_or_default();
    Ok(row_to_key_result(
        row,
        resolved.value,
        resolved.status,
        tasks,
    ))
}

/// Resolve the effective current_value for a KR based on its kpi_type.
///
/// * `manual` — use the stored value as-is.
/// * `task_completion` — count linked tasks done / total (recomputed on read).
/// * `finance` — aggregate one explicit currency and scope only.
async fn resolve_current_value(state: &AppState, kr: &KeyResultRow) -> AppResult<KpiResolution> {
    match kr.kpi_type.as_str() {
        "task_completion" => {
            // KR-scoped: count tasks linked directly to this key result.
            // Falls back to goal-level links (key_result_id IS NULL) only
            // when no KR-scoped links exist, preserving legacy behavior.
            let row = sqlx::query!(
                r#"SELECT
                     COUNT(*)::bigint AS "total!: i64",
                     COUNT(*) FILTER (WHERE ts.is_done)::bigint AS "done!: i64"
                   FROM goal_tasks gt
                   JOIN tasks t ON t.id = gt.task_id
                   JOIN task_statuses ts ON ts.slug = t.status
                   WHERE gt.key_result_id = $1
                     AND t.deleted_at IS NULL"#,
                kr.id,
            )
            .fetch_one(&state.db)
            .await;

            let r = row?;
            if r.total > 0 {
                return Ok(KpiResolution::new(
                    r.done as f64 / r.total as f64 * 100.0,
                    "ready",
                ));
            }

            // Fallback: goal-level legacy links (key_result_id IS NULL).
            let fallback = sqlx::query!(
                r#"SELECT
                     COUNT(*)::bigint AS "total!: i64",
                     COUNT(*) FILTER (WHERE ts.is_done)::bigint AS "done!: i64"
                   FROM goal_tasks gt
                   JOIN tasks t ON t.id = gt.task_id
                   JOIN task_statuses ts ON ts.slug = t.status
                   WHERE gt.goal_id = $1
                     AND gt.key_result_id IS NULL
                     AND t.deleted_at IS NULL"#,
                kr.goal_id,
            )
            .fetch_one(&state.db)
            .await?;

            Ok(if fallback.total == 0 {
                KpiResolution::new(0.0, "no_assignment")
            } else {
                KpiResolution::new(
                    fallback.done as f64 / fallback.total as f64 * 100.0,
                    "ready",
                )
            })
        }
        "finance" => {
            let Some(definition) = persisted_finance_definition(kr) else {
                return Ok(KpiResolution::new(0.0, "unconfigured"));
            };
            if definition.scope == "project" && definition.project_id.is_none() {
                return Ok(KpiResolution::new(0.0, "broken_scope"));
            }
            let value = sqlx::query_scalar::<_, i64>(
                r#"SELECT COALESCE(SUM(CASE
                       WHEN $1 = 'income' AND type = 'income' THEN amount
                       WHEN $1 = 'expense' AND type = 'expense' THEN amount
                       WHEN $1 = 'net' AND type = 'income' THEN amount
                       WHEN $1 = 'net' AND type = 'expense' THEN -amount
                       ELSE 0 END), 0)::bigint
                   FROM transactions
                   WHERE currency = $2
                     AND ($3 = 'all'
                       OR ($3 = 'general' AND project_id IS NULL)
                       OR ($3 = 'project' AND project_id = $4))
                     AND ($5 = 'all' OR status = $5)
                     AND ($6::timestamptz IS NULL OR date >= $6)
                     AND ($7::timestamptz IS NULL OR date < $7)
                     AND ($8::text IS NULL OR category = $8)"#,
            )
            .bind(&definition.metric)
            .bind(&definition.currency)
            .bind(&definition.scope)
            .bind(definition.project_id)
            .bind(&definition.status)
            .bind(definition.from)
            .bind(definition.to)
            .bind(definition.category.as_deref())
            .fetch_one(&state.db)
            .await?;
            Ok(KpiResolution::new(
                crate::services::currency::minor_units_to_major(value, &definition.currency)?,
                "ready",
            ))
        }
        _ => Ok(KpiResolution::new(kr.current_value, "ready")),
    }
}

async fn fetch_key_result_row(
    state: &AppState,
    id: Uuid,
    goal_id: Option<Uuid>,
) -> AppResult<KeyResultRow> {
    sqlx::query_as::<_, KeyResultRow>(
        r#"SELECT id, goal_id, title, kpi_type, target_value,
                  current_value, unit, finance_metric, finance_currency,
                  finance_scope, finance_project_id, finance_status,
                  finance_from, finance_to, finance_category,
                  created_at, updated_at
           FROM key_results
           WHERE id = $1 AND ($2::uuid IS NULL OR goal_id = $2)"#,
    )
    .bind(id)
    .bind(goal_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("key_result {id} not found")))
}

#[derive(Debug)]
struct KpiResolution {
    value: f64,
    status: &'static str,
}

impl KpiResolution {
    fn new(value: f64, status: &'static str) -> Self {
        Self { value, status }
    }
}

#[derive(Debug)]
struct PersistedFinanceDefinition {
    metric: String,
    currency: String,
    scope: String,
    project_id: Option<Uuid>,
    status: String,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    category: Option<String>,
}

fn persisted_finance_definition(kr: &KeyResultRow) -> Option<PersistedFinanceDefinition> {
    Some(PersistedFinanceDefinition {
        metric: kr.finance_metric.clone()?,
        currency: kr.finance_currency.clone()?,
        scope: kr.finance_scope.clone()?,
        project_id: kr.finance_project_id,
        status: kr.finance_status.clone()?,
        from: kr.finance_from,
        to: kr.finance_to,
        category: kr.finance_category.clone(),
    })
}

async fn normalize_finance_definition(
    state: &AppState,
    kpi_type: &str,
    definition: Option<FinanceKpiDefinition>,
) -> AppResult<Option<PersistedFinanceDefinition>> {
    if kpi_type != "finance" {
        if definition.is_some() {
            return Err(AppError::BadRequest(
                "financeDefinition is only valid for finance key results".to_string(),
            ));
        }
        return Ok(None);
    }
    let definition = definition.ok_or_else(|| {
        AppError::BadRequest("finance key results require financeDefinition".to_string())
    })?;
    if !matches!(definition.metric.as_str(), "income" | "expense" | "net") {
        return Err(AppError::BadRequest(
            "invalid financeDefinition.metric".to_string(),
        ));
    }
    let currency = crate::services::currency::normalize_iso_currency(&definition.currency)?;
    if !matches!(definition.scope.as_str(), "all" | "general" | "project") {
        return Err(AppError::BadRequest(
            "invalid financeDefinition.scope".to_string(),
        ));
    }
    if !matches!(definition.status.as_str(), "all" | "cleared" | "pending") {
        return Err(AppError::BadRequest(
            "invalid financeDefinition.status".to_string(),
        ));
    }
    let project_id = definition
        .project_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|err| AppError::BadRequest(format!("invalid finance projectId: {err}")))?;
    if definition.scope == "project" && project_id.is_none() {
        return Err(AppError::BadRequest(
            "financeDefinition.scope=project requires projectId".to_string(),
        ));
    }
    if definition.scope != "project" && project_id.is_some() {
        return Err(AppError::BadRequest(
            "finance projectId is only valid for project scope".to_string(),
        ));
    }
    if let Some(project_id) = project_id {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)")
                .bind(project_id)
                .fetch_one(&state.db)
                .await?;
        if !exists {
            return Err(AppError::BadRequest(format!(
                "finance project {project_id} not found"
            )));
        }
    }
    let from = parse_finance_date(definition.from.as_deref(), "from")?;
    let to = parse_finance_date(definition.to.as_deref(), "to")?;
    if from.zip(to).is_some_and(|(from, to)| from >= to) {
        return Err(AppError::BadRequest(
            "financeDefinition.from must be before to".to_string(),
        ));
    }
    Ok(Some(PersistedFinanceDefinition {
        metric: definition.metric,
        currency,
        scope: definition.scope,
        project_id,
        status: definition.status,
        from,
        to,
        category: definition
            .category
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    }))
}

fn parse_finance_date(value: Option<&str>, field: &str) -> AppResult<Option<DateTime<Utc>>> {
    value
        .map(DateTime::parse_from_rfc3339)
        .transpose()
        .map(|value| value.map(|value| value.with_timezone(&Utc)))
        .map_err(|err| AppError::BadRequest(format!("invalid financeDefinition.{field}: {err}")))
}

async fn task_assignment_summary(
    state: &AppState,
    goal_id: Uuid,
) -> AppResult<TaskAssignmentSummary> {
    let (assigned, completed) = sqlx::query_as::<_, (i64, i64)>(
        r#"SELECT COUNT(*)::bigint,
                  COUNT(*) FILTER (WHERE ts.is_done)::bigint
           FROM goal_tasks gt
           INNER JOIN tasks t ON t.id = gt.task_id AND t.deleted_at IS NULL
           INNER JOIN task_statuses ts ON ts.slug = t.status
           WHERE gt.goal_id = $1"#,
    )
    .bind(goal_id)
    .fetch_one(&state.db)
    .await?;
    Ok(TaskAssignmentSummary {
        assigned,
        completed,
        has_assignment: assigned > 0,
    })
}

/// Batch-load linked tasks for a set of key result IDs.
///
/// Returns a map from KR ID to its linked tasks. KRs with no linked tasks
/// are absent from the map (callers default to empty). Uses a single query
/// to avoid N+1 when loading a goal with many KRs.
async fn fetch_linked_tasks_for_krs(
    state: &AppState,
    kr_ids: &[Uuid],
) -> AppResult<std::collections::HashMap<Uuid, Vec<LinkedTask>>> {
    if kr_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let rows = sqlx::query_as::<_, LinkedTaskRow>(
        r#"SELECT gt.key_result_id, t.id, t.title, t.status, t.priority, t.due_date
           FROM goal_tasks gt
           JOIN tasks t ON t.id = gt.task_id AND t.deleted_at IS NULL
           WHERE gt.key_result_id = ANY($1)
           ORDER BY t.created_at ASC"#,
    )
    .bind(kr_ids)
    .fetch_all(&state.db)
    .await?;

    let mut map: std::collections::HashMap<Uuid, Vec<LinkedTask>> =
        std::collections::HashMap::new();
    for row in rows {
        let task = LinkedTask {
            id: row.id.to_string(),
            title: row.title,
            status: row.status,
            priority: row.priority,
            due_date: row.due_date.map(|d| d.to_rfc3339()),
        };
        map.entry(row.key_result_id).or_default().push(task);
    }
    Ok(map)
}

// ---- KR-Task link operations ----

/// POST /api/goals/{id}/key-results/{krId}/tasks
///
/// Links a task to a specific key result. Also upserts the goal-level row
/// (key_result_id IS NULL) so that the goal-level task assignment count
/// stays consistent.
pub async fn link_task_to_kr(
    state: &AppState,
    goal_id: Uuid,
    kr_id: Uuid,
    req: LinkTaskRequest,
) -> AppResult<KeyResultResponse> {
    // Validate the KR exists and belongs to the goal.
    let kr_row = fetch_key_result_row(state, kr_id, Some(goal_id)).await?;

    // Validate the task exists and is not soft-deleted.
    let task_id = Uuid::parse_str(&req.task_id)
        .map_err(|err| AppError::BadRequest(format!("invalid taskId: {err}")))?;
    let task_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = $1 AND deleted_at IS NULL)",
    )
    .bind(task_id)
    .fetch_one(&state.db)
    .await?;
    if !task_exists {
        return Err(AppError::NotFound(format!("task {task_id} not found")));
    }

    // Upsert the KR-scoped link. ON CONFLICT on the partial unique index
    // (key_result_id, task_id) handles idempotent re-linking.
    sqlx::query(
        r#"INSERT INTO goal_tasks (goal_id, task_id, key_result_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (key_result_id, task_id) WHERE key_result_id IS NOT NULL DO NOTHING"#,
    )
    .bind(goal_id)
    .bind(task_id)
    .bind(kr_id)
    .execute(&state.db)
    .await?;

    // Also ensure the goal-level link exists so the goal's
    // task_assignment_summary counts it. ON CONFLICT on the PK
    // (goal_id, task_id) handles idempotency.
    sqlx::query(
        r#"INSERT INTO goal_tasks (goal_id, task_id, key_result_id)
           VALUES ($1, $2, NULL)
           ON CONFLICT (goal_id, task_id) DO UPDATE SET key_result_id = CASE
               WHEN goal_tasks.key_result_id IS NULL THEN NULL
               ELSE goal_tasks.key_result_id
           END"#,
    )
    .bind(goal_id)
    .bind(task_id)
    .execute(&state.db)
    .await?;

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "goal_task",
        Some(&task_id.to_string()),
        Some(
            serde_json::json!({ "goalId": goal_id.to_string(), "keyResultId": kr_id.to_string() }),
        ),
    )
    .await;

    let kr = fetch_key_result(state, kr_row.id).await?;
    Ok(KeyResultResponse { key_result: kr })
}

/// DELETE /api/goals/{id}/key-results/{krId}/tasks/{taskId}
///
/// Unlinks a task from a specific key result. Only removes the KR-scoped
/// row; the goal-level link (if any) is preserved.
pub async fn unlink_task_from_kr(
    state: &AppState,
    goal_id: Uuid,
    kr_id: Uuid,
    task_id: Uuid,
) -> AppResult<KeyResultResponse> {
    // Validate the KR exists and belongs to the goal.
    let kr_row = fetch_key_result_row(state, kr_id, Some(goal_id)).await?;

    sqlx::query!(
        r#"DELETE FROM goal_tasks
           WHERE goal_id = $1 AND task_id = $2 AND key_result_id = $3"#,
        goal_id,
        task_id,
        kr_id,
    )
    .execute(&state.db)
    .await?;

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "goal_task",
        Some(&task_id.to_string()),
        Some(
            serde_json::json!({ "goalId": goal_id.to_string(), "keyResultId": kr_id.to_string() }),
        ),
    )
    .await;

    let kr = fetch_key_result(state, kr_row.id).await?;
    Ok(KeyResultResponse { key_result: kr })
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
            finance_metric: None,
            finance_currency: None,
            finance_scope: None,
            finance_project_id: None,
            finance_status: None,
            finance_from: None,
            finance_to: None,
            finance_category: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn row_to_key_result_caps_progress_at_one_hundred() {
        let kr = row_to_key_result(key_result_row(10.0, 25.0), 25.0, "ready", vec![]);
        assert_eq!(kr.progress, 100.0);
    }

    #[test]
    fn row_to_key_result_uses_zero_progress_for_non_positive_target() {
        let kr = row_to_key_result(key_result_row(0.0, 25.0), 25.0, "ready", vec![]);
        assert_eq!(kr.progress, 0.0);
    }

    #[test]
    fn average_progress_returns_zero_for_empty_results() {
        assert_eq!(average_progress(&[]), 0.0);
    }

    #[test]
    fn average_progress_returns_mean_value() {
        let krs = vec![
            row_to_key_result(key_result_row(100.0, 25.0), 25.0, "ready", vec![]),
            row_to_key_result(key_result_row(100.0, 75.0), 75.0, "ready", vec![]),
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

    #[sqlx::test(migrations = "./migrations")]
    async fn finance_kpi_aggregates_one_currency_and_keeps_deleted_scope_broken(
        pool: sqlx::PgPool,
    ) {
        let state = AppState::new(pool.clone(), test_config());
        let goal_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO goals (title) VALUES ('Finance KPI') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let project_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO projects (name, drive_slug, drive_path)
               VALUES ('KPI project', 'kpi-project', '/drive/projects/kpi-project')
               RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        for (project, kind, amount, currency, status) in [
            (None, "income", 1_000_i64, "USD", "cleared"),
            (None, "expense", 250_i64, "USD", "cleared"),
            (None, "income", 900_i64, "USD", "pending"),
            (None, "income", 1_000_000_i64, "KRW", "cleared"),
            (Some(project_id), "income", 500_i64, "USD", "cleared"),
        ] {
            sqlx::query(
                r#"INSERT INTO transactions
                     (project_id, type, amount, currency, date, status)
                   VALUES ($1, $2, $3, $4, now(), $5)"#,
            )
            .bind(project)
            .bind(kind)
            .bind(amount)
            .bind(currency)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        }

        let general = create_key_result(
            &state,
            goal_id,
            CreateKeyResultRequest {
                title: "Cleared USD net".to_string(),
                kpi_type: Some("finance".to_string()),
                target_value: Some(1_000.0),
                current_value: None,
                unit: None,
                finance_definition: Some(FinanceKpiDefinition {
                    metric: "net".to_string(),
                    currency: "usd".to_string(),
                    scope: "general".to_string(),
                    project_id: None,
                    status: "cleared".to_string(),
                    from: None,
                    to: None,
                    category: None,
                }),
            },
        )
        .await
        .unwrap()
        .key_result;
        assert_eq!(general.current_value, 7.5);
        assert_eq!(general.unit, "USD");
        assert_eq!(general.calculation_status, "ready");

        let project = create_key_result(
            &state,
            goal_id,
            CreateKeyResultRequest {
                title: "Project income".to_string(),
                kpi_type: Some("finance".to_string()),
                target_value: Some(1_000.0),
                current_value: None,
                unit: None,
                finance_definition: Some(FinanceKpiDefinition {
                    metric: "income".to_string(),
                    currency: "USD".to_string(),
                    scope: "project".to_string(),
                    project_id: Some(project_id.to_string()),
                    status: "cleared".to_string(),
                    from: None,
                    to: None,
                    category: None,
                }),
            },
        )
        .await
        .unwrap()
        .key_result;
        assert_eq!(project.current_value, 5.0);

        sqlx::query("DELETE FROM projects WHERE id = $1")
            .bind(project_id)
            .execute(&pool)
            .await
            .unwrap();
        let broken = fetch_key_result(&state, Uuid::parse_str(&project.id).unwrap())
            .await
            .unwrap();
        assert_eq!(broken.current_value, 0.0);
        assert_eq!(broken.calculation_status, "broken_scope");
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
