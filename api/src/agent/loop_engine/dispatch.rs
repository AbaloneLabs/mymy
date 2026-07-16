//! Tool dispatch policy independent from turn streaming.
//!
//! The provider loop decides when to dispatch, while this module decides
//! whether a call is executable, needs explicit user judgment, or can join a
//! safe parallel batch. Keeping that policy in one place prevents sequential
//! and parallel execution from applying different Decision or delegation rules.

use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::agent::clarify::{normalize_choices, ClarifyGate, ClarifyRequest};
use crate::agent::execution::ToolExecutionContext;
use crate::agent::providers::types::ToolCall;
use crate::agent::tools::{decision_argument_error, tool_error, ToolRegistry};

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
        blocking: bool,
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
            "decision" | "clarify" => self.evaluate_clarify(call).await,
            "delegate_task" => self.evaluate_delegate(call),
            _ => ToolDispatch::Execute,
        }
    }

    pub(super) fn parallel_batch_eligible(&self, calls: &[ToolCall]) -> bool {
        if calls.len() < 2 {
            return false;
        }
        let mut resources = HashSet::new();
        calls.iter().all(|call| {
            if !tool_is_allowed(self.allowed_tool_names, &call.name)
                || matches!(call.name.as_str(), "decision" | "clarify" | "delegate_task")
            {
                return false;
            }
            let Ok(arguments) = serde_json::from_str::<Value>(&call.arguments) else {
                return false;
            };
            let Some(capability) = self
                .registry
                .capability_for_arguments(&call.name, &arguments)
            else {
                return false;
            };
            if !capability.parallel_safe() {
                return false;
            }
            resources.insert(capability.resource_key(&arguments))
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
        let Some(blocking) = args.get("blocking").and_then(Value::as_bool) else {
            return ToolDispatch::Blocked(decision_argument_error());
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
                blocking,
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
