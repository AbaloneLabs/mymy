//! Native agent tool-calling loop.
//!
//! The loop is provider-agnostic: it consumes normalized stream deltas,
//! assembles a turn, dispatches tool calls, and repeats until the model stops
//! or a safety limit is reached. Session ownership stays outside the loop; the
//! caller passes mutable history and later persists the messages it cares about.

mod budget;
pub(crate) mod delegate;
mod dispatch;
mod todo_injection;
mod turn_state;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::Duration;
use std::time::Instant;

use futures::{stream::BoxStream, stream::FuturesUnordered, StreamExt};
use serde_json::Value;
use tokio::sync::Mutex;
use tracing::Instrument;
use uuid::Uuid;

use crate::agent::clarify::{ClarifyGate, ClarifyRequest};
use crate::agent::context::ContextManager;
use crate::agent::execution::ToolExecutionContext;
use crate::agent::providers::types::{FinishReason, StreamDelta, Usage};
use crate::agent::providers::{LlmProvider, Message, ProviderError};
use crate::agent::tools::{
    tool_error, tool_success_result, ToolCapability, ToolEffect, ToolRegistry,
};

use self::budget::{allocate_child_budget, RunBudget};
use self::dispatch::{tool_is_allowed, ToolDispatch, ToolDispatchPolicy};
use self::turn_state::{TurnAccumulator, TurnEffect};

const CLARIFY_TIMEOUT_SECS: u64 = 1_800;
const PROVIDER_FAST_RETRY_DELAYS_SECS: [u64; 6] = [1, 2, 4, 8, 16, 30];

