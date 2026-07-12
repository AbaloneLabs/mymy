//! Durable agent-run HTTP projections.
//!
//! Event streaming reads ordered PostgreSQL rows and waits only as an
//! optimization. Disconnecting this SSE response cannot cancel or own a run.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use async_stream::stream;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use futures::Stream;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::agent_run::{
    AgentRunChildrenResponse, AgentRunEventsQuery, AgentRunResponse, AgentRunsQuery,
    AgentRunsResponse, CancelAgentRunResponse, SessionRunInputResponse, SessionRuntimeResponse,
    UpdateSessionRunInputRequest,
};
use crate::services::agent_runs;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/agent-runs", get(list_runs))
        .route("/api/agent-runs/{id}", get(get_run))
        .route("/api/agent-runs/{id}/children", get(get_children))
        .route("/api/agent-runs/{id}/checklist", get(get_checklist))
        .route("/api/agent-runs/{id}/event-log", get(get_event_log))
        .route("/api/agent-runs/{id}/provenance", get(get_provenance))
        .route("/api/agent-runs/{id}/events", get(stream_events))
        .route("/api/agent-runs/{id}/cancel", post(cancel_run))
        .route("/api/chat/sessions/{id}/runtime", get(get_session_runtime))
        .route(
            "/api/session-run-inputs/{id}",
            patch(update_run_input).delete(cancel_run_input),
        )
}

async fn get_checklist(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let items = crate::services::run_progress::list_checklist(&state, id).await?;
    Ok(Json(serde_json::json!({ "items": items })))
}

async fn get_event_log(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<crate::models::agent_run::AgentRunEventsResponse>> {
    Ok(Json(agent_runs::list_run_events(&state, id, 0).await?))
}

async fn get_provenance(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<crate::models::artifact::RunProvenanceResponse>> {
    Ok(Json(
        crate::services::artifacts::list_run_provenance(&state, id).await?,
    ))
}

async fn list_runs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AgentRunsQuery>,
) -> AppResult<Json<AgentRunsResponse>> {
    Ok(Json(AgentRunsResponse {
        runs: agent_runs::list_runs(&state, query).await?,
    }))
}

async fn get_children(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<AgentRunChildrenResponse>> {
    Ok(Json(AgentRunChildrenResponse {
        children: agent_runs::list_child_runs(&state, id).await?,
    }))
}

async fn get_run(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<AgentRunResponse>> {
    Ok(Json(AgentRunResponse {
        run: agent_runs::get_run(&state, id).await?,
    }))
}

async fn get_session_runtime(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<SessionRuntimeResponse>> {
    Ok(Json(agent_runs::get_session_runtime(&state, id).await?))
}

async fn cancel_run(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<CancelAgentRunResponse>> {
    Ok(Json(agent_runs::request_cancel(&state, id, "user").await?))
}

async fn update_run_input(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateSessionRunInputRequest>,
) -> AppResult<Json<SessionRunInputResponse>> {
    Ok(Json(SessionRunInputResponse {
        input: agent_runs::update_queued_input(&state, id, request).await?,
    }))
}

async fn cancel_run_input(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<SessionRunInputResponse>> {
    Ok(Json(SessionRunInputResponse {
        input: agent_runs::cancel_queued_input(&state, id).await?,
    }))
}

async fn stream_events(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<AgentRunEventsQuery>,
) -> AppResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    agent_runs::get_run(&state, id).await?;
    let header_cursor = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    let stream = stream! {
        let mut cursor = query.after_sequence.max(header_cursor).max(0);
        loop {
            let snapshot = match agent_runs::list_run_events(&state, id, cursor).await {
                Ok(snapshot) => snapshot,
                Err(err) => {
                    let payload = serde_json::json!({
                        "type": "error",
                        "message": format!("run event replay failed: {err}"),
                    });
                    yield Ok(Event::default().event("error").data(payload.to_string()));
                    break;
                }
            };
            for item in snapshot.events {
                cursor = item.sequence;
                yield Ok(
                    Event::default()
                        .id(item.sequence.to_string())
                        .event(item.event_type)
                        .data(item.payload.to_string()),
                );
            }
            if is_terminal(&snapshot.run.status) && cursor >= snapshot.latest_sequence {
                break;
            }
            tokio::select! {
                _ = state.agent_run_notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(750)) => {}
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}
