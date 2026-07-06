use std::collections::HashSet;
use std::sync::Arc;

use futures::StreamExt;
use serde::Serialize;

use crate::agent::providers::{LlmProvider, Message};
use crate::agent::security::redact_sensitive_text;
use crate::agent::tools::ToolRegistry;

use super::{AgentEvent, AgentLoop, LoopConfig};

const MAX_DELEGATE_TASKS: usize = 10;
pub(super) const MAX_DELEGATE_CONCURRENCY: usize = 5;
const MAX_DELEGATE_TURNS: u32 = 10;
const DELEGATE_BLOCKED_TOOLS: &[&str] = &["delegate_task", "clarify"];

#[derive(Debug, Clone)]
pub(super) struct DelegateTaskSpec {
    pub(super) index: usize,
    goal: String,
    context: Option<String>,
    tools: Vec<String>,
    max_turns: u32,
}

#[derive(Debug, Serialize)]
pub(super) struct DelegateTaskResult {
    pub(super) index: usize,
    goal: String,
    pub(super) status: String,
    result: String,
    error: Option<String>,
    total_api_calls: u32,
    total_tool_calls: u32,
    allowed_tools: Vec<String>,
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
) -> DelegateTaskResult {
    let allowed_tools = resolve_delegate_tools(&task, &available_tools);
    let mut messages = vec![Message::user(build_delegate_user_prompt(&task))];
    let child_loop = AgentLoop::new(
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
    let child_system_prompt = build_delegate_system_prompt(&parent_system_prompt);
    let mut result = String::new();
    let mut error = None;
    let mut total_api_calls = 0;
    let mut total_tool_calls = 0;
    let mut events = child_loop.run(&child_system_prompt, &mut messages);
    while let Some(event) = events.next().await {
        match event {
            AgentEvent::TextDelta(text) => result.push_str(&text),
            AgentEvent::Error(message) => {
                error = Some(message);
            }
            AgentEvent::Done {
                total_api_calls: api_calls,
                total_tool_calls: tool_calls,
            } => {
                total_api_calls = api_calls;
                total_tool_calls = tool_calls;
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
        index: task.index,
        goal: task.goal,
        status: status.to_string(),
        result: redact_sensitive_text(result.trim()),
        error,
        total_api_calls,
        total_tool_calls,
        allowed_tools,
    }
}

fn resolve_delegate_tools(
    task: &DelegateTaskSpec,
    available_tools: &HashSet<String>,
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
        .collect::<Vec<_>>();
    tools.sort();
    tools.dedup();
    tools
}

fn build_delegate_system_prompt(parent_system_prompt: &str) -> String {
    format!(
        "{parent_system_prompt}\n\n[Delegated child runtime]\nYou are a non-interactive child agent. Complete only the delegated goal, return concise findings, do not ask the user for clarification, and do not call delegation or clarification tools."
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
