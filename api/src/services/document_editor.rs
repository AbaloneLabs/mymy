//! Built-in document editor model conversion.
//!
//! The editor intentionally avoids external document services. Office files are
//! OOXML zip packages, so this module exposes a compact JSON editing model and
//! writes the edited model back by replacing the relevant XML parts while
//! preserving the rest of the package.

mod codec;
pub mod commands;
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
mod docx_text_anchors;
mod docx_text_parts;
mod docx_utils;
mod kind;
mod ooxml_charts;
mod ooxml_content_types;
mod ooxml_images;
mod ooxml_package;
mod pptx_manifest;
mod pptx_model;
mod pptx_notes;
mod pptx_package;
mod revision_snapshots;
mod save_receipts;
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

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::models::content_security::ContentOrigin;
use crate::models::document_editor::{
    DocumentEditorKind, DocumentEditorModelResponse, DocumentEditorSyncStatus,
    SaveDocumentEditorCopyRequest, ValidateDocumentEditorModelRequest,
    ValidateDocumentEditorModelResponse, WriteDocumentEditorModelRequest,
    DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION,
};
use crate::services::document_conversion::checkpoint as conversion_checkpoint;
use crate::services::document_revisions::{
    record_document_revision, revision_provenance, RevisionActor,
};
use crate::services::drive;
use crate::services::file_observations::{fingerprint_path, FileFingerprint};
use crate::services::workspace_content::{AdmissionActor, AdmissionOutcome, AdmissionRequest};
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
use self::docx_styles::{
    add_docx_font_table_replacements, add_docx_style_replacements, docx_paragraph_style_id,
    docx_paragraph_styles, docx_style_names,
};
#[cfg(test)]
use self::docx_tables::build_docx_table;
use self::docx_tables::{
    parse_docx_table_border_color, parse_docx_table_border_size, parse_docx_table_cell_background,
    parse_docx_table_cell_vertical_align, parse_docx_table_column_widths,
    parse_docx_table_header_background, parse_docx_table_header_row, parse_docx_table_merged_cells,
    parse_docx_table_row_heights, parse_docx_table_rows, parse_docx_table_style,
};
use self::docx_text_anchors::{docx_comment_ranges, docx_hyperlink_ranges, docx_note_references};
use self::docx_text_parts::{add_docx_text_part_replacements, docx_text_parts};
use self::docx_utils::*;
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
use self::revision_snapshots::{
    load_revision_snapshot, pin_revision_snapshot, refresh_revision_snapshot_pin,
    store_revision_snapshot,
};
use self::save_receipts::{
    insert_pending_save_receipt, load_save_receipt, mark_save_receipt_committed,
    refresh_pending_result_hash, DocumentSaveReceipt,
};
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
const MAX_DOCUMENT_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_DOCUMENT_MODEL_BYTES: usize = 128 * 1024 * 1024;

pub async fn read_model(
    state: &AppState,
    logical_path: &str,
) -> AppResult<DocumentEditorModelResponse> {
    state
        .workspace_content
        .ensure_not_quarantined(state, logical_path)
        .await?;
    let _namespace_guard = state.drive_namespace_lock().read().await;
    let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    let write_lock = state.drive_write_lock(&resolved.physical_path).await;
    let _write_guard = write_lock.lock().await;
    read_model_with_sync_unlocked(state, resolved.logical_path, resolved.physical_path).await
}