fn provider_fast_retry(error: &ProviderError, retry_index: usize) -> Option<(u64, &'static str)> {
    let default_delay = *PROVIDER_FAST_RETRY_DELAYS_SECS.get(retry_index)?;
    match error {
        ProviderError::RateLimited { retry_after_secs } => Some((
            retry_after_secs.unwrap_or(default_delay).min(30),
            "rate_limited",
        )),
        ProviderError::Network(_) => Some((default_delay, "network")),
        ProviderError::HttpStatus { .. } if error.is_retryable() => {
            Some((default_delay, "http_status"))
        }
        ProviderError::StreamEnded => Some((default_delay, "stream_ended")),
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub enum AgentEvent {
    TextDelta(String),
    ReasoningDelta(String),
    ModelTurnStarted {
        iteration: u32,
    },
    ToolCallStarted {
        call_id: String,
        tool_name: String,
        arguments: String,
        resource_key: Option<String>,
        capability: Option<ToolCapability>,
    },
    ToolCallFinished {
        call_id: String,
        result: String,
        error: Option<String>,
        duration_ms: u64,
    },
    ClarifyRequired {
        request: ClarifyRequest,
    },
    TurnCompleted {
        finish_reason: FinishReason,
        usage: Usage,
    },
    ContextCompressing,
    RunPaused {
        decision_id: String,
    },
    ProviderUnavailable(String),
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

pub struct AgentLoop {
    provider: Arc<dyn LlmProvider>,
    tool_registry: Arc<ToolRegistry>,
    config: LoopConfig,
    context_manager: Option<Mutex<ContextManager>>,
    session_id: Option<Uuid>,
    clarify_gate: Option<Arc<ClarifyGate>>,
    todo_path: Option<PathBuf>,
    allowed_tool_names: Option<HashSet<String>>,
    execution_context: Option<ToolExecutionContext>,
    delegate_run_coordinator: Option<Arc<dyn delegate::DelegateRunCoordinator>>,
    generated_messages: StdMutex<Vec<Message>>,
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
            clarify_gate: None,
            todo_path: None,
            allowed_tool_names: None,
            execution_context: None,
            delegate_run_coordinator: None,
            generated_messages: StdMutex::new(Vec::new()),
        }
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

    pub fn set_execution_context(&mut self, context: ToolExecutionContext) {
        self.execution_context = Some(context);
    }

    pub(crate) fn set_delegate_run_coordinator(
        &mut self,
        coordinator: Arc<dyn delegate::DelegateRunCoordinator>,
    ) {
        self.delegate_run_coordinator = Some(coordinator);
    }

    pub fn generated_messages(&self) -> Vec<Message> {
        self.generated_messages
            .lock()
            .map(|messages| messages.clone())
            .unwrap_or_default()
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
            if let Ok(mut generated) = self.generated_messages.lock() {
                generated.clear();
            }
            let mut total_tool_calls = 0;
            let mut empty_responses = 0;
            let mut completion_reminder_sent = false;
            let run_started_at = Instant::now();
            let run_budget = RunBudget::from_context(self.execution_context.as_ref());
            let mut total_model_tokens = 0_u32;
            let cancellation = self
                .execution_context
                .as_ref()
                .map(|context| context.cancellation.clone());

            for iteration in 0..self.config.max_iterations {
                if run_budget.token_limit_reached(total_model_tokens) {
                    yield AgentEvent::Error("run token budget exceeded".to_string());
                    yield AgentEvent::Done { total_api_calls: iteration, total_tool_calls };
                    return;
                }
                if run_budget.runtime_limit_reached(run_started_at) {
                    yield AgentEvent::Error("run runtime budget exceeded".to_string());
                    yield AgentEvent::Done { total_api_calls: iteration, total_tool_calls };
                    return;
                }
                if cancellation.as_ref().is_some_and(|token| token.is_cancelled()) {
                    yield AgentEvent::Done { total_api_calls: iteration, total_tool_calls };
                    return;
                }
                if iteration >= self.config.max_api_calls {
                    yield AgentEvent::Error("maximum API call limit exceeded".to_string());
                    yield AgentEvent::Done { total_api_calls: iteration, total_tool_calls };
                    return;
                }

                let api_calls = iteration + 1;
                yield AgentEvent::ModelTurnStarted { iteration: api_calls };
                let tools = self.visible_tool_schemas();
                let mut turn = TurnAccumulator::new();

                {
                    let request_messages = messages.clone();
                    let mut provider_retry_index = 0;
                    'provider_request: loop {
                        let model_span = tracing::info_span!(
                            "model_turn",
                            run_id = ?self.execution_context.as_ref().map(|context| context.run_id),
                            iteration,
                        );
                        let stream_request = self
                            .stream_with_retry(
                                system_prompt,
                                &request_messages,
                                &tools,
                                &mut provider_retry_index,
                            )
                            .instrument(model_span);
                        let stream_result = if let Some(token) = &cancellation {
                            tokio::select! {
                                _ = token.cancelled() => {
                                    yield AgentEvent::Done { total_api_calls: iteration, total_tool_calls };
                                    return;
                                }
                                result = stream_request => result,
                            }
                        } else {
                            stream_request.await
                        };
                        let mut provider_stream = match stream_result {
                            Ok(stream) => stream,
                            Err(err) => {
                                if err.is_retryable() {
                                    yield AgentEvent::ProviderUnavailable(format!("provider stream failed: {err}"));
                                } else {
                                    yield AgentEvent::Error(format!("provider stream failed: {err}"));
                                }
                                yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                return;
                            }
                        };
                        let mut received_delta = false;
                        loop {
                            let next_delta = if let Some(token) = &cancellation {
                                tokio::select! {
                                    _ = token.cancelled() => {
                                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                        return;
                                    }
                                    next = provider_stream.next() => next,
                                }
                            } else {
                                provider_stream.next().await
                            };
                            let Some(delta_result) = next_delta else {
                                break;
                            };
                            let delta = match delta_result {
                                Ok(delta) => {
                                    received_delta = true;
                                    delta
                                }
                                Err(err) => {
                                    if !received_delta {
                                        if let Some((delay, cause)) =
                                            provider_fast_retry(&err, provider_retry_index)
                                        {
                                            provider_retry_index += 1;
                                            metrics::counter!(
                                                "mymy_agent_provider_retries_total",
                                                "cause" => cause,
                                            )
                                            .increment(1);
                                            let wait = tokio::time::sleep(Duration::from_secs(delay));
                                            if let Some(token) = &cancellation {
                                                tokio::select! {
                                                    _ = token.cancelled() => {
                                                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                                        return;
                                                    }
                                                    _ = wait => {}
                                                }
                                            } else {
                                                wait.await;
                                            }
                                            continue 'provider_request;
                                        }
                                    }
                                    if !received_delta && err.is_retryable() {
                                        yield AgentEvent::ProviderUnavailable(format!("provider stream error: {err}"));
                                    } else {
                                        yield AgentEvent::Error(format!("provider stream error: {err}"));
                                    }
                                    yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                    return;
                                }
                            };

                            match turn.apply(delta) {
                                TurnEffect::Text(text) => yield AgentEvent::TextDelta(text),
                                TurnEffect::Reasoning(text) => {
                                    yield AgentEvent::ReasoningDelta(text)
                                }
                                TurnEffect::None => {}
                            }
                        }
                        break 'provider_request;
                    }
                }

                let completed_turn = turn.complete();
                let content = completed_turn.content;
                let reasoning = completed_turn.reasoning;
                let finish_reason = completed_turn.finish_reason;
                let usage = completed_turn.usage;
                let assembled_tool_calls = completed_turn.tool_calls;
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
                let assistant_message = Message::assistant_with_tools(
                    assistant_content,
                    assembled_tool_calls.clone(),
                );
                messages.push(assistant_message.clone());
                if let Ok(mut generated) = self.generated_messages.lock() {
                    generated.push(assistant_message);
                }

                yield AgentEvent::TurnCompleted {
                    finish_reason,
                    usage: usage.clone(),
                };
                total_model_tokens = total_model_tokens.saturating_add(usage.total_tokens);
                if run_budget.token_limit_exceeded(total_model_tokens) {
                    yield AgentEvent::Error("run token budget exceeded; partial output was preserved".to_string());
                    yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                    return;
                }

                if let Some(manager) = &self.context_manager {
                    let should_compress = {
                        let mut manager = manager.lock().await;
                        manager.update_usage(&usage);
                        manager.should_compress(messages, system_prompt)
                    };
                    if should_compress {
                        yield AgentEvent::ContextCompressing;
                        let checkpoint = match (
                            self.execution_context.as_ref(),
                            self.execution_context
                                .as_ref()
                                .and_then(|context| context.progress.as_ref()),
                        ) {
                            (Some(context), Some(progress)) => {
                                match progress.create_checkpoint(context, messages).await {
                                    Ok(checkpoint) => Some(checkpoint),
                                    Err(err) => {
                                        yield AgentEvent::Error(format!("structured checkpoint failed: {err}"));
                                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                        return;
                                    }
                                }
                            }
                            _ => None,
                        };
                        let changed = {
                            let mut manager = manager.lock().await;
                            match checkpoint {
                                Some(checkpoint) => {
                                    manager.compress_with_checkpoint(messages, &checkpoint)
                                }
                                None => manager.compress(messages),
                            }
                        };
                        if changed {
                            if let Some(todo_context) = self.load_todo_injection() {
                                messages.push(Message::user(todo_context));
                            }
                        }
                    }
                }

                match finish_reason {
                    FinishReason::Stop => {
                        if !completion_reminder_sent {
                            if let (Some(context), Some(progress)) = (
                                self.execution_context.as_ref(),
                                self.execution_context
                                    .as_ref()
                                    .and_then(|context| context.progress.as_ref()),
                            ) {
                                match progress.completion_reminder(context).await {
                                    Ok(Some(reminder)) => {
                                        completion_reminder_sent = true;
                                        messages.push(Message::user(reminder));
                                        continue;
                                    }
                                    Ok(None) => {}
                                    Err(err) => {
                                        yield AgentEvent::Error(format!("completion gate failed: {err}"));
                                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                        return;
                                    }
                                }
                            }
                        }
                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                        return;
                    }
                    FinishReason::ContentFilter | FinishReason::Length => {
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

                let parallel_fits_budget =
                    run_budget.tool_batch_fits(total_tool_calls, assembled_tool_calls.len());
                if parallel_fits_budget
                    && self
                        .dispatch_policy()
                        .parallel_batch_eligible(&assembled_tool_calls)
                {
                    let group_started_at = Instant::now();
                    let parallel_call_count = assembled_tool_calls.len();
                    let mut pending = FuturesUnordered::new();
                    let mut ordered_results = vec![None; assembled_tool_calls.len()];
                    for (index, call) in assembled_tool_calls.into_iter().enumerate() {
                        total_tool_calls += 1;
                        let invocation_context = self
                            .execution_context
                            .as_ref()
                            .map(|context| context.for_invocation(&call.id));
                        let invocation_id = invocation_context
                            .as_ref()
                            .map(|context| context.invocation_id.clone())
                            .unwrap_or_else(|| call.id.clone());
                        let capability = self
                            .tool_registry
                            .capability(&call.name)
                            .cloned()
                            .expect("parallel eligibility requires capability metadata");
                        let args = serde_json::from_str(&call.arguments).unwrap_or(Value::Null);
                        let resource_key = capability.resource_key(&args);
                        yield AgentEvent::ToolCallStarted {
                            call_id: invocation_id.clone(),
                            tool_name: call.name.clone(),
                            arguments: call.arguments.clone(),
                            resource_key: Some(resource_key),
                            capability: Some(capability),
                        };
                        let registry = self.tool_registry.clone();
                        pending.push(async move {
                            let started_at = Instant::now();
                            let execute = async {
                                match &invocation_context {
                                    Some(context) => registry
                                        .execute_with_context(
                                            context,
                                            &call.name,
                                            &call.arguments,
                                        )
                                        .await,
                                    None => registry.execute(&call.name, &call.arguments).await,
                                }
                            };
                            let result = match invocation_context
                                .as_ref()
                                .map(|context| context.cancellation.clone())
                            {
                                Some(token) => tokio::select! {
                                    _ = token.cancelled() => {
                                        tool_error("run cancellation interrupted parallel read")
                                    }
                                    result = execute => result,
                                },
                                None => execute.await,
                            };
                            (
                                index,
                                call,
                                invocation_id,
                                result,
                                started_at.elapsed().as_millis() as u64,
                            )
                        });
                    }
                    while let Some((index, call, invocation_id, result, duration_ms)) = pending.next().await {
                        let error = serde_json::from_str::<Value>(&result)
                            .ok()
                            .and_then(|value| {
                                value
                                    .get("error")
                                    .and_then(Value::as_str)
                                    .map(str::to_string)
                            });
                        yield AgentEvent::ToolCallFinished {
                            call_id: invocation_id,
                            result: result.clone(),
                            error,
                            duration_ms,
                        };
                        ordered_results[index] = Some((call, result));
                    }
                    for (call, result) in ordered_results.into_iter().flatten() {
                        let tool_message = Message::tool_result(call.id, result);
                        messages.push(tool_message.clone());
                        if let Ok(mut generated) = self.generated_messages.lock() {
                            generated.push(tool_message);
                        }
                    }
                    tracing::info!(
                        call_count = parallel_call_count,
                        duration_ms = group_started_at.elapsed().as_millis() as u64,
                        "parallel read tool group finished"
                    );
                    if cancellation.as_ref().is_some_and(|token| token.is_cancelled()) {
                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                        return;
                    }
                    if iteration + 1 >= self.config.max_iterations {
                        yield AgentEvent::Error("maximum agent loop iteration limit exceeded".to_string());
                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                        return;
                    }
                    continue;
                }

                for call in assembled_tool_calls {
                    if cancellation.as_ref().is_some_and(|token| token.is_cancelled()) {
                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                        return;
                    }
                    if run_budget.tool_limit_reached(total_tool_calls) {
                        yield AgentEvent::Error("run tool-call budget exceeded".to_string());
                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                        return;
                    }
                    total_tool_calls += 1;
                    let invocation_context = self
                        .execution_context
                        .as_ref()
                        .map(|context| context.for_invocation(&call.id));
                    let invocation_id = invocation_context
                        .as_ref()
                        .map(|context| context.invocation_id.clone())
                        .unwrap_or_else(|| call.id.clone());
                    let tool_capability = self.tool_registry.capability(&call.name).cloned();
                    let resource_key = tool_capability.as_ref().map(|capability| {
                        let args = serde_json::from_str(&call.arguments).unwrap_or(Value::Null);
                        tracing::debug!(
                            tool = %call.name,
                            invocation_id = %invocation_id,
                            parallel_safe = capability.parallel_safe(),
                            "tool invocation classified"
                        );
                        capability.resource_key(&args)
                    });
                    yield AgentEvent::ToolCallStarted {
                        call_id: invocation_id.clone(),
                        tool_name: call.name.clone(),
                        arguments: call.arguments.clone(),
                        resource_key,
                        capability: tool_capability,
                    };

                    let dispatch = self.dispatch_policy().evaluate(&call).await;
                    let tool_started_at = Instant::now();
                    let result = match dispatch {
                        ToolDispatch::Execute => {
                            match &invocation_context {
                                Some(context) => self
                                    .tool_registry
                                    .execute_with_context(context, &call.name, &call.arguments)
                                    .await,
                                None => self.tool_registry.execute(&call.name, &call.arguments).await,
                            }
                        }
                        ToolDispatch::Blocked(result) => result,
                        ToolDispatch::Clarify { request, receiver } => {
                            let request_id = request.request_id.clone();
                            yield AgentEvent::ClarifyRequired { request };
                            let answer = async {
                                tokio::time::timeout(
                                    Duration::from_secs(CLARIFY_TIMEOUT_SECS),
                                    receiver,
                                )
                                .await
                            };
                            let answer = if let Some(token) = &cancellation {
                                tokio::select! {
                                    _ = token.cancelled() => {
                                        if let Some(gate) = &self.clarify_gate {
                                            gate.cancel(&request_id).await;
                                        }
                                        yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                        return;
                                    }
                                    answer = answer => answer,
                                }
                            } else {
                                answer.await
                            };
                            match answer {
                                Ok(Ok(answer)) => {
                                    tool_success_result(&serde_json::json!({
                                        "success": true,
                                        "answer": answer,
                                    }), ToolEffect::Read)
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
                        ToolDispatch::DurableClarify { question, choices } => {
                            let (Some(context), Some(coordinator)) = (
                                self.execution_context.as_ref(),
                                self.execution_context
                                    .as_ref()
                                    .and_then(|context| context.decisions.as_ref()),
                            ) else {
                                yield AgentEvent::ToolCallFinished {
                                    call_id: invocation_id,
                                    result: tool_error("durable decision runtime is unavailable"),
                                    error: Some("durable decision runtime is unavailable".to_string()),
                                    duration_ms: tool_started_at.elapsed().as_millis() as u64,
                                };
                                yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                return;
                            };
                            match coordinator
                                .create_choice(context, &question, &choices, messages)
                                .await
                            {
                                Ok(decision) => {
                                    let decision_result = tool_success_result(&serde_json::json!({
                                        "success": true,
                                        "decision_id": decision.id,
                                        "status": "pending",
                                    }), ToolEffect::Create);
                                    yield AgentEvent::ToolCallFinished {
                                        call_id: invocation_id,
                                        result: decision_result,
                                        error: None,
                                        duration_ms: tool_started_at.elapsed().as_millis() as u64,
                                    };
                                    if let Some(session_id) = decision.session_id {
                                        yield AgentEvent::ClarifyRequired {
                                            request: ClarifyRequest {
                                                request_id: decision.id.to_string(),
                                                session_id,
                                                question: decision.question,
                                                choices: decision.choices,
                                                created_at: decision.created_at,
                                            },
                                        };
                                    }
                                    yield AgentEvent::RunPaused {
                                        decision_id: decision.id.to_string(),
                                    };
                                    return;
                                }
                                Err(err) => {
                                    yield AgentEvent::ToolCallFinished {
                                        call_id: invocation_id,
                                        result: tool_error(&format!("decision creation failed: {err}")),
                                        error: Some(format!("decision creation failed: {err}")),
                                        duration_ms: tool_started_at.elapsed().as_millis() as u64,
                                    };
                                    yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                    return;
                                }
                            }
                        }
                        ToolDispatch::Approval {
                            question,
                            proposed_action,
                            target_version,
                        } => {
                            let (Some(context), Some(coordinator)) = (
                                self.execution_context.as_ref(),
                                self.execution_context
                                    .as_ref()
                                    .and_then(|context| context.decisions.as_ref()),
                            ) else {
                                yield AgentEvent::ToolCallFinished {
                                    call_id: invocation_id,
                                    result: tool_error("durable approval runtime is unavailable"),
                                    error: Some("durable approval runtime is unavailable".to_string()),
                                    duration_ms: tool_started_at.elapsed().as_millis() as u64,
                                };
                                yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                return;
                            };
                            match coordinator
                                .create_approval(
                                    context,
                                    &question,
                                    proposed_action,
                                    target_version,
                                    messages,
                                )
                                .await
                            {
                                Ok(decision) => {
                                    yield AgentEvent::ToolCallFinished {
                                        call_id: invocation_id,
                                        result: tool_success_result(&serde_json::json!({
                                            "success": true,
                                            "decision_id": decision.id,
                                            "status": "pending",
                                        }), ToolEffect::Create),
                                        error: None,
                                        duration_ms: tool_started_at.elapsed().as_millis() as u64,
                                    };
                                    if let Some(session_id) = decision.session_id {
                                        yield AgentEvent::ClarifyRequired {
                                            request: ClarifyRequest {
                                                request_id: decision.id.to_string(),
                                                session_id,
                                                question: decision.question,
                                                choices: decision.choices,
                                                created_at: decision.created_at,
                                            },
                                        };
                                    }
                                    yield AgentEvent::RunPaused {
                                        decision_id: decision.id.to_string(),
                                    };
                                    return;
                                }
                                Err(err) => {
                                    yield AgentEvent::ToolCallFinished {
                                        call_id: invocation_id,
                                        result: tool_error(&format!("approval creation failed: {err}")),
                                        error: Some(format!("approval creation failed: {err}")),
                                        duration_ms: tool_started_at.elapsed().as_millis() as u64,
                                    };
                                    yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                                    return;
                                }
                            }
                        }
                        ToolDispatch::Delegate { tasks } => {
                            let remaining_api_budget = self
                                .config
                                .max_api_calls
                                .saturating_sub(api_calls.saturating_add(1));
                            let remaining_tool_budget =
                                run_budget.remaining_tools(total_tool_calls);
                            let remaining_token_budget =
                                run_budget.remaining_tokens(total_model_tokens);
                            let delegated = self
                                .run_delegate_tasks(
                                    system_prompt,
                                    &invocation_id,
                                    tasks,
                                    remaining_api_budget,
                                    remaining_tool_budget,
                                    remaining_token_budget,
                                )
                                .await;
                            total_model_tokens = total_model_tokens
                                .saturating_add(delegated.total_tokens);
                            delegated.output
                        }
                    };
                    let error = serde_json::from_str::<serde_json::Value>(&result)
                        .ok()
                        .and_then(|value| value.get("error").and_then(|err| err.as_str()).map(str::to_string));

                    yield AgentEvent::ToolCallFinished {
                        call_id: invocation_id,
                        result: result.clone(),
                        error,
                        duration_ms: tool_started_at.elapsed().as_millis() as u64,
                    };
                    let tool_message = Message::tool_result(call.id, result);
                    messages.push(tool_message.clone());
                    if let Ok(mut generated) = self.generated_messages.lock() {
                        generated.push(tool_message);
                    }
                }

                if iteration + 1 >= self.config.max_iterations {
                    yield AgentEvent::Error("maximum agent loop iteration limit exceeded".to_string());
                    yield AgentEvent::Done { total_api_calls: api_calls, total_tool_calls };
                    return;
                }
            }
        })
    }

    async fn run_delegate_tasks(
        &self,
        system_prompt: &str,
        parent_invocation_id: &str,
        mut tasks: Vec<delegate::DelegateTaskSpec>,
        remaining_api_budget: u32,
        remaining_tool_budget: Option<u32>,
        remaining_token_budget: Option<u32>,
    ) -> DelegateBatchResult {
        let task_count = tasks.len() as u32;
        if remaining_api_budget < task_count {
            return DelegateBatchResult::error(
                "delegate fan-out exceeds the parent run's remaining model-turn budget",
            );
        }
        let child_token_pool = remaining_token_budget.map(|remaining| {
            let reserve = (remaining / 4).max(1_000).min(remaining);
            remaining.saturating_sub(reserve)
        });
        for (position, task) in tasks.iter_mut().enumerate() {
            let position = position as u32;
            let api_quota =
                allocate_child_budget(remaining_api_budget, task_count, position).max(1);
            task.max_turns = task.max_turns.min(api_quota);
            task.max_tool_calls = remaining_tool_budget
                .map(|budget| allocate_child_budget(budget, task_count, position));
            task.max_total_tokens =
                child_token_pool.map(|budget| allocate_child_budget(budget, task_count, position));
        }
        let parent_system_prompt = system_prompt.to_string();
        let available_tools = self
            .tool_registry
            .schemas()
            .into_iter()
            .map(|schema| schema.function.name)
            .collect::<HashSet<_>>();
        let handles = match (&self.delegate_run_coordinator, &self.execution_context) {
            (Some(coordinator), Some(parent)) => match coordinator
                .start_children(parent, parent_invocation_id, &tasks)
                .await
            {
                Ok(handles) => handles,
                Err(err) => {
                    return DelegateBatchResult::error(&format!(
                        "delegate run creation failed: {err}"
                    ))
                }
            },
            _ => Vec::new(),
        };
        let handles = handles
            .into_iter()
            .map(|handle| (handle.delegate_index, handle))
            .collect::<std::collections::HashMap<_, _>>();
        let mut results = futures::stream::iter(tasks.into_iter().map(|task| {
            let provider = self.provider.clone();
            let registry = self.tool_registry.clone();
            let parent_system_prompt = parent_system_prompt.clone();
            let available_tools = available_tools.clone();
            let coordinator = self.delegate_run_coordinator.clone();
            let handle = handles.get(&task.index).cloned();
            let parent_context = self.execution_context.clone();
            async move {
                let child_context = handle.as_ref().and_then(|handle| {
                    parent_context.as_ref().map(|parent| {
                        let mut authorization = parent.authorization.clone();
                        authorization.explicit_user_action = false;
                        if let Some(value) = task.max_tool_calls {
                            authorization.budget["maxToolCalls"] = Value::from(value);
                        }
                        if let Some(value) = task.max_total_tokens {
                            authorization.budget["maxTotalTokens"] = Value::from(value);
                        }
                        ToolExecutionContext {
                            run_id: handle.run_id,
                            session_id: parent.session_id,
                            agent_profile: parent.agent_profile.clone(),
                            trigger: crate::agent::execution::SessionTrigger::Delegate {
                                parent_run_id: parent.run_id,
                                parent_event_id: handle.parent_event_id,
                                delegate_index: handle.delegate_index as u32,
                            },
                            project_id: parent.project_id,
                            authorization,
                            invocation_id: String::new(),
                            lease_epoch: handle.lease_epoch,
                            cancellation: handle.cancellation.clone(),
                            guard: parent.guard.clone(),
                            progress: parent.progress.clone(),
                            decisions: parent.decisions.clone(),
                        }
                    })
                });
                let child = delegate::run_delegate_child(
                    provider,
                    registry,
                    parent_system_prompt,
                    available_tools,
                    task,
                    child_context,
                );
                tokio::pin!(child);
                let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
                let mut heartbeat_error = None;
                let mut result = loop {
                    tokio::select! {
                        result = &mut child => break result,
                        _ = heartbeat.tick(), if handle.is_some() && coordinator.is_some() => {
                            if let (Some(handle), Some(coordinator)) = (&handle, &coordinator) {
                                if let Err(err) = coordinator.heartbeat_child(handle).await {
                                    handle.cancellation.cancel();
                                    heartbeat_error = Some(err);
                                }
                            }
                        }
                    }
                };
                if let Some(err) = heartbeat_error {
                    result.status = "failed".to_string();
                    result.error = Some(format!("delegate heartbeat failed: {err}"));
                }
                if let (Some(handle), Some(coordinator)) = (&handle, &coordinator) {
                    if let Err(err) = coordinator.finish_child(handle, &result).await {
                        result.status = "failed".to_string();
                        result.error = Some(format!("delegate persistence failed: {err}"));
                    }
                }
                result
            }
        }))
        .buffer_unordered(delegate::MAX_DELEGATE_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
        results.sort_by_key(|result| result.index);
        let all_completed = results.iter().all(|result| result.status == "completed");
        let total_tokens = results.iter().fold(0_u32, |total, result| {
            total.saturating_add(result.total_tokens)
        });
        DelegateBatchResult {
            output: tool_success_result(
                &serde_json::json!({
                "success": all_completed,
                "results": results,
                }),
                ToolEffect::Execute,
            ),
            total_tokens,
        }
    }

    async fn stream_with_retry<'a>(
        &'a self,
        system_prompt: &'a str,
        messages: &'a [Message],
        tools: &'a [crate::agent::providers::ToolSchema],
        retry_index: &mut usize,
    ) -> Result<
        BoxStream<'a, Result<StreamDelta, crate::agent::providers::ProviderError>>,
        crate::agent::providers::ProviderError,
    > {
        loop {
            match self.provider.stream(system_prompt, messages, tools).await {
                Ok(stream) => return Ok(stream),
                Err(err) => {
                    let Some((delay, cause)) = provider_fast_retry(&err, *retry_index) else {
                        return Err(err);
                    };
                    *retry_index += 1;
                    metrics::counter!("mymy_agent_provider_retries_total", "cause" => cause)
                        .increment(1);
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                }
            }
        }
    }

    fn load_todo_injection(&self) -> Option<String> {
        if self
            .execution_context
            .as_ref()
            .and_then(|context| context.progress.as_ref())
            .is_some()
        {
            return None;
        }
        let path = self.todo_path.as_ref()?;
        todo_injection::load_todo_injection(path)
    }

    fn visible_tool_schemas(&self) -> Vec<crate::agent::providers::ToolSchema> {
        self.tool_registry
            .schemas()
            .into_iter()
            .filter(|schema| self.is_tool_allowed(&schema.function.name))
            .collect()
    }

    fn dispatch_policy(&self) -> ToolDispatchPolicy<'_> {
        ToolDispatchPolicy {
            registry: &self.tool_registry,
            allowed_tool_names: self.allowed_tool_names.as_ref(),
            execution_context: self.execution_context.as_ref(),
            clarify_gate: self.clarify_gate.as_ref(),
            session_id: self.session_id,
        }
    }

    fn is_tool_allowed(&self, tool_name: &str) -> bool {
        tool_is_allowed(self.allowed_tool_names.as_ref(), tool_name)
    }
}

struct DelegateBatchResult {
    output: String,
    total_tokens: u32,
}

impl DelegateBatchResult {
    fn error(message: &str) -> Self {
        Self {
            output: tool_error(message),
            total_tokens: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use async_trait::async_trait;
    use futures::stream;
    use tokio::sync::Barrier;

    use super::*;
    use crate::agent::providers::types::{FinishReason, ModelInfo};
    use crate::agent::providers::{FunctionSchema, ProviderError, ToolSchema};

    #[test]
    fn transient_provider_retries_reach_thirty_seconds_before_durable_deferral() {
        assert_eq!(PROVIDER_FAST_RETRY_DELAYS_SECS, [1, 2, 4, 8, 16, 30]);
    }
    use crate::agent::tools::{tool_result, ToolEffect, ToolEntry, ToolError, ToolHandler};

    struct MockProvider {
        turns: Mutex<VecDeque<Vec<StreamDelta>>>,
    }

    struct DisconnectingProvider;

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

    #[async_trait]
    impl LlmProvider for DisconnectingProvider {
        async fn stream(
            &self,
            _system_prompt: &str,
            _messages: &[Message],
            _tools: &[ToolSchema],
        ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
            Ok(Box::pin(stream::iter([
                Ok(StreamDelta::Text("partial visible result".to_string())),
                Err(ProviderError::StreamEnded),
            ])))
        }

        async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
            Ok(Vec::new())
        }
    }

    struct EchoTool;

    struct BarrierReadTool {
        barrier: Arc<Barrier>,
    }

    struct TrackingMutationTool {
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
    }

    struct QuarantinedTool;

    #[async_trait]
    impl ToolHandler for EchoTool {
        async fn execute(&self, args: &serde_json::Value) -> Result<String, ToolError> {
            Ok(tool_result(args))
        }
    }

    #[async_trait]
    impl ToolHandler for BarrierReadTool {
        async fn execute(&self, args: &Value) -> Result<String, ToolError> {
            self.barrier.wait().await;
            tokio::time::sleep(Duration::from_millis(
                args.get("delayMs").and_then(Value::as_u64).unwrap_or(0),
            ))
            .await;
            Ok(tool_result(args))
        }
    }

    #[async_trait]
    impl ToolHandler for TrackingMutationTool {
        async fn execute(&self, args: &Value) -> Result<String, ToolError> {
            let current = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_active.fetch_max(current, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(20)).await;
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(tool_result(args))
        }
    }

    #[async_trait]
    impl ToolHandler for QuarantinedTool {
        async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
            Err(ToolError::Coded {
                code: "content_quarantined",
                message: "This file is considered suspicious and cannot be accessed until the user approves it. If you need the file, ask the user for approval.".to_string(),
            })
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

        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::TextDelta(_))));
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::Done { .. })));
        assert_eq!(messages.len(), 2);
    }

    #[tokio::test]
    async fn provider_disconnect_has_one_deterministic_partial_error_terminal_sequence() {
        let agent_loop = AgentLoop::new(
            Arc::new(DisconnectingProvider),
            Arc::new(ToolRegistry::new()),
            LoopConfig::default(),
            None,
        );
        let mut messages = vec![Message::user("start")];

        let events = agent_loop
            .run("system", &mut messages)
            .collect::<Vec<_>>()
            .await;

        assert!(matches!(
            events.as_slice(),
            [
                AgentEvent::ModelTurnStarted { iteration: 1 },
                AgentEvent::TextDelta(text),
                AgentEvent::Error(error),
                AgentEvent::Done {
                    total_api_calls: 1,
                    total_tool_calls: 0,
                }
            ] if text == "partial visible result" && error == "provider stream error: stream ended unexpectedly"
        ));
        assert_eq!(
            messages.len(),
            1,
            "an incomplete assistant turn must not enter the next provider context"
        );
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
                    description: Some("Echo one integer value.".to_string()),
                    parameters: serde_json::json!({"type":"object","properties":{"value":{"type":"integer","description":"Integer value returned by the test tool."}},"required":["value"],"additionalProperties":false}),
                },
            },
            capability: crate::agent::tools::ToolCapability::read("test"),
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

    #[tokio::test]
    async fn quarantined_tool_failure_is_safe_and_the_run_continues_without_retry() {
        let provider = Arc::new(MockProvider {
            turns: Mutex::new(VecDeque::from([
                vec![
                    StreamDelta::ToolCallStart {
                        index: 0,
                        id: "quarantine_call".to_string(),
                        name: "read_quarantined".to_string(),
                    },
                    StreamDelta::ToolCallArguments {
                        index: 0,
                        fragment: r#"{"path":"untrusted-name"}"#.to_string(),
                    },
                    StreamDelta::Finish {
                        reason: FinishReason::ToolCalls,
                        usage: Usage::default(),
                    },
                ],
                vec![
                    StreamDelta::Text("I need user approval.".to_string()),
                    text_finish(),
                ],
            ])),
        });
        let mut registry = ToolRegistry::new();
        registry.register(ToolEntry {
            name: "read_quarantined".to_string(),
            toolset: "test".to_string(),
            schema: ToolSchema {
                tool_type: "function".to_string(),
                function: FunctionSchema {
                    name: "read_quarantined".to_string(),
                    description: Some("Return a stable quarantine denial.".to_string()),
                    parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"Logical quarantined test path."}},"required":["path"],"additionalProperties":false}),
                },
            },
            capability: crate::agent::tools::ToolCapability::read("file"),
            handler: Arc::new(QuarantinedTool),
        });
        let agent_loop = AgentLoop::new(provider, Arc::new(registry), LoopConfig::default(), None);
        let mut messages = vec![Message::user("read it")];
        let events: Vec<AgentEvent> = agent_loop.run("system", &mut messages).collect().await;

        let finished = events
            .iter()
            .filter_map(|event| match event {
                AgentEvent::ToolCallFinished { result, .. } => Some(result),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(finished.len(), 1, "the failed call must not be retried");
        let result: Value = serde_json::from_str(finished[0]).unwrap();
        assert_eq!(result["code"], "content_quarantined");
        assert!(result["error"].as_str().unwrap().contains("ask the user"));
        let serialized = result.to_string();
        assert!(!serialized.contains("Settings"));
        assert!(!serialized.contains("quarantine_call"));
        assert!(!serialized.contains("untrusted-name"));
        assert!(events.iter().any(
            |event| matches!(event, AgentEvent::TextDelta(text) if text.contains("approval"))
        ));
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::Done { .. })));
        assert!(!events
            .iter()
            .any(|event| matches!(event, AgentEvent::RunPaused { .. })));
    }

    #[tokio::test]
    async fn safe_reads_run_concurrently_and_preserve_provider_result_order() {
        let provider = Arc::new(MockProvider {
            turns: Mutex::new(VecDeque::from([
                vec![
                    StreamDelta::ToolCallStart {
                        index: 0,
                        id: "call_1".to_string(),
                        name: "read".to_string(),
                    },
                    StreamDelta::ToolCallArguments {
                        index: 0,
                        fragment: r#"{"id":"first","delayMs":40}"#.to_string(),
                    },
                    StreamDelta::ToolCallStart {
                        index: 1,
                        id: "call_2".to_string(),
                        name: "read".to_string(),
                    },
                    StreamDelta::ToolCallArguments {
                        index: 1,
                        fragment: r#"{"id":"second","delayMs":5}"#.to_string(),
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
            name: "read".to_string(),
            toolset: "test".to_string(),
            schema: ToolSchema {
                tool_type: "function".to_string(),
                function: FunctionSchema {
                    name: "read".to_string(),
                    description: Some("Read one delayed test resource.".to_string()),
                    parameters: serde_json::json!({"type":"object","properties":{"id":{"type":"string","description":"Test resource identifier."},"delayMs":{"type":"integer","minimum":0,"description":"Artificial delay in milliseconds."}},"required":["id","delayMs"],"additionalProperties":false}),
                },
            },
            capability: crate::agent::tools::ToolCapability::read("test")
                .with_resource_argument("id"),
            handler: Arc::new(BarrierReadTool {
                barrier: Arc::new(Barrier::new(2)),
            }),
        });
        let agent_loop = AgentLoop::new(provider, Arc::new(registry), LoopConfig::default(), None);
        let mut messages = vec![Message::user("read both")];
        let events = tokio::time::timeout(
            Duration::from_secs(1),
            agent_loop.run("system", &mut messages).collect::<Vec<_>>(),
        )
        .await
        .expect("independent reads should not deadlock behind serial dispatch");

        let completion_order = events
            .iter()
            .filter_map(|event| match event {
                AgentEvent::ToolCallFinished { call_id, .. } => Some(call_id.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();
        let result_order = messages
            .iter()
            .filter_map(|message| message.tool_call_id.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(completion_order, vec!["call_2", "call_1"]);
        assert_eq!(result_order, vec!["call_1", "call_2"]);
    }

    #[tokio::test]
    async fn mutations_remain_serial_even_for_distinct_resources() {
        let provider = Arc::new(MockProvider {
            turns: Mutex::new(VecDeque::from([
                vec![
                    StreamDelta::ToolCallStart {
                        index: 0,
                        id: "call_1".to_string(),
                        name: "mutate".to_string(),
                    },
                    StreamDelta::ToolCallArguments {
                        index: 0,
                        fragment: r#"{"id":"first"}"#.to_string(),
                    },
                    StreamDelta::ToolCallStart {
                        index: 1,
                        id: "call_2".to_string(),
                        name: "mutate".to_string(),
                    },
                    StreamDelta::ToolCallArguments {
                        index: 1,
                        fragment: r#"{"id":"second"}"#.to_string(),
                    },
                    StreamDelta::Finish {
                        reason: FinishReason::ToolCalls,
                        usage: Usage::default(),
                    },
                ],
                vec![StreamDelta::Text("done".to_string()), text_finish()],
            ])),
        });
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));
        let mut registry = ToolRegistry::new();
        registry.register(ToolEntry {
            name: "mutate".to_string(),
            toolset: "test".to_string(),
            schema: ToolSchema {
                tool_type: "function".to_string(),
                function: FunctionSchema {
                    name: "mutate".to_string(),
                    description: Some("Mutate one test resource.".to_string()),
                    parameters: serde_json::json!({"type":"object","properties":{"id":{"type":"string","description":"Test resource identifier."}},"required":["id"],"additionalProperties":false}),
                },
            },
            capability: crate::agent::tools::ToolCapability::mutation(ToolEffect::Update, "test"),
            handler: Arc::new(TrackingMutationTool {
                active: active.clone(),
                max_active: max_active.clone(),
            }),
        });
        let agent_loop = AgentLoop::new(provider, Arc::new(registry), LoopConfig::default(), None);
        let mut messages = vec![Message::user("mutate both")];
        agent_loop
            .run("system", &mut messages)
            .collect::<Vec<_>>()
            .await;

        assert_eq!(max_active.load(Ordering::SeqCst), 1);
    }
}
