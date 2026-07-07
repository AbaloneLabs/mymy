//! Save-time document validation.
//!
//! The editor writes user-visible files back to the shared drive, so malformed
//! bytes are more costly than an in-memory model error. This module keeps the
//! final validation gate close to persistence while separating it from format
//! conversion code. Text formats are parsed with their native parsers, and
//! OOXML packages are checked for the minimum required parts plus internal
//! relationship targets before the write is accepted.

use std::path::Path;

use serde::Deserialize as _;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::document_editor::DocumentEditorKind;

use super::text_formats::has_utf8_bom;
use super::{attr_value, read_zip_text, xml_named_empty_elements, zip_entry_names};

pub(super) fn validate_saved_document_bytes(
    kind: DocumentEditorKind,
    path: &Path,
    bytes: &[u8],
) -> AppResult<()> {
    validate_structured_text_for_path(path, bytes)?;
    match kind {
        DocumentEditorKind::Docx | DocumentEditorKind::Xlsx | DocumentEditorKind::Pptx => {
            validate_ooxml_package(kind, bytes)
        }
        DocumentEditorKind::Markdown
        | DocumentEditorKind::Text
        | DocumentEditorKind::Csv
        | DocumentEditorKind::Tsv
        | DocumentEditorKind::Preview => Ok(()),
    }
}

pub(super) fn validate_structured_text_for_path(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "json" | "yaml" | "yml" | "toml") {
        return Ok(());
    }
    let body = if has_utf8_bom(bytes) {
        &bytes[3..]
    } else {
        bytes
    };
    let content = std::str::from_utf8(body)
        .map_err(|_| AppError::BadRequest("Structured text file is not valid UTF-8".into()))?;
    match extension.as_str() {
        "json" => {
            serde_json::from_str::<Value>(content)
                .map_err(|error| AppError::BadRequest(format!("Saved JSON is invalid: {error}")))?;
        }
        "yaml" | "yml" => {
            for document in serde_yaml::Deserializer::from_str(content) {
                serde_yaml::Value::deserialize(document).map_err(|error| {
                    AppError::BadRequest(format!("Saved YAML is invalid: {error}"))
                })?;
            }
        }
        "toml" => {
            toml::from_str::<toml::Value>(content)
                .map_err(|error| AppError::BadRequest(format!("Saved TOML is invalid: {error}")))?;
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn validate_ooxml_package(kind: DocumentEditorKind, bytes: &[u8]) -> AppResult<()> {
    let names = zip_entry_names(bytes)?;
    let required = match kind {
        DocumentEditorKind::Docx => &[
            "[Content_Types].xml",
            "_rels/.rels",
            "word/document.xml",
            "word/_rels/document.xml.rels",
        ][..],
        DocumentEditorKind::Xlsx => &[
            "[Content_Types].xml",
            "_rels/.rels",
            "xl/workbook.xml",
            "xl/_rels/workbook.xml.rels",
        ][..],
        DocumentEditorKind::Pptx => &[
            "[Content_Types].xml",
            "_rels/.rels",
            "ppt/presentation.xml",
            "ppt/_rels/presentation.xml.rels",
        ][..],
        _ => &[][..],
    };
    for part in required {
        if !names.iter().any(|name| name == part) {
            return Err(AppError::BadRequest(format!(
                "Saved OOXML package is missing required part: {part}"
            )));
        }
    }
    validate_ooxml_relationship_targets(bytes, &names)
}

fn validate_ooxml_relationship_targets(bytes: &[u8], names: &[String]) -> AppResult<()> {
    for rels_path in names.iter().filter(|name| name.ends_with(".rels")) {
        let rels = read_zip_text(bytes, rels_path)?;
        for relationship in xml_named_empty_elements(&rels, "Relationship") {
            if attr_value(&relationship, "TargetMode")
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case("External"))
            {
                continue;
            }
            let Some(target) = attr_value(&relationship, "Target") else {
                continue;
            };
            if should_skip_ooxml_relationship_target(&target) {
                continue;
            }
            let resolved = resolve_ooxml_relationship_target(rels_path, &target)?;
            if !names.iter().any(|name| name == &resolved) {
                return Err(AppError::BadRequest(format!(
                    "Saved OOXML relationship target is missing: {rels_path} -> {target}"
                )));
            }
        }
    }
    Ok(())
}

fn should_skip_ooxml_relationship_target(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    target.starts_with('#')
        || lower.starts_with("http:")
        || lower.starts_with("https:")
        || lower.starts_with("mailto:")
        || lower.starts_with("file:")
}

fn resolve_ooxml_relationship_target(rels_path: &str, target: &str) -> AppResult<String> {
    let normalized_target = target.trim_start_matches('/');
    let base = ooxml_relationship_source_directory(rels_path);
    normalize_ooxml_part_path(&format!("{base}/{normalized_target}"))
}

fn ooxml_relationship_source_directory(rels_path: &str) -> String {
    if rels_path == "_rels/.rels" {
        return String::new();
    }
    let source_part = rels_path
        .replace("/_rels/", "/")
        .strip_suffix(".rels")
        .map(str::to_string)
        .unwrap_or_else(|| rels_path.to_string());
    source_part
        .rsplit_once('/')
        .map(|(directory, _)| directory.to_string())
        .unwrap_or_default()
}

fn normalize_ooxml_part_path(path: &str) -> AppResult<String> {
    let mut parts = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if parts.pop().is_none() {
                return Err(AppError::BadRequest(
                    "Saved OOXML relationship target escapes package root".into(),
                ));
            }
            continue;
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}