/// Read model bytes and their revision token while the caller holds the same
/// path lock used by atomic writers. Without this shared critical section, an
/// open could pair an old parsed model with the fingerprint of a newer file and
/// later pass optimistic concurrency while overwriting unseen content.
async fn read_model_unlocked(
    state: &AppState,
    logical_path: String,
    physical_path: std::path::PathBuf,
) -> AppResult<(DocumentEditorModelResponse, Vec<u8>)> {
    let worker_path = physical_path.clone();
    let (kind, model, compatibility_warnings, bytes) = state
        .document_conversion_pool
        .run("read", move || {
            conversion_checkpoint()?;
            let metadata = std::fs::metadata(&worker_path)?;
            if !metadata.is_file() {
                return Err(AppError::BadRequest("Drive path is not a file".into()));
            }
            validate_document_file_size(metadata.len())?;
            let kind = editor_kind_for_path(&worker_path);
            if kind == DocumentEditorKind::Preview {
                return Err(AppError::BadRequest("File type is not editable".into()));
            }
            let bytes = std::fs::read(&worker_path)?;
            validate_saved_document_bytes(kind, &worker_path, &bytes)?;
            let model = model_from_bytes(kind, &bytes)?;
            conversion_checkpoint()?;
            let compatibility_warnings = compatibility_warnings_for_bytes(kind, &bytes);
            Ok::<_, AppError>((kind, model, compatibility_warnings, bytes))
        })
        .await?;
    let fingerprint = fingerprint_token(&physical_path).await?;
    Ok((
        DocumentEditorModelResponse {
            path: logical_path,
            name: physical_path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default(),
            editor_kind: kind,
            mime_type: mime_type_for_editor(kind),
            fingerprint,
            model_schema_version: DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION,
            capabilities: document_editor_capabilities(kind),
            sync_status: DocumentEditorSyncStatus::LocalOnly,
            revision_provenance: None,
            compatibility_warnings,
            model,
        },
        bytes,
    ))
}

async fn model_response_from_committed_bytes(
    state: &AppState,
    logical_path: String,
    physical_path: std::path::PathBuf,
    bytes: Vec<u8>,
    fingerprint: FileFingerprint,
    sync_status: DocumentEditorSyncStatus,
) -> AppResult<DocumentEditorModelResponse> {
    let worker_path = physical_path.clone();
    let worker_bytes = bytes;
    let (kind, model, compatibility_warnings) = state
        .document_conversion_pool
        .run("committed_read", move || {
            conversion_checkpoint()?;
            validate_document_file_size(worker_bytes.len() as u64)?;
            let kind = editor_kind_for_path(&worker_path);
            if kind == DocumentEditorKind::Preview {
                return Err(AppError::BadRequest("File type is not editable".into()));
            }
            validate_saved_document_bytes(kind, &worker_path, &worker_bytes)?;
            let model = model_from_bytes(kind, &worker_bytes)?;
            let warnings = compatibility_warnings_for_bytes(kind, &worker_bytes);
            conversion_checkpoint()?;
            Ok::<_, AppError>((kind, model, warnings))
        })
        .await?;
    Ok(DocumentEditorModelResponse {
        path: logical_path,
        name: physical_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        editor_kind: kind,
        mime_type: mime_type_for_editor(kind),
        fingerprint: fingerprint_value_token(&fingerprint),
        model_schema_version: DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION,
        capabilities: document_editor_capabilities(kind),
        sync_status,
        revision_provenance: None,
        compatibility_warnings,
        model,
    })
}

async fn commit_editor_output(
    state: &AppState,
    logical_path: &str,
    physical_path: &Path,
    bytes: &[u8],
    expected_fingerprint: Option<&str>,
    allow_overwrite: bool,
) -> AppResult<(FileFingerprint, DocumentEditorSyncStatus)> {
    let file_name = physical_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_string();
    let outcome = state
        .workspace_content
        .admit_bytes(
            state,
            AdmissionRequest {
                desired_path: logical_path.to_string(),
                file_name,
                origin: ContentOrigin::EditorOutput,
                actor: AdmissionActor::user(),
                expected_fingerprint: expected_fingerprint.map(str::to_string),
                allow_overwrite,
                enqueue_s3_sync: true,
            },
            bytes,
        )
        .await?;
    match outcome {
        AdmissionOutcome::Committed {
            fingerprint,
            sync_status,
        } => Ok((fingerprint, sync_status)),
        AdmissionOutcome::Quarantined { .. } => Err(AppError::content_quarantined()),
        AdmissionOutcome::Rejected => Err(AppError::content_rejected()),
    }
}

