//! Built-in document editor model conversion.
//!
//! The editor intentionally avoids external document services. Office files are
//! OOXML zip packages, so this module exposes a compact JSON editing model and
//! writes the edited model back by replacing the relevant XML parts while
//! preserving the rest of the package.

mod compatibility;
mod docx_blocks;
mod docx_comments;
mod docx_content_controls;
mod docx_fields;
mod docx_notes;
mod docx_numbering;
mod docx_page;
mod docx_relationships;
mod docx_revisions;
mod docx_runs;
mod docx_styles;
mod docx_tables;
mod docx_text_parts;
mod kind;
mod ooxml_charts;
mod ooxml_content_types;
mod ooxml_images;
mod ooxml_package;
mod pptx_manifest;
mod pptx_model;
mod pptx_notes;
mod pptx_package;
mod text_formats;
mod validation;
mod xlsx_model;
mod xlsx_objects;
mod xlsx_relationships;
mod xlsx_styles;
mod xlsx_tables;
mod xlsx_workbook;
mod xml_utils;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use base64::Engine as _;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::models::document_editor::{
    DocumentEditorKind, DocumentEditorModelResponse, WriteDocumentEditorModelRequest,
};
use crate::services::drive;
use crate::services::file_observations::fingerprint_path;
use crate::state::AppState;

