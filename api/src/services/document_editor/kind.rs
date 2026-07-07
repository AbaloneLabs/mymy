//! File-kind detection and MIME metadata for document editor entries.
//!
//! Keeping kind detection outside the read/write implementation makes the
//! editor entrypoint easier to audit: path classification, API response
//! metadata, and format-specific conversion are separate decisions.

use std::path::Path;

use crate::models::document_editor::DocumentEditorKind;

pub fn editor_kind_for_path(path: &Path) -> DocumentEditorKind {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" => DocumentEditorKind::Markdown,
        "txt" | "log" | "json" | "yaml" | "yml" | "toml" | "css" | "js" | "mjs" | "cjs" | "ts"
        | "tsx" | "rs" | "py" | "sh" => DocumentEditorKind::Text,
        "csv" => DocumentEditorKind::Csv,
        "tsv" => DocumentEditorKind::Tsv,
        "docx" => DocumentEditorKind::Docx,
        "xlsx" => DocumentEditorKind::Xlsx,
        "pptx" => DocumentEditorKind::Pptx,
        _ => DocumentEditorKind::Preview,
    }
}

pub(super) fn mime_type_for_editor(kind: DocumentEditorKind) -> String {
    match kind {
        DocumentEditorKind::Markdown => "text/markdown",
        DocumentEditorKind::Text => "text/plain",
        DocumentEditorKind::Csv => "text/csv",
        DocumentEditorKind::Tsv => "text/tab-separated-values",
        DocumentEditorKind::Docx => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
        DocumentEditorKind::Xlsx => {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
        DocumentEditorKind::Pptx => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        }
        DocumentEditorKind::Preview => "application/octet-stream",
    }
    .to_string()
}