pub async fn write_model(
    state: &AppState,
    request: WriteDocumentEditorModelRequest,
) -> AppResult<DocumentEditorModelResponse> {
    if request.model_schema_version != DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION {
        return Err(AppError::BadRequest(format!(
            "Document editor model schema changed (client {}, server {})",
            request.model_schema_version, DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION
        )));
    }
    validate_document_editor_capabilities(request.editor_kind, &request.required_capabilities)?;
    validate_document_editor_idempotency_key(&request.idempotency_key)?;
    state
        .workspace_content
        .ensure_not_quarantined(state, &request.path)
        .await?;
    let request_hash = document_save_request_hash(&request)?;
    let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, &request.path)?;
    let metadata = std::fs::metadata(&resolved.physical_path)?;
    if !metadata.is_file() {
        return Err(AppError::BadRequest("Drive path is not a file".into()));
    }
    let expected_fingerprint = request.expected_fingerprint.clone();
    let idempotency_key = request.idempotency_key.clone();
    let editor_kind_key = document_editor_kind_key(request.editor_kind).to_string();
    let existing_receipt = load_save_receipt(state, &idempotency_key).await?;
    if let Some(receipt) = existing_receipt.as_ref() {
        validate_save_receipt_request(
            receipt,
            &resolved.logical_path,
            &editor_kind_key,
            &expected_fingerprint,
            &request_hash,
        )?;
        let current_fingerprint = fingerprint_path(&resolved.physical_path)
            .await
            .map_err(AppError::Internal)?;
        if current_fingerprint.hash == receipt.result_content_hash {
            let current_token = fingerprint_value_token(&current_fingerprint);
            if let Err(error) =
                mark_save_receipt_committed(state, &idempotency_key, &current_token).await
            {
                tracing::warn!(
                    idempotency_key = %idempotency_key,
                    error = %error,
                    "document save committed but receipt finalization failed"
                );
            }
            if let Err(error) = record_document_revision(
                state,
                &resolved.logical_path,
                &current_fingerprint.hash,
                RevisionActor::User,
                "document-editor",
                Some(&idempotency_key),
            )
            .await
            {
                tracing::warn!(
                    path = %resolved.logical_path,
                    error = %error,
                    "document save committed but revision provenance was not recorded"
                );
            }
            return read_model_with_sync_unlocked(
                state,
                resolved.logical_path,
                resolved.physical_path,
            )
            .await;
        }
        if receipt.status == "committed" {
            return Err(AppError::Conflict(format!(
                "Save {} committed as revision {} but the file changed again",
                receipt.idempotency_key,
                receipt.result_fingerprint.as_deref().unwrap_or("unknown")
            )));
        }
    }
    let current = fingerprint_token(&resolved.physical_path).await?;
    if expected_fingerprint != current {
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
    validate_document_file_size(metadata.len())?;
    let physical_path = resolved.physical_path.clone();
    let editor_kind = request.editor_kind;
    let model = request.model;
    let (updated, original) = state
        .document_conversion_pool
        .run("write", move || {
            conversion_checkpoint()?;
            validate_document_model_size(&model)?;
            let original = std::fs::read(&physical_path)?;
            validate_saved_document_bytes(editor_kind, &physical_path, &original)?;
            let updated = bytes_from_model(editor_kind, &original, &model)?;
            validate_document_file_size(updated.len() as u64)?;
            validate_saved_document_bytes(editor_kind, &physical_path, &updated)?;
            conversion_checkpoint()?;
            Ok::<_, AppError>((updated, original))
        })
        .await?;
    let result_content_hash = content_hash(&updated);
    let before_replace = fingerprint_token(&resolved.physical_path).await?;
    if before_replace != expected_fingerprint {
        return Err(AppError::Conflict(
            "File changed while the editor was preparing the save".to_string(),
        ));
    }
    if existing_receipt.is_some() {
        refresh_pending_result_hash(state, &idempotency_key, &result_content_hash).await?;
    } else {
        let receipt = DocumentSaveReceipt {
            idempotency_key: idempotency_key.clone(),
            drive_path: resolved.logical_path.clone(),
            editor_kind: editor_kind_key,
            expected_fingerprint: expected_fingerprint.clone(),
            request_hash,
            result_content_hash: result_content_hash.clone(),
            result_fingerprint: None,
            status: "pending".to_string(),
        };
        if !insert_pending_save_receipt(state, &receipt).await? {
            let concurrent = load_save_receipt(state, &idempotency_key)
                .await?
                .ok_or_else(|| {
                    AppError::Internal(
                        "Document save receipt conflicted but could not be loaded".into(),
                    )
                })?;
            validate_save_receipt_request(
                &concurrent,
                &resolved.logical_path,
                document_editor_kind_key(request.editor_kind),
                &expected_fingerprint,
                &receipt.request_hash,
            )?;
            if concurrent.result_content_hash != receipt.result_content_hash {
                return Err(AppError::Conflict(
                    "Document save idempotency key is already preparing different bytes".into(),
                ));
            }
        }
    }
    store_revision_snapshot(
        state,
        &resolved.logical_path,
        &content_hash(&original),
        &original,
    )
    .await?;
    let (committed_fingerprint, sync_status) = commit_editor_output(
        state,
        &resolved.logical_path,
        &resolved.physical_path,
        &updated,
        Some(&expected_fingerprint),
        true,
    )
    .await?;
    let logical_path = resolved.logical_path;
    let committed_bytes = updated;
    let mut response = model_response_from_committed_bytes(
        state,
        logical_path.clone(),
        resolved.physical_path,
        committed_bytes.clone(),
        committed_fingerprint,
        sync_status,
    )
    .await?;
    if let Err(error) = pin_revision_snapshot(
        state,
        &logical_path,
        &content_hash(&committed_bytes),
        &committed_bytes,
    )
    .await
    {
        tracing::warn!(
            path = %logical_path,
            error = %error,
            "document save committed but its recovery snapshot was not recorded"
        );
    }
    if let Err(error) =
        mark_save_receipt_committed(state, &idempotency_key, &response.fingerprint).await
    {
        tracing::warn!(
            idempotency_key = %idempotency_key,
            error = %error,
            "document save succeeded but receipt finalization will require retry reconciliation"
        );
    }
    if let Err(error) = record_document_revision(
        state,
        &logical_path,
        &result_content_hash,
        RevisionActor::User,
        "document-editor",
        Some(&idempotency_key),
    )
    .await
    {
        tracing::warn!(
            path = %logical_path,
            error = %error,
            "document save committed but revision provenance was not recorded"
        );
    }
    response.revision_provenance =
        load_revision_provenance(state, &logical_path, &response.fingerprint).await;
    Ok(response)
}

