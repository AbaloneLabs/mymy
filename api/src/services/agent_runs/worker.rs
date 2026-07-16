//! Background agent-run worker.
//!
//! PostgreSQL leases own execution. The local notify only reduces queue and
//! replay latency, while heartbeat and lease epochs prevent a stale worker
//! from claiming completion after ownership has moved elsewhere.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::StreamExt;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::agent::execution::{
    AuthorizationContext, RunCancellation, SessionTrigger, ToolExecutionContext,
};
use crate::agent::loop_engine::AgentEvent;
use crate::agent::providers::types::{FinishReason, Usage};
use crate::agent::providers::Message;
use crate::agent::runtime::run_moa_turn;
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::models::chat::{ChatSseEvent, SendMessageRequest};
use crate::services::chat::{self as chat_service, PreparedExecution};
use crate::state::AppState;

use super::{
    append_event_for_lease, apply_message_projection, apply_one_pending_projection,
    cancel_one_queued_run, cancel_requested, claim_next_run, defer_run_for_provider_retry,
    finish_run, heartbeat_run, load_trigger_input, mark_input_applied, pause_run_for_decision,
    queue_message_projection, reconcile_one_stale_run, update_run_snapshot, AgentRunRow,
};

const TEXT_EVENT_MAX_CHARS: usize = 2_048;
const TEXT_EVENT_FLUSH_INTERVAL: Duration = Duration::from_millis(250);

pub fn start_agent_run_worker(state: Arc<AppState>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let worker_id = format!("api:{}", Uuid::new_v4());
        loop {
            let progressed = match run_worker_iteration(&state, &worker_id).await {
                Ok(progressed) => progressed,
                Err(err) => {
                    tracing::error!(error = %err, "agent run worker iteration failed");
                    false
                }
            };
            if progressed {
                continue;
            }
            tokio::select! {
                _ = state.agent_run_notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(1)) => {}
            }
        }
    })
}

async fn run_worker_iteration(state: &AppState, worker_id: &str) -> AppResult<bool> {
    if crate::services::decisions::expire_pending_decisions(state).await? > 0 {
        return Ok(true);
    }
    if cancel_one_queued_run(state).await? {
        return Ok(true);
    }
    if reconcile_one_stale_run(state).await? {
        return Ok(true);
    }
    if apply_one_pending_projection(state).await? {
        return Ok(true);
    }
    let Some(run) = claim_next_run(state, worker_id).await? else {
        return Ok(false);
    };
    execute_claimed_run(state, run).await;
    Ok(true)
}

