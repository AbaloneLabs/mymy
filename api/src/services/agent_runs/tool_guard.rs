//! Durable tool authorization revalidation.
//!
//! Tool schemas describe intent, but execution rechecks the active lease,
//! session identity, current permissions, target revision, and durable user
//! approval immediately before side effects. This closes the time-of-check to
//! time-of-use gap across long model turns and queued decisions.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::agent::execution::{SessionTrigger, ToolExecutionContext, ToolExecutionGuard};
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
    ) -> Result<(), String> {
        if context.cancellation.is_cancelled() {
            return Err("run cancellation was requested before tool start".to_string());
        }
        if matches!(context.trigger, SessionTrigger::Wake) && capability.effect != ToolEffect::Read
        {
            return Err(
                "proactive wake discovery is read-only; create a visible proposal instead"
                    .to_string(),
            );
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
        .map_err(|err| format!("tool origin revalidation failed: {err}"))?;
        if !origin_valid {
            return Err(
                "run ownership, session, agent, or project changed before tool execution"
                    .to_string(),
            );
        }

        if let Some((domain, write)) = permission_domain_for_toolset(toolset) {
            let policy = crate::services::agent_permissions::load_policy(
                &self.state,
                &context.agent_profile,
            )
            .await
            .map_err(|err| format!("tool permission revalidation failed: {err}"))?;
            let permitted = if write {
                policy.can_write(domain)
            } else {
                policy.can_read(domain)
            };
            if !permitted {
                return Err("agent tool permission changed before execution".to_string());
            }
        }

        let autonomous = !matches!(context.trigger, SessionTrigger::Chat)
            || !context.authorization.explicit_user_action;
        let approval_required = capability.requires_approval(autonomous);
        let action = crate::agent::tools::proposed_action_descriptor(
            tool_name,
            capability,
            contract_fingerprint,
            arguments,
        );
        let action_hash = crate::agent::tools::proposed_action_hash(&action);
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
                .map_err(|err| err.to_string())?;
            }
        }
        let approved = context
            .authorization
            .approval_ceiling
            .get("approvedActionHashes")
            .and_then(Value::as_array)
            .is_some_and(|hashes| {
                hashes
                    .iter()
                    .any(|hash| hash.as_str() == Some(&action_hash))
            });
        if approval_required && !approved {
            return Err(
                "this action requires a durable user decision before autonomous execution"
                    .to_string(),
            );
        }
        if approval_required && approved {
            crate::services::decisions::validate_approved_action_target(
                &self.state,
                context.run_id,
                &action_hash,
            )
            .await
            .map_err(|err| err.to_string())?;
        }
        Ok(())
    }
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
}
