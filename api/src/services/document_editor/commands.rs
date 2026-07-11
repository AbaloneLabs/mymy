//! Document-editor application command boundary.
//!
//! HTTP handlers depend on this facade instead of conversion internals. The
//! boundary keeps transport concerns stable while codecs, persistence, and
//! conflict policy evolve independently, and gives non-HTTP callers one place
//! to apply the same open/save/copy/validate semantics.

use crate::error::AppResult;
use crate::models::document_editor::{
    DocumentEditorModelResponse, SaveDocumentEditorCopyRequest, ValidateDocumentEditorModelRequest,
    ValidateDocumentEditorModelResponse, WriteDocumentEditorModelRequest,
};
use crate::state::AppState;

pub struct DocumentEditorCommands<'a> {
    state: &'a AppState,
}

impl<'a> DocumentEditorCommands<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub async fn open(&self, logical_path: &str) -> AppResult<DocumentEditorModelResponse> {
        super::read_model(self.state, logical_path).await
    }

    pub async fn save(
        &self,
        request: WriteDocumentEditorModelRequest,
    ) -> AppResult<DocumentEditorModelResponse> {
        super::write_model(self.state, request).await
    }

    pub async fn save_copy(
        &self,
        request: SaveDocumentEditorCopyRequest,
    ) -> AppResult<DocumentEditorModelResponse> {
        super::save_copy(self.state, request).await
    }

    pub async fn validate(
        &self,
        request: ValidateDocumentEditorModelRequest,
    ) -> AppResult<ValidateDocumentEditorModelResponse> {
        super::validate_model(self.state, request).await
    }
}