async fn execute_claimed_run(state: &AppState, run: AgentRunRow) {
    let run_started = Instant::now();
    metrics::counter!(
        "mymy_agent_runs_started_total",
        "trigger" => run.trigger_type.clone(),
    )
    .increment(1);
    let span = tracing::info_span!(
        "agent_run",
        run_id = %run.id,
        trigger = %run.trigger_type,
        agent_profile = %run.agent_profile,
        lease_epoch = run.lease_epoch,
        lease_expires_at = ?run.lease_expires_at,
    );
    let _guard = span.enter();
    tracing::info!("agent run started");

    let started_payload = serde_json::to_value(ChatSseEvent::RunStatus {
        run_id: run.id.to_string(),
        status: "running".to_string(),
        cancel_requested: run.cancel_requested_at.is_some(),
    })
    .unwrap_or_else(|_| serde_json::json!({"type": "error"}));
    if let Err(err) = append_event_for_lease(
        state,
        &run,
        "run_started",
        started_payload,
        Some(&format!("run-started:{}", run.lease_epoch)),
    )
    .await
    {
        tracing::error!(error = %err, "failed to append run start event");
        return;
    }

    let cancellation = state
        .register_run_cancellation(run.id, run.lease_epoch)
        .await;
    if run.cancel_requested_at.is_some() {
        cancellation.cancel();
    }

    let (heartbeat_stop, heartbeat_receiver) = watch::channel(false);
    let heartbeat_state = state.clone();
    let heartbeat_run = run.clone();
    let heartbeat_cancellation = cancellation.clone();
    let heartbeat_task = tokio::spawn(async move {
        maintain_heartbeat(
            heartbeat_state,
            heartbeat_run,
            heartbeat_cancellation,
            heartbeat_receiver,
        )
        .await;
    });
    let cancellation_state = state.clone();
    let cancellation_run = run.clone();
    let cancellation_token = cancellation.clone();
    let cancellation_receiver = heartbeat_stop.subscribe();
    let initial_permission_fingerprint = match crate::services::agent_permissions::load_policy(
        state,
        &run.agent_profile,
    )
    .await
    {
        Ok(policy) => policy.fingerprint(),
        Err(error) => {
            tracing::error!(run_id = %run.id, error = %error, "failed to snapshot Run permissions");
            cancellation.cancel();
            String::new()
        }
    };
    let cancellation_task = tokio::spawn(async move {
        monitor_durable_cancellation(
            cancellation_state,
            cancellation_run,
            cancellation_token,
            cancellation_receiver,
            initial_permission_fingerprint,
        )
        .await;
    });

    let outcome = execute_chat_run(state, &run, cancellation).await;
    let _ = heartbeat_stop.send(true);
    let _ = heartbeat_task.await;
    let _ = cancellation_task.await;

    match outcome {
        Ok(outcome) => {
            if let Some(message) = outcome.provider_retry_error.as_deref() {
                match defer_run_for_provider_retry(state, &run, message).await {
                    Ok(()) => {
                        metrics::counter!(
                            "mymy_agent_provider_durable_retries_total",
                            "trigger" => run.trigger_type.clone(),
                        )
                        .increment(1);
                        tracing::warn!("agent run parked for durable provider retry");
                    }
                    Err(error) => {
                        tracing::error!(error = %error, "failed to schedule durable provider retry");
                    }
                }
                state
                    .unregister_run_cancellation(run.id, run.lease_epoch)
                    .await;
                return;
            }
            if let Some(decision_id) = outcome.paused_decision_id.as_deref() {
                match pause_run_for_decision(state, &run, decision_id).await {
                    Ok(true) => {
                        tracing::info!(decision_id, "agent run paused for decision");
                        if run.trigger_type == "cron" {
                            if let Err(err) =
                                crate::services::cron::mark_occurrence_waiting(state, run.id).await
                            {
                                tracing::error!(error = %err, "failed to mark cron occurrence waiting");
                            }
                        }
                    }
                    Ok(false) => {
                        tracing::info!(decision_id, "Decision resolved before pause; Run requeued");
                        state
                            .unregister_run_cancellation(run.id, run.lease_epoch)
                            .await;
                        record_run_finished(&run, "queued", run_started.elapsed());
                        return;
                    }
                    Err(err) => {
                        tracing::error!(error = %err, "failed to pause run for decision");
                        let _ = persist_terminal_status_notice(
                            state,
                            &run,
                            "failed",
                            Some("decision_pause_failed"),
                        )
                        .await;
                        let _ = finish_run(
                            state,
                            &run,
                            "failed",
                            Some("decision_pause_failed"),
                            serde_json::json!({}),
                        )
                        .await;
                        if run.trigger_type == "cron" {
                            let _ =
                                crate::services::cron::finalize_occurrence(state, run.id, "failed")
                                    .await;
                        }
                        state
                            .unregister_run_cancellation(run.id, run.lease_epoch)
                            .await;
                        record_run_finished(&run, "failed", run_started.elapsed());
                        return;
                    }
                }
                state
                    .unregister_run_cancellation(run.id, run.lease_epoch)
                    .await;
                record_run_finished(&run, "waiting_decision", run_started.elapsed());
                return;
            }
            let status = terminal_status(&outcome);
            if status != "completed" {
                if let Err(error) = persist_terminal_status_notice(
                    state,
                    &run,
                    status,
                    outcome.error_code.as_deref(),
                )
                .await
                {
                    tracing::error!(error = %error, "failed to persist terminal Run status message");
                }
            }
            match finish_run(
                state,
                &run,
                status,
                outcome.error_code.as_deref(),
                serde_json::json!({
                    "apiCalls": outcome.total_api_calls,
                    "toolCalls": outcome.total_tool_calls,
                    "promptTokens": outcome.usage.prompt_tokens,
                    "completionTokens": outcome.usage.completion_tokens,
                    "totalTokens": outcome.usage.total_tokens,
                }),
            )
            .await
            {
                Ok(actual_status) => {
                    if actual_status == "queued" {
                        tracing::info!(
                            "agent run requeued to deliver a newly resolved Decision answer"
                        );
                        record_run_finished(&run, "queued", run_started.elapsed());
                        state
                            .unregister_run_cancellation(run.id, run.lease_epoch)
                            .await;
                        return;
                    }
                    crate::services::runtime_memory::spawn_run_summary(state.clone(), run.id);
                    if actual_status == "completed" && outcome.total_tool_calls > 0 {
                        if let Err(err) = crate::services::proactive::record_activity(
                            state,
                            Some(&run.agent_profile),
                            run.project_id,
                            "productive_run",
                            &run.id.to_string(),
                        )
                        .await
                        {
                            tracing::warn!(error = %err, "failed to record productive run activity");
                        }
                    }
                    if run.trigger_type == "cron" {
                        if let Err(err) = crate::services::cron::finalize_occurrence(
                            state,
                            run.id,
                            &actual_status,
                        )
                        .await
                        {
                            tracing::error!(error = %err, "failed to finalize cron occurrence");
                        }
                    }
                    tracing::info!(status = actual_status, "agent run finished");
                    record_run_finished(&run, &actual_status, run_started.elapsed());
                }
                Err(err) => tracing::error!(error = %err, "failed to commit run terminal state"),
            }
        }
        Err(err) => {
            let message = redact_sensitive_text(&err.to_string());
            let _ = append_chat_event(
                state,
                &run,
                "error",
                &ChatSseEvent::Error {
                    message: message.clone(),
                },
                Some("run-error"),
            )
            .await;
            if let Err(status_error) =
                persist_terminal_status_notice(state, &run, "failed", Some(error_code(&err))).await
            {
                tracing::error!(error = %status_error, "failed to persist Run failure message");
            }
            if let Err(finish_err) = finish_run(
                state,
                &run,
                "failed",
                Some(error_code(&err)),
                serde_json::json!({}),
            )
            .await
            {
                tracing::error!(error = %finish_err, "failed to persist agent run failure");
            } else {
                crate::services::runtime_memory::spawn_run_summary(state.clone(), run.id);
                if run.trigger_type == "cron" {
                    if let Err(finalize_err) =
                        crate::services::cron::finalize_occurrence(state, run.id, "failed").await
                    {
                        tracing::error!(error = %finalize_err, "failed to finalize failed cron occurrence");
                    }
                }
            }
            tracing::error!(error = %err, "agent run failed");
            record_run_finished(&run, "failed", run_started.elapsed());
        }
    }
    state
        .unregister_run_cancellation(run.id, run.lease_epoch)
        .await;
}

