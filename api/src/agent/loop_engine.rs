//! Native agent tool-calling loop.
//!
//! The loop is provider-agnostic: it consumes normalized stream deltas,
//! assembles a turn, dispatches tool calls, and repeats until the model stops
//! or a safety limit is reached. Session ownership stays outside the loop; the
//! caller passes mutable history and later persists the messages it cares about.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures::{stream::BoxStream, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

use crate::agent::clarify::{normalize_choices, ClarifyGate, ClarifyRequest};
use crate::agent::context::ContextManager;
use crate::agent::providers::types::{FinishReason, StreamDelta, ToolCall, Usage};
use crate::agent::providers::{LlmProvider, Message};
use crate::agent::security::{
    detect_dangerous_command, is_sensitive_path, redact_sensitive_text, ApprovalDecision,
    ApprovalGate, ApprovalRequest, DangerousMatch, Severity,
};
use crate::agent::tools::{tool_error, tool_result, ToolRegistry};

const APPROVAL_TIMEOUT_SECS: u64 = 300;
const CLARIFY_TIMEOUT_SECS: u64 = 1_800;
const MAX_DELEGATE_TASKS: usize = 10;
const MAX_DELEGATE_CONCURRENCY: usize = 5;
const MAX_DELEGATE_TURNS: u32 = 10;
const DELEGATE_BLOCKED_TOOLS: &[&str] = &["delegate_task", "clarify"];

#[derive(Debug, Clone)]
pub enum AgentEvent {
    TextDelta(String),
    ReasoningDelta(String),
    ToolCallStarted {
        call_id: String,
        tool_name: String,
        arguments: String,
    },
    ToolCallFinished {
        call_id: String,
        result: String,
        error: Option<String>,
    },
    ApprovalRequired {
        request: ApprovalRequest,
    },
    ClarifyRequired {
        request: ClarifyRequest,
    },
    TurnCompleted {
        finish_reason: FinishReason,
        usage: Usage,
    },
    ContextCompressing,
    Done {
        total_api_calls: u32,
        total_tool_calls: u32,
    },
    Error(String),
}

#[derive(Debug, Clone)]
pub struct LoopConfig {
    pub max_iterations: u32,
    pub max_api_calls: u32,
    pub max_empty_responses: u32,
}

impl Default for LoopConfig {
    fn default() -> Self {
        Self {
            max_iterations: 30,
            max_api_calls: 50,
            max_empty_responses: 2,
        }
    }
}

enum ToolApproval {
    Execute {
        approved: bool,
    },
    Blocked(String),
    Pending {
        request: ApprovalRequest,
        receiver: oneshot::Receiver<ApprovalDecision>,
        pattern_key: String,
    },
    Clarify {
        request: ClarifyRequest,
        receiver: oneshot::Receiver<String>,
    },
    Delegate {
        tasks: Vec<DelegateTaskSpec>,
    },
}

pub struct AgentLoop {
    provider: Arc<dyn LlmProvider>,
    tool_registry: Arc<ToolRegistry>,
    config: LoopConfig,
    context_manager: Option<Mutex<ContextManager>>,
    session_id: Option<Uuid>,
    approval_gate: Option<Arc<ApprovalGate>>,
    clarify_gate: Option<Arc<ClarifyGate>>,
    todo_path: Option<PathBuf>,
    allowed_tool_names: Option<HashSet<String>>,
}

impl AgentLoop {
    pub fn new(
        provider: Arc<dyn LlmProvider>,
        tool_registry: Arc<ToolRegistry>,
        config: LoopConfig,
        context_manager: Option<ContextManager>,
    ) -> Self {
        Self {
            provider,
            tool_registry,
            config,
            context_manager: context_manager.map(Mutex::new),
            session_id: None,
            approval_gate: None,
            clarify_gate: None,
            todo_path: None,
            allowed_tool_names: None,
        }
    }

    pub fn with_approval_gate(
        mut self,
        session_id: Uuid,
        approval_gate: Arc<ApprovalGate>,
    ) -> Self {
        self.session_id = Some(session_id);
        self.approval_gate = Some(approval_gate);
        self
    }

