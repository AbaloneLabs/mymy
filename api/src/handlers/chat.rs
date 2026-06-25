//! Chat HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{delete, get};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::chat::{
    ChatMessagesResponse, ChatSessionResponse, ChatSessionsResponse, CreateSessionRequest,
    DeleteResponse, SendMessageRequest, SendMessageResponse,
};
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
            "/api/chat/sessions/{id}/messages",
            get(get_messages).post(send_message),
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
) -> AppResult<Json<SendMessageResponse>> {
    Ok(Json(chat_service::send_message(&state, id, req).await?))
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = chat_service::delete_session(&state, id).await?;
    Ok(Json(DeleteResponse { success }))
}
