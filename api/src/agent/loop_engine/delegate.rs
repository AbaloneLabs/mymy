use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;
use futures::StreamExt;
use serde::Serialize;
use uuid::Uuid;

use crate::agent::execution::{RunCancellation, ToolExecutionContext};
use crate::agent::providers::{LlmProvider, Message};
use crate::agent::security::redact_sensitive_text;
use crate::agent::tools::ToolRegistry;

use super::{AgentEvent, AgentLoop, LoopConfig};

const MAX_DELEGATE_TASKS: usize = 10;
pub(super) const MAX_DELEGATE_CONCURRENCY: usize = 5;
const MAX_DELEGATE_TURNS: u32 = 10;
const DELEGATE_BLOCKED_TOOLS: &[&str] = &["delegate_task", "decision", "clarify"];

#[derive(Debug, Clone)]
pub(crate) struct DelegateTaskSpec {
    pub(crate) index: usize,
    pub(crate) goal: String,
    pub(crate) context: Option<String>,
    pub(crate) tools: Vec<String>,
    pub(crate) max_turns: u32,
    pub(crate) max_tool_calls: Option<u32>,
    pub(crate) max_total_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
pub(crate) struct DelegateTaskResult {
    pub(crate) run_id: Option<String>,
    pub(super) index: usize,
    pub(crate) goal: String,
    pub(crate) status: String,
    pub(crate) result: String,
    pub(crate) error: Option<String>,
    pub(crate) total_api_calls: u32,
    pub(crate) total_tool_calls: u32,
    pub(crate) total_tokens: u32,
    pub(crate) allowed_tools: Vec<String>,
    #[serde(skip_serializing)]
    pub(crate) visible_events: Vec<DelegateVisibleEvent>,
}

#[derive(Debug, Clone)]
pub(crate) struct DelegateVisibleEvent {
    pub(crate) event_type: String,
    pub(crate) payload: serde_json::Value,
}

#[derive(Clone)]
pub(crate) struct DelegateRunHandle {
    pub(crate) run_id: Uuid,
    pub(crate) parent_event_id: Uuid,
    pub(crate) delegate_index: usize,
    pub(crate) lease_owner: String,
    pub(crate) lease_epoch: i64,
    pub(crate) cancellation: RunCancellation,
}

#[async_trait]
pub(crate) trait DelegateRunCoordinator: Send + Sync {
    async fn start_children(
        &self,
        parent: &ToolExecutionContext,
        parent_invocation_id: &str,
        tasks: &[DelegateTaskSpec],
    ) -> Result<Vec<DelegateRunHandle>, String>;

    async fn heartbeat_child(&self, handle: &DelegateRunHandle) -> Result<(), String>;

    async fn finish_child(
        &self,
        handle: &DelegateRunHandle,
        result: &DelegateTaskResult,
    ) -> Result<(), String>;
}

pub(super) fn parse_delegate_tasks(
    args: &serde_json::Value,
) -> Result<Vec<DelegateTaskSpec>, &'static str> {
    let Some(tasks) = args.get("tasks").and_then(serde_json::Value::as_array) else {
        return Err("delegate_task requires tasks");
    };
    let tasks = tasks
        .iter()
        .take(MAX_DELEGATE_TASKS)
        .enumerate()
        .filter_map(|(index, task)| {
            let goal = task
                .get("goal")
                .and_then(serde_json::Value::as_str)?
                .trim()
                .to_string();
            if goal.is_empty() {
                return None;
            }
            let context = task
                .get("context")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|context| !context.is_empty())
                .map(str::to_string);
            let tools = task
                .get("tools")
                .and_then(serde_json::Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|tool| !tool.is_empty())
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let max_turns = task
                .get("max_turns")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(3)
                .clamp(1, MAX_DELEGATE_TURNS as u64) as u32;
            Some(DelegateTaskSpec {
                index,
                goal,
                context,
                tools,
                max_turns,
                max_tool_calls: None,
                max_total_tokens: None,
            })
        })
        .collect::<Vec<_>>();
    if tasks.is_empty() {
        return Err("delegate_task requires at least one non-empty goal");
    }
    Ok(tasks)
}

pub(super) fn is_delegate_tool_blocked(tool_name: &str) -> bool {
    DELEGATE_BLOCKED_TOOLS.contains(&tool_name)
}