    pub fn with_clarify_gate(mut self, session_id: Uuid, clarify_gate: Arc<ClarifyGate>) -> Self {
        self.session_id = Some(session_id);
        self.clarify_gate = Some(clarify_gate);
        self
    }

    pub fn with_todo_path(mut self, todo_path: PathBuf) -> Self {
        self.todo_path = Some(todo_path);
        self
    }

    fn with_allowed_tools(mut self, allowed_tool_names: HashSet<String>) -> Self {
        self.allowed_tool_names = Some(allowed_tool_names);
        self
    }

    pub fn run<'a>(
        &'a self,
        system_prompt: &'a str,
        messages: &'a mut Vec<Message>,
    ) -> BoxStream<'a, AgentEvent> {
        Box::pin(async_stream::stream! {
            let mut total_tool_calls = 0;
            let mut empty_responses = 0;

            for iteration in 0..self.config.max_iterations {
                if iteration >= self.config.max_api_calls {
                    yield AgentEvent::Error("maximum API call limit exceeded".to_string());
                    yield AgentEvent::Done { total_api_calls: iteration, total_tool_calls };
                    return;
                }

                let api_calls = iteration + 1;
                let tools = self.visible_tool_schemas();
                let mut content = String::new();
                let mut reasoning = String::new();
                let mut finish_reason = FinishReason::Stop;
                let mut finish_seen = false;
                let mut usage = Usage::default();
                let mut tool_calls: BTreeMap<usize, ToolCall> = BTreeMap::new();

                {
                    let request_messages = messages.clone();
                    let stream_result = self.stream_with_retry(system_prompt, &request_messages, &tools).await;
                    let mut provider_stream = match stream_result {
                        Ok(stream) => stream,
                        Err(err) => {
                            yield AgentEvent::Error(format!("provider stream failed: {err}"));
                            yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                            return;
                        }
                    };

                    while let Some(delta_result) = provider_stream.next().await {
                        let delta = match delta_result {
                            Ok(delta) => delta,
                            Err(err) => {
                                yield AgentEvent::Error(format!("provider stream error: {err}"));
                                yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                return;
                            }
                        };

                        match delta {
                            StreamDelta::Text(text) => {
                                let text = redact_sensitive_text(&text);
                                content.push_str(&text);
                                yield AgentEvent::TextDelta(text);
                            }
                            StreamDelta::Reasoning(text) => {
                                let text = redact_sensitive_text(&text);
                                reasoning.push_str(&text);
                                yield AgentEvent::ReasoningDelta(text);
                            }
                            StreamDelta::ToolCallStart { index, id, name } => {
                                tool_calls.insert(index, ToolCall {
                                    id,
                                    name,
                                    arguments: String::new(),
                                });
                            }
                            StreamDelta::ToolCallArguments { index, fragment } => {
                                let entry = tool_calls.entry(index).or_insert_with(|| ToolCall {
                                    id: format!("call_{index}"),
                                    name: String::new(),
                                    arguments: String::new(),
                                });
                                entry.arguments.push_str(&fragment);
                            }
                            StreamDelta::Finish { reason, usage: delta_usage } => {
                                if delta_usage.total_tokens > 0
                                    || delta_usage.prompt_tokens > 0
                                    || delta_usage.completion_tokens > 0
                                {
                                    usage = delta_usage;
                                }
                                if !finish_seen || reason != FinishReason::Stop {
                                    finish_reason = reason;
                                    finish_seen = true;
                                }
                            }
                        }
                    }
                }

                let assembled_tool_calls: Vec<ToolCall> = tool_calls.into_values().collect();
                let content_is_empty = content.trim().is_empty() && reasoning.trim().is_empty();
                if content_is_empty && assembled_tool_calls.is_empty() && finish_reason == FinishReason::Stop {
                    empty_responses += 1;
                    if empty_responses <= self.config.max_empty_responses {
                        continue;
                    }
                    yield AgentEvent::Error("model returned repeated empty responses".to_string());
                    yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                    return;
                }
                empty_responses = 0;

                let assistant_content = if content.is_empty() { None } else { Some(content.clone()) };
                messages.push(Message::assistant_with_tools(
                    assistant_content,
                    assembled_tool_calls.clone(),
                ));

                yield AgentEvent::TurnCompleted {
                    finish_reason,
                    usage: usage.clone(),
                };

                if let Some(manager) = &self.context_manager {
                    let mut manager = manager.lock().await;
                    manager.update_usage(&usage);
                    if manager.should_compress(messages, system_prompt) {
                        yield AgentEvent::ContextCompressing;
                        if manager.compress(messages) {
                            if let Some(todo_context) = self.load_todo_injection() {
                                messages.push(Message::user(todo_context));
                            }
                        }
                    }
                }

                match finish_reason {
                    FinishReason::Stop | FinishReason::ContentFilter | FinishReason::Length => {
                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                        return;
                    }
                    FinishReason::ToolCalls => {}
                }

                if assembled_tool_calls.is_empty() {
                    yield AgentEvent::Error("provider finished with tool_calls but returned no tool calls".to_string());
                    yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                    return;
                }

                for call in assembled_tool_calls {
                    total_tool_calls += 1;
                    yield AgentEvent::ToolCallStarted {
                        call_id: call.id.clone(),
                        tool_name: call.name.clone(),
                        arguments: call.arguments.clone(),
                    };

                    let approval = self.evaluate_tool_approval(&call).await;
                    let result = match approval {
                        ToolApproval::Execute { approved } => {
                            if approved {
                                self.tool_registry.execute_approved(&call.name, &call.arguments).await
                            } else {
                                self.tool_registry.execute(&call.name, &call.arguments).await
                            }
                        }
                        ToolApproval::Blocked(result) => result,
                        ToolApproval::Pending {
                            request,
                            receiver,
                            pattern_key,
                        } => {
                            let request_id = request.request_id.clone();
                            yield AgentEvent::ApprovalRequired { request };
                            match tokio::time::timeout(
                                Duration::from_secs(APPROVAL_TIMEOUT_SECS),
                                receiver,
                            )
                            .await
                            {
                                Ok(Ok(ApprovalDecision::Approve)) => {
                                    if let (Some(gate), Some(session_id)) = (&self.approval_gate, self.session_id) {
                                        gate.remember_session_approval(session_id, pattern_key).await;
                                    }
                                    self.tool_registry.execute_approved(&call.name, &call.arguments).await
                                }
                                Ok(Ok(ApprovalDecision::Reject)) => {
                                    tool_error("user rejected tool approval")
                                }
                                Ok(Err(_)) => tool_error("approval request closed"),
                                Err(_) => {
                                    if let Some(gate) = &self.approval_gate {
                                        gate.cancel(&request_id).await;
                                    }
                                    tool_error("approval request timed out")
                                }
                            }
                        }
                        ToolApproval::Clarify { request, receiver } => {
                            let request_id = request.request_id.clone();
                            yield AgentEvent::ClarifyRequired { request };
                            match tokio::time::timeout(
                                Duration::from_secs(CLARIFY_TIMEOUT_SECS),
                                receiver,
                            )
                            .await
                            {
                                Ok(Ok(answer)) => {
                                    tool_result(&serde_json::json!({
                                        "success": true,
                                        "answer": answer,
                                    }))
                                }
                                Ok(Err(_)) => tool_error("clarify request closed"),
                                Err(_) => {
                                    if let Some(gate) = &self.clarify_gate {
                                        gate.cancel(&request_id).await;
                                    }
                                    tool_error("clarify request timed out")
                                }
                            }
                        }
                        ToolApproval::Delegate { tasks } => {
                            self.run_delegate_tasks(system_prompt, tasks).await
                        }
                    };
                    let error = serde_json::from_str::<serde_json::Value>(&result)
                        .ok()
                        .and_then(|value| value.get("error").and_then(|err| err.as_str()).map(str::to_string));

                    yield AgentEvent::ToolCallFinished {
                        call_id: call.id.clone(),
                        result: result.clone(),
                        error,
                    };
                    messages.push(Message::tool_result(call.id, result));
                }

                if iteration + 1 >= self.config.max_iterations {
                    yield AgentEvent::Error("maximum agent loop iteration limit exceeded".to_string());
                    yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                    return;
                }
            }
        })
    }

    async fn evaluate_tool_approval(&self, call: &ToolCall) -> ToolApproval {
        if !self.is_tool_allowed(&call.name) {
            return ToolApproval::Blocked(tool_error(&format!(
                "tool is blocked in this delegated child: {}",
                call.name
            )));
        }

        if call.name == "clarify" {
            return self.evaluate_clarify(call).await;
        }

        if call.name == "delegate_task" {
            return self.evaluate_delegate(call).await;
        }

        if call.name == "write_file" || call.name == "patch_file" {
            return self.evaluate_sensitive_file_write(call).await;
        }

        if call.name != "terminal" {
            return ToolApproval::Execute { approved: false };
        }

        let Ok(args) = serde_json::from_str::<serde_json::Value>(&call.arguments) else {
            return ToolApproval::Execute { approved: false };
        };
        let Some(command) = args.get("command").and_then(serde_json::Value::as_str) else {
            return ToolApproval::Execute { approved: false };
        };
        let Some(matched) = detect_dangerous_command(command) else {
            return ToolApproval::Execute { approved: false };
        };

        match matched.severity {
            Severity::Hardline => ToolApproval::Blocked(tool_error(&format!(
                "blocked: {} ({})",
                matched.description, matched.pattern_key
            ))),
            Severity::Dangerous => {
                let (Some(gate), Some(session_id)) = (&self.approval_gate, self.session_id) else {
                    return ToolApproval::Blocked(tool_error(&format!(
                        "requires approval: {} ({})",
                        matched.description, matched.pattern_key
                    )));
                };

                if gate
                    .is_approved_for_session(session_id, &matched.pattern_key)
                    .await
                {
                    return ToolApproval::Execute { approved: true };
                }

                let (request, receiver) = gate
                    .request_approval(session_id, &call.name, command, &matched)
                    .await;
                ToolApproval::Pending {
                    request,
                    receiver,
                    pattern_key: matched.pattern_key,
                }
            }
        }
    }

    async fn evaluate_clarify(&self, call: &ToolCall) -> ToolApproval {
        let Ok(args) = serde_json::from_str::<serde_json::Value>(&call.arguments) else {
            return ToolApproval::Execute { approved: false };
        };
        let Some(question) = args
            .get("question")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|question| !question.is_empty())
        else {
            return ToolApproval::Execute { approved: false };
        };
        let (Some(gate), Some(session_id)) = (&self.clarify_gate, self.session_id) else {
            return ToolApproval::Execute { approved: false };
        };
        let choices = normalize_choices(args.get("choices"));
        let (request, receiver) = gate.request(session_id, question, choices).await;
        ToolApproval::Clarify { request, receiver }
    }

    async fn evaluate_sensitive_file_write(&self, call: &ToolCall) -> ToolApproval {
        let Ok(args) = serde_json::from_str::<serde_json::Value>(&call.arguments) else {
            return ToolApproval::Execute { approved: false };
        };
        let Some(path) = args.get("path").and_then(serde_json::Value::as_str) else {
            return ToolApproval::Execute { approved: false };
        };
        if !is_sensitive_path(Path::new(path)) {
            return ToolApproval::Execute { approved: false };
        }

        let matched = DangerousMatch {
            pattern_key: format!("sensitive_file_write:{path}"),
            description: "write to sensitive file path".to_string(),
            severity: Severity::Dangerous,
        };
        let (Some(gate), Some(session_id)) = (&self.approval_gate, self.session_id) else {
            return ToolApproval::Blocked(tool_error(&format!(
                "requires approval: {} ({})",
                matched.description, matched.pattern_key
            )));
        };
        if gate
            .is_approved_for_session(session_id, &matched.pattern_key)
            .await
        {
            return ToolApproval::Execute { approved: true };
        }
        let action = format!("{} {}", call.name, path);
        let (request, receiver) = gate
            .request_approval(session_id, &call.name, action, &matched)
            .await;
        ToolApproval::Pending {
            request,
            receiver,
            pattern_key: matched.pattern_key,
        }
    }

    async fn evaluate_delegate(&self, call: &ToolCall) -> ToolApproval {
        let Ok(args) = serde_json::from_str::<serde_json::Value>(&call.arguments) else {
            return ToolApproval::Blocked(tool_error("invalid delegate_task arguments"));
        };
        let Some(tasks) = args.get("tasks").and_then(serde_json::Value::as_array) else {
            return ToolApproval::Blocked(tool_error("delegate_task requires tasks"));
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
            return ToolApproval::Blocked(tool_error(
                "delegate_task requires at least one non-empty goal",
            ));
        }
        ToolApproval::Delegate { tasks }
    }

    async fn run_delegate_tasks(
        &self,
        system_prompt: &str,
        tasks: Vec<DelegateTaskSpec>,
    ) -> String {
        let parent_system_prompt = system_prompt.to_string();
        let available_tools = self
            .tool_registry
            .schemas()
            .into_iter()
            .map(|schema| schema.function.name)
            .collect::<HashSet<_>>();
        let mut results = futures::stream::iter(tasks.into_iter().map(|task| {
            let provider = self.provider.clone();
            let registry = self.tool_registry.clone();
            let parent_system_prompt = parent_system_prompt.clone();
            let available_tools = available_tools.clone();
            async move {
                run_delegate_child(
                    provider,
                    registry,
                    parent_system_prompt,
                    available_tools,
                    task,
                )
                .await
            }
        }))
        .buffer_unordered(MAX_DELEGATE_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
        results.sort_by_key(|result| result.index);
        let all_completed = results.iter().all(|result| result.status == "completed");
        tool_result(&serde_json::json!({
            "success": all_completed,
            "results": results,
        }))
    }

    async fn stream_with_retry<'a>(
        &'a self,
        system_prompt: &'a str,
        messages: &'a [Message],
        tools: &'a [crate::agent::providers::ToolSchema],
    ) -> Result<
        BoxStream<'a, Result<StreamDelta, crate::agent::providers::ProviderError>>,
        crate::agent::providers::ProviderError,
    > {
        let mut attempt = 0;
        loop {
            attempt += 1;
            match self.provider.stream(system_prompt, messages, tools).await {
                Ok(stream) => return Ok(stream),
                Err(crate::agent::providers::ProviderError::RateLimited { retry_after_secs })
                    if attempt <= 3 =>
                {
                    let delay = retry_after_secs.unwrap_or(1_u64 << (attempt - 1)).min(8);
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                }
                Err(crate::agent::providers::ProviderError::Network(_)) if attempt <= 2 => {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                Err(err) => return Err(err),
            }
        }
    }

    fn load_todo_injection(&self) -> Option<String> {
        let path = self.todo_path.as_ref()?;
        load_todo_injection(path)
    }

    fn visible_tool_schemas(&self) -> Vec<crate::agent::providers::ToolSchema> {
        self.tool_registry
            .schemas()
            .into_iter()
            .filter(|schema| self.is_tool_allowed(&schema.function.name))
            .collect()
    }

    fn is_tool_allowed(&self, tool_name: &str) -> bool {
        match &self.allowed_tool_names {
            Some(allowed) => {
                allowed.contains(tool_name) && !DELEGATE_BLOCKED_TOOLS.contains(&tool_name)
            }
            None => true,
        }
    }
}

