//! Stable API and execution projections for durable Decisions.

use serde_json::Value;

use crate::agent::execution::DurableDecision;
use crate::models::decision::DecisionView;

use super::validation::approval_review_projection;
use super::DecisionRow;

pub(super) fn row_to_durable(row: DecisionRow) -> DurableDecision {
    DurableDecision {
        id: row.id,
        session_id: row.session_id,
        question: row.question,
        choices: row
            .choices
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        created_at: row.created_at.to_rfc3339(),
    }
}

pub(super) fn row_to_view(row: DecisionRow) -> DecisionView {
    DecisionView {
        id: row.id.to_string(),
        run_id: row.run_id.to_string(),
        session_id: row.session_id.map(|id| id.to_string()),
        cron_job_id: row.cron_job_id,
        kind: row.kind,
        context: row.context,
        reason: row.reason,
        question: row.question,
        choices: row.choices,
        suspend: row.suspend,
        status: row.status,
        answer: row.answer,
        proposed_action: row.proposed_action.as_ref().map(approval_review_projection),
        target_version: row.target_version,
        expires_at: row.expires_at.map(|time| time.to_rfc3339()),
        created_at: row.created_at.to_rfc3339(),
        resolved_at: row.resolved_at.map(|time| time.to_rfc3339()),
    }
}

pub(super) fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}