fn record_run_finished(run: &AgentRunRow, status: &str, duration: Duration) {
    metrics::counter!(
        "mymy_agent_runs_finished_total",
        "trigger" => run.trigger_type.clone(),
        "status" => status.to_string(),
    )
    .increment(1);
    metrics::histogram!(
        "mymy_agent_run_duration_seconds",
        "trigger" => run.trigger_type.clone(),
        "status" => status.to_string(),
    )
    .record(duration.as_secs_f64());
}

async fn execute_chat_run(
    state: &AppState,
    run: &AgentRunRow,
    cancellation: RunCancellation,
) -> AppResult<RunOutcome> {
    let session_id = run
        .session_id
        .ok_or_else(|| AppError::Internal("runtime run is missing session_id".to_string()))?;
    let input = load_trigger_input(state, run).await?;
    let use_moa = input
        .options
        .get("useMoa")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let moa_preset_id = input
        .options
        .get("moaPresetId")
        .and_then(serde_json::Value::as_str)
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|err| AppError::BadRequest(format!("invalid queued MoA preset id: {err}")))?;
    let mut preparation_attempt = 0;
    let mut turn = loop {
        let prepared = chat_service::prepare_native_turn_for_input(
            state,
            run.id,
            session_id,
            input.id,
            SendMessageRequest {
                text: input.content.clone(),
                use_moa,
                moa_preset_id,
            },
        )
        .await?;
        if crate::services::runtime_memory::memory_context_is_current(state, run.id).await? {
            break prepared;
        }
        preparation_attempt += 1;
        crate::services::runtime_memory::reset_memory_context_before_dispatch(state, run.id)
            .await?;
        if preparation_attempt >= 3 {
            return Err(AppError::ServiceUnavailable(
                "memory context kept changing before provider dispatch; retry the turn".to_string(),
            ));
        }
    };
    ensure_contract_revision_compatible(
        run.tool_schema_fingerprint.as_deref(),
        &turn.tool_schema_fingerprint,
    )?;
    let mut resume_blocks = Vec::new();
    if let Some(resume_input) =
        crate::services::run_progress::latest_resume_input(state, run.id).await?
    {
        resume_blocks.push(resume_input);
    }
    let decision_inbox = crate::services::decisions::resolved_answer_inbox(state, run.id).await?;
    resume_blocks.extend(decision_inbox.messages);
    if !resume_blocks.is_empty() {
        turn.messages
            .push(Message::user(resume_blocks.join("\n\n")));
    }
    let mut authorization =
        serde_json::from_value::<AuthorizationContext>(run.authorization_context.clone())
            .unwrap_or_default();
    authorization.explicit_user_action = run.trigger_type == "chat";
    let max_runtime = authorization
        .budget
        .get("maxRuntimeSeconds")
        .and_then(serde_json::Value::as_u64)
        .map(Duration::from_secs);
    let max_total_tokens = authorization
        .budget
        .get("maxTotalTokens")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    if let PreparedExecution::Agent(agent_loop) = &mut turn.execution {
        agent_loop.set_execution_context(ToolExecutionContext {
            run_id: run.id,
            session_id: run.session_id,
            agent_profile: run.agent_profile.clone(),
            trigger: trigger_for_run(run)?,
            project_id: run.project_id,
            authorization,
            invocation_id: String::new(),
            lease_epoch: run.lease_epoch,
            cancellation: cancellation.clone(),
            guard: Some(super::tool_execution_guard(state.clone())),
            progress: Some(super::run_progress_store(state.clone())),
            decisions: Some(crate::services::decisions::coordinator(state.clone())),
        });
        agent_loop.set_delegate_run_coordinator(super::delegate_run_coordinator(state.clone()));
    }
    update_run_snapshot(
        state,
        run,
        &turn.tool_schema_fingerprint,
        turn.system_prompt.chars().count(),
        turn.tool_count,
    )
    .await?;
    crate::services::decisions::mark_inbox_delivered(
        state,
        run.id,
        run.lease_epoch,
        &run.agent_profile,
        decision_inbox.revision,
    )
    .await?;
    mark_input_applied(state, input.id).await?;

    let mut user_message = turn.user_message.clone();
    user_message.content = redact_sensitive_text(&user_message.content);
    append_chat_event(
        state,
        run,
        "user_message",
        &ChatSseEvent::UserMessage {
            message: Box::new(user_message),
        },
        Some("user-message"),
    )
    .await?;

    let mut total_api_calls = 0;
    let mut total_tool_calls = 0;
    let mut total_usage = Usage::default();
    let mut terminal_error = None;
    let mut provider_retry_error = None;
    let mut cancelled = false;
    let mut paused_decision_id = None;
    let defer_text_delivery = turn.buffered_output_required;
    let mut deferred_text = String::new();
    let new_messages;

    match &mut turn.execution {
        PreparedExecution::Agent(agent_loop) => {
            let mut text_buffer = TextEventBuffer::new();
            let execution_started = Instant::now();
            let mut active_tool_calls = HashMap::new();
            let mut events = agent_loop.run(&turn.system_prompt, &mut turn.messages);
            loop {
                let mut budget_expired = false;
                let next_event = if let Some(limit) = max_runtime {
                    let remaining = limit.saturating_sub(execution_started.elapsed());
                    match tokio::time::timeout(remaining, events.next()).await {
                        Ok(event) => event,
                        Err(_) => {
                            budget_expired = true;
                            None
                        }
                    }
                } else {
                    events.next().await
                };
                if budget_expired {
                    cancellation.cancel();
                    terminal_error = Some("runtime_budget_exceeded".to_string());
                    flush_text_buffer(state, run, &mut text_buffer).await?;
                    append_chat_event(
                        state,
                        run,
                        "error",
                        &ChatSseEvent::Error {
                            message: "run runtime budget exceeded; partial output was preserved"
                                .to_string(),
                        },
                        Some("runtime-budget-exceeded"),
                    )
                    .await?;
                    for call_id in active_tool_calls.keys() {
                        append_chat_event(
                            state,
                            run,
                            "tool_outcome_unknown",
                            &ChatSseEvent::OutcomeUnknown {
                                run_id: run.id.to_string(),
                                message: "The runtime budget expired while a tool was active. Verify the target state before retrying."
                                    .to_string(),
                            },
                            Some(&format!("runtime-budget-tool:{call_id}")),
                        )
                        .await?;
                    }
                    break;
                }
                let Some(event) = next_event else {
                    break;
                };
                if cancel_requested(state, run.id).await? {
                    cancellation.cancel();
                    cancelled = true;
                    break;
                }
                match event {
                    AgentEvent::TextDelta(content) => {
                        if defer_text_delivery {
                            deferred_text.push_str(&content);
                            if deferred_text.len() > 1_000_000 {
                                cancellation.cancel();
                                terminal_error = Some("buffered_output_too_large".to_string());
                                cancelled = true;
                                break;
                            }
                        } else {
                            text_buffer.push(&content);
                            if text_buffer.should_flush() {
                                flush_text_buffer(state, run, &mut text_buffer).await?;
                            }
                        }
                    }
                    AgentEvent::ReasoningDelta(content) => {
                        // Hidden reasoning is intentionally neither persisted nor projected.
                        drop(content);
                    }
                    AgentEvent::ModelTurnStarted { iteration } => {
                        flush_text_buffer(state, run, &mut text_buffer).await?;
                        append_chat_event(
                            state,
                            run,
                            "model_turn_started",
                            &ChatSseEvent::ModelTurnStarted { iteration },
                            Some(&format!("model-turn-started:{iteration}")),
                        )
                        .await?;
                    }
                    AgentEvent::ToolCallStarted {
                        call_id,
                        tool_name,
                        arguments,
                        resource_key,
                        capability,
                    } => {
                        active_tool_calls.insert(
                            call_id.clone(),
                            ToolNoticeContext {
                                tool_name: tool_name.clone(),
                                resource_key: resource_key.clone(),
                            },
                        );
                        flush_text_buffer(state, run, &mut text_buffer).await?;
                        append_chat_event(
                            state,
                            run,
                            "tool_call_start",
                            &ChatSseEvent::ToolCallStart {
                                call_id: redact_sensitive_text(&call_id),
                                tool_name,
                                arguments: redact_sensitive_text(&arguments),
                                resource_key,
                                capability,
                            },
                            Some(&format!("tool-start:{call_id}")),
                        )
                        .await?;
                    }
                    AgentEvent::ToolCallFinished {
                        call_id,
                        result,
                        error,
                        duration_ms,
                    } => {
                        let tool_context = active_tool_calls.remove(&call_id);
                        flush_text_buffer(state, run, &mut text_buffer).await?;
                        append_chat_event(
                            state,
                            run,
                            "tool_call_finish",
                            &ChatSseEvent::ToolCallFinish {
                                call_id: redact_sensitive_text(&call_id),
                                result: redact_sensitive_text(&result),
                                error: error.map(|value| redact_sensitive_text(&value)),
                                duration_ms,
                            },
                            Some(&format!("tool-finish:{call_id}")),
                        )
                        .await?;
                        if let Some(tool_context) = tool_context.as_ref() {
                            persist_tool_status_notice(
                                state,
                                run,
                                session_id,
                                &call_id,
                                tool_context,
                                &result,
                            )
                            .await?;
                        }
                    }
                    AgentEvent::ClarifyRequired { request } => {
                        flush_text_buffer(state, run, &mut text_buffer).await?;
                        append_chat_event(
                            state,
                            run,
                            "clarify",
                            &ChatSseEvent::Clarify { request },
                            None,
                        )
                        .await?;
                    }
                    AgentEvent::TurnCompleted {
                        finish_reason,
                        usage,
                    } => {
                        total_usage.prompt_tokens = total_usage
                            .prompt_tokens
                            .saturating_add(usage.prompt_tokens);
                        total_usage.completion_tokens = total_usage
                            .completion_tokens
                            .saturating_add(usage.completion_tokens);
                        total_usage.total_tokens =
                            total_usage.total_tokens.saturating_add(usage.total_tokens);
                        flush_text_buffer(state, run, &mut text_buffer).await?;
                        append_chat_event(
                            state,
                            run,
                            "model_turn_finished",
                            &ChatSseEvent::TurnCompleted {
                                finish_reason,
                                usage,
                            },
                            None,
                        )
                        .await?;
                    }
                    AgentEvent::ContextCompressing => {
                        flush_text_buffer(state, run, &mut text_buffer).await?;
                        append_chat_event(
                            state,
                            run,
                            "context_compressing",
                            &ChatSseEvent::ContextCompressing,
                            None,
                        )
                        .await?;
                    }
                    AgentEvent::RunPaused { decision_id } => {
                        flush_text_buffer(state, run, &mut text_buffer).await?;
                        paused_decision_id = Some(decision_id);
                        break;
                    }
                    AgentEvent::ProviderUnavailable(message) => {
                        flush_text_buffer(state, run, &mut text_buffer).await?;
                        provider_retry_error = Some(redact_sensitive_text(&message));
                    }
                    AgentEvent::Error(message) => {
                        flush_text_buffer(state, run, &mut text_buffer).await?;
                        terminal_error = Some(
                            if message.contains("budget exceeded") {
                                "runtime_budget_exceeded"
                            } else {
                                "agent_loop_error"
                            }
                            .to_string(),
                        );
                        append_chat_event(
                            state,
                            run,
                            "error",
                            &ChatSseEvent::Error {
                                message: redact_sensitive_text(&message),
                            },
                            None,
                        )
                        .await?;
                    }
                    AgentEvent::Done {
                        total_api_calls: api_calls,
                        total_tool_calls: tool_calls,
                    } => {
                        total_api_calls = api_calls;
                        total_tool_calls = tool_calls;
                        break;
                    }
                }
            }
            flush_text_buffer(state, run, &mut text_buffer).await?;
            new_messages = agent_loop.generated_messages();
        }
        PreparedExecution::Moa(moa_turn) => {
            tracing::info!("running MoA agent run");
            let result = tokio::select! {
                _ = cancellation.cancelled() => {
                    cancelled = true;
                    None
                }
                result = async {
                    let execution = run_moa_turn(
                        &turn.system_prompt,
                        &turn.messages,
                        &[],
                        moa_turn.proposers.clone(),
                        moa_turn.aggregator.clone(),
                        moa_turn.config.clone(),
                    );
                    match max_runtime {
                        Some(limit) => tokio::time::timeout(limit, execution).await.ok(),
                        None => Some(execution.await),
                    }
                } => match result {
                    Some(result) => Some(result.map_err(|err| AppError::Internal(format!("MoA run failed: {err}")))?),
                    None => {
                        cancellation.cancel();
                        terminal_error = Some("runtime_budget_exceeded".to_string());
                        append_chat_event(
                            state,
                            run,
                            "error",
                            &ChatSseEvent::Error {
                                message: "run runtime budget exceeded before MoA aggregation completed"
                                    .to_string(),
                            },
                            Some("runtime-budget-exceeded"),
                        )
                        .await?;
                        None
                    }
                },
            };
            let Some(result) = result else {
                return Ok(RunOutcome {
                    total_api_calls,
                    total_tool_calls,
                    usage: total_usage,
                    error_code: terminal_error,
                    cancelled,
                    paused_decision_id: None,
                    provider_retry_error: None,
                });
            };
            let aggregated = redact_sensitive_text(&result.aggregated);
            total_usage = result.usage.clone();
            if max_total_tokens.is_some_and(|limit| total_usage.total_tokens > limit) {
                terminal_error = Some("runtime_budget_exceeded".to_string());
                append_chat_event(
                    state,
                    run,
                    "error",
                    &ChatSseEvent::Error {
                        message: "MoA token usage exceeded the run budget; the completed partial result was preserved"
                            .to_string(),
                    },
                    Some("token-budget-exceeded"),
                )
                .await?;
            }
            if !aggregated.is_empty() && !defer_text_delivery {
                append_chat_event(
                    state,
                    run,
                    "text_delta",
                    &ChatSseEvent::TextDelta {
                        content: aggregated.clone(),
                    },
                    None,
                )
                .await?;
            } else if defer_text_delivery {
                deferred_text = aggregated.clone();
            }
            turn.messages.push(Message::assistant(aggregated));
            append_chat_event(
                state,
                run,
                "turn_completed",
                &ChatSseEvent::TurnCompleted {
                    finish_reason: FinishReason::Stop,
                    usage: total_usage.clone(),
                },
                None,
            )
            .await?;
            total_api_calls = moa_turn.proposers.len() as u32 + 1;
            new_messages = turn.messages[turn.agent_message_start..].to_vec();
        }
    }

    if cancellation.is_cancelled() && paused_decision_id.is_none() {
        if cancel_requested(state, run.id).await? {
            cancelled = true;
        } else {
            let current_permission_fingerprint =
                crate::services::agent_permissions::load_policy(state, &run.agent_profile)
                    .await?
                    .fingerprint();
            terminal_error = Some(
                if current_permission_fingerprint != turn.permission_fingerprint {
                    "permission_revision_changed"
                } else if !crate::services::runtime_memory::memory_context_is_current(state, run.id)
                    .await?
                {
                    "memory_context_changed"
                } else {
                    "run_execution_cancelled"
                }
                .to_string(),
            );
        }
    }

    if provider_retry_error.is_some() {
        return Ok(RunOutcome {
            total_api_calls,
            total_tool_calls,
            usage: total_usage,
            error_code: None,
            cancelled: false,
            paused_decision_id: None,
            provider_retry_error,
        });
    }

    if cancelled {
        return Ok(RunOutcome {
            total_api_calls,
            total_tool_calls,
            usage: total_usage,
            error_code: None,
            cancelled,
            paused_decision_id,
            provider_retry_error: None,
        });
    }

    if defer_text_delivery {
        let current_permission_fingerprint =
            crate::services::agent_permissions::load_policy(state, &run.agent_profile)
                .await?
                .fingerprint();
        let memory_context_current =
            crate::services::runtime_memory::memory_context_is_current(state, run.id).await?;
        if current_permission_fingerprint != turn.permission_fingerprint || !memory_context_current
        {
            cancellation.cancel();
            append_chat_event(
                state,
                run,
                "error",
                &ChatSseEvent::Error {
                    message: "Run permissions or recalled memory changed before buffered output delivery; the response was withheld."
                        .to_string(),
                },
                Some("buffered-output-context-change"),
            )
            .await?;
            return Ok(RunOutcome {
                total_api_calls,
                total_tool_calls,
                usage: total_usage,
                error_code: Some(if memory_context_current {
                    "permission_revision_changed".to_string()
                } else {
                    "memory_context_changed".to_string()
                }),
                cancelled: true,
                paused_decision_id: None,
                provider_retry_error: None,
            });
        }
        if !deferred_text.is_empty() {
            append_chat_event(
                state,
                run,
                "text_delta",
                &ChatSseEvent::TextDelta {
                    content: deferred_text.clone(),
                },
                Some("buffered-text-delivery"),
            )
            .await?;
        }
    }

    queue_message_projection(state, run, session_id, &new_messages).await?;
    let assistant_message = apply_message_projection(state, run.id).await?;
    if let Some(pending) =
        crate::services::decisions::pending_decision_for_run(state, run.id).await?
    {
        persist_waiting_decision_notice(state, run, session_id, &pending).await?;
        return Ok(RunOutcome {
            total_api_calls,
            total_tool_calls,
            usage: total_usage,
            error_code: terminal_error,
            cancelled: false,
            paused_decision_id: Some(pending.id.to_string()),
            provider_retry_error: None,
        });
    }
    paused_decision_id = None;
    if run.trigger_type == "cron" && terminal_error.is_none() && deferred_text.trim().is_empty() {
        terminal_error = Some("empty_agent_outcome".to_string());
        chat_service::save_run_status_message(
            state,
            run.id,
            session_id,
            "empty-agent-outcome",
            "작업이 실패했습니다.\n사유: empty_agent_outcome — cron 실행이 실제 응답이나 [SILENT] 결과 없이 종료되었습니다.\n실행 상태: 성공으로 기록되지 않았습니다.\n다음 단계: 이 세션에서 실행 기록을 확인한 뒤 작업을 다시 요청하세요.",
            serde_json::json!({
                "type": "run_status",
                "status": "failed",
                "reasonCode": "empty_agent_outcome",
                "agentRunId": run.id,
            }),
        )
        .await?;
    }
    let session = chat_service::fetch_session_response(state, session_id).await?;
    append_chat_event(
        state,
        run,
        "done",
        &ChatSseEvent::Done {
            assistant_message: assistant_message.map(Box::new),
            session: Box::new(session),
            total_api_calls,
            total_tool_calls,
        },
        Some("done"),
    )
    .await?;

    Ok(RunOutcome {
        total_api_calls,
        total_tool_calls,
        usage: total_usage,
        error_code: terminal_error,
        cancelled,
        paused_decision_id,
        provider_retry_error: None,
    })
}

