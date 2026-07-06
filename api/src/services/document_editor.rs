//! Built-in document editor model conversion.
//!
//! The editor intentionally avoids external document services. Office files are
//! OOXML zip packages, so this module exposes a compact JSON editing model and
//! writes the edited model back by replacing the relevant XML parts while
//! preserving the rest of the package.

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};
use std::path::Path;

use serde_json::{json, Value};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{AppError, AppResult};
use crate::models::document_editor::{
    DocumentEditorKind, DocumentEditorModelResponse, WriteDocumentEditorModelRequest,
};
use crate::services::drive;
use crate::services::file_observations::fingerprint_path;
use crate::state::AppState;

pub async fn read_model(
    state: &AppState,
    logical_path: &str,
) -> AppResult<DocumentEditorModelResponse> {
    let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    let metadata = std::fs::metadata(&resolved.physical_path)?;
    if !metadata.is_file() {
        return Err(AppError::BadRequest("Drive path is not a file".into()));
    }
    let kind = editor_kind_for_path(&resolved.physical_path);
    if kind == DocumentEditorKind::Preview {
        return Err(AppError::BadRequest("File type is not editable".into()));
    }
    let bytes = std::fs::read(&resolved.physical_path)?;
    let model = model_from_bytes(kind, &bytes)?;
    let fingerprint = fingerprint_token(&resolved.physical_path).await?;
    Ok(DocumentEditorModelResponse {
        path: resolved.logical_path,
        name: resolved
            .physical_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        editor_kind: kind,
        mime_type: mime_type_for_editor(kind),
        fingerprint,
        model,
    })
}

pub async fn write_model(
    state: &AppState,
    request: WriteDocumentEditorModelRequest,
) -> AppResult<DocumentEditorModelResponse> {
    let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, &request.path)?;
    let metadata = std::fs::metadata(&resolved.physical_path)?;
    if !metadata.is_file() {
        return Err(AppError::BadRequest("Drive path is not a file".into()));
    }
    let current = fingerprint_token(&resolved.physical_path).await?;
    if request
        .expected_fingerprint
        .as_deref()
        .is_some_and(|expected| expected != current)
    {
        return Err(AppError::Conflict(
            "File changed since the editor opened".to_string(),
        ));
    }
    let expected_kind = editor_kind_for_path(&resolved.physical_path);
    if expected_kind != request.editor_kind || expected_kind == DocumentEditorKind::Preview {
        return Err(AppError::BadRequest(
            "Editor kind does not match file type".into(),
        ));
    }
    let original = std::fs::read(&resolved.physical_path)?;
    let updated = bytes_from_model(request.editor_kind, &original, &request.model)?;
    drive::write_file_bytes(state, &resolved.logical_path, &updated).await?;
    read_model(state, &resolved.logical_path).await
}

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

async fn fingerprint_token(path: &Path) -> AppResult<String> {
    let fingerprint = fingerprint_path(path).await.map_err(AppError::Internal)?;
    let modified = fingerprint
        .modified_at
        .map(|value| value.timestamp_millis().to_string())
        .unwrap_or_else(|| "none".to_string());
    Ok(format!(
        "{}:{}:{}",
        fingerprint.hash, fingerprint.size, modified
    ))
}

fn mime_type_for_editor(kind: DocumentEditorKind) -> String {
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

fn model_from_bytes(kind: DocumentEditorKind, bytes: &[u8]) -> AppResult<Value> {
    match kind {
        DocumentEditorKind::Markdown | DocumentEditorKind::Text => {
            let content = std::str::from_utf8(bytes)
                .map_err(|_| AppError::BadRequest("File is not valid UTF-8".into()))?;
            Ok(json!({ "content": content }))
        }
        DocumentEditorKind::Csv => delimited_model(bytes, ','),
        DocumentEditorKind::Tsv => delimited_model(bytes, '\t'),
        DocumentEditorKind::Docx => docx_model(bytes),
        DocumentEditorKind::Xlsx => xlsx_model(bytes),
        DocumentEditorKind::Pptx => pptx_model(bytes),
        DocumentEditorKind::Preview => {
            Err(AppError::BadRequest("File type is not editable".into()))
        }
    }
}

fn bytes_from_model(
    kind: DocumentEditorKind,
    original: &[u8],
    model: &Value,
) -> AppResult<Vec<u8>> {
    match kind {
        DocumentEditorKind::Markdown | DocumentEditorKind::Text => {
            let content = model
                .get("content")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::BadRequest("Text model requires content".into()))?;
            Ok(content.as_bytes().to_vec())
        }
        DocumentEditorKind::Csv => delimited_bytes(model, ','),
        DocumentEditorKind::Tsv => delimited_bytes(model, '\t'),
        DocumentEditorKind::Docx => update_docx(original, model),
        DocumentEditorKind::Xlsx => update_xlsx(original, model),
        DocumentEditorKind::Pptx => update_pptx(original, model),
        DocumentEditorKind::Preview => {
            Err(AppError::BadRequest("File type is not editable".into()))
        }
    }
}