use self::compatibility::compatibility_warnings_for_bytes;
#[cfg(test)]
use self::docx_blocks::build_docx_paragraph;
use self::docx_blocks::{
    docx_paragraph_has_page_break, docx_paragraph_has_section_break, docx_section_break_kind,
    replace_docx_blocks,
};
use self::docx_comments::{
    add_docx_comment_replacements, docx_comment_id_from_paragraph, docx_comments,
};
use self::docx_content_controls::docx_paragraph_content_controls;
use self::docx_fields::docx_paragraph_fields;
use self::docx_notes::{
    add_docx_note_replacements, docx_notes, DOCX_ENDNOTE_PART, DOCX_FOOTNOTE_PART,
};
#[cfg(test)]
use self::docx_numbering::ensure_docx_basic_numbering_xml;
use self::docx_numbering::{
    add_docx_numbering_replacements, docx_blocks_have_lists, docx_list_kind, docx_list_level,
    docx_list_numbering_id, docx_numbering_formats, docx_numbering_start_overrides,
};
#[cfg(test)]
use self::docx_numbering::{DOCX_BULLET_NUM_ID, DOCX_NUMBER_NUM_ID};
use self::docx_page::{docx_page_settings, update_docx_page_settings};
use self::docx_relationships::{
    add_docx_hyperlink_relationships, docx_empty_content_types, docx_empty_relationships,
    ensure_docx_part_relationship,
};
use self::docx_revisions::docx_paragraph_revisions;
use self::docx_runs::{docx_run_models, docx_runs_text};
use self::docx_styles::{docx_paragraph_style_id, docx_paragraph_styles, docx_style_names};
#[cfg(test)]
use self::docx_tables::build_docx_table;
use self::docx_tables::{
    parse_docx_table_border_color, parse_docx_table_border_size, parse_docx_table_cell_background,
    parse_docx_table_cell_vertical_align, parse_docx_table_column_widths,
    parse_docx_table_header_background, parse_docx_table_header_row, parse_docx_table_merged_cells,
    parse_docx_table_row_heights, parse_docx_table_rows, parse_docx_table_style,
};
use self::docx_text_parts::{add_docx_text_part_replacements, docx_text_parts};
pub use self::kind::editor_kind_for_path;
use self::kind::mime_type_for_editor;
use self::ooxml_charts::{
    ooxml_chart_axis_label_bold, ooxml_chart_axis_label_font_size, ooxml_chart_axis_label_italic,
    ooxml_chart_axis_label_rotation, ooxml_chart_axis_label_text_color,
    ooxml_chart_axis_line_color, ooxml_chart_axis_line_dash, ooxml_chart_axis_line_width,
    ooxml_chart_axis_major_gridlines_visible, ooxml_chart_axis_major_tick_mark,
    ooxml_chart_axis_minor_tick_mark, ooxml_chart_axis_number_format, ooxml_chart_axis_position,
    ooxml_chart_axis_tick_label_position, ooxml_chart_axis_title, ooxml_chart_legend_position,
    ooxml_chart_legend_visible, ooxml_chart_series, ooxml_chart_series_specs, ooxml_chart_title,
    ooxml_chart_type, update_ooxml_chart_axis_label_rotation, update_ooxml_chart_axis_label_style,
    update_ooxml_chart_axis_line_color, update_ooxml_chart_axis_line_dash,
    update_ooxml_chart_axis_line_width, update_ooxml_chart_axis_major_gridlines,
    update_ooxml_chart_axis_major_tick_mark, update_ooxml_chart_axis_minor_tick_mark,
    update_ooxml_chart_axis_number_format, update_ooxml_chart_axis_position,
    update_ooxml_chart_axis_tick_label_position, update_ooxml_chart_axis_title,
    update_ooxml_chart_legend, update_ooxml_chart_series, update_ooxml_chart_title,
    update_ooxml_chart_type,
};
use self::ooxml_content_types::{ensure_content_type_default, ensure_content_type_override};
#[cfg(test)]
use self::ooxml_images::build_docx_image_paragraph;
use self::ooxml_images::{
    add_docx_image_replacements, decode_pptx_image_data_url, docx_image_block_from_segment,
    docx_relationship_targets, image_mime_type_from_path, next_pptx_media_path,
};
use self::ooxml_package::{
    next_rid, read_zip_bytes, read_zip_text, replace_zip_entries, replacement_zip_text_or_default,
    upsert_zip_replacement, zip_entry_names,
};
#[cfg(test)]
use self::pptx_manifest::PptxPresentationSlideWrite;
use self::pptx_manifest::{
    append_pptx_slide_content_types_for_writes, pptx_presentation_slides, pptx_slide_writes,
    update_pptx_presentation_manifest,
};
#[cfg(test)]
use self::pptx_model::*;
use self::pptx_model::{pptx_model, update_pptx};
use self::pptx_notes::{add_pptx_notes_replacement, pptx_slide_notes};
use self::pptx_package::{append_pptx_notes_content_types, pptx_slide_relationship_target};
#[cfg(test)]
use self::text_formats::parse_delimited;
use self::text_formats::{delimited_bytes, delimited_model, text_bytes, text_model};
use self::validation::validate_saved_document_bytes;
#[cfg(test)]
use self::validation::{validate_ooxml_package, validate_structured_text_for_path};
#[cfg(test)]
use self::xlsx_model::*;
use self::xlsx_model::{
    parse_sheet_auto_filter, valid_xlsx_range_reference, xlsx_validation_string, xml_bool_attr,
    SheetUpdate,
};
use self::xlsx_model::{update_xlsx, xlsx_model};
use self::xlsx_objects::{
    add_xlsx_chart_replacements, add_xlsx_pivot_replacements, parse_xlsx_sheet_objects,
};
use self::xlsx_relationships::{
    remove_relationships_by_type, xlsx_empty_relationships, xlsx_part_rels_path,
    xlsx_part_to_relationship_target_from, xlsx_relationship_by_type,
    xlsx_relationship_target_by_type, xlsx_relationships_by_id, xlsx_worksheet_rels_path,
};
use self::xlsx_styles::{
    append_xlsx_style_to_cell_json, ensure_xlsx_comments_content_types,
    ensure_xlsx_styles_content_type, ensure_xlsx_styles_relationship, xlsx_cell_style_from_model,
    xlsx_hex_color, xlsx_styles_from_xml, XlsxCellStyle, XlsxParsedStyles, XlsxStyleWriter,
};
#[cfg(test)]
use self::xlsx_tables::update_xlsx_table_xml;
use self::xlsx_tables::{
    add_xlsx_table_replacements, ensure_xlsx_table_content_types, XlsxTableReplacementContext,
};
use self::xlsx_workbook::{
    append_xlsx_sheet_content_types, parse_xlsx_defined_names, update_xlsx_defined_names,
    update_xlsx_workbook_calc_properties, update_xlsx_workbook_manifest, xlsx_model_has_formulas,
    xlsx_sheet_writes, xlsx_workbook_sheets,
};
#[cfg(test)]
use self::xlsx_workbook::{xlsx_workbook_sheets_from_xml, XlsxWorkbookSheetWrite};
use self::xml_utils::{
    append_before_or_end, attr_value, escape_xml, extract_text_tags, find_xml_start,
    find_xml_tag_start, first_tag_text, remove_xml_named_elements, replace_empty_xml_element,
    replace_tag_texts, replace_xml_element, set_first_xml_tag_attrs, set_xml_attr, unescape_xml,
    xml_empty_elements, xml_first_empty_tag_attr, xml_has_named_empty_tag,
    xml_named_empty_elements, xml_named_segments, xml_named_start_tag, xml_segments,
};
#[cfg(test)]
use crate::models::document_editor::{
    DocumentCompatibilityWarning, DocumentCompatibilityWarningSeverity,
};