async fn maintain_heartbeat(
    state: AppState,
    run: AgentRunRow,
    cancellation: RunCancellation,
    mut stop: watch::Receiver<bool>,
) {
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    loop {
        tokio::select! {
            _ = interval.tick() => {
                match heartbeat_run(&state, &run).await {
                    Ok(true) => {}
                    Ok(false) => {
                        cancellation.cancel();
                        break;
                    }
                    Err(err) => tracing::warn!(error = %err, run_id = %run.id, "agent run heartbeat failed"),
                }
            }
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    break;
                }
            }
        }
    }
}

async fn monitor_durable_cancellation(
    state: AppState,
    run: AgentRunRow,
    cancellation: RunCancellation,
    mut stop: watch::Receiver<bool>,
    initial_permission_fingerprint: String,
) {
    loop {
        tokio::select! {
            _ = state.agent_run_notify.notified() => {}
            _ = tokio::time::sleep(Duration::from_millis(500)) => {}
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    break;
                }
            }
        }
        match cancel_requested(&state, run.id).await {
            Ok(true) => {
                cancellation.cancel();
                break;
            }
            Ok(false) => {}
            Err(err) => tracing::warn!(error = %err, run_id = %run.id, "cancel polling failed"),
        }
        match crate::services::agent_permissions::load_policy(&state, &run.agent_profile).await {
            Ok(policy) if policy.fingerprint() != initial_permission_fingerprint => {
                tracing::warn!(run_id = %run.id, "Run cancelled because its permission revision changed");
                cancellation.cancel();
                break;
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(run_id = %run.id, error = %error, "Run permission revalidation failed closed");
                cancellation.cancel();
                break;
            }
        }
        match crate::services::runtime_memory::memory_context_is_current(&state, run.id).await {
            Ok(true) => {}
            Ok(false) => {
                tracing::warn!(run_id = %run.id, "Run cancelled because recalled memory changed");
                cancellation.cancel();
                break;
            }
            Err(error) => {
                tracing::warn!(run_id = %run.id, error = %error, "Run memory-context revalidation failed closed");
                cancellation.cancel();
                break;
            }
        }
    }
}