pub async fn save_copy(
    state: &AppState,
    request: SaveDocumentEditorCopyRequest,
) -> AppResult<DocumentEditorModelResponse> {
    state
        .workspace_content
        .ensure_not_quarantined(state, &request.source_path)
        .await?;
    state
        .workspace_content
        .ensure_not_quarantined(state, &request.target_path)
        .await?;
    if request.model_schema_version != DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION {
        return Err(AppError::BadRequest(format!(
            "Document editor model schema changed (client {}, server {})",
            request.model_schema_version, DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION
        )));
    }
    validate_document_editor_capabilities(request.editor_kind, &request.required_capabilities)?;
    validate_document_editor_idempotency_key(&request.idempotency_key)?;
    if request.source_path == request.target_path {
        return Err(AppError::BadRequest(
            "Conflict copy path must differ from the source path".into(),
        ));
    }
    let request_hash = document_copy_request_hash(&request)?;
    let receipt_expected = format!("copy:{}", request.base_fingerprint);
    let source = drive::resolve_drive_path(&state.config.agent_data_dir, &request.source_path)?;
    let target = drive::resolve_drive_path(&state.config.agent_data_dir, &request.target_path)?;
    let expected_source_kind = editor_kind_for_path(&source.physical_path);
    let target_kind = editor_kind_for_path(&target.physical_path);
    if expected_source_kind != request.editor_kind || target_kind != request.editor_kind {
        return Err(AppError::BadRequest(
            "Conflict copy must keep the source document file type".into(),
        ));
    }
    let editor_kind_key = document_editor_kind_key(request.editor_kind).to_string();
    if let Some(receipt) = load_save_receipt(state, &request.idempotency_key).await? {
        validate_save_receipt_request(
            &receipt,
            &target.logical_path,
            &editor_kind_key,
            &receipt_expected,
            &request_hash,
        )?;
        if target.physical_path.is_file() {
            let fingerprint = fingerprint_path(&target.physical_path)
                .await
                .map_err(AppError::Internal)?;
            if fingerprint.hash == receipt.result_content_hash {
                return read_model_with_sync_unlocked(
                    state,
                    target.logical_path,
                    target.physical_path,
                )
                .await;
            }
        }
        return Err(AppError::Conflict(
            "Conflict copy receipt exists but the target path contains different bytes".into(),
        ));
    }
    if target.physical_path.exists() {
        return Err(AppError::Conflict(
            "Conflict copy target already exists; choose another name".into(),
        ));
    }
    let base_hash = request
        .base_fingerprint
        .split(':')
        .next()
        .unwrap_or(&request.base_fingerprint);
    let base_bytes = load_revision_snapshot(state, &source.logical_path, base_hash)
        .await?
        .ok_or_else(|| {
            AppError::Conflict(
                "The exact base revision is no longer available for a safe conflict copy".into(),
            )
        })?;
    let model = request.model;
    let target_path = target.physical_path.clone();
    let editor_kind = request.editor_kind;
    let updated = state
        .document_conversion_pool
        .run("copy", move || {
            conversion_checkpoint()?;
            validate_document_model_size(&model)?;
            validate_saved_document_bytes(editor_kind, &target_path, &base_bytes)?;
            let updated = bytes_from_model(editor_kind, &base_bytes, &model)?;
            validate_document_file_size(updated.len() as u64)?;
            validate_saved_document_bytes(editor_kind, &target_path, &updated)?;
            conversion_checkpoint()?;
            Ok::<_, AppError>(updated)
        })
        .await?;
    let result_content_hash = content_hash(&updated);
    let receipt = DocumentSaveReceipt {
        idempotency_key: request.idempotency_key.clone(),
        drive_path: target.logical_path.clone(),
        editor_kind: editor_kind_key,
        expected_fingerprint: receipt_expected,
        request_hash,
        result_content_hash: result_content_hash.clone(),
        result_fingerprint: None,
        status: "pending".to_string(),
    };
    if !insert_pending_save_receipt(state, &receipt).await? {
        return Err(AppError::Conflict(
            "Conflict copy idempotency key is already in use".into(),
        ));
    }
    let (committed_fingerprint, sync_status) = commit_editor_output(
        state,
        &target.logical_path,
        &target.physical_path,
        &updated,
        None,
        false,
    )
    .await?;
    let committed_bytes = updated;
    let mut response = model_response_from_committed_bytes(
        state,
        target.logical_path.clone(),
        target.physical_path.clone(),
        committed_bytes.clone(),
        committed_fingerprint,
        sync_status,
    )
    .await?;
    if let Err(error) = pin_revision_snapshot(
        state,
        &target.logical_path,
        &result_content_hash,
        &committed_bytes,
    )
    .await
    {
        tracing::warn!(
            path = %target.logical_path,
            error = %error,
            "document conflict copy committed but recovery snapshot recording failed"
        );
    }
    if let Err(error) =
        mark_save_receipt_committed(state, &request.idempotency_key, &response.fingerprint).await
    {
        tracing::warn!(
            idempotency_key = %request.idempotency_key,
            error = %error,
            "document conflict copy committed but receipt finalization failed"
        );
    }
    if let Err(error) = record_document_revision(
        state,
        &target.logical_path,
        &result_content_hash,
        RevisionActor::User,
        "document-editor-copy",
        Some(&request.idempotency_key),
    )
    .await
    {
        tracing::warn!(
            path = %target.logical_path,
            error = %error,
            "document conflict copy committed but revision provenance was not recorded"
        );
    }
    response.revision_provenance =
        load_revision_provenance(state, &target.logical_path, &response.fingerprint).await;
    Ok(response)
}

