//! Audit log service — helper functions for recording data mutations.
//!
//! The core `log_audit()` performs a single INSERT into `audit_logs`.
//! `log_audit_safe()` is a fire-and-forget wrapper: it logs failures via
//! `tracing::warn!` but never propagates the error, so audit-log write
//! failures never break business logic.

use std::future::Future;

use sqlx::PgPool;

use crate::agent::execution::ToolExecutionContext;
use crate::agent::security::redact_sensitive_text;

#[derive(Clone)]
struct RuntimeAuditActor {
    actor_id: String,
    run_id: String,
    session_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeMutationOrigin {
    pub run_id: uuid::Uuid,
}

tokio::task_local! {
    static RUNTIME_AUDIT_ACTOR: RuntimeAuditActor;
}

pub async fn with_agent_audit_actor<F>(context: &ToolExecutionContext, future: F) -> F::Output
where
    F: Future,
{
    RUNTIME_AUDIT_ACTOR
        .scope(
            RuntimeAuditActor {
                actor_id: format!("agent:{}", context.agent_profile),
                run_id: context.run_id.to_string(),
                session_id: context.session_id.map(|id| id.to_string()),
            },
            future,
        )
        .await
}

pub fn current_runtime_origin() -> Option<RuntimeMutationOrigin> {
    RUNTIME_AUDIT_ACTOR
        .try_with(|actor| {
            Some(RuntimeMutationOrigin {
                run_id: uuid::Uuid::parse_str(&actor.run_id).ok()?,
            })
        })
        .ok()
        .flatten()
}

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
    let runtime_actor = RUNTIME_AUDIT_ACTOR.try_with(Clone::clone).ok();
    let (effective_actor_type, effective_actor_id) = match runtime_actor.as_ref() {
        Some(runtime) if actor_type == "user" && actor_id == "user" => {
            ("agent".to_string(), runtime.actor_id.clone())
        }
        _ => (actor_type.to_string(), actor_id.to_string()),
    };
    let changes = match (changes, runtime_actor) {
        (Some(serde_json::Value::Object(mut object)), Some(runtime)) => {
            object.insert("agentRunId".to_string(), runtime.run_id.into());
            if let Some(session_id) = runtime.session_id {
                object.insert("sessionId".to_string(), session_id.into());
            }
            Some(serde_json::Value::Object(object))
        }
        (None, Some(runtime)) => Some(serde_json::json!({
            "agentRunId": runtime.run_id,
            "sessionId": runtime.session_id,
        })),
        (changes, None) | (changes, Some(_)) => changes,
    };
    if let Err(e) = log_audit(
        db,
        &effective_actor_type,
        &effective_actor_id,
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

pub async fn log_security_denial_safe(db: &PgPool, operation: &str, path: &str, reason: &str) {
    log_audit_safe(
        db,
        "agent",
        "agent:native",
        "deny",
        "filesystem_guard",
        Some(&redact_sensitive_text(path)),
        Some(serde_json::json!({
            "operation": operation,
            "path": redact_sensitive_text(path),
            "reason": redact_sensitive_text(reason),
        })),
    )
    .await;
}
