//! Audit log service — helper functions for recording data mutations.
//!
//! The core `log_audit()` performs a single INSERT into `audit_logs`.
//! `log_audit_safe()` is a fire-and-forget wrapper: it logs failures via
//! `tracing::warn!` but never propagates the error, so audit-log write
//! failures never break business logic.

use sqlx::PgPool;

/// Record a single audit log entry.
///
/// Returns `Err` only if the DB INSERT fails; callers that want to ignore
/// such failures should use [`log_audit_safe`] instead.
pub async fn log_audit(
    db: &PgPool,
    actor_type: &str,  // "user" | "agent"
    actor_id: &str,    // "user" | "agent:{profile}"
    action: &str,      // "create" | "update" | "delete"
    entity_type: &str, // "note" | "task" | ...
    entity_id: Option<&str>,
    changes: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO audit_logs
             (actor_type, actor_id, action, entity_type, entity_id, changes)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
        actor_type,
        actor_id,
        action,
        entity_type,
        entity_id,
        changes as Option<serde_json::Value>,
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Fire-and-forget audit log writer.
///
/// Wraps [`log_audit`] and swallows any DB error, logging it via
/// `tracing::warn!` instead. This guarantees that a failed audit-log write
/// never causes a business operation to fail.
pub async fn log_audit_safe(
    db: &PgPool,
    actor_type: &str,
    actor_id: &str,
    action: &str,
    entity_type: &str,
    entity_id: Option<&str>,
    changes: Option<serde_json::Value>,
) {
    if let Err(e) = log_audit(
        db,
        actor_type,
        actor_id,
        action,
        entity_type,
        entity_id,
        changes,
    )
    .await
    {
        tracing::warn!(error = ?e, %entity_type, %action, "failed to write audit log");
    }
}