fn docx_model(bytes: &[u8]) -> AppResult<Value> {
    let document = read_zip_text(bytes, "word/document.xml")?;
    let mut blocks = Vec::new();
    for (index, paragraph) in xml_segments(&document, "<w:p", "</w:p>").iter().enumerate() {
        let text = extract_text_tags(paragraph, "w:t").join("");
        if !text.trim().is_empty() {
            blocks.push(json!({
                "id": format!("p{}", index + 1),
                "type": if paragraph.contains("Heading") { "heading" } else { "paragraph" },
                "text": text,
                "bold": paragraph.contains("<w:b") || paragraph.contains("<w:b/>"),
                "italic": paragraph.contains("<w:i") || paragraph.contains("<w:i/>")
            }));
        }
    }
    Ok(json!({ "blocks": blocks }))
}

fn update_docx(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let blocks = model
        .get("blocks")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("DOCX model requires blocks".into()))?;
    let document = read_zip_text(original, "word/document.xml")?;
    let document = replace_docx_blocks(&document, blocks);
    replace_zip_entries(original, &[("word/document.xml", document.into_bytes())])
}

fn delimited_model(bytes: &[u8], delimiter: char) -> AppResult<Value> {
    let content = std::str::from_utf8(bytes)
        .map_err(|_| AppError::BadRequest("Delimited file is not valid UTF-8".into()))?;
    Ok(json!({ "rows": parse_delimited(content, delimiter) }))
}

fn delimited_bytes(model: &Value, delimiter: char) -> AppResult<Vec<u8>> {
    let rows = model
        .get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("Delimited model requires rows".into()))?;
    let lines = rows
        .iter()
        .map(|row| {
            row.as_array()
                .map(|cells| {
                    cells
                        .iter()
                        .map(|cell| {
                            escape_delimited_cell(cell.as_str().unwrap_or_default(), delimiter)
                        })
                        .collect::<Vec<_>>()
                        .join(&delimiter.to_string())
                })
                .unwrap_or_default()
        })
        .collect::<Vec<_>>();
    Ok(lines.join("\n").into_bytes())
}

fn xlsx_model(bytes: &[u8]) -> AppResult<Value> {
    let strings = read_shared_strings(bytes).unwrap_or_default();
    let mut archive = zip_archive(bytes)?;
    let mut sheets = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(map_zip)?;
        let name = file.name().to_string();
        if !(name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml")) {
            continue;
        }
        let mut xml = String::new();
        file.read_to_string(&mut xml).map_err(map_io)?;
        sheets.push(json!({
            "id": name,
            "name": name.rsplit('/').next().unwrap_or(&name),
            "rows": parse_sheet_rows(&xml, &strings)
        }));
    }
    Ok(json!({ "sheets": sheets }))
}

fn update_xlsx(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let sheets = model
        .get("sheets")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("XLSX model requires sheets".into()))?;
    let mut replacements = Vec::new();
    for sheet in sheets {
        let Some(id) = sheet.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(rows) = sheet.get("rows").and_then(Value::as_array) else {
            continue;
        };
        let original_xml = read_zip_text(original, id)?;
        let values = sheet_cell_values(rows);
        replacements.push((
            id.to_string(),
            update_sheet_cells(&original_xml, &values).into_bytes(),
        ));
    }
    let replacement_refs = replacements
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.clone()))
        .collect::<Vec<_>>();
    replace_zip_entries(original, &replacement_refs)
}

