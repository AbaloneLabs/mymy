//! Note / wiki HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::note::{CreateNoteRequest, NoteResponse, NotesResponse, UpdateNoteRequest};
use crate::models::project::DeleteResponse;
use crate::services::notes::{self as notes_service, NoteQuery, SearchQuery};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/notes", get(list_notes).post(create_note))
        .route("/api/notes/search", get(search_notes))
        .route("/api/notes/{id}", patch(update_note).delete(delete_note))
}

pub async fn list_notes(
    State(state): State<Arc<AppState>>,
    Query(q): Query<NoteQuery>,
) -> AppResult<Json<NotesResponse>> {
    Ok(Json(notes_service::list_notes(&state, q).await?))
}

pub async fn search_notes(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<NotesResponse>> {
    Ok(Json(notes_service::search_notes(&state, q).await?))
}

pub async fn create_note(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateNoteRequest>,
) -> AppResult<Json<NoteResponse>> {
    Ok(Json(notes_service::create_note(&state, req).await?))
}

pub async fn update_note(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateNoteRequest>,
) -> AppResult<Json<NoteResponse>> {
    Ok(Json(notes_service::update_note(&state, id, req).await?))
}

pub async fn delete_note(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = notes_service::delete_note(&state, id).await?;
    Ok(Json(DeleteResponse { success }))
}