pub async fn validate_model(
    state: &AppState,
    request: ValidateDocumentEditorModelRequest,
) -> AppResult<ValidateDocumentEditorModelResponse> {
    state
        .workspace_content
        .ensure_not_quarantined(state, &request.path)
        .await?;
    if request.model_schema_version != DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION {
        return Err(AppError::BadRequest(format!(
            "Document editor model schema changed (client {}, server {})",
            request.model_schema_version, DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION
        )));
    }
    validate_document_editor_capabilities(request.editor_kind, &request.required_capabilities)?;
    let _namespace_guard = state.drive_namespace_lock().read().await;
    let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, &request.path)?;
    let write_lock = state.drive_write_lock(&resolved.physical_path).await;
    let _write_guard = write_lock.lock().await;
    let metadata = std::fs::metadata(&resolved.physical_path)?;
    if !metadata.is_file() {
        return Err(AppError::BadRequest("Drive path is not a file".into()));
    }
    let current = fingerprint_token(&resolved.physical_path).await?;
    if current != request.expected_fingerprint {
        return Err(AppError::Conflict(
            "File changed while validating the editor draft".into(),
        ));
    }
    let expected_kind = editor_kind_for_path(&resolved.physical_path);
    if expected_kind != request.editor_kind || expected_kind == DocumentEditorKind::Preview {
        return Err(AppError::BadRequest(
            "Editor kind does not match file type".into(),
        ));
    }
    validate_document_file_size(metadata.len())?;
    let logical_path = resolved.logical_path.clone();
    let physical_path = resolved.physical_path;
    let editor_kind = request.editor_kind;
    let model = request.model;
    let (serialized_size, compatibility_warnings) = state
        .document_conversion_pool
        .run("validate", move || {
            conversion_checkpoint()?;
            validate_document_model_size(&model)?;
            let original = std::fs::read(&physical_path)?;
            validate_saved_document_bytes(editor_kind, &physical_path, &original)?;
            let updated = bytes_from_model(editor_kind, &original, &model)?;
            validate_document_file_size(updated.len() as u64)?;
            validate_saved_document_bytes(editor_kind, &physical_path, &updated)?;
            let warnings = compatibility_warnings_for_bytes(editor_kind, &updated);
            conversion_checkpoint()?;
            Ok::<_, AppError>((updated.len(), warnings))
        })
        .await?;
    let expected_hash = current.split(':').next().unwrap_or(&current);
    if let Err(error) = refresh_revision_snapshot_pin(state, &logical_path, expected_hash).await {
        tracing::warn!(
            path = %logical_path,
            error = %error,
            "document draft validated but its base snapshot lease was not refreshed"
        );
    }
    Ok(ValidateDocumentEditorModelResponse {
        fingerprint: current,
        serialized_size,
        compatibility_warnings,
    })
}

