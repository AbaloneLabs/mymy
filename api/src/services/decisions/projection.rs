//! Stable API and execution projections for durable Decisions.

use serde_json::Value;

use crate::agent::execution::DurableDecision;
use crate::models::decision::DecisionView;

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
        suspend: row.suspend,
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
        expires_at: row.expires_at.map(|time| time.to_rfc3339()),
        created_at: row.created_at.to_rfc3339(),
        resolved_at: row.resolved_at.map(|time| time.to_rfc3339()),
    }
}

pub(super) fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use uuid::Uuid;

    use super::*;

    #[test]
    fn semantic_decision_projection_excludes_execution_authority() {
        let view = row_to_view(DecisionRow {
            id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
            session_id: None,
            cron_job_id: None,
            kind: "choice".to_string(),
            context: "Agent requires user input".to_string(),
            reason: "The choice changes the requested output.".to_string(),
            question: "Which format should be used?".to_string(),
            choices: serde_json::json!(["document", "spreadsheet"]),
            suspend: false,
            status: "pending".to_string(),
            answer: None,
            expires_at: None,
            created_at: Utc::now(),
            resolved_at: None,
        });
        let projection = serde_json::to_value(view).unwrap();
        assert_eq!(projection["kind"], "choice");
        assert!(projection.get("proposedAction").is_none());
        assert!(projection.get("proposedActionHash").is_none());
        assert!(projection.get("approvalPolicy").is_none());
        assert!(projection.get("targetVersion").is_none());
    }
}