const PPTX_SLIDE_WIDTH_EMU: f64 = 9_144_000.0;
const PPTX_SLIDE_HEIGHT_EMU: f64 = 5_143_500.0;
const PPTX_DEFAULT_TABLE_STYLE_ID: &str = "{5940675A-B579-460E-94D1-54222C63F5DA}";

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
    let compatibility_warnings = compatibility_warnings_for_bytes(kind, &bytes);
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
        compatibility_warnings,
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
    validate_saved_document_bytes(expected_kind, &resolved.physical_path, &updated)?;
    drive::write_file_bytes(state, &resolved.logical_path, &updated).await?;
    read_model(state, &resolved.logical_path).await
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

fn model_from_bytes(kind: DocumentEditorKind, bytes: &[u8]) -> AppResult<Value> {
    match kind {
        DocumentEditorKind::Markdown | DocumentEditorKind::Text => text_model(bytes),
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
        DocumentEditorKind::Markdown | DocumentEditorKind::Text => text_bytes(original, model),
        DocumentEditorKind::Csv => delimited_bytes(original, model, ','),
        DocumentEditorKind::Tsv => delimited_bytes(original, model, '\t'),
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
    let rels = read_zip_text(bytes, "word/_rels/document.xml.rels").unwrap_or_default();
    let relationships = docx_relationship_targets(&rels);
    let numbering = read_zip_text(bytes, "word/numbering.xml").unwrap_or_default();
    let numbering_formats = docx_numbering_formats(&numbering);
    let numbering_starts = docx_numbering_start_overrides(&numbering);
    let styles_xml = read_zip_text(bytes, "word/styles.xml").unwrap_or_default();
    let style_names = docx_style_names(&styles_xml);
    let paragraph_styles = docx_paragraph_styles(&styles_xml);
    let mut blocks = Vec::new();
    let mut index = 0usize;
    for segment in docx_body_segments(&document) {
        if segment.starts_with("<w:tbl") {
            let mut table_block = json!({
                "id": format!("tbl{}", index + 1),
                "type": "table",
                "rows": parse_docx_table_rows(&segment),
                "tableColumnWidths": parse_docx_table_column_widths(&segment),
                "tableRowHeights": parse_docx_table_row_heights(&segment)
            });
            let merged_cells = parse_docx_table_merged_cells(&segment);
            if !merged_cells.is_empty() {
                table_block["tableMergedCells"] = json!(merged_cells);
            }
            if let Some(style) = parse_docx_table_style(&segment) {
                table_block["tableStyle"] = json!(style);
            }
            if let Some(color) = parse_docx_table_border_color(&segment) {
                table_block["tableBorderColor"] = json!(color);
            }
            if let Some(size) = parse_docx_table_border_size(&segment) {
                table_block["tableBorderSize"] = json!(size);
            }
            if let Some(background) = parse_docx_table_cell_background(&segment) {
                table_block["tableCellBackground"] = json!(background);
            }
            if parse_docx_table_header_row(&segment) {
                table_block["tableHeaderRow"] = json!(true);
            }
            if let Some(background) = parse_docx_table_header_background(&segment) {
                table_block["tableHeaderBackground"] = json!(background);
            }
            if let Some(align) = parse_docx_table_cell_vertical_align(&segment) {
                table_block["tableCellVerticalAlign"] = json!(align);
            }
            blocks.push(table_block);
            index += 1;
            continue;
        }
        if docx_paragraph_has_section_break(&segment) {
            blocks.push(json!({
                "id": format!("sect{}", index + 1),
                "type": "sectionBreak",
                "text": "",
                "breakKind": docx_section_break_kind(&segment)
            }));
            index += 1;
            continue;
        }
        if docx_paragraph_has_page_break(&segment) {
            blocks.push(json!({
                "id": format!("br{}", index + 1),
                "type": "pageBreak",
                "text": ""
            }));
            index += 1;
            continue;
        }
        let text = extract_text_tags(&segment, "w:t").join("");
        if text.trim().is_empty() {
            if let Some(block) =
                docx_image_block_from_segment(&segment, &relationships, bytes, index)
            {
                blocks.push(block);
                index += 1;
            }
            continue;
        }
        let paragraph_style_id = docx_paragraph_style_id(&segment);
        let heading_level = docx_heading_level(&segment);
        let relationship_id = docx_tag_attr(&segment, "<w:hyperlink", "r:id");
        let hyperlink_target = relationship_id
            .as_ref()
            .and_then(|id| relationships.get(id))
            .cloned();
        let mut block = json!({
            "id": format!("p{}", index + 1),
            "type": if heading_level.is_some() { "heading" } else { "paragraph" },
            "headingLevel": heading_level,
            "text": text,
            "bold": docx_has_enabled_run_property(&segment, "<w:b"),
            "italic": docx_has_enabled_run_property(&segment, "<w:i"),
            "underline": docx_has_enabled_underline(&segment),
            "strikethrough": docx_has_enabled_run_property(&segment, "<w:strike"),
            "verticalAlign": docx_vertical_align(&segment),
            "fontFamily": docx_tag_attr(&segment, "<w:rFonts", "w:ascii"),
            "fontSize": docx_font_size(&segment),
            "color": docx_tag_attr(&segment, "<w:color", "w:val")
                .and_then(|color| docx_hex_color(&color))
                .map(|color| format!("#{color}")),
            "highlight": docx_tag_attr(&segment, "<w:highlight", "w:val"),
            "align": docx_alignment(&segment),
            "listKind": docx_list_kind(&segment, &numbering_formats),
            "listNumberingId": docx_list_numbering_id(&segment),
            "listLevel": docx_list_level(&segment),
            "indentLeft": docx_u32_attr(&segment, "<w:ind", "w:left"),
            "spacingBefore": docx_u32_attr(&segment, "<w:spacing", "w:before"),
            "spacingAfter": docx_u32_attr(&segment, "<w:spacing", "w:after"),
            "lineSpacing": docx_u32_attr(&segment, "<w:spacing", "w:line"),
            "pageBreakBefore": segment.contains("<w:pageBreakBefore"),
            "keepWithNext": segment.contains("<w:keepNext"),
            "keepLinesTogether": segment.contains("<w:keepLines")
        });
        if let Some(style_id) = paragraph_style_id {
            block["paragraphStyleId"] = json!(style_id.clone());
            if let Some(style_name) = style_names.get(&style_id) {
                block["paragraphStyleName"] = json!(style_name);
            }
        }
        if let (Some(num_id), Some(level)) = (
            block.get("listNumberingId").and_then(Value::as_str),
            block.get("listLevel").and_then(Value::as_u64),
        ) {
            if let Some(start) = numbering_starts.get(&(num_id.to_string(), level as u32)) {
                block["listStart"] = json!(start);
            }
        }
        if let Some(relationship_id) = relationship_id {
            block["relationshipId"] = json!(relationship_id);
        }
        if let Some(target) = hyperlink_target {
            block["target"] = json!(target);
        }
        if let Some(bookmark_name) = docx_bookmark_name(&segment) {
            block["bookmarkName"] = json!(bookmark_name);
        }
        if let Some(bookmark_id) = docx_bookmark_id(&segment) {
            block["bookmarkId"] = json!(bookmark_id.to_string());
        }
        if let Some(comment_id) = docx_comment_id_from_paragraph(&segment) {
            block["commentId"] = json!(comment_id);
        }
        if let Some(footnote_id) = docx_tag_attr(&segment, "<w:footnoteReference", "w:id") {
            block["footnoteId"] = json!(footnote_id);
        }
        if let Some(endnote_id) = docx_tag_attr(&segment, "<w:endnoteReference", "w:id") {
            block["endnoteId"] = json!(endnote_id);
        }
        let content_controls = docx_paragraph_content_controls(&segment);
        if !content_controls.is_empty() {
            block["contentControls"] = json!(content_controls);
        }
        let fields = docx_paragraph_fields(&segment);
        if !fields.is_empty() {
            block["fields"] = json!(fields);
        }
        let revisions = docx_paragraph_revisions(&segment);
        if !revisions.is_empty() {
            block["revisions"] = json!(revisions);
        }
        let runs = docx_run_models(&segment);
        if !runs.is_empty() && docx_runs_text(&runs) == text {
            block["runs"] = json!(runs);
        }
        blocks.push(block);
        index += 1;
    }
    Ok(json!({
        "blocks": blocks,
        "page": docx_page_settings(&document),
        "headers": docx_text_parts(bytes, "header"),
        "footers": docx_text_parts(bytes, "footer"),
        "comments": docx_comments(bytes),
        "footnotes": docx_notes(bytes, "word/footnotes.xml", "w:footnote", "footnote"),
        "endnotes": docx_notes(bytes, "word/endnotes.xml", "w:endnote", "endnote"),
        "styles": paragraph_styles
    }))
}

fn update_docx(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let mut blocks = model
        .get("blocks")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| AppError::BadRequest("DOCX model requires blocks".into()))?;
    let mut relationships = read_zip_text(original, "word/_rels/document.xml.rels")
        .unwrap_or_else(|_| docx_empty_relationships());
    let mut content_types = read_zip_text(original, "[Content_Types].xml")
        .unwrap_or_else(|_| docx_empty_content_types());
    let mut replacements = Vec::new();
    let manifest_changed = add_docx_image_replacements(
        original,
        &mut blocks,
        &mut relationships,
        &mut content_types,
        &mut replacements,
    )?;
    let hyperlinks_changed = add_docx_hyperlink_relationships(&mut blocks, &mut relationships);
    let numbering_changed = if docx_blocks_have_lists(&blocks) {
        add_docx_numbering_replacements(
            original,
            &mut blocks,
            &mut relationships,
            &mut content_types,
            &mut replacements,
        );
        true
    } else {
        false
    };
    let document = read_zip_text(original, "word/document.xml")?;
    assign_docx_bookmark_ids(&document, &mut blocks);
    let document = replace_docx_blocks(&document, &blocks);
    let document = update_docx_page_settings(&document, model.get("page"));
    let document = ensure_docx_relationship_namespace(&document);
    replacements.push(("word/document.xml".to_string(), document.into_bytes()));
    add_docx_text_part_replacements(original, model.get("headers"), "header", &mut replacements);
    add_docx_text_part_replacements(original, model.get("footers"), "footer", &mut replacements);
    let comments_changed = add_docx_comment_replacements(
        original,
        model.get("comments"),
        &mut relationships,
        &mut content_types,
        &mut replacements,
    );
    let footnotes_changed = add_docx_note_replacements(
        original,
        model.get("footnotes"),
        DOCX_FOOTNOTE_PART,
        &mut relationships,
        &mut content_types,
        &mut replacements,
    );
    let endnotes_changed = add_docx_note_replacements(
        original,
        model.get("endnotes"),
        DOCX_ENDNOTE_PART,
        &mut relationships,
        &mut content_types,
        &mut replacements,
    );
    if manifest_changed
        || numbering_changed
        || hyperlinks_changed
        || comments_changed
        || footnotes_changed
        || endnotes_changed
    {
        replacements.push((
            "word/_rels/document.xml.rels".to_string(),
            relationships.into_bytes(),
        ));
        replacements.push((
            "[Content_Types].xml".to_string(),
            content_types.into_bytes(),
        ));
    }
    let replacement_refs = replacements
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.clone()))
        .collect::<Vec<_>>();
    replace_zip_entries(original, &replacement_refs)
}

