//! Durable agent-run row access.
//!
//! Centralizing the complete column projection prevents lifecycle commands,
//! lease recovery, and API projections from silently loading different run
//! identities as the schema evolves.

use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::AgentRunRow;

pub(super) fn run_select() -> String {
    format!("SELECT {} FROM agent_runs", run_columns())
}

pub(super) fn run_columns() -> &'static str {
    "id, session_id, agent_profile, trigger_type, trigger_ref, parent_run_id, \
     parent_event_id, delegate_index, project_id, status, objective, prompt_version, authorization_context, \
     lease_owner, lease_epoch, next_event_sequence, lease_expires_at, cancel_requested_at, started_at, \
     heartbeat_at, completed_at, error_code, usage, created_at"
}

pub(super) async fn fetch_run_row(pool: &sqlx::PgPool, id: Uuid) -> AppResult<AgentRunRow> {
    sqlx::query_as::<_, AgentRunRow>(&format!("{} WHERE id = $1", run_select()))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent run {id} not found")))
}
