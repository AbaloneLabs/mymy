//! Tool dispatch policy independent from turn streaming.
//!
//! The provider loop decides when to dispatch, while this module decides
//! whether a call is executable, needs user interaction, or can join a safe
//! parallel batch. Keeping that policy in one place prevents sequential and
//! parallel execution from applying different approval or delegation rules.

use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::agent::clarify::{normalize_choices, ClarifyGate, ClarifyRequest};
use crate::agent::execution::{SessionTrigger, ToolExecutionContext};
use crate::agent::providers::types::ToolCall;
use crate::agent::tools::{tool_error, ToolRegistry};

use super::delegate;

pub(super) enum ToolDispatch {
    Execute,
    Blocked(String),
    Clarify {
        request: ClarifyRequest,
        receiver: oneshot::Receiver<String>,
    },
    DurableClarify {
        question: String,
        choices: Vec<String>,
    },
    Approval {
        question: String,
        proposed_action: Value,
        target_version: Option<String>,
    },
    Delegate {
        tasks: Vec<delegate::DelegateTaskSpec>,
    },
}

pub(super) struct ToolDispatchPolicy<'a> {
    pub(super) registry: &'a ToolRegistry,
    pub(super) allowed_tool_names: Option<&'a HashSet<String>>,
    pub(super) execution_context: Option<&'a ToolExecutionContext>,
    pub(super) clarify_gate: Option<&'a Arc<ClarifyGate>>,
    pub(super) session_id: Option<Uuid>,
}

impl ToolDispatchPolicy<'_> {
    pub(super) async fn evaluate(&self, call: &ToolCall) -> ToolDispatch {
        if !tool_is_allowed(self.allowed_tool_names, &call.name) {
            return ToolDispatch::Blocked(tool_error(&format!(
                "tool is blocked in this delegated child: {}",
                call.name
            )));
        }
        match call.name.as_str() {
            "clarify" => self.evaluate_clarify(call).await,
            "delegate_task" => self.evaluate_delegate(call),
            _ => self
                .evaluate_approval(call)
                .unwrap_or(ToolDispatch::Execute),
        }
    }

    pub(super) fn parallel_batch_eligible(&self, calls: &[ToolCall]) -> bool {
        if calls.len() < 2 {
            return false;
        }
        let autonomous = autonomous(self.execution_context);
        let mut resources = HashSet::new();
        calls.iter().all(|call| {
            if !tool_is_allowed(self.allowed_tool_names, &call.name)
                || matches!(call.name.as_str(), "clarify" | "delegate_task")
            {
                return false;
            }
            let Some(capability) = self.registry.capability(&call.name) else {
                return false;
            };
            if !capability.parallel_safe() || capability.requires_approval(autonomous) {
                return false;
            }
            let Ok(arguments) = serde_json::from_str::<Value>(&call.arguments) else {
                return false;
            };
            resources.insert(capability.resource_key(&arguments))
        })
    }

    fn evaluate_approval(&self, call: &ToolCall) -> Option<ToolDispatch> {
        let context = self.execution_context?;
        context.decisions.as_ref()?;
        let capability = self.registry.capability(&call.name)?;
        if !capability.requires_approval(autonomous(Some(context))) {
            return None;
        }
        let arguments = serde_json::from_str::<Value>(&call.arguments).ok()?;
        let proposed_action =
            crate::agent::tools::proposed_action_descriptor(&call.name, capability, &arguments);
        let action_hash = crate::agent::tools::proposed_action_hash(&proposed_action);
        let already_approved = context
            .authorization
            .approval_ceiling
            .get("approvedActionHashes")
            .and_then(Value::as_array)
            .is_some_and(|hashes| {
                hashes
                    .iter()
                    .any(|hash| hash.as_str() == Some(&action_hash))
            });
        if already_approved {
            return None;
        }
        let resource_key = capability.resource_key(&arguments);
        Some(ToolDispatch::Approval {
            question: format!(
                "Approve the {:?} action `{}` on `{}`?",
                capability.effect, call.name, resource_key
            ),
            proposed_action,
            target_version: extract_target_version(&arguments),
        })
    }

    async fn evaluate_clarify(&self, call: &ToolCall) -> ToolDispatch {
        let Ok(args) = serde_json::from_str::<Value>(&call.arguments) else {
            return ToolDispatch::Execute;
        };
        let Some(question) = args
            .get("question")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|question| !question.is_empty())
        else {
            return ToolDispatch::Execute;
        };
        let choices = normalize_choices(args.get("choices"));
        if self
            .execution_context
            .and_then(|context| context.decisions.as_ref())
            .is_some()
        {
            return ToolDispatch::DurableClarify {
                question: question.to_string(),
                choices,
            };
        }
        let (Some(gate), Some(session_id)) = (self.clarify_gate, self.session_id) else {
            return ToolDispatch::Execute;
        };
        let (request, receiver) = gate.request(session_id, question, choices).await;
        ToolDispatch::Clarify { request, receiver }
    }

    fn evaluate_delegate(&self, call: &ToolCall) -> ToolDispatch {
        let Ok(args) = serde_json::from_str::<Value>(&call.arguments) else {
            return ToolDispatch::Blocked(tool_error("invalid delegate_task arguments"));
        };
        match delegate::parse_delegate_tasks(&args) {
            Ok(tasks) => ToolDispatch::Delegate { tasks },
            Err(message) => ToolDispatch::Blocked(tool_error(message)),
        }
    }
}

pub(super) fn tool_is_allowed(allowed: Option<&HashSet<String>>, tool_name: &str) -> bool {
    match allowed {
        Some(allowed) => {
            allowed.contains(tool_name) && !delegate::is_delegate_tool_blocked(tool_name)
        }
        None => true,
    }
}

fn autonomous(context: Option<&ToolExecutionContext>) -> bool {
    context.is_some_and(|context| {
        !matches!(context.trigger, SessionTrigger::Chat)
            || !context.authorization.explicit_user_action
    })
}

fn extract_target_version(arguments: &Value) -> Option<String> {
    let keys = [
        "expectedVersion",
        "expectedFingerprint",
        "targetVersion",
        "version",
        "updatedAt",
    ];
    let direct = keys
        .into_iter()
        .find_map(|key| arguments.get(key))
        .or_else(|| {
            arguments
                .get("data")
                .and_then(|data| keys.into_iter().find_map(|key| data.get(key)))
        });
    direct.and_then(|value| match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    })
}
