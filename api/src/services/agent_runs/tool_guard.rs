//! Durable tool authorization and deterministic write-safety revalidation.
//!
//! Tool schemas describe intent, but execution rechecks the active lease,
//! session identity, current permissions, target revision, and durable user
//! safety immediately before side effects. Safety verdicts never become user
//! Decisions, which keeps security invariants separate from product judgment.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::agent::execution::{
    SessionTrigger, ToolExecutionContext, ToolExecutionGuard, ToolGuardError,
};
use crate::agent::security::{
    detect_dangerous_command, redact_sensitive_text, scan_for_threats, ThreatScope,
};
use crate::agent::tools::{ToolCapability, ToolEffect};
use crate::state::AppState;

struct DurableToolExecutionGuard {
    state: AppState,
}

pub(crate) fn tool_execution_guard(state: AppState) -> Arc<dyn ToolExecutionGuard> {
    Arc::new(DurableToolExecutionGuard { state })
}

#[async_trait]
impl ToolExecutionGuard for DurableToolExecutionGuard {
    async fn validate(
        &self,
        context: &ToolExecutionContext,
        tool_name: &str,
        toolset: &str,
        capability: &ToolCapability,
        contract_fingerprint: &str,
        arguments: &Value,
    ) -> Result<(), ToolGuardError> {
        if context.cancellation.is_cancelled() {
            return Err(ToolGuardError::denied(
                "run_cancelled",
                "Run cancellation was requested before tool start.",
                "cancelled Runs cannot start new effects",
                "Stop this branch and report the cancellation.",
            ));
        }
        if matches!(context.trigger, SessionTrigger::Wake) && capability.effect != ToolEffect::Read
        {
            return Err(ToolGuardError::denied(
                "wake_read_only",
                "Proactive wake discovery is read-only; create a visible proposal instead.",
                "wake discovery cannot mutate state",
                "Continue with read-only discovery or leave a visible proposal.",
            ));
        }
        let origin_valid = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                 SELECT 1
                 FROM agent_runs r
                 LEFT JOIN chat_sessions s ON s.id = r.session_id
                 INNER JOIN native_agents a ON a.profile = r.agent_profile
                 WHERE r.id = $1 AND r.lease_epoch = $2 AND r.status = 'running'
                   AND r.cancel_requested_at IS NULL
                   AND r.agent_profile = $3
                   AND r.project_id IS NOT DISTINCT FROM $4
                   AND r.session_id IS NOT DISTINCT FROM $5
                   AND (r.session_id IS NULL OR (
                     s.profile = r.agent_profile
                     AND s.project_id IS NOT DISTINCT FROM r.project_id
                   ))
               )"#,
        )
        .bind(context.run_id)
        .bind(context.lease_epoch)
        .bind(&context.agent_profile)
        .bind(context.project_id)
        .bind(context.session_id)
        .fetch_one(&self.state.db)
        .await
        .map_err(|_| {
            ToolGuardError::denied(
                "origin_revalidation_failed",
                "Tool origin could not be revalidated.",
                "effects require a current owned Run lease",
                "Stop this branch and allow the Run to be retried from durable state.",
            )
        })?;
        if !origin_valid {
            return Err(ToolGuardError::denied(
                "origin_scope_changed",
                "Run ownership, session, agent, or project changed before tool execution.",
                "effects remain bound to the originating agent and project",
                "Re-read the current Run state before attempting different work.",
            ));
        }

        let mut permission_fingerprint = None;
        if let Some((domain, write)) = permission_domain_for_toolset(toolset) {
            let policy = crate::services::agent_permissions::load_policy(
                &self.state,
                &context.agent_profile,
            )
            .await
            .map_err(|_| {
                ToolGuardError::denied(
                    "permission_revalidation_failed",
                    "Agent access could not be revalidated.",
                    "effects require a current agent access policy",
                    "Stop this branch and report that access could not be verified.",
                )
            })?;
            let permitted = if write {
                policy.can_write(domain)
            } else {
                policy.can_read(domain)
            };
            if !permitted {
                return Err(ToolGuardError::denied(
                    "agent_access_denied",
                    "The owning agent's access policy does not permit this operation.",
                    "each agent's configured domain access is enforced at execution time",
                    "Continue without this operation or report the configured restriction.",
                ));
            }
            permission_fingerprint = Some(policy.fingerprint());
        }

        let expected_version = expected_target_version(arguments);
        if capability.effect != ToolEffect::Read {
            if let Some(expected_version) = expected_version {
                crate::services::decisions::validate_resource_target_version(
                    &self.state,
                    &context.agent_profile,
                    &capability.resource_key(arguments),
                    &expected_version,
                )
                .await
                .map_err(|_| {
                    ToolGuardError::denied(
                        "stale_target",
                        "The target changed before tool execution.",
                        "writes must bind to the current target version",
                        "Read the live resource, use its real current version, and construct a new call.",
                    )
                })?;
            }
            if let Err(error) = inspect_write(context, tool_name, capability, arguments) {
                let resource_key = capability.resource_key(arguments);
                crate::services::agent_runs::append_audit_event_for_context(
                    &self.state,
                    context,
                    "write_safety_inspected",
                    serde_json::json!({
                        "type": "write_safety_inspected",
                        "verdict": "deny",
                        "tool": tool_name,
                        "effect": capability.effect,
                        "resource_key": resource_key,
                        "reason_code": error.code,
                        "operation_state": error.operation_state,
                    }),
                    Some(&format!("write-safety:{}", context.invocation_id)),
                )
                .await
                .map_err(|_| {
                    ToolGuardError::denied(
                        "safety_audit_unavailable",
                        "The write safety denial could not be recorded.",
                        "state-changing operations require a durable safety audit",
                        "Stop this branch and retry only after audit storage is available.",
                    )
                })?;
                crate::services::audit::log_security_denial_safe(
                    &self.state.db,
                    tool_name,
                    &resource_key,
                    error.code,
                )
                .await;
                return Err(error);
            }
            let argument_hash = hash_arguments(arguments);
            crate::services::agent_runs::append_audit_event_for_context(
                &self.state,
                context,
                "write_safety_inspected",
                serde_json::json!({
                    "type": "write_safety_inspected",
                    "verdict": "allow",
                    "tool": tool_name,
                    "effect": capability.effect,
                    "resource_key": capability.resource_key(arguments),
                    "argument_hash": argument_hash,
                    "contract_fingerprint": contract_fingerprint,
                    "permission_fingerprint": permission_fingerprint,
                }),
                Some(&format!("write-safety:{}", context.invocation_id)),
            )
            .await
            .map_err(|_| {
                ToolGuardError::denied(
                    "safety_audit_unavailable",
                    "The write safety verdict could not be recorded.",
                    "state-changing operations require a durable safety audit",
                    "Stop this branch and retry only after audit storage is available.",
                )
            })?;
        }
        Ok(())
    }
}