fn replace_docx_paragraph_text(paragraph: &str, text: &str) -> String {
    if paragraph.contains("<w:t") {
        return replace_tag_texts(paragraph, "w:t", &[text.to_string()]);
    }
    let run = format!(
        r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#,
        escape_xml(text)
    );
    append_before_or_end(paragraph, "</w:p>", &run)
}

fn docx_plain_paragraph_xml(text: &str) -> String {
    format!(
        r#"<w:p><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        escape_xml(text)
    )
}

fn docx_body_segments(document: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut rest = document;
    loop {
        let paragraph = rest.find("<w:p").map(|index| (index, "<w:p", "</w:p>"));
        let table = rest
            .find("<w:tbl")
            .map(|index| (index, "<w:tbl", "</w:tbl>"));
        let next = match (paragraph, table) {
            (Some(paragraph), Some(table)) => {
                if paragraph.0 <= table.0 {
                    paragraph
                } else {
                    table
                }
            }
            (Some(paragraph), None) => paragraph,
            (None, Some(table)) => table,
            (None, None) => break,
        };
        let after_start = &rest[next.0..];
        let Some(end) = after_start.find(next.2) else {
            break;
        };
        let end_index = end + next.2.len();
        segments.push(after_start[..end_index].to_string());
        rest = &after_start[end_index..];
    }
    segments
}

