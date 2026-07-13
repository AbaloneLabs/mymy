use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::models::goal::{
    FinanceKpiDefinition, Goal, KeyResult, LinkedTask, TaskAssignmentSummary,
};

/// A goal / OKR objective row.
#[derive(Debug, FromRow)]
pub(super) struct GoalRow {
    pub(super) id: Uuid,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) r#type: String,
    pub(super) period: String,
    pub(super) status: String,
    pub(super) created_at: DateTime<Utc>,
    pub(super) updated_at: DateTime<Utc>,
}

/// A key result row belonging to a goal.
#[derive(Debug, FromRow)]
pub(super) struct KeyResultRow {
    pub(super) id: Uuid,
    pub(super) goal_id: Uuid,
    pub(super) title: String,
    pub(super) kpi_type: String,
    pub(super) target_value: f64,
    pub(super) current_value: f64,
    pub(super) unit: String,
    pub(super) finance_metric: Option<String>,
    pub(super) finance_currency: Option<String>,
    pub(super) finance_scope: Option<String>,
    pub(super) finance_project_id: Option<Uuid>,
    pub(super) finance_status: Option<String>,
    pub(super) finance_from: Option<DateTime<Utc>>,
    pub(super) finance_to: Option<DateTime<Utc>>,
    pub(super) finance_category: Option<String>,
    pub(super) created_at: DateTime<Utc>,
    pub(super) updated_at: DateTime<Utc>,
}

/// A row from the joined goal_tasks + tasks query used to populate
/// `KeyResult.linked_tasks`. `key_result_id` identifies which KR this
/// task belongs to for map grouping.
#[derive(Debug, FromRow)]
pub(super) struct LinkedTaskRow {
    pub(super) key_result_id: Uuid,
    pub(super) id: Uuid,
    pub(super) title: String,
    pub(super) status: String,
    pub(super) priority: String,
    pub(super) due_date: Option<DateTime<Utc>>,
}

/// Average progress across key results (0 if empty).
pub(super) fn average_progress(krs: &[KeyResult]) -> f64 {
    if krs.is_empty() {
        return 0.0;
    }
    krs.iter().map(|kr| kr.progress).sum::<f64>() / krs.len() as f64
}

pub(super) fn row_to_goal(
    row: GoalRow,
    progress: f64,
    key_results: Option<Vec<KeyResult>>,
    task_assignment: TaskAssignmentSummary,
) -> Goal {
    Goal {
        id: row.id.to_string(),
        title: row.title,
        description: row.description,
        r#type: row.r#type,
        period: row.period,
        status: row.status,
        progress,
        key_results,
        task_assignment,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

pub(super) fn row_to_key_result(
    row: KeyResultRow,
    current_value: f64,
    calculation_status: &str,
    linked_tasks: Vec<LinkedTask>,
) -> KeyResult {
    let progress = if row.target_value > 0.0 {
        (current_value / row.target_value * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    let finance_definition = finance_definition(&row);
    KeyResult {
        id: row.id.to_string(),
        goal_id: row.goal_id.to_string(),
        title: row.title,
        kpi_type: row.kpi_type,
        target_value: row.target_value,
        current_value,
        unit: row.unit,
        progress,
        finance_definition,
        calculation_status: calculation_status.to_string(),
        linked_tasks,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

pub(super) fn finance_definition(row: &KeyResultRow) -> Option<FinanceKpiDefinition> {
    Some(FinanceKpiDefinition {
        metric: row.finance_metric.clone()?,
        currency: row.finance_currency.clone()?,
        scope: row.finance_scope.clone()?,
        project_id: row.finance_project_id.map(|id| id.to_string()),
        status: row.finance_status.clone()?,
        from: row.finance_from.map(|value| value.to_rfc3339()),
        to: row.finance_to.map(|value| value.to_rfc3339()),
        category: row.finance_category.clone(),
    })
}
