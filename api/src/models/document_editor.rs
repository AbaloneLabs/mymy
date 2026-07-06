//! Request and response models for the built-in document editor.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocumentEditorKind {
    Markdown,
    Text,
    Csv,
    Tsv,
    Docx,
    Xlsx,
    Pptx,
    Preview,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEditorModelResponse {
    pub path: String,
    pub name: String,
    pub editor_kind: DocumentEditorKind,
    pub mime_type: String,
    pub fingerprint: String,
    pub model: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteDocumentEditorModelRequest {
    pub path: String,
    pub editor_kind: DocumentEditorKind,
    pub model: Value,
    pub expected_fingerprint: Option<String>,
}