fn docx_tag_attr(xml: &str, marker: &str, attr: &str) -> Option<String> {
    let start = xml.find(marker)?;
    let after_start = &xml[start..];
    let end = after_start.find('>')?;
    attr_value(&after_start[..end], attr)
}

fn docx_font_size(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:sz", "w:val")
        .and_then(|value| value.parse::<u32>().ok())
        .map(|half_points| (half_points / 2).to_string())
}

fn docx_alignment(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:jc", "w:val")
        .filter(|value| matches!(value.as_str(), "left" | "center" | "right" | "justify"))
}

fn docx_bookmark_name(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:bookmarkStart", "w:name")
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty() && name != "_GoBack")
}

fn docx_bookmark_id(xml: &str) -> Option<u32> {
    docx_tag_attr(xml, "<w:bookmarkStart", "w:id").and_then(|value| value.parse().ok())
}

fn docx_bookmark_ids(xml: &str) -> BTreeSet<u32> {
    let mut ids = BTreeSet::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<w:bookmarkStart") {
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            break;
        };
        if let Some(id) =
            attr_value(&after_start[..end], "w:id").and_then(|value| value.parse().ok())
        {
            ids.insert(id);
        }
        rest = &after_start[end + 1..];
    }
    ids
}

fn assign_docx_bookmark_ids(document: &str, blocks: &mut [Value]) {
    let mut used = docx_bookmark_ids(document);
    for block in blocks.iter() {
        if docx_bookmark_name_from_model(block).is_some() {
            if let Some(id) = docx_bookmark_id_from_model(block) {
                used.insert(id);
            }
        }
    }
    let mut next = used
        .iter()
        .next_back()
        .copied()
        .unwrap_or(0)
        .saturating_add(1);
    for block in blocks {
        if docx_bookmark_name_from_model(block).is_none()
            || docx_bookmark_id_from_model(block).is_some()
        {
            continue;
        }
        while used.contains(&next) {
            next = next.saturating_add(1);
        }
        if let Some(object) = block.as_object_mut() {
            object.insert("bookmarkId".to_string(), json!(next.to_string()));
        }
        used.insert(next);
        next = next.saturating_add(1);
    }
}

