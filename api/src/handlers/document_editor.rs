//! Built-in document editor routes.

use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};

use crate::error::{AppError, AppResult};
use crate::models::document_editor::{
    DocumentEditorKind, DocumentEditorModelResponse, DocumentEditorSyncStatus,
    SaveDocumentEditorCopyRequest, ValidateDocumentEditorModelRequest,
    ValidateDocumentEditorModelResponse, WriteDocumentEditorModelRequest,
};
use crate::models::drive::DrivePathQuery;
use crate::services::document_editor;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/document-editor/model",
            get(read_document_model).put(write_document_model),
        )
        .route(
            "/api/document-editor/validate",
            post(validate_document_model),
        )
        .route("/api/document-editor/copy", post(save_document_copy))
}

async fn save_document_copy(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SaveDocumentEditorCopyRequest>,
) -> AppResult<Json<DocumentEditorModelResponse>> {
    let kind = document_editor_kind_metric(request.editor_kind);
    let started = Instant::now();
    let result = document_editor::save_copy(&state, request).await;
    record_document_editor_mutation("copy", kind, started, &result);
    Ok(Json(result?))
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
    let kind = document_editor_kind_metric(request.editor_kind);
    let started = Instant::now();
    let result = document_editor::write_model(&state, request).await;
    record_document_editor_mutation("save", kind, started, &result);
    Ok(Json(result?))
}

fn record_document_editor_mutation(
    operation: &'static str,
    kind: &'static str,
    started: Instant,
    result: &AppResult<DocumentEditorModelResponse>,
) {
    // Paths and document-derived values are deliberately excluded. These
    // bounded labels make conflict and durability regressions observable
    // without turning metrics storage into another document-content surface.
    let outcome = match result {
        Ok(response) if response.sync_status == DocumentEditorSyncStatus::Failed => {
            "committed_sync_failed"
        }
        Ok(_) => "committed",
        Err(AppError::Conflict(_)) => "conflict",
        Err(AppError::BadRequest(_)) => "rejected",
        Err(_) => "failed",
    };
    metrics::counter!(
        "mymy_document_editor_mutations_total",
        "operation" => operation,
        "kind" => kind,
        "outcome" => outcome
    )
    .increment(1);
    metrics::histogram!(
        "mymy_document_editor_mutation_duration_seconds",
        "operation" => operation,
        "kind" => kind,
        "outcome" => outcome
    )
    .record(started.elapsed().as_secs_f64());
}

fn document_editor_kind_metric(kind: DocumentEditorKind) -> &'static str {
    match kind {
        DocumentEditorKind::Markdown => "markdown",
        DocumentEditorKind::Text => "text",
        DocumentEditorKind::Csv => "csv",
        DocumentEditorKind::Tsv => "tsv",
        DocumentEditorKind::Docx => "docx",
        DocumentEditorKind::Xlsx => "xlsx",
        DocumentEditorKind::Pptx => "pptx",
        DocumentEditorKind::Preview => "preview",
    }
}

async fn validate_document_model(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ValidateDocumentEditorModelRequest>,
) -> AppResult<Json<ValidateDocumentEditorModelResponse>> {
    Ok(Json(
        document_editor::validate_model(&state, request).await?,
    ))
}