fn ensure_contract_revision_compatible(pinned: Option<&str>, current: &str) -> AppResult<()> {
    if pinned.is_some_and(|revision| revision != current) {
        return Err(AppError::coded(
            "contract_revision_unavailable",
            axum::http::StatusCode::CONFLICT,
            "This run was prepared with a different tool contract revision and cannot be resumed safely.",
        ));
    }
    Ok(())
}

fn trigger_for_run(run: &AgentRunRow) -> AppResult<SessionTrigger> {
    match run.trigger_type.as_str() {
        "chat" => Ok(SessionTrigger::Chat),
        "cron" => Ok(SessionTrigger::Cron {
            job_id: run.trigger_ref.clone().unwrap_or_default(),
        }),
        "wake" => Ok(SessionTrigger::Wake),
        "delegate" => Ok(SessionTrigger::Delegate {
            parent_run_id: run.parent_run_id.ok_or_else(|| {
                AppError::Internal("delegate run is missing parent_run_id".to_string())
            })?,
            parent_event_id: run.parent_event_id.ok_or_else(|| {
                AppError::Internal("delegate run is missing parent_event_id".to_string())
            })?,
            delegate_index: run.delegate_index.ok_or_else(|| {
                AppError::Internal("delegate run is missing delegate_index".to_string())
            })? as u32,
        }),
        trigger => Err(AppError::Internal(format!(
            "unsupported run trigger: {trigger}"
        ))),
    }
}