async fn read_model_with_sync_unlocked(
    state: &AppState,
    logical_path: String,
    physical_path: std::path::PathBuf,
) -> AppResult<DocumentEditorModelResponse> {
    let (mut response, bytes) =
        read_model_unlocked(state, logical_path.clone(), physical_path).await?;
    if let Err(error) =
        pin_revision_snapshot(state, &logical_path, &content_hash(&bytes), &bytes).await
    {
        tracing::warn!(
            path = %logical_path,
            error = %error,
            "document opened but its recovery snapshot was not recorded"
        );
    }
    response.sync_status = match drive::document_sync_status(state, &logical_path).await {
        Ok(status) => status,
        Err(error) => {
            tracing::warn!(
                path = %logical_path,
                error = %error,
                "document opened locally but sync status could not be loaded"
            );
            DocumentEditorSyncStatus::Failed
        }
    };
    response.revision_provenance =
        load_revision_provenance(state, &logical_path, &response.fingerprint).await;
    Ok(response)
}

async fn load_revision_provenance(
    state: &AppState,
    logical_path: &str,
    fingerprint: &str,
) -> Option<crate::models::document_editor::DocumentRevisionProvenance> {
    let content_hash = fingerprint.split(':').next().unwrap_or(fingerprint);
    match revision_provenance(state, logical_path, content_hash).await {
        Ok(provenance) => provenance,
        Err(error) => {
            tracing::warn!(
                path = %logical_path,
                error = %error,
                "document revision provenance could not be loaded"
            );
            None
        }
    }
}

