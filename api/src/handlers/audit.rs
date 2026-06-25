//! Audit log HTTP handler.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::Json;
use axum::Router;

use crate::error::AppResult;
use crate::models::audit::{AuditLogQuery, AuditLogsResponse};
use crate::services::audit_logs;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/audit-logs", get(list_audit_logs))
}

pub async fn list_audit_logs(
    State(state): State<Arc<AppState>>,
    Query(q): Query<AuditLogQuery>,
) -> AppResult<Json<AuditLogsResponse>> {
    Ok(Json(audit_logs::list_audit_logs(&state, q).await?))
}