async fn append_chat_event(
    state: &AppState,
    run: &AgentRunRow,
    event_type: &str,
    event: &ChatSseEvent,
    idempotency_key: Option<&str>,
) -> AppResult<()> {
    let payload = serde_json::to_value(event)
        .map_err(|err| AppError::Internal(format!("run event serialization failed: {err}")))?;
    append_event_for_lease(state, run, event_type, payload, idempotency_key).await?;
    Ok(())
}

async fn flush_text_buffer(
    state: &AppState,
    run: &AgentRunRow,
    buffer: &mut TextEventBuffer,
) -> AppResult<()> {
    let Some(content) = buffer.take() else {
        return Ok(());
    };
    append_chat_event(
        state,
        run,
        "text_delta",
        &ChatSseEvent::TextDelta { content },
        None,
    )
    .await
}

struct TextEventBuffer {
    content: String,
    last_flush: Instant,
}

impl TextEventBuffer {
    fn new() -> Self {
        Self {
            content: String::new(),
            last_flush: Instant::now(),
        }
    }

    fn push(&mut self, value: &str) {
        self.content.push_str(value);
    }

    fn should_flush(&self) -> bool {
        self.content.chars().count() >= TEXT_EVENT_MAX_CHARS
            || self.last_flush.elapsed() >= TEXT_EVENT_FLUSH_INTERVAL
    }