fn document_editor_capabilities(kind: DocumentEditorKind) -> Vec<String> {
    let mut capabilities = vec![
        "document-revision-cas-v1".to_string(),
        "document-revision-provenance-v1".to_string(),
        "document-conflict-copy-v1".to_string(),
        "document-revision-snapshot-v1".to_string(),
        "atomic-file-replace-v1".to_string(),
        "normalized-model-schema-v1".to_string(),
    ];
    capabilities.push(
        match kind {
            DocumentEditorKind::Markdown => "markdown-source-model-v1",
            DocumentEditorKind::Text => "text-source-model-v1",
            DocumentEditorKind::Csv | DocumentEditorKind::Tsv => "delimited-table-model-v1",
            DocumentEditorKind::Docx => "docx-run-model-v1",
            DocumentEditorKind::Xlsx => "xlsx-workbook-model-v1",
            DocumentEditorKind::Pptx => "pptx-stable-object-model-v1",
            DocumentEditorKind::Preview => "preview-read-only-v1",
        }
        .to_string(),
    );
    capabilities
}

fn validate_document_editor_capabilities(
    kind: DocumentEditorKind,
    required: &[String],
) -> AppResult<()> {
    let supported = document_editor_capabilities(kind);
    let missing = required
        .iter()
        .filter(|capability| !supported.contains(capability))
        .cloned()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return Ok(());
    }
    Err(AppError::BadRequest(format!(
        "Document editor capabilities are unavailable: {}",
        missing.join(", ")
    )))
}

fn validate_document_editor_idempotency_key(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(AppError::BadRequest(
            "Document save idempotency key must be 1-64 ASCII letters, digits, '-' or '_'".into(),
        ));
    }
    Ok(())
}

fn document_save_request_hash(request: &WriteDocumentEditorModelRequest) -> AppResult<String> {
    let mut hasher = Sha256::new();
    hash_framed(&mut hasher, request.path.as_bytes());
    hash_framed(
        &mut hasher,
        document_editor_kind_key(request.editor_kind).as_bytes(),
    );
    hash_framed(&mut hasher, &request.model_schema_version.to_be_bytes());
    hash_framed(&mut hasher, request.expected_fingerprint.as_bytes());
    for capability in &request.required_capabilities {
        hash_framed(&mut hasher, capability.as_bytes());
    }
    let model = serde_json::to_vec(&request.model)
        .map_err(|error| AppError::BadRequest(format!("Document model is invalid: {error}")))?;
    hash_framed(&mut hasher, &model);
    Ok(hex::encode(hasher.finalize()))
}

fn document_copy_request_hash(request: &SaveDocumentEditorCopyRequest) -> AppResult<String> {
    let mut hasher = Sha256::new();
    hash_framed(&mut hasher, request.source_path.as_bytes());
    hash_framed(&mut hasher, request.target_path.as_bytes());
    hash_framed(
        &mut hasher,
        document_editor_kind_key(request.editor_kind).as_bytes(),
    );
    hash_framed(&mut hasher, &request.model_schema_version.to_be_bytes());
    hash_framed(&mut hasher, request.base_fingerprint.as_bytes());
    for capability in &request.required_capabilities {
        hash_framed(&mut hasher, capability.as_bytes());
    }
    let model = serde_json::to_vec(&request.model)
        .map_err(|error| AppError::BadRequest(format!("Document model is invalid: {error}")))?;
    hash_framed(&mut hasher, &model);
    Ok(hex::encode(hasher.finalize()))
}

