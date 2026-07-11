//! Stable API projections for durable run rows.
//!
//! Repository rows deliberately keep database-native types. Converting them
//! here prevents handlers and lifecycle commands from each inventing slightly
//! different timestamps, identifiers, or terminal-state semantics.

use crate::models::agent_run::{AgentRunEventView, AgentRunView, SessionRunInputView};

use super::{AgentRunEventRow, AgentRunRow, SessionRunInputRow};

pub(super) fn run_to_view(row: AgentRunRow) -> AgentRunView {
    AgentRunView {
        id: row.id.to_string(),
        session_id: row.session_id.map(|id| id.to_string()),
        agent_profile: row.agent_profile,
        trigger_type: row.trigger_type,
        trigger_ref: row.trigger_ref,
        parent_run_id: row.parent_run_id.map(|id| id.to_string()),
        parent_event_id: row.parent_event_id.map(|id| id.to_string()),
        delegate_index: row.delegate_index,
        project_id: row.project_id.map(|id| id.to_string()),
        status: row.status,
        objective: row.objective,
        prompt_version: row.prompt_version,
        lease_epoch: row.lease_epoch,
        latest_sequence: row.next_event_sequence,
        lease_expires_at: row.lease_expires_at.map(|time| time.to_rfc3339()),
        cancel_requested_at: row.cancel_requested_at.map(|time| time.to_rfc3339()),
        started_at: row.started_at.map(|time| time.to_rfc3339()),
        heartbeat_at: row.heartbeat_at.map(|time| time.to_rfc3339()),
        completed_at: row.completed_at.map(|time| time.to_rfc3339()),
        error_code: row.error_code,
        usage: row.usage,
        created_at: row.created_at.to_rfc3339(),
    }
}

pub(super) fn event_to_view(row: AgentRunEventRow) -> AgentRunEventView {
    AgentRunEventView {
        id: row.id.to_string(),
        run_id: row.run_id.to_string(),
        sequence: row.sequence,
        event_type: row.event_type,
        payload_version: row.payload_version,
        visibility: row.visibility,
        payload: row.payload,
        created_at: row.created_at.to_rfc3339(),
    }
}

pub(super) fn input_to_view(row: SessionRunInputRow) -> SessionRunInputView {
    SessionRunInputView {
        id: row.id.to_string(),
        session_id: row.session_id.to_string(),
        client_request_id: row.client_request_id,
        target_run_id: row.target_run_id.map(|id| id.to_string()),
        kind: row.kind,
        content: row.content,
        options: row.options,
        status: row.status,
        sequence: row.sequence,
        created_at: row.created_at.to_rfc3339(),
        applied_at: row.applied_at.map(|time| time.to_rfc3339()),
    }
}

pub(super) fn truncate_chars(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

pub(super) fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}