    fn take(&mut self) -> Option<String> {
        if self.content.is_empty() {
            return None;
        }
        self.last_flush = Instant::now();
        Some(std::mem::take(&mut self.content))
    }
}

struct RunOutcome {
    total_api_calls: u32,
    total_tool_calls: u32,
    usage: Usage,
    error_code: Option<String>,
    cancelled: bool,
    paused_decision_id: Option<String>,
    provider_retry_error: Option<String>,
}

fn terminal_status(outcome: &RunOutcome) -> &'static str {
    if outcome.error_code.is_some() {
        "failed"
    } else if outcome.cancelled {
        "cancelled"
    } else {
        "completed"
    }
}

struct ToolNoticeContext {
    tool_name: String,
    resource_key: Option<String>,
}

async fn persist_waiting_decision_notice(
    state: &AppState,
    run: &AgentRunRow,
    session_id: Uuid,
    decision: &crate::services::decisions::PendingDecision,
) -> AppResult<()> {
    let scheduling = if decision.blocking {
        "독립 작업도 함께 일시 중지되었습니다."
    } else {
        "독립 작업을 마쳤으며, 답변이 필요한 작업만 보류되었습니다."
    };
    let content = format!(
        "사용자 판단을 기다리고 있습니다.\n질문: {}\n실행 상태: waiting_decision — {}\n다음 단계: Decision에 답하면 이 세션에서 작업이 자동으로 재개됩니다.",
        redact_sensitive_text(&decision.question),
        scheduling,
    );
    chat_service::save_run_status_message(
        state,
        run.id,
        session_id,
        &format!("waiting-decision:{}", decision.id),
        &content,
        serde_json::json!({
            "type": "run_status",
            "status": "waiting_decision",
            "decisionId": decision.id,
            "blocking": decision.blocking,
            "agentRunId": run.id,
        }),
    )
    .await
}