#[derive(Debug, Deserialize)]
struct TodoInjectionItem {
    id: String,
    content: String,
    status: String,
}

#[derive(Debug, Clone)]
struct DelegateTaskSpec {
    index: usize,
    goal: String,
    context: Option<String>,
    tools: Vec<String>,
    max_turns: u32,
}

#[derive(Debug, Serialize)]
struct DelegateTaskResult {
    index: usize,
    goal: String,
    status: String,
    result: String,
    error: Option<String>,
    total_api_calls: u32,
    total_tool_calls: u32,
    allowed_tools: Vec<String>,
}

async fn run_delegate_child(
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
        .filter(|tool| !DELEGATE_BLOCKED_TOOLS.contains(&tool.as_str()))
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

fn load_todo_injection(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let todos = serde_json::from_str::<Vec<TodoInjectionItem>>(&raw).ok()?;
    if todos.is_empty() {
        return None;
    }
    let mut out = String::from(
        "[Runtime context after compression]\nCurrent task list retained from todo tool:\n",
    );
    for todo in todos.into_iter().take(256) {
        let status = match todo.status.as_str() {
            "completed" => "[x]",
            "in_progress" => "[~]",
            "cancelled" => "[-]",
            _ => "[ ]",
        };
        out.push_str(&format!(
            "- {status} {} - {}\n",
            redact_sensitive_text(todo.id.trim()),
            redact_sensitive_text(todo.content.trim())
        ));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use async_trait::async_trait;
    use futures::stream;

    use super::*;
    use crate::agent::providers::types::{FinishReason, ModelInfo};
    use crate::agent::providers::{FunctionSchema, ProviderError, ToolSchema};
    use crate::agent::tools::{tool_result, ToolEntry, ToolError, ToolHandler};

    struct MockProvider {
        turns: Mutex<VecDeque<Vec<StreamDelta>>>,
    }

    #[async_trait]
    impl LlmProvider for MockProvider {
        async fn stream(
            &self,
            _system_prompt: &str,
            _messages: &[Message],
            _tools: &[ToolSchema],
        ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
            let mut turns = self.turns.lock().await;
            let deltas = turns.pop_front().unwrap_or_default();
            Ok(Box::pin(stream::iter(deltas.into_iter().map(Ok))))
        }

        async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
            Ok(Vec::new())
        }
    }

    struct EchoTool;

    #[async_trait]
    impl ToolHandler for EchoTool {
        async fn execute(&self, args: &serde_json::Value) -> Result<String, ToolError> {
            Ok(tool_result(args))
        }
    }

    fn text_finish() -> StreamDelta {
        StreamDelta::Finish {
            reason: FinishReason::Stop,
            usage: Usage {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
            },
        }
    }

    #[tokio::test]
    async fn loop_streams_text_and_finishes() {
        let provider = Arc::new(MockProvider {
            turns: Mutex::new(VecDeque::from([vec![
                StreamDelta::Text("hello".to_string()),
                text_finish(),
            ]])),
        });
        let registry = Arc::new(ToolRegistry::new());
        let agent_loop = AgentLoop::new(provider, registry, LoopConfig::default(), None);
        let mut messages = vec![Message::user("hi")];
        let events: Vec<AgentEvent> = agent_loop.run("system", &mut messages).collect().await;

        assert!(matches!(events[0], AgentEvent::TextDelta(_)));
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::Done { .. })));
        assert_eq!(messages.len(), 2);
    }

    #[tokio::test]
    async fn loop_executes_tool_and_continues() {
        let provider = Arc::new(MockProvider {
            turns: Mutex::new(VecDeque::from([
                vec![
                    StreamDelta::ToolCallStart {
                        index: 0,
                        id: "call_1".to_string(),
                        name: "echo".to_string(),
                    },
                    StreamDelta::ToolCallArguments {
                        index: 0,
                        fragment: r#"{"value":42}"#.to_string(),
                    },
                    StreamDelta::Finish {
                        reason: FinishReason::ToolCalls,
                        usage: Usage::default(),
                    },
                ],
                vec![StreamDelta::Text("done".to_string()), text_finish()],
            ])),
        });
        let mut registry = ToolRegistry::new();
        registry.register(ToolEntry {
            name: "echo".to_string(),
            toolset: "test".to_string(),
            schema: ToolSchema {
                tool_type: "function".to_string(),
                function: FunctionSchema {
                    name: "echo".to_string(),
                    description: None,
                    parameters: serde_json::json!({"type":"object"}),
                },
            },
            handler: Arc::new(EchoTool),
        });
        let agent_loop = AgentLoop::new(provider, Arc::new(registry), LoopConfig::default(), None);
        let mut messages = vec![Message::user("use tool")];
        let events: Vec<AgentEvent> = agent_loop.run("system", &mut messages).collect().await;

        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::ToolCallFinished { .. })));
        assert!(messages
            .iter()
            .any(|message| message.tool_call_id.as_deref() == Some("call_1")));
    }
}
