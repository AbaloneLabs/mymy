//! Chat HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::agent_run::{EnqueueChatRunRequest, EnqueueChatRunResponse};
use crate::models::artifact::{
    ArtifactOpenResponse, SessionArtifactsQuery, SessionArtifactsResponse,
};
use crate::models::chat::{
    ChatMessagesResponse, ChatSessionResponse, ChatSessionsResponse, ClarifyAnswerRequest,
    ClarifyAnswerResponse, CreateSessionRequest, DeleteResponse, SessionDeletionImpactResponse,
};
use crate::services::agent_runs;
use crate::services::chat::{self as chat_service, SessionQuery};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/chat/sessions",
            get(list_sessions).post(create_session),
        )
        .route("/api/chat/sessions/{id}", delete(delete_session))
        .route(
            "/api/chat/sessions/{id}/deletion-impact",
            get(session_deletion_impact),
        )
        .route(
            "/api/chat/sessions/{id}/artifacts",
            get(list_session_artifacts),
        )
        .route("/api/artifacts/{id}/open", get(open_artifact))
        .route(
            "/api/chat/sessions/{id}/messages",
            get(get_messages).post(send_message),
        )
        .route(
            "/api/chat/sessions/{id}/clarify/{request_id}",
            post(resolve_clarify),
        )
}

pub async fn list_session_artifacts(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<SessionArtifactsQuery>,
) -> AppResult<Json<SessionArtifactsResponse>> {
    Ok(Json(
        crate::services::artifacts::list_session_artifacts(&state, id, query).await?,
    ))
}

pub async fn open_artifact(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ArtifactOpenResponse>> {
    Ok(Json(
        crate::services::artifacts::resolve_artifact_open(&state, id).await?,
    ))
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
    Json(req): Json<EnqueueChatRunRequest>,
) -> AppResult<(StatusCode, Json<EnqueueChatRunResponse>)> {
    Ok((
        StatusCode::ACCEPTED,
        Json(agent_runs::enqueue_chat_run(&state, id, req).await?),
    ))
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<DeleteSessionQuery>,
) -> AppResult<Json<DeleteResponse>> {
    let success =
        chat_service::delete_session_with_options(&state, id, query.confirm_future_cron_deletion)
            .await?;
    Ok(Json(DeleteResponse { success }))
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionQuery {
    #[serde(default)]
    confirm_future_cron_deletion: bool,
}

pub async fn session_deletion_impact(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<SessionDeletionImpactResponse>> {
    Ok(Json(
        chat_service::session_deletion_impact(&state, id).await?,
    ))
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
    if let Ok(decision_id) = Uuid::parse_str(&request_id) {
        if let Ok(decision) = crate::services::decisions::get_decision(&state, decision_id).await {
            if decision.session_id != Some(id.to_string()) {
                return Err(AppError::NotFound(format!(
                    "clarify request {request_id} not found"
                )));
            }
            let resolved = crate::services::decisions::resolve_decision(
                &state,
                decision_id,
                serde_json::Value::String(answer),
                "user",
            )
            .await?;
            return Ok(Json(ClarifyAnswerResponse {
                success: resolved.applied || resolved.decision.status == "resolved",
            }));
        }
    }
    let success = state.clarify_gate.resolve(id, &request_id, answer).await;
    if !success {
        return Err(AppError::NotFound(format!(
            "clarify request {request_id} not found"
        )));
    }
    Ok(Json(ClarifyAnswerResponse { success }))
}