fn inspect_write(
    context: &ToolExecutionContext,
    tool_name: &str,
    capability: &ToolCapability,
    arguments: &Value,
) -> Result<(), ToolGuardError> {
    let serialized = serde_json::to_string(arguments).unwrap_or_default();
    if serialized.len() > 1_000_000 {
        return Err(ToolGuardError::denied(
            "write_scope_unbounded",
            "Write arguments exceed the bounded safety-inspection limit.",
            "writes must have a bounded inspectable scope",
            "Narrow the operation to one bounded resource without including rejected payloads.",
        ));
    }
    if redact_sensitive_text(&serialized) != serialized {
        return Err(ToolGuardError::denied(
            "credential_content_denied",
            "The requested write contains credential-shaped content.",
            "credentials cannot be stored or disclosed through agent tools",
            "Remove the credential from this branch and use the dedicated credential settings when appropriate.",
        ));
    }
    if tool_name == "agent_update"
        && arguments
            .get("data")
            .and_then(|data| data.get("toolPermissions"))
            .is_some()
    {
        return Err(ToolGuardError::denied(
            "permission_escalation_denied",
            "Agents cannot change native-agent access policies through an agent tool.",
            "agent access policy changes require the authenticated user settings boundary",
            "Continue without changing access or report which configured restriction blocked the work.",
        ));
    }
    if tool_name == "agent_delete"
        && arguments.get("profile").and_then(Value::as_str) == Some(&context.agent_profile)
    {
        return Err(ToolGuardError::denied(
            "protected_agent_denied",
            "An agent cannot delete its own active identity.",
            "the active Run owner must remain valid for the Run lifetime",
            "Stop this branch and leave agent lifecycle changes to the authenticated user.",
        ));
    }
    if matches!(capability.effect, ToolEffect::Execute) {
        let executable = arguments
            .get("command")
            .or_else(|| arguments.get("code"))
            .and_then(Value::as_str);
        if let Some(dangerous) = executable.and_then(detect_dangerous_command) {
            return Err(ToolGuardError::denied(
                "dangerous_process_denied",
                format!("The process request violates a protected command boundary ({}).", dangerous.pattern_key),
                "commands cannot escape isolation, access credentials, or perform destructive host operations",
                "Use a bounded non-destructive command inside the agent workspace, or stop this branch.",
            ));
        }
    }
    if capability.effect == ToolEffect::External
        && !scan_for_threats(&serialized, ThreatScope::All).is_empty()
    {
        return Err(ToolGuardError::denied(
            "outbound_disclosure_denied",
            "The external request contains an unsafe disclosure or instruction pattern.",
            "private data cannot be sent to an undeclared or unsafe destination",
            "Remove the outbound disclosure and use a bounded request containing only intended public data.",
        ));
    }
    if capability.effect == ToolEffect::Delete
        && (arguments.get("recursive").and_then(Value::as_bool) == Some(true)
            || arguments.as_object().is_some_and(|arguments| {
                arguments.values().any(|value| {
                    value
                        .as_str()
                        .is_some_and(|value| matches!(value.trim(), "*" | "/" | "." | ".."))
                })
            }))
    {
        return Err(ToolGuardError::denied(
            "destructive_scope_denied",
            "Recursive, wildcard, or root-level deletion is not permitted.",
            "destructive operations must name one bounded recoverable target",
            "Narrow the request to one real owned resource, or stop this branch.",
        ));
    }
    Ok(())
}