pub(super) async fn run_delegate_child(
    provider: Arc<dyn LlmProvider>,
    registry: Arc<ToolRegistry>,
    parent_system_prompt: String,
    available_tools: HashSet<String>,
    task: DelegateTaskSpec,
    execution_context: Option<ToolExecutionContext>,
) -> DelegateTaskResult {
    let allowed_tools = resolve_delegate_tools(&task, &available_tools, &registry);
    let mut messages = vec![Message::user(build_delegate_user_prompt(&task))];
    let mut child_loop = AgentLoop::new(
        provider,
        registry,
        LoopConfig {
            max_iterations: task.max_turns,
            max_api_calls: task.max_turns,
            max_empty_responses: 1,
        },
        None,
    )
    .with_allowed_tools(allowed_tools.iter().cloned().collect());
    if let Some(context) = execution_context {
        child_loop.set_execution_context(context);
    }
    let child_system_prompt = build_delegate_system_prompt(&parent_system_prompt);
    let mut result = String::new();
    let mut error = None;
    let mut total_api_calls = 0;
    let mut total_tool_calls = 0;
    let mut total_tokens = 0_u32;
    let mut visible_events = Vec::new();
    let mut events = child_loop.run(&child_system_prompt, &mut messages);
    while let Some(event) = events.next().await {
        match event {
            AgentEvent::TextDelta(text) => result.push_str(&text),
            AgentEvent::Error(message) => {
                error = Some(message);
            }
            AgentEvent::ToolCallStarted {
                call_id,
                tool_name,
                arguments,
                resource_key,
                capability,
            } => visible_events.push(DelegateVisibleEvent {
                event_type: "tool_call_start".to_string(),
                payload: serde_json::json!({
                    "type": "tool_call_start",
                    "call_id": call_id,
                    "tool_name": tool_name,
                    "arguments": arguments,
                    "resource_key": resource_key,
                    "capability": capability,
                }),
            }),
            AgentEvent::ToolCallFinished {
                call_id,
                result,
                error,
                duration_ms,
            } => visible_events.push(DelegateVisibleEvent {
                event_type: "tool_call_finish".to_string(),
                payload: serde_json::json!({
                    "type": "tool_call_finish",
                    "call_id": call_id,
                    "result": result,
                    "error": error,
                    "duration_ms": duration_ms,
                }),
            }),
            AgentEvent::Done {
                total_api_calls: api_calls,
                total_tool_calls: tool_calls,
            } => {
                total_api_calls = api_calls;
                total_tool_calls = tool_calls;
            }
            AgentEvent::TurnCompleted { usage, .. } => {
                total_tokens = total_tokens.saturating_add(usage.total_tokens);
            }
            _ => {}
        }
    }
    let status = if error.is_some() {
        "failed"
    } else {
        "completed"
    };
    DelegateTaskResult {
        run_id: execution_context_run_id(&child_loop),
        index: task.index,
        goal: task.goal,
        status: status.to_string(),
        result: redact_sensitive_text(result.trim()),
        error,
        total_api_calls,
        total_tool_calls,
        total_tokens,
        allowed_tools,
        visible_events,
    }
}

fn execution_context_run_id(child_loop: &AgentLoop) -> Option<String> {
    child_loop
        .execution_context
        .as_ref()
        .map(|context| context.run_id.to_string())
}

fn resolve_delegate_tools(
    task: &DelegateTaskSpec,
    available_tools: &HashSet<String>,
    registry: &ToolRegistry,
) -> Vec<String> {
    let requested = if task.tools.is_empty() {
        available_tools.iter().cloned().collect::<Vec<_>>()
    } else {
        task.tools.clone()
    };
    let mut tools = requested
        .into_iter()
        .filter(|tool| available_tools.contains(tool))
        .filter(|tool| !is_delegate_tool_blocked(tool.as_str()))
        .filter(|tool| registry.capability(tool).is_some())
        .collect::<Vec<_>>();
    tools.sort();
    tools.dedup();
    tools
}

fn build_delegate_system_prompt(parent_system_prompt: &str) -> String {
    format!(
        "{parent_system_prompt}\n\n[Delegated child runtime]\nYou are a non-interactive child agent. Complete only the delegated goal, return concise findings, do not ask the user for a Decision, and do not call delegation or Decision tools."
    )
}

fn build_delegate_user_prompt(task: &DelegateTaskSpec) -> String {
    match &task.context {
        Some(context) => format!(
            "Delegated goal:\n{}\n\nContext provided by parent agent:\n{}",
            task.goal, context
        ),
        None => format!("Delegated goal:\n{}", task.goal),
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use serde_json::Value;

    use super::*;
    use crate::agent::tools::{
        tool_result, tool_schema, ToolCapability, ToolEffect, ToolEntry, ToolError, ToolHandler,
    };

    struct TestTool;

    #[async_trait]
    impl ToolHandler for TestTool {
        async fn execute(&self, arguments: &Value) -> Result<String, ToolError> {
            Ok(tool_result(arguments))
        }
    }

    #[test]
    fn delegated_children_inherit_agent_authorized_writes() {
        let mut registry = ToolRegistry::new();
        for (name, capability) in [
            ("read_task", ToolCapability::read("task")),
            (
                "update_task",
                ToolCapability::mutation(ToolEffect::Update, "task"),
            ),
            (
                "decision",
                ToolCapability::mutation(ToolEffect::Create, "decision"),
            ),
        ] {
            registry.register(ToolEntry {
                name: name.to_string(),
                toolset: "test".to_string(),
                schema: tool_schema(
                    name,
                    "Exercise delegated access inheritance.",
                    serde_json::json!({"type":"object","properties":{}}),
                ),
                capability,
                handler: Arc::new(TestTool),
            });
        }
        let available = ["read_task", "update_task", "decision"]
            .into_iter()
            .map(str::to_string)
            .collect::<HashSet<_>>();
        let task = DelegateTaskSpec {
            index: 0,
            goal: "Update one task".to_string(),
            context: None,
            tools: Vec::new(),
            max_turns: 1,
            max_tool_calls: None,
            max_total_tokens: None,
        };

        assert_eq!(
            resolve_delegate_tools(&task, &available, &registry),
            vec!["read_task".to_string(), "update_task".to_string()]
        );
    }
}
