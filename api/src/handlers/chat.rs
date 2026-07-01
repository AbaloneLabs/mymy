//! Chat HTTP handlers.

use std::convert::Infallible;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{delete, get, post};
use axum::Json;
use axum::Router;
use futures::Stream;
use uuid::Uuid;

use crate::agent::loop_engine::AgentEvent;
use crate::agent::providers::types::{FinishReason, Usage};
use crate::agent::providers::Message;
use crate::agent::runtime::run_moa_turn;
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::models::chat::{
    ApprovalDecisionRequest, ApprovalDecisionResponse, ChatMessagesResponse, ChatSessionResponse,
    ChatSessionsResponse, ChatSseEvent, ClarifyAnswerRequest, ClarifyAnswerResponse,
    CreateSessionRequest, DeleteResponse, SendMessageRequest, YoloModeRequest,
};
use crate::services::chat::{self as chat_service, PreparedExecution, SessionQuery};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/chat/sessions",
            get(list_sessions).post(create_session),
        )
        .route("/api/chat/sessions/{id}", delete(delete_session))
        .route(
            "/api/chat/sessions/{id}/messages",
            get(get_messages).post(send_message),
        )
        .route(
            "/api/chat/sessions/{id}/approvals/{request_id}",
            post(resolve_approval),
        )
        .route(
            "/api/chat/sessions/{id}/approvals/yolo",
            post(set_yolo_mode),
        )
        .route(
            "/api/chat/sessions/{id}/clarify/{request_id}",
            post(resolve_clarify),
        )
}

pub async fn list_sessions(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SessionQuery>,
) -> AppResult<Json<ChatSessionsResponse>> {
    Ok(Json(chat_service::list_sessions(&state, q).await?))
}

pub async fn create_session(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateSessionRequest>,
) -> AppResult<Json<ChatSessionResponse>> {
    Ok(Json(chat_service::create_session(&state, req).await?))
}

pub async fn get_messages(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ChatMessagesResponse>> {
    Ok(Json(chat_service::get_messages(&state, id).await?))
}

pub async fn send_message(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<SendMessageRequest>,
) -> AppResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let turn = chat_service::prepare_native_turn(&state, id, req).await?;
    let stream = stream_chat_turn(state, turn);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = chat_service::delete_session(&state, id).await?;
    Ok(Json(DeleteResponse { success }))
}

pub async fn resolve_approval(
    State(state): State<Arc<AppState>>,
    Path((id, request_id)): Path<(Uuid, String)>,
    Json(req): Json<ApprovalDecisionRequest>,
) -> AppResult<Json<ApprovalDecisionResponse>> {
    let success = state
        .approval_gate
        .resolve(id, &request_id, req.decision, req.remember)
        .await;
    if !success {
        return Err(AppError::NotFound(format!(
            "approval request {request_id} not found"
        )));
    }
    Ok(Json(ApprovalDecisionResponse { success }))
}

pub async fn set_yolo_mode(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<YoloModeRequest>,
) -> AppResult<Json<ApprovalDecisionResponse>> {
    state.approval_gate.set_yolo_mode(id, req.enabled).await;
    Ok(Json(ApprovalDecisionResponse { success: true }))
}

pub async fn resolve_clarify(
    State(state): State<Arc<AppState>>,
    Path((id, request_id)): Path<(Uuid, String)>,
    Json(req): Json<ClarifyAnswerRequest>,
) -> AppResult<Json<ClarifyAnswerResponse>> {
    let answer = req.answer.trim().to_string();
    if answer.is_empty() {
        return Err(AppError::BadRequest(
            "clarify answer cannot be empty".into(),
        ));
    }
    let success = state.clarify_gate.resolve(id, &request_id, answer).await;
    if !success {
        return Err(AppError::NotFound(format!(
            "clarify request {request_id} not found"
        )));
    }
    Ok(Json(ClarifyAnswerResponse { success }))
}

