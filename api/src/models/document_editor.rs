//! Request and response models for the built-in document editor.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Version of the JSON editing contract exchanged between the API and web UI.
/// Package formats have their own versions; this value protects the normalized
/// intermediate model from rolling-deployment field loss.
pub const DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION: u32 = 1;

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
    pub model_schema_version: u32,
    pub capabilities: Vec<String>,
    pub sync_status: DocumentEditorSyncStatus,
    pub revision_provenance: Option<DocumentRevisionProvenance>,
    pub compatibility_warnings: Vec<DocumentCompatibilityWarning>,
    pub model: Value,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocumentRevisionActorKind {
    User,
    Agent,
    System,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRevisionProvenance {
    pub actor_kind: DocumentRevisionActorKind,
    pub actor_id: Option<String>,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DocumentEditorSyncStatus {
    LocalOnly,
    Pending,
    Synced,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCompatibilityWarning {
    pub code: String,
    pub severity: DocumentCompatibilityWarningSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocumentCompatibilityWarningSeverity {
    Info,
    Warning,
    Danger,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteDocumentEditorModelRequest {
    pub path: String,
    pub editor_kind: DocumentEditorKind,
    pub model: Value,
    pub model_schema_version: u32,
    /// Capabilities the client used to interpret and mutate the normalized
    /// model. A rolling deployment must reject a write if any are unavailable.
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    /// Stable logical-save identity used to reconcile a committed write after
    /// its HTTP response is lost.
    pub idempotency_key: String,
    /// The exact durable revision the caller based its edit or overwrite
    /// decision on. Document editor writes always replace an existing file, so
    /// omitting this token would turn every save into a blind overwrite.
    pub expected_fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentEditorCopyRequest {
    pub source_path: String,
    pub target_path: String,
    pub editor_kind: DocumentEditorKind,
    pub model: Value,
    pub model_schema_version: u32,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    pub idempotency_key: String,
    /// The exact package revision from which the local draft was derived. A
    /// conflict copy must preserve unsupported parts from this snapshot, not
    /// borrow them from a newer external revision.
    pub base_fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateDocumentEditorModelRequest {
    pub path: String,
    pub editor_kind: DocumentEditorKind,
    pub model: Value,
    pub model_schema_version: u32,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    pub expected_fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateDocumentEditorModelResponse {
    pub fingerprint: String,
    pub serialized_size: usize,
    pub compatibility_warnings: Vec<DocumentCompatibilityWarning>,
}

#[cfg(test)]
mod tests {
    use super::{DocumentEditorKind, WriteDocumentEditorModelRequest};
    use serde_json::json;

    #[test]
    fn document_write_requires_revision_and_model_schema_tokens() {
        let complete = serde_json::from_value::<WriteDocumentEditorModelRequest>(json!({
            "path": "/drive/shared/document.md",
            "editorKind": "markdown",
            "model": { "content": "updated" },
            "modelSchemaVersion": 1,
            "requiredCapabilities": ["document-revision-cas-v1"],
            "idempotencyKey": "save-1",
            "expectedFingerprint": "revision-1"
        }))
        .unwrap();
        assert_eq!(complete.editor_kind, DocumentEditorKind::Markdown);

        let missing_revision = serde_json::from_value::<WriteDocumentEditorModelRequest>(json!({
            "path": "/drive/shared/document.md",
            "editorKind": "markdown",
            "model": { "content": "updated" },
            "modelSchemaVersion": 1
        }));
        assert!(missing_revision.is_err());

        let missing_schema = serde_json::from_value::<WriteDocumentEditorModelRequest>(json!({
            "path": "/drive/shared/document.md",
            "editorKind": "markdown",
            "model": { "content": "updated" },
            "requiredCapabilities": [],
            "idempotencyKey": "save-1",
            "expectedFingerprint": "revision-1"
        }));
        assert!(missing_schema.is_err());
    }
}