fn hash_arguments(arguments: &Value) -> String {
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    hasher.update(serde_json::to_vec(arguments).unwrap_or_default());
    hex::encode(hasher.finalize())
}

fn expected_target_version(arguments: &Value) -> Option<String> {
    const KEYS: [&str; 5] = [
        "expectedVersion",
        "expectedFingerprint",
        "targetVersion",
        "version",
        "updatedAt",
    ];
    KEYS.into_iter()
        .find_map(|key| arguments.get(key))
        .or_else(|| {
            arguments
                .get("data")
                .and_then(|data| KEYS.into_iter().find_map(|key| data.get(key)))
        })
        .and_then(|value| match value {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            _ => None,
        })
}

fn permission_domain_for_toolset(
    toolset: &str,
) -> Option<(crate::models::agent::AgentToolDomain, bool)> {
    let (domain, write) = toolset
        .strip_suffix("_read")
        .map(|domain| (domain, false))
        .or_else(|| toolset.strip_suffix("_write").map(|domain| (domain, true)))?;
    crate::services::agent_permissions::parse_domain(domain)
        .ok()
        .map(|domain| (domain, write))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(profile: &str) -> ToolExecutionContext {
        ToolExecutionContext {
            run_id: uuid::Uuid::new_v4(),
            session_id: None,
            agent_profile: profile.to_string(),
            trigger: SessionTrigger::Chat,
            project_id: None,
            authorization: crate::agent::execution::AuthorizationContext::default(),
            invocation_id: "test-invocation".to_string(),
            lease_epoch: 1,
            cancellation: crate::agent::execution::RunCancellation::new(),
            guard: None,
            progress: None,
            decisions: None,
        }
    }

    #[test]
    fn target_version_accepts_top_level_and_nested_values() {
        assert_eq!(
            expected_target_version(&serde_json::json!({ "expectedFingerprint": "abc" })),
            Some("abc".to_string())
        );
        assert_eq!(
            expected_target_version(&serde_json::json!({ "data": { "version": 7 } })),
            Some("7".to_string())
        );
    }

    #[test]
    fn bounded_owned_write_is_allowed_by_deterministic_inspection() {
        inspect_write(
            &context("writer"),
            "tasks_create",
            &ToolCapability::mutation(ToolEffect::Create, "task"),
            &serde_json::json!({"data": {"title": "Prepare the report"}}),
        )
        .unwrap();
    }

    #[test]
    fn permission_escalation_and_self_deletion_fail_closed() {
        let escalation = inspect_write(
            &context("writer"),
            "agent_update",
            &ToolCapability::mutation(ToolEffect::Update, "agent"),
            &serde_json::json!({"profile": "writer", "data": {"toolPermissions": []}}),
        )
        .unwrap_err();
        assert_eq!(escalation.code, "permission_escalation_denied");
        assert_eq!(escalation.operation_state, "not_started");

        let deletion = inspect_write(
            &context("writer"),
            "agent_delete",
            &ToolCapability::mutation(ToolEffect::Delete, "agent"),
            &serde_json::json!({"profile": "writer"}),
        )
        .unwrap_err();
        assert_eq!(deletion.code, "protected_agent_denied");
    }

    #[test]
    fn dangerous_process_and_unbounded_delete_fail_closed() {
        let process = inspect_write(
            &context("writer"),
            "terminal",
            &ToolCapability::process(),
            &serde_json::json!({"command": "rm -rf /"}),
        )
        .unwrap_err();
        assert_eq!(process.code, "dangerous_process_denied");

        let deletion = inspect_write(
            &context("writer"),
            "drive_delete",
            &ToolCapability::mutation(ToolEffect::Delete, "file"),
            &serde_json::json!({"path": "*", "recursive": true}),
        )
        .unwrap_err();
        assert_eq!(deletion.code, "destructive_scope_denied");
    }
}
