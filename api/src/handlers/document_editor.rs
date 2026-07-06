//! Built-in document editor routes.

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};

use crate::error::AppResult;
use crate::models::document_editor::{
    DocumentEditorModelResponse, WriteDocumentEditorModelRequest,
};
use crate::models::drive::DrivePathQuery;
use crate::services::document_editor;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route(
        "/api/document-editor/model",
        get(read_document_model).put(write_document_model),
    )
}

async fn read_document_model(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DrivePathQuery>,
) -> AppResult<Json<DocumentEditorModelResponse>> {
    let path = query.path.unwrap_or_else(|| "/drive".to_string());
    Ok(Json(document_editor::read_model(&state, &path).await?))
}

async fn write_document_model(
    State(state): State<Arc<AppState>>,
    Json(request): Json<WriteDocumentEditorModelRequest>,
) -> AppResult<Json<DocumentEditorModelResponse>> {
    Ok(Json(document_editor::write_model(&state, request).await?))
}