fn docx_bookmark_name_from_model(block: &Value) -> Option<String> {
    let name = block.get("bookmarkName")?.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    let mut normalized = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if normalized
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_digit())
    {
        normalized.insert(0, '_');
    }
    let normalized = normalized.trim_matches('_').to_string();
    (!normalized.is_empty()).then(|| normalized.chars().take(40).collect())
}

fn docx_bookmark_id_from_model(block: &Value) -> Option<u32> {
    block
        .get("bookmarkId")
        .and_then(Value::as_str)
        .and_then(|value| value.parse().ok())
        .or_else(|| {
            block
                .get("bookmarkId")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok())
        })
}

fn docx_vertical_align(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:vertAlign", "w:val")
        .filter(|value| matches!(value.as_str(), "superscript" | "subscript"))
}

fn docx_has_enabled_run_property(xml: &str, marker: &str) -> bool {
    let mut rest = xml;
    while let Some(start) = rest.find(marker) {
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            return true;
        };
        let tag = &after_start[..=end];
        if !docx_tag_attr(tag, marker, "w:val").is_some_and(|value| {
            matches!(value.to_ascii_lowercase().as_str(), "false" | "0" | "off")
        }) {
            return true;
        }
        rest = &after_start[end + 1..];
    }
    false
}

fn docx_has_enabled_underline(xml: &str) -> bool {
    let mut rest = xml;
    while let Some(start) = rest.find("<w:u") {
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            return true;
        };
        let tag = &after_start[..=end];
        if !docx_tag_attr(tag, "<w:u", "w:val")
            .is_some_and(|value| value.eq_ignore_ascii_case("none"))
        {
            return true;
        }
        rest = &after_start[end + 1..];
    }
    false
}