fn pptx_model(bytes: &[u8]) -> AppResult<Value> {
    let mut archive = zip_archive(bytes)?;
    let mut slides = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(map_zip)?;
        let name = file.name().to_string();
        if !(name.starts_with("ppt/slides/slide") && name.ends_with(".xml")) {
            continue;
        }
        let mut xml = String::new();
        file.read_to_string(&mut xml).map_err(map_io)?;
        let texts = extract_text_tags(&xml, "a:t")
            .into_iter()
            .enumerate()
            .map(|(text_index, text)| {
                json!({
                    "id": format!("t{}", text_index + 1),
                    "text": text
                })
            })
            .collect::<Vec<_>>();
        slides.push(json!({
            "id": name,
            "name": name.rsplit('/').next().unwrap_or(&name),
            "texts": texts
        }));
    }
    Ok(json!({ "slides": slides }))
}

fn update_pptx(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let slides = model
        .get("slides")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("PPTX model requires slides".into()))?;
    let mut replacements = Vec::new();
    for slide in slides {
        let Some(id) = slide.get("id").and_then(Value::as_str) else {
            continue;
        };
        let texts = slide
            .get("texts")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|item| {
                        item.get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string()
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let original_xml = read_zip_text(original, id)?;
        replacements.push((
            id.to_string(),
            replace_tag_texts(&original_xml, "a:t", &texts).into_bytes(),
        ));
    }
    let replacement_refs = replacements
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.clone()))
        .collect::<Vec<_>>();
    replace_zip_entries(original, &replacement_refs)
}

fn parse_sheet_rows(xml: &str, shared_strings: &[String]) -> Vec<Value> {
    let mut rows = Vec::new();
    for row_xml in xml_segments(xml, "<row", "</row>") {
        let row_ref = attr_value(&row_xml, "r").unwrap_or_default();
        let cells = xml_segments(&row_xml, "<c", "</c>")
            .into_iter()
            .map(|cell| {
                let reference = attr_value(&cell, "r").unwrap_or_default();
                let cell_type = attr_value(&cell, "t").unwrap_or_default();
                let raw = if cell_type == "inlineStr" {
                    extract_text_tags(&cell, "t").join("")
                } else {
                    first_tag_text(&cell, "v").unwrap_or_default()
                };
                let value = if cell_type == "s" {
                    raw.parse::<usize>()
                        .ok()
                        .and_then(|idx| shared_strings.get(idx).cloned())
                        .unwrap_or(raw)
                } else {
                    raw
                };
                json!({ "ref": reference, "value": value })
            })
            .collect::<Vec<_>>();
        rows.push(json!({ "index": row_ref, "cells": cells }));
    }
    rows
}

fn replace_docx_blocks(document: &str, blocks: &[Value]) -> String {
    let mut output = String::new();
    let mut rest = document;
    let mut block_index = 0usize;
    while let Some(start) = rest.find("<w:p") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</w:p>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</w:p>".len();
        let paragraph = &after_start[..end_index];
        let has_text = !extract_text_tags(paragraph, "w:t")
            .join("")
            .trim()
            .is_empty();
        if has_text {
            if let Some(block) = blocks.get(block_index) {
                let text = block
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                output.push_str(&replace_tag_texts(paragraph, "w:t", &[text]));
            } else {
                output.push_str(paragraph);
            }
            block_index += 1;
        } else {
            output.push_str(paragraph);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    if block_index < blocks.len() {
        insert_docx_blocks(&output, &blocks[block_index..])
    } else {
        output
    }
}

fn insert_docx_blocks(document: &str, blocks: &[Value]) -> String {
    let inserted = blocks
        .iter()
        .map(build_docx_paragraph)
        .collect::<Vec<_>>()
        .join("");
    if let Some(index) = document.find("<w:sectPr") {
        let mut output = String::new();
        output.push_str(&document[..index]);
        output.push_str(&inserted);
        output.push_str(&document[index..]);
        return output;
    }
    if let Some(index) = document.find("</w:body>") {
        let mut output = String::new();
        output.push_str(&document[..index]);
        output.push_str(&inserted);
        output.push_str(&document[index..]);
        return output;
    }
    format!("{document}{inserted}")
}

fn build_docx_paragraph(block: &Value) -> String {
    let text = block
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let block_type = block
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("paragraph");
    let style = if block_type == "heading" {
        r#"<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>"#
    } else {
        ""
    };
    format!(
        "<w:p>{style}<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
        escape_xml(text)
    )
}

fn sheet_cell_values(rows: &[Value]) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    for row in rows {
        let Some(cells) = row.get("cells").and_then(Value::as_array) else {
            continue;
        };
        for cell in cells {
            let Some(reference) = cell.get("ref").and_then(Value::as_str) else {
                continue;
            };
            values.insert(
                reference.to_string(),
                cell.get("value")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            );
        }
    }
    values
}

