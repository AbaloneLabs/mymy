//! Audit log query domain operations.

use chrono::{DateTime, Utc};

use crate::error::{AppError, AppResult};
use crate::models::audit::{AuditLog, AuditLogQuery, AuditLogRow, AuditLogsResponse};
use crate::state::AppState;

/// Default and maximum page sizes for the audit log list endpoint.
const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;

/// GET /api/audit-logs
///
/// Returns audit log entries newest-first, with optional filtering and
/// limit/offset pagination.
pub async fn list_audit_logs(state: &AppState, q: AuditLogQuery) -> AppResult<AuditLogsResponse> {
    // Validate enum-like filters against known values.
    if let Some(ref a) = q.actor_type {
        validate_actor_type(a)?;
    }
    if let Some(ref a) = q.action {
        validate_action(a)?;
    }

    let start = parse_ts(q.start_date.as_deref(), "startDate")?;
    let end = parse_ts(q.end_date.as_deref(), "endDate")?;

    // Clamp pagination params to sane bounds.
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = q.offset.unwrap_or(0).max(0);

    // Single query with `($n::T IS NULL OR col = $n)` predicates. This avoids
    // enumerating every filter combination (2^5 = 32 arms), which the
    // `query_as!` macro would otherwise require for compile-time validation.
    let rows = sqlx::query_as!(
        AuditLogRow,
        r#"SELECT id, actor_type, actor_id, action, entity_type, entity_id,
                  changes, created_at
           FROM audit_logs
           WHERE ($1::text IS NULL OR actor_type = $1)
             AND ($2::text IS NULL OR entity_type = $2)
             AND ($3::text IS NULL OR action = $3)
             AND ($4::timestamptz IS NULL OR created_at >= $4)
             AND ($5::timestamptz IS NULL OR created_at < $5)
           ORDER BY created_at DESC
           LIMIT $6 OFFSET $7"#,
        q.actor_type.as_deref() as Option<&str>,
        q.entity_type.as_deref() as Option<&str>,
        q.action.as_deref() as Option<&str>,
        start,
        end,
        limit,
        offset,
    )
    .fetch_all(&state.db)
    .await?;

    // Total count for pagination (same filters, no limit/offset).
    let total_row = sqlx::query!(
        r#"SELECT COUNT(*)::bigint AS "count!: i64"
           FROM audit_logs
           WHERE ($1::text IS NULL OR actor_type = $1)
             AND ($2::text IS NULL OR entity_type = $2)
             AND ($3::text IS NULL OR action = $3)
             AND ($4::timestamptz IS NULL OR created_at >= $4)
             AND ($5::timestamptz IS NULL OR created_at < $5)"#,
        q.actor_type.as_deref() as Option<&str>,
        q.entity_type.as_deref() as Option<&str>,
        q.action.as_deref() as Option<&str>,
        start,
        end,
    )
    .fetch_one(&state.db)
    .await?;

    let logs = rows.into_iter().map(row_to_audit_log).collect();
    Ok(AuditLogsResponse {
        logs,
        total: total_row.count,
        limit,
        offset,
    })
}

// ---- helpers ----

fn row_to_audit_log(row: AuditLogRow) -> AuditLog {
    AuditLog {
        id: row.id.to_string(),
        actor_type: row.actor_type,
        actor_id: row.actor_id,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        changes: row.changes,
        created_at: row.created_at.to_rfc3339(),
    }
}

fn validate_actor_type(t: &str) -> AppResult<()> {
    if matches!(t, "user" | "agent") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid actorType: {t}")))
    }
}

fn validate_action(a: &str) -> AppResult<()> {
    if matches!(a, "create" | "update" | "delete" | "deny" | "redact") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid action: {a}")))
    }
}

/// Parse an optional RFC3339 timestamp. `None` / empty -> `None`.
fn parse_ts(s: Option<&str>, field: &str) -> AppResult<Option<DateTime<Utc>>> {
    match s.filter(|s| !s.is_empty()) {
        Some(s) => {
            let dt = DateTime::parse_from_rfc3339(s)
                .map_err(|e| AppError::BadRequest(format!("invalid {field}: {e}")))?
                .with_timezone(&Utc);
            Ok(Some(dt))
        }
        None => Ok(None),
    }
}
