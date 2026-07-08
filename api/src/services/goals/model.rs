use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::models::goal::{Goal, KeyResult};

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
    pub(super) created_at: DateTime<Utc>,
    pub(super) updated_at: DateTime<Utc>,
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
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

pub(super) fn row_to_key_result(row: KeyResultRow, current_value: f64) -> KeyResult {
    let progress = if row.target_value > 0.0 {
        (current_value / row.target_value * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    KeyResult {
        id: row.id.to_string(),
        goal_id: row.goal_id.to_string(),
        title: row.title,
        kpi_type: row.kpi_type,
        target_value: row.target_value,
        current_value,
        unit: row.unit,
        progress,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}