fn update_sheet_cells(xml: &str, values: &BTreeMap<String, String>) -> String {
    let mut output = String::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<c") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(tag_end) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let self_closing = after_start[..=tag_end].ends_with("/>");
        let end_index = if self_closing {
            tag_end + 1
        } else {
            match after_start.find("</c>") {
                Some(end) => end + "</c>".len(),
                None => {
                    output.push_str(after_start);
                    return output;
                }
            }
        };
        let cell = &after_start[..end_index];
        if let Some(reference) = attr_value(cell, "r") {
            if let Some(value) = values.get(&reference) {
                output.push_str(&build_sheet_cell(cell, &reference, value));
            } else {
                output.push_str(cell);
            }
        } else {
            output.push_str(cell);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

fn build_sheet_cell(original: &str, reference: &str, value: &str) -> String {
    let style = attr_value(original, "s")
        .map(|style| format!(r#" s="{}""#, escape_xml(&style)))
        .unwrap_or_default();
    format!(
        r#"<c r="{reference}"{style} t="inlineStr"><is><t>{}</t></is></c>"#,
        escape_xml(value)
    )
}

fn parse_delimited(content: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut chars = content.chars().peekable();
    let mut quoted = false;
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    cell.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                cell.push(ch);
            }
            continue;
        }
        if ch == '"' && cell.is_empty() {
            quoted = true;
        } else if ch == delimiter {
            row.push(std::mem::take(&mut cell));
        } else if ch == '\n' {
            row.push(std::mem::take(&mut cell));
            rows.push(std::mem::take(&mut row));
        } else if ch == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            row.push(std::mem::take(&mut cell));
            rows.push(std::mem::take(&mut row));
        } else {
            cell.push(ch);
        }
    }
    if quoted || !cell.is_empty() || !row.is_empty() || content.ends_with(delimiter) {
        row.push(cell);
    }
    if !row.is_empty() {
        rows.push(row);
    }
    rows
}

fn escape_delimited_cell(value: &str, delimiter: char) -> String {
    let must_quote = value.contains(delimiter)
        || value.contains('"')
        || value.contains('\n')
        || value.contains('\r');
    if must_quote {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn read_shared_strings(bytes: &[u8]) -> AppResult<Vec<String>> {
    let xml = read_zip_text(bytes, "xl/sharedStrings.xml")?;
    Ok(xml_segments(&xml, "<si", "</si>")
        .into_iter()
        .map(|item| extract_text_tags(&item, "t").join(""))
        .collect())
}

fn replace_zip_entries(original: &[u8], replacements: &[(&str, Vec<u8>)]) -> AppResult<Vec<u8>> {
    let mut archive = zip_archive(original)?;
    let replacement_map = replacements
        .iter()
        .map(|(path, bytes)| ((*path).to_string(), bytes.as_slice()))
        .collect::<BTreeMap<_, _>>();
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(map_zip)?;
        let name = file.name().to_string();
        if file.is_dir() {
            writer.add_directory(&name, options).map_err(map_zip)?;
            continue;
        }
        let mut contents = Vec::new();
        file.read_to_end(&mut contents).map_err(map_io)?;
        let bytes = replacement_map
            .get(&name)
            .copied()
            .unwrap_or(contents.as_slice());
        writer.start_file(&name, options).map_err(map_zip)?;
        writer.write_all(bytes).map_err(map_io)?;
    }
    let cursor = writer.finish().map_err(map_zip)?;
    Ok(cursor.into_inner())
}

fn read_zip_text(bytes: &[u8], path: &str) -> AppResult<String> {
    let mut archive = zip_archive(bytes)?;
    let mut file = archive.by_name(path).map_err(map_zip)?;
    let mut text = String::new();
    file.read_to_string(&mut text).map_err(map_io)?;
    Ok(text)
}

fn zip_archive(bytes: &[u8]) -> AppResult<ZipArchive<Cursor<&[u8]>>> {
    ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| AppError::BadRequest(format!("Invalid OOXML package: {error}")))
}

fn xml_segments(xml: &str, start_marker: &str, end_marker: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(start_marker) {
        let after_start = &rest[start..];
        let Some(end) = after_start.find(end_marker) else {
            break;
        };
        let end_index = end + end_marker.len();
        segments.push(after_start[..end_index].to_string());
        rest = &after_start[end_index..];
    }
    segments
}

