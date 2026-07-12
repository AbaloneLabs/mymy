//! API projection for durable memory rows.

use crate::models::runtime_memory::{AgentMemoryView, RunSummaryView};

use super::{MemoryRow, SummaryRow};

pub(super) fn memory_view(row: MemoryRow) -> AgentMemoryView {
    AgentMemoryView {
        id: row.id.to_string(),
        source_run_id: row.source_run_id.map(|id| id.to_string()),
        source_run_snapshot_id: row.source_run_snapshot_id,
        source_decision_id: row.source_decision_id.map(|id| id.to_string()),
        source_session_id: row.source_session_id.map(|id| id.to_string()),
        source_message_start: row.source_message_start.map(|id| id.to_string()),
        source_message_end: row.source_message_end.map(|id| id.to_string()),
        agent_profile: row.agent_profile,
        project_id: row.project_id.map(|id| id.to_string()),
        memory_type: row.memory_type,
        origin: row.origin,
        scope_kind: row.scope_kind,
        scope_id: row.scope_id,
        tier: row.tier,
        evidence_role: row.evidence_role,
        content: row.content,
        confidence: row.confidence,
        status: row.status,
        sensitivity: row.sensitivity,
        valid_from: row.valid_from.to_rfc3339(),
        valid_until: row.valid_until.map(|value| value.to_rfc3339()),
        superseded_by: row.superseded_by.map(|id| id.to_string()),
        created_at: row.created_at.to_rfc3339(),
        content_revision: row.content_revision,
        lifecycle_revision: row.lifecycle_revision,
    }
}

pub(super) fn summary_view(row: SummaryRow) -> RunSummaryView {
    RunSummaryView {
        run_id: row.run_id.to_string(),
        agent_profile: row.agent_profile,
        project_id: row.project_id.map(|id| id.to_string()),
        objective: row.objective,
        outcome: row.outcome,
        summary_text: row.summary_text,
        key_topics: row.key_topics,
        source_event_start: row.source_event_start,
        source_event_end: row.source_event_end,
        created_at: row.created_at.to_rfc3339(),
    }
}