fn hash_framed(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

fn content_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn document_editor_kind_key(kind: DocumentEditorKind) -> &'static str {
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

fn validate_save_receipt_request(
    receipt: &DocumentSaveReceipt,
    path: &str,
    editor_kind: &str,
    expected_fingerprint: &str,
    request_hash: &str,
) -> AppResult<()> {
    if receipt.drive_path == path
        && receipt.editor_kind == editor_kind
        && receipt.expected_fingerprint == expected_fingerprint
        && receipt.request_hash == request_hash
    {
        return Ok(());
    }
    Err(AppError::Conflict(
        "Document save idempotency key was already used for another logical save".into(),
    ))
}

fn validate_document_file_size(size: u64) -> AppResult<()> {
    if size > MAX_DOCUMENT_FILE_BYTES {
        return Err(AppError::BadRequest(format!(
            "Document file exceeds the {} MiB editor limit",
            MAX_DOCUMENT_FILE_BYTES / (1024 * 1024)
        )));
    }
    Ok(())
}

fn validate_document_model_size(model: &Value) -> AppResult<()> {
    let size = serde_json::to_vec(model)
        .map_err(|error| AppError::BadRequest(format!("Document model is invalid: {error}")))?
        .len();
    if size > MAX_DOCUMENT_MODEL_BYTES {
        return Err(AppError::BadRequest(format!(
            "Document model exceeds the {} MiB editor limit",
            MAX_DOCUMENT_MODEL_BYTES / (1024 * 1024)
        )));
    }
    Ok(())
}

async fn fingerprint_token(path: &Path) -> AppResult<String> {
    let fingerprint = fingerprint_path(path).await.map_err(AppError::Internal)?;
    Ok(fingerprint_value_token(&fingerprint))
}

fn fingerprint_value_token(fingerprint: &FileFingerprint) -> String {
    let modified = fingerprint
        .modified_at
        .map(|value| value.timestamp_millis().to_string())
        .unwrap_or_else(|| "none".to_string());
    format!("{}:{}:{}", fingerprint.hash, fingerprint.size, modified)
}

fn model_from_bytes(kind: DocumentEditorKind, bytes: &[u8]) -> AppResult<Value> {
    codec::codec_for_kind(kind).decode(bytes)
}

fn bytes_from_model(
    kind: DocumentEditorKind,
    original: &[u8],
    model: &Value,
) -> AppResult<Vec<u8>> {
    codec::codec_for_kind(kind).encode(original, model)
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
                "breakKind": docx_section_break_kind(&segment),
                "sectionPage": docx_page_settings(&segment)
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
        let block_id = format!("p{}", index + 1);
        let mut block = json!({
            "id": block_id.clone(),
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
        let comment_ranges = docx_comment_ranges(&segment);
        if !comment_ranges.is_empty() {
            block["commentRanges"] = json!(comment_ranges);
        }
        let hyperlink_ranges = docx_hyperlink_ranges(&segment, &relationships, &block_id);
        if !hyperlink_ranges.is_empty() {
            block["hyperlinks"] = json!(hyperlink_ranges);
        }
        if let Some(footnote_id) = docx_tag_attr(&segment, "<w:footnoteReference", "w:id") {
            block["footnoteId"] = json!(footnote_id);
        }
        if let Some(endnote_id) = docx_tag_attr(&segment, "<w:endnoteReference", "w:id") {
            block["endnoteId"] = json!(endnote_id);
        }
        let note_references = docx_note_references(&segment);
        if !note_references.is_empty() {
            block["noteReferences"] = json!(note_references);
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
    let styles_changed =
        add_docx_style_replacements(original, model.get("styles"), &mut replacements);
    let font_table_changed = add_docx_font_table_replacements(original, model, &mut replacements);
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
        || styles_changed
        || font_table_changed
    {
        if styles_changed {
            relationships = ensure_docx_part_relationship(
                &relationships,
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
                "styles.xml",
            );
            content_types = ensure_content_type_override(
                &content_types,
                "/word/styles.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
            );
        }
        if font_table_changed {
            relationships = ensure_docx_part_relationship(
                &relationships,
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable",
                "fontTable.xml",
            );
            content_types = ensure_content_type_override(
                &content_types,
                "/word/fontTable.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml",
            );
        }
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

#[cfg(test)]
mod tests;