fn first_tag_text(xml: &str, tag: &str) -> Option<String> {
    extract_text_tags(xml, tag).into_iter().next()
}

fn extract_text_tags(xml: &str, tag: &str) -> Vec<String> {
    let start_marker = format!("<{tag}");
    let end_marker = format!("</{tag}>");
    xml_segments(xml, &start_marker, &end_marker)
        .into_iter()
        .filter_map(|segment| {
            let gt = segment.find('>')?;
            let end = segment.rfind(&end_marker)?;
            Some(unescape_xml(&segment[gt + 1..end]))
        })
        .collect()
}

fn replace_tag_texts(xml: &str, tag: &str, values: &[String]) -> String {
    let start_marker = format!("<{tag}");
    let end_marker = format!("</{tag}>");
    let mut output = String::new();
    let mut rest = xml;
    let mut index = 0usize;
    while let Some(start) = rest.find(&start_marker) {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(gt) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let Some(end) = after_start.find(&end_marker) else {
            output.push_str(after_start);
            return output;
        };
        output.push_str(&after_start[..gt + 1]);
        output.push_str(&escape_xml(
            values.get(index).map(String::as_str).unwrap_or_default(),
        ));
        output.push_str(&after_start[end..end + end_marker.len()]);
        rest = &after_start[end + end_marker.len()..];
        index += 1;
    }
    output.push_str(rest);
    output
}

fn attr_value(xml: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let pattern = format!("{name}={quote}");
        let Some(found) = xml.find(&pattern) else {
            continue;
        };
        let start = found + pattern.len();
        if let Some(end) = xml[start..].find(quote) {
            return Some(xml[start..start + end].to_string());
        }
    }
    None
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn unescape_xml(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn map_zip(error: zip::result::ZipError) -> AppError {
    AppError::BadRequest(format!("OOXML zip operation failed: {error}"))
}

fn map_io(error: std::io::Error) -> AppError {
    AppError::Internal(format!("document IO operation failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_kind_excludes_html_for_dedicated_web_viewer() {
        assert_eq!(
            editor_kind_for_path(Path::new("index.html")),
            DocumentEditorKind::Preview
        );
        assert_eq!(
            editor_kind_for_path(Path::new("page.htm")),
            DocumentEditorKind::Preview
        );
    }

    #[test]
    fn editor_kind_accepts_document_and_structured_text_formats() {
        assert_eq!(
            editor_kind_for_path(Path::new("notes.md")),
            DocumentEditorKind::Markdown
        );
        assert_eq!(
            editor_kind_for_path(Path::new("data.json")),
            DocumentEditorKind::Text
        );
        assert_eq!(
            editor_kind_for_path(Path::new("sheet.csv")),
            DocumentEditorKind::Csv
        );
        assert_eq!(
            editor_kind_for_path(Path::new("book.xlsx")),
            DocumentEditorKind::Xlsx
        );
        assert_eq!(
            editor_kind_for_path(Path::new("deck.pptx")),
            DocumentEditorKind::Pptx
        );
    }

    #[test]
    fn csv_parser_handles_quotes_commas_and_newlines() {
        let rows = parse_delimited("name,note\nalpha,\"one, two\"\nbeta,\"line\nbreak\"", ',');

        assert_eq!(
            rows,
            vec![
                vec!["name".to_string(), "note".to_string()],
                vec!["alpha".to_string(), "one, two".to_string()],
                vec!["beta".to_string(), "line\nbreak".to_string()],
            ]
        );
    }

    #[test]
    fn delimited_serializer_quotes_when_needed() {
        let model = json!({
            "rows": [
                ["name", "note"],
                ["alpha", "one, two"],
                ["beta", "quote \"inside\""]
            ]
        });

        let bytes = delimited_bytes(&model, ',').expect("CSV should serialize");
        assert_eq!(
            String::from_utf8(bytes).expect("CSV is UTF-8"),
            "name,note\nalpha,\"one, two\"\nbeta,\"quote \"\"inside\"\"\""
        );
    }

    #[test]
    fn tsv_parser_uses_tab_delimiter() {
        let rows = parse_delimited("a\tb\nc\td", '\t');

        assert_eq!(
            rows,
            vec![
                vec!["a".to_string(), "b".to_string()],
                vec!["c".to_string(), "d".to_string()],
            ]
        );
    }
}