async fn persist_tool_status_notice(
    state: &AppState,
    run: &AgentRunRow,
    session_id: Uuid,
    call_id: &str,
    context: &ToolNoticeContext,
    result: &str,
) -> AppResult<()> {
    let Ok(result) = serde_json::from_str::<serde_json::Value>(result) else {
        return Ok(());
    };
    if result.get("ok").and_then(serde_json::Value::as_bool) != Some(false) {
        return Ok(());
    }
    let code = result
        .get("code")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("tool_error");
    let recovery_kind = result
        .get("recovery")
        .and_then(|recovery| recovery.get("kind"))
        .and_then(serde_json::Value::as_str);
    let visible_kind = match (code, recovery_kind) {
        (_, Some("safety_denied")) => "blocked",
        ("content_quarantined", _) | ("quarantine_capacity_exceeded", _) => "quarantined",
        ("content_rejected", _) => "blocked",
        ("execution_outcome_unknown", _) => "reconciliation_required",
        _ => return Ok(()),
    };
    let error = result
        .get("error")
        .and_then(serde_json::Value::as_str)
        .map(redact_sensitive_text)
        .unwrap_or_else(|| "정책 검사에서 작업을 허용하지 않았습니다.".to_string());
    let operation_state = result
        .get("operationState")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    let next_action = result
        .get("recovery")
        .and_then(|recovery| recovery.get("permittedNextAction"))
        .and_then(serde_json::Value::as_str)
        .map(redact_sensitive_text)
        .unwrap_or_else(|| match visible_kind {
            "quarantined" => {
                "격리 검토 화면에서 상태를 확인하세요. 대상은 변경되지 않았습니다.".to_string()
            }
            "reconciliation_required" => {
                "같은 쓰기를 다시 실행하지 말고 대상 상태를 먼저 읽어 확인하세요.".to_string()
            }
            _ => "안전한 범위로 작업을 좁히거나 이 분기를 중지하세요.".to_string(),
        });
    let target = context
        .resource_key
        .as_deref()
        .map(visible_resource_label)
        .unwrap_or_else(|| "설정된 대상".to_string());
    let content = format!(
        "작업이 차단되었습니다.\n요청: {} ({})\n사유: {} — {}\n실행 상태: {}\n다음 단계: {}",
        context.tool_name, target, code, error, operation_state, next_action,
    );
    chat_service::save_run_status_message(
        state,
        run.id,
        session_id,
        &format!("tool-status:{call_id}"),
        &content,
        serde_json::json!({
            "type": "run_status",
            "status": visible_kind,
            "reasonCode": code,
            "operationState": operation_state,
            "tool": context.tool_name,
            "agentRunId": run.id,
        }),
    )
    .await
}

fn visible_resource_label(resource_key: &str) -> String {
    let redacted = redact_sensitive_text(resource_key);
    let unsafe_path = redacted.contains("..")
        || redacted
            .split_once(':')
            .is_some_and(|(_, target)| target.starts_with('/') && !target.starts_with("/drive/"));
    if unsafe_path {
        let kind = redacted
            .split_once(':')
            .map_or("resource", |(kind, _)| kind);
        format!("{kind}:protected-target")
    } else {
        redacted
    }
}

async fn persist_terminal_status_notice(
    state: &AppState,
    run: &AgentRunRow,
    status: &str,
    reason_code: Option<&str>,
) -> AppResult<()> {
    let Some(session_id) = run.session_id else {
        return Ok(());
    };
    let reason_code = reason_code.unwrap_or(if status == "cancelled" {
        "cancelled_by_user"
    } else {
        "run_failed"
    });
    let (title, next_action) = if status == "cancelled" {
        (
            "작업이 취소되었습니다.",
            "필요하면 이 세션에서 범위를 조정해 새 요청을 보내세요.",
        )
    } else {
        (
            "작업이 실패했습니다.",
            "이 세션의 실행 기록과 차단 사유를 확인한 뒤 안전한 후속 요청을 보내세요.",
        )
    };
    let content =
        format!("{title}\n사유: {reason_code}\n실행 상태: {status}\n다음 단계: {next_action}");
    chat_service::save_run_status_message(
        state,
        run.id,
        session_id,
        &format!("terminal:{status}:{reason_code}"),
        &content,
        serde_json::json!({
            "type": "run_status",
            "status": status,
            "reasonCode": reason_code,
            "agentRunId": run.id,
        }),
    )
    .await
}

fn error_code(error: &AppError) -> &'static str {
    match error {
        AppError::BadRequest(_) => "bad_request",
        AppError::Unauthorized(_) => "unauthorized",
        AppError::Conflict(_) => "conflict",
        AppError::NotFound(_) => "not_found",
        AppError::Database(_) => "database_error",
        AppError::Io(_) => "io_error",
        AppError::Internal(_) => "internal_error",
        AppError::PayloadTooLarge(_) => "payload_too_large",
        AppError::UnsupportedMedia(_) => "unsupported_media",
        AppError::ServiceUnavailable(_) => "service_unavailable",
        AppError::Coded { code, .. } => code,
    }
}

#[cfg(test)]
mod contract_revision_tests {
    use super::*;

    #[test]
    fn fresh_and_matching_runs_accept_the_current_contract() {
        assert!(ensure_contract_revision_compatible(None, "v1").is_ok());
        assert!(ensure_contract_revision_compatible(Some("v1"), "v1").is_ok());
    }

    #[test]
    fn resumed_run_rejects_a_different_contract_before_execution() {
        let error = ensure_contract_revision_compatible(Some("v1"), "v2").unwrap_err();
        assert!(matches!(
            error,
            AppError::Coded {
                code: "contract_revision_unavailable",
                ..
            }
        ));
    }

    #[test]
    fn cancellation_and_internal_abort_never_become_false_success() {
        let cancelled = RunOutcome {
            total_api_calls: 0,
            total_tool_calls: 0,
            usage: Usage::default(),
            error_code: None,
            cancelled: true,
            paused_decision_id: None,
            provider_retry_error: None,
        };
        assert_eq!(terminal_status(&cancelled), "cancelled");

        let internal_abort = RunOutcome {
            error_code: Some("permission_revision_changed".to_string()),
            ..cancelled
        };
        assert_eq!(terminal_status(&internal_abort), "failed");
    }
}