fn stream_chat_turn(
    state: Arc<AppState>,
    mut turn: chat_service::PreparedNativeTurn,
) -> impl Stream<Item = Result<Event, Infallible>> {
    async_stream::stream! {
        yield sse_event("user_message", &ChatSseEvent::UserMessage {
            message: Box::new(turn.user_message.clone()),
        });

        let mut done_totals = None;
        match &mut turn.execution {
            PreparedExecution::Agent(agent_loop) => {
                let mut events = agent_loop.run(&turn.system_prompt, &mut turn.messages);
                use futures::StreamExt as _;

                while let Some(event) = events.next().await {
                    match event {
                        AgentEvent::TextDelta(content) => {
                            let content = redact_sensitive_text(&content);
                            yield sse_event("text_delta", &ChatSseEvent::TextDelta { content });
                        }
                        AgentEvent::ReasoningDelta(content) => {
                            let content = redact_sensitive_text(&content);
                            yield sse_event("reasoning_delta", &ChatSseEvent::ReasoningDelta { content });
                        }
                        AgentEvent::ToolCallStarted { call_id, tool_name, arguments } => {
                            yield sse_event("tool_call_start", &ChatSseEvent::ToolCallStart {
                                call_id: redact_sensitive_text(&call_id),
                                tool_name,
                                arguments: redact_sensitive_text(&arguments),
                            });
                        }
                        AgentEvent::ToolCallFinished { call_id, result, error } => {
                            yield sse_event("tool_call_finish", &ChatSseEvent::ToolCallFinish {
                                call_id: redact_sensitive_text(&call_id),
                                result: redact_sensitive_text(&result),
                                error: error.map(|value| redact_sensitive_text(&value)),
                            });
                        }
                        AgentEvent::ApprovalRequired { request } => {
                            yield sse_event("approval_required", &ChatSseEvent::ApprovalRequired {
                                request,
                            });
                        }
                        AgentEvent::ClarifyRequired { request } => {
                            yield sse_event("clarify", &ChatSseEvent::Clarify {
                                request,
                            });
                        }
                        AgentEvent::TurnCompleted { finish_reason, usage } => {
                            yield sse_event("turn_completed", &ChatSseEvent::TurnCompleted {
                                finish_reason,
                                usage,
                            });
                        }
                        AgentEvent::ContextCompressing => {
                            yield sse_event("context_compressing", &ChatSseEvent::ContextCompressing);
                        }
                        AgentEvent::Error(message) => {
                            let message = redact_sensitive_text(&message);
                            yield sse_event("error", &ChatSseEvent::Error { message });
                        }
                        AgentEvent::Done { total_api_calls, total_tool_calls } => {
                            done_totals = Some((total_api_calls, total_tool_calls));
                            break;
                        }
                    }
                }
            }
            PreparedExecution::Moa(moa_turn) => {
                tracing::info!(
                    preset_id = %moa_turn.preset_id,
                    preset_name = %moa_turn.preset_name,
                    "running MoA chat turn"
                );
                match run_moa_turn(
                    &turn.system_prompt,
                    &turn.messages,
                    &[],
                    moa_turn.proposers.clone(),
                    moa_turn.aggregator.clone(),
                    moa_turn.config.clone(),
                )
                .await
                {
                    Ok(result) => {
                        let aggregated = redact_sensitive_text(&result.aggregated);
                        if !aggregated.is_empty() {
                            yield sse_event("text_delta", &ChatSseEvent::TextDelta {
                                content: aggregated.clone(),
                            });
                        }
                        turn.messages.push(Message::assistant(aggregated));
                        yield sse_event("turn_completed", &ChatSseEvent::TurnCompleted {
                            finish_reason: FinishReason::Stop,
                            usage: Usage::default(),
                        });
                        done_totals = Some((moa_turn.proposers.len() as u32 + 1, 0));
                    }
                    Err(err) => {
                        yield sse_event("error", &ChatSseEvent::Error {
                            message: redact_sensitive_text(&format!("MoA turn failed: {err}")),
                        });
                        done_totals = Some((0, 0));
                    }
                }
            }
        }

        let (total_api_calls, total_tool_calls) = done_totals.unwrap_or((0, 0));
        let new_messages = turn.messages[turn.agent_message_start..].to_vec();
        let assistant_message = match chat_service::save_agent_messages(&state, turn.session_id, &new_messages).await {
            Ok(message) => message,
            Err(err) => {
                yield sse_event("error", &ChatSseEvent::Error {
                    message: format!("failed to persist agent messages: {err}"),
                });
                None
            }
        };

        match chat_service::fetch_session_response(&state, turn.session_id).await {
            Ok(session) => {
                yield sse_event("done", &ChatSseEvent::Done {
                    assistant_message: assistant_message.map(Box::new),
                    session: Box::new(session),
                    total_api_calls,
                    total_tool_calls,
                });
            }
            Err(err) => {
                yield sse_event("error", &ChatSseEvent::Error {
                    message: format!("failed to reload session: {err}"),
                });
            }
        }
    }
}

fn sse_event(name: &str, payload: &ChatSseEvent) -> Result<Event, Infallible> {
    let data = serde_json::to_string(payload).unwrap_or_else(|_| {
        "{\"type\":\"error\",\"message\":\"event serialization failed\"}".to_string()
    });
    Ok(Event::default().event(name).data(data))
}