fn docx_heading_level(xml: &str) -> Option<u32> {
    let style = docx_tag_attr(xml, "<w:pStyle", "w:val")?;
    let normalized = style
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    let level = normalized.strip_prefix("heading")?.parse::<u32>().ok()?;
    (1..=6).contains(&level).then_some(level)
}

fn docx_text_with_breaks(text: &str) -> String {
    text.split('\n')
        .enumerate()
        .map(|(index, line)| {
            let prefix = if index == 0 { "" } else { "<w:br/>" };
            format!(
                "{prefix}<w:t xml:space=\"preserve\">{}</w:t>",
                escape_xml(line)
            )
        })
        .collect::<Vec<_>>()
        .join("")
}

fn ensure_docx_relationship_namespace(document: &str) -> String {
    if !document.contains("r:id=") || document.contains("xmlns:r=") {
        return document.to_string();
    }
    set_first_xml_tag_attrs(
        document,
        "<w:document",
        &[(
            "xmlns:r",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships".to_string(),
        )],
    )
}

fn docx_hex_color(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('#');
    if value.len() == 6 && value.chars().all(|character| character.is_ascii_hexdigit()) {
        Some(value.to_ascii_uppercase())
    } else {
        None
    }
}

fn docx_u32_model_attr(block: &Value, key: &str, max: u32) -> Option<u32> {
    block
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value.min(u64::from(max)) as u32)
        .filter(|value| *value > 0)
}

fn docx_u32_model_attr_allow_zero(block: &Value, key: &str, max: u32) -> Option<u32> {
    block
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value.min(u64::from(max)) as u32)
}

fn docx_u32_attr(xml: &str, tag: &str, attr: &str) -> Option<u32> {
    docx_tag_attr(xml, tag, attr).and_then(|value| value.parse::<u32>().ok())
}

fn column_letters(mut column: u32) -> String {
    let mut output = String::new();
    while column > 0 {
        let remainder = (column - 1) % 26;
        output.insert(0, char::from_u32('A' as u32 + remainder).unwrap_or('A'));
        column = (column - remainder - 1) / 26;
    }
    output
}

#[cfg(test)]
mod tests;
