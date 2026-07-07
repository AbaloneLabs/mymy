//! Built-in document editor model conversion.
//!
//! The editor intentionally avoids external document services. Office files are
//! OOXML zip packages, so this module exposes a compact JSON editing model and
//! writes the edited model back by replacing the relevant XML parts while
//! preserving the rest of the package.

mod docx_comments;
mod docx_notes;
mod docx_numbering;
mod docx_page;
mod docx_relationships;
mod docx_tables;
mod docx_text_parts;
mod ooxml_images;
mod ooxml_package;
mod text_formats;
mod validation;
mod xml_utils;

use std::collections::BTreeMap;
use std::path::Path;

use base64::Engine as _;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::models::document_editor::{
    DocumentCompatibilityWarning, DocumentCompatibilityWarningSeverity, DocumentEditorKind,
    DocumentEditorModelResponse, WriteDocumentEditorModelRequest,
};
use crate::services::drive;
use crate::services::file_observations::fingerprint_path;
use crate::state::AppState;

use self::docx_comments::{add_docx_comment_replacements, docx_comments};
use self::docx_notes::{
    add_docx_note_replacements, docx_note_reference_run, docx_notes,
    docx_paragraph_needs_note_reference_rebuild, DOCX_ENDNOTE_PART, DOCX_FOOTNOTE_PART,
};
#[cfg(test)]
use self::docx_numbering::ensure_docx_basic_numbering_xml;
use self::docx_numbering::{
    add_docx_numbering_replacements, docx_blocks_have_lists, docx_list_kind,
    docx_numbering_formats, DOCX_BULLET_NUM_ID, DOCX_NUMBER_NUM_ID,
};
use self::docx_page::{docx_page_settings, update_docx_page_settings};
use self::docx_relationships::{
    add_docx_hyperlink_relationships, docx_empty_content_types, docx_empty_relationships,
    ensure_docx_part_relationship,
};
use self::docx_tables::{
    build_docx_table, parse_docx_table_border_color, parse_docx_table_border_size,
    parse_docx_table_cell_background, parse_docx_table_cell_vertical_align,
    parse_docx_table_column_widths, parse_docx_table_header_background,
    parse_docx_table_header_row, parse_docx_table_row_heights, parse_docx_table_rows,
    parse_docx_table_style,
};
use self::docx_text_parts::{add_docx_text_part_replacements, docx_text_parts};
use self::ooxml_images::{
    add_docx_image_replacements, build_docx_image_paragraph, decode_pptx_image_data_url,
    docx_image_block_from_segment, docx_image_relationship_id, docx_relationship_targets,
    next_pptx_media_path,
};
use self::ooxml_package::{read_zip_bytes, read_zip_text, replace_zip_entries, zip_entry_names};
#[cfg(test)]
use self::text_formats::parse_delimited;
use self::text_formats::{delimited_bytes, delimited_model, text_bytes, text_model};
use self::validation::validate_saved_document_bytes;
#[cfg(test)]
use self::validation::{validate_ooxml_package, validate_structured_text_for_path};
use self::xml_utils::{
    attr_value, escape_xml, extract_text_tags, find_xml_start, find_xml_tag_start, first_tag_text,
    remove_xml_named_elements, replace_empty_xml_element, replace_tag_texts, replace_xml_element,
    set_first_xml_tag_attrs, set_xml_attr, unescape_xml, xml_empty_elements,
    xml_first_empty_tag_attr, xml_has_named_empty_tag, xml_named_empty_elements,
    xml_named_segments, xml_named_start_tag, xml_segments,
};

const PPTX_SLIDE_WIDTH_EMU: f64 = 9_144_000.0;
const PPTX_SLIDE_HEIGHT_EMU: f64 = 5_143_500.0;

#[derive(Debug, Clone)]
struct PptxTextSpec {
    text: String,
    text_index: Option<usize>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rotation: f64,
    font_size: u32,
    font_family: Option<String>,
    color: Option<String>,
    fill_color: Option<String>,
    bold: bool,
    italic: bool,
    underline: bool,
    strikethrough: bool,
    align: Option<String>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum PptxShapeKind {
    Rect,
    Ellipse,
    Line,
}

impl PptxShapeKind {
    fn from_value(value: &str) -> Option<Self> {
        match value {
            "rect" => Some(Self::Rect),
            "ellipse" => Some(Self::Ellipse),
            "line" => Some(Self::Line),
            _ => None,
        }
    }

    fn as_value(self) -> &'static str {
        match self {
            Self::Rect => "rect",
            Self::Ellipse => "ellipse",
            Self::Line => "line",
        }
    }
}

#[derive(Debug, Clone)]
struct PptxShapeSpec {
    kind: PptxShapeKind,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rotation: f64,
    fill_color: Option<String>,
    stroke_color: Option<String>,
    stroke_width: f64,
}

#[derive(Debug, Clone)]
struct PptxTableSpec {
    text_index_start: Option<usize>,
    rows: Vec<Vec<String>>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rotation: f64,
}

#[derive(Debug, Clone)]
struct PptxImageSpec {
    relationship_id: Option<String>,
    data_url: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rotation: f64,
    alt_text: Option<String>,
}

#[derive(Debug, Clone)]
struct PptxChartSpec {
    relationship_id: Option<String>,
    path: Option<String>,
    title: Option<String>,
    series: Vec<PptxChartSeriesSpec>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rotation: f64,
}

#[derive(Debug, Clone)]
struct PptxChartSeriesSpec {
    name: Option<String>,
    categories: Vec<String>,
    values: Vec<String>,
}

#[derive(Debug, Clone)]
struct PptxTransitionSpec {
    kind: String,
    speed: Option<String>,
    direction: Option<String>,
    advance_on_click: bool,
    advance_after_ms: Option<u32>,
}

#[derive(Debug, Clone)]
struct PptxAnimationSpec {
    source_xml: Option<String>,
    delay_ms: Option<u32>,
    duration_ms: Option<u32>,
}

#[derive(Debug, Clone, Default)]
struct SheetCellWrite {
    value: String,
    formula: Option<String>,
    style: Option<XlsxCellStyle>,
    style_index: Option<usize>,
}

#[derive(Debug, Clone, Default)]
struct SheetRowWrite {
    height: Option<f64>,
    hidden: bool,
}

#[derive(Debug, Clone)]
struct SheetColumnWrite {
    index: u32,
    width: Option<f64>,
    hidden: bool,
}

#[derive(Debug, Clone, Default)]
struct SheetDataValidation {
    sqref: String,
    validation_type: Option<String>,
    operator: Option<String>,
    formula1: Option<String>,
    formula2: Option<String>,
    allow_blank: bool,
    show_input_message: bool,
    show_error_message: bool,
    prompt_title: Option<String>,
    prompt: Option<String>,
    error_title: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct SheetConditionalFormatting {
    sqref: String,
    rules: Vec<SheetConditionalRule>,
}

#[derive(Debug, Clone, Default)]
struct SheetConditionalRule {
    rule_type: Option<String>,
    operator: Option<String>,
    priority: Option<u32>,
    dxf_id: Option<usize>,
    fill_color: Option<String>,
    text: Option<String>,
    time_period: Option<String>,
    formulas: Vec<String>,
    source_xml: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct SheetProtection {
    enabled: bool,
    password: Option<String>,
    objects: bool,
    scenarios: bool,
    format_cells: bool,
    format_columns: bool,
    format_rows: bool,
    insert_columns: bool,
    insert_rows: bool,
    insert_hyperlinks: bool,
    delete_columns: bool,
    delete_rows: bool,
    sort: bool,
    auto_filter: bool,
    pivot_tables: bool,
}

#[derive(Debug, Clone, Default)]
struct SheetPageMargins {
    left: Option<f64>,
    right: Option<f64>,
    top: Option<f64>,
    bottom: Option<f64>,
    header: Option<f64>,
    footer: Option<f64>,
}

#[derive(Debug, Clone, Default)]
struct SheetPageSetup {
    orientation: Option<String>,
    paper_size: Option<u32>,
    scale: Option<u32>,
    fit_to_width: Option<u32>,
    fit_to_height: Option<u32>,
}

#[derive(Debug, Clone, Default)]
struct SheetHyperlink {
    reference: String,
    relationship_id: Option<String>,
    target: Option<String>,
    location: Option<String>,
    display: Option<String>,
    tooltip: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct SheetComment {
    reference: String,
    author: Option<String>,
    text: String,
}

#[derive(Debug, Clone, Default)]
struct XlsxSheetObjects {
    tables: Vec<Value>,
    charts: Vec<Value>,
    images: Vec<Value>,
    pivots: Vec<Value>,
}

#[derive(Debug, Clone, Default)]
struct SheetUpdate {
    cells: BTreeMap<String, SheetCellWrite>,
    rows: BTreeMap<u32, SheetRowWrite>,
    columns: Vec<SheetColumnWrite>,
    tab_color_xml: Option<String>,
    merged_ranges: Vec<String>,
    data_validations: Vec<SheetDataValidation>,
    conditional_formattings: Vec<SheetConditionalFormatting>,
    protection: Option<SheetProtection>,
    page_margins: Option<SheetPageMargins>,
    page_setup: Option<SheetPageSetup>,
    hyperlinks: Vec<SheetHyperlink>,
    comments: Option<Vec<SheetComment>>,
    auto_filter: Option<String>,
    frozen_rows: u32,
    frozen_columns: u32,
}

#[derive(Debug, Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
struct XlsxCellStyle {
    number_format: Option<String>,
    font_family: Option<String>,
    font_size: Option<String>,
    bold: bool,
    italic: bool,
    underline: bool,
    strikethrough: bool,
    color: Option<String>,
    fill_color: Option<String>,
    align: Option<String>,
    vertical_align: Option<String>,
    wrap_text: bool,
}

#[derive(Debug, Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
struct XlsxFontStyle {
    family: Option<String>,
    size: Option<String>,
    bold: bool,
    italic: bool,
    underline: bool,
    strikethrough: bool,
    color: Option<String>,
}

#[derive(Debug, Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
struct XlsxCellXf {
    num_fmt_id: u32,
    font_id: usize,
    fill_id: usize,
    align: Option<String>,
    vertical_align: Option<String>,
    wrap_text: bool,
}

#[derive(Debug, Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
struct XlsxDxfStyle {
    fill_color: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct XlsxParsedStyles {
    num_formats: BTreeMap<u32, String>,
    fonts: Vec<XlsxFontStyle>,
    fills: Vec<Option<String>>,
    dxfs: Vec<XlsxDxfStyle>,
    cell_xfs: Vec<XlsxCellXf>,
    cell_styles: Vec<XlsxCellStyle>,
}

#[derive(Debug, Clone)]
struct XlsxStyleWriter {
    xml: String,
    parsed: XlsxParsedStyles,
    font_keys: BTreeMap<XlsxFontStyle, usize>,
    fill_keys: BTreeMap<Option<String>, usize>,
    dxf_keys: BTreeMap<XlsxDxfStyle, usize>,
    num_format_keys: BTreeMap<String, u32>,
    cell_xf_keys: BTreeMap<XlsxCellXf, usize>,
    changed: bool,
}

#[derive(Debug, Clone)]
struct XlsxWorkbookSheetRef {
    path: String,
    name: String,
    sheet_id: u32,
    rel_id: String,
    state: Option<String>,
}

#[derive(Debug, Clone)]
struct XlsxWorkbookSheetWrite {
    path: String,
    name: String,
    state: Option<String>,
}

#[derive(Debug, Clone)]
struct XlsxTabColor {
    color: Option<String>,
    source_xml: String,
}

#[derive(Debug, Clone)]
struct PptxPresentationSlideRef {
    path: String,
    slide_id: usize,
    rel_id: String,
}

#[derive(Debug, Clone)]
struct PptxPresentationSlideWrite {
    path: String,
}

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

fn compatibility_warnings_for_bytes(
    kind: DocumentEditorKind,
    bytes: &[u8],
) -> Vec<DocumentCompatibilityWarning> {
    match kind {
        DocumentEditorKind::Docx => docx_compatibility_warnings(bytes),
        DocumentEditorKind::Xlsx => xlsx_compatibility_warnings(bytes),
        DocumentEditorKind::Pptx => pptx_compatibility_warnings(bytes),
        DocumentEditorKind::Markdown
        | DocumentEditorKind::Text
        | DocumentEditorKind::Csv
        | DocumentEditorKind::Tsv
        | DocumentEditorKind::Preview => Vec::new(),
    }
}

fn docx_compatibility_warnings(bytes: &[u8]) -> Vec<DocumentCompatibilityWarning> {
    let names = zip_entry_names(bytes).unwrap_or_default();
    let document = read_zip_text(bytes, "word/document.xml").unwrap_or_default();
    let mut warnings = Vec::new();
    push_warning_if(
        &mut warnings,
        document.contains("<w:drawing") || document.contains("<w:pict"),
        "docx-drawing",
        DocumentCompatibilityWarningSeverity::Warning,
        "Drawings and images are preserved in the document package.",
    );
    push_warning_if(
        &mut warnings,
        names
            .iter()
            .any(|name| name.starts_with("word/header") || name.starts_with("word/footer")),
        "docx-header-footer",
        DocumentCompatibilityWarningSeverity::Info,
        "Headers and footers are preserved in the document package.",
    );
    push_warning_if(
        &mut warnings,
        document.contains("<w:numPr") || names.iter().any(|name| name == "word/numbering.xml"),
        "docx-numbering",
        DocumentCompatibilityWarningSeverity::Info,
        "Lists and numbering are preserved in the document package.",
    );
    push_warning_if(
        &mut warnings,
        names.iter().any(|name| name == "word/comments.xml")
            || document.contains("<w:commentRangeStart"),
        "docx-comments",
        DocumentCompatibilityWarningSeverity::Info,
        "Comments and comment ranges are preserved in the document package.",
    );
    push_warning_if(
        &mut warnings,
        names
            .iter()
            .any(|name| name == "word/footnotes.xml" || name == "word/endnotes.xml"),
        "docx-notes",
        DocumentCompatibilityWarningSeverity::Info,
        "Footnotes and endnotes are preserved in the document package.",
    );
    push_warning_if(
        &mut warnings,
        document.contains("<w:ins") || document.contains("<w:del"),
        "docx-track-changes",
        DocumentCompatibilityWarningSeverity::Warning,
        "Tracked changes are preserved in the document package.",
    );
    push_warning_if(
        &mut warnings,
        document.contains("<w:sectPr"),
        "docx-section",
        DocumentCompatibilityWarningSeverity::Info,
        "Page sections and layout settings are preserved in the document package.",
    );
    warnings
}

fn xlsx_compatibility_warnings(bytes: &[u8]) -> Vec<DocumentCompatibilityWarning> {
    let names = zip_entry_names(bytes).unwrap_or_default();
    let sheet_xml = names
        .iter()
        .filter(|name| name.starts_with("xl/worksheets/") && name.ends_with(".xml"))
        .filter_map(|name| read_zip_text(bytes, name).ok())
        .collect::<Vec<_>>()
        .join("\n");
    let mut warnings = Vec::new();
    push_warning_if(
        &mut warnings,
        sheet_xml.contains("<f"),
        "xlsx-formulas",
        DocumentCompatibilityWarningSeverity::Info,
        "Formulas and cached values are preserved in the workbook package.",
    );
    push_warning_if(
        &mut warnings,
        names.iter().any(|name| name == "xl/styles.xml"),
        "xlsx-styles",
        DocumentCompatibilityWarningSeverity::Info,
        "Workbook styles are preserved in the workbook package.",
    );
    push_warning_if(
        &mut warnings,
        sheet_xml.contains("<mergeCells") || sheet_xml.contains("<mergeCell"),
        "xlsx-merged-cells",
        DocumentCompatibilityWarningSeverity::Info,
        "Merged cells are preserved in the workbook package.",
    );
    push_warning_if(
        &mut warnings,
        sheet_xml.contains("<conditionalFormatting"),
        "xlsx-conditional-formatting",
        DocumentCompatibilityWarningSeverity::Info,
        "Conditional formatting is preserved. Basic cell, text, formula, duplicate, and highlight rule editing is available.",
    );
    push_warning_if(
        &mut warnings,
        sheet_xml.contains("<dataValidations") || sheet_xml.contains("<dataValidation"),
        "xlsx-data-validation",
        DocumentCompatibilityWarningSeverity::Info,
        "Data validation rules are preserved. Basic range, list, numeric/date/time/text, custom formula, and message editing is available.",
    );
    push_warning_if(
        &mut warnings,
        sheet_xml.contains("<hyperlinks") || sheet_xml.contains("<hyperlink"),
        "xlsx-hyperlinks",
        DocumentCompatibilityWarningSeverity::Info,
        "Spreadsheet hyperlinks are preserved and can be edited for cell ranges.",
    );
    push_warning_if(
        &mut warnings,
        names.iter().any(|name| name.starts_with("xl/charts/")),
        "xlsx-charts",
        DocumentCompatibilityWarningSeverity::Info,
        "Charts and chart data are preserved in the workbook package.",
    );
    push_warning_if(
        &mut warnings,
        names.iter().any(|name| name.starts_with("xl/pivotTables/")),
        "xlsx-pivots",
        DocumentCompatibilityWarningSeverity::Info,
        "Pivot tables and pivot cache parts are preserved in the workbook package.",
    );
    push_warning_if(
        &mut warnings,
        names.iter().any(|name| name == "xl/vbaProject.bin"),
        "xlsx-macros",
        DocumentCompatibilityWarningSeverity::Danger,
        "This workbook contains macros. Macro parts are preserved in the workbook package.",
    );
    warnings
}

fn pptx_compatibility_warnings(bytes: &[u8]) -> Vec<DocumentCompatibilityWarning> {
    let names = zip_entry_names(bytes).unwrap_or_default();
    let slide_xml = names
        .iter()
        .filter(|name| name.starts_with("ppt/slides/") && name.ends_with(".xml"))
        .filter_map(|name| read_zip_text(bytes, name).ok())
        .collect::<Vec<_>>()
        .join("\n");
    let mut warnings = Vec::new();
    push_warning_if(
        &mut warnings,
        names.iter().any(|name| name.starts_with("ppt/media/")) || slide_xml.contains("<p:pic"),
        "pptx-media",
        DocumentCompatibilityWarningSeverity::Info,
        "Slide media parts are preserved in the presentation package.",
    );
    push_warning_if(
        &mut warnings,
        names.iter().any(|name| name.starts_with("ppt/charts/")),
        "pptx-charts",
        DocumentCompatibilityWarningSeverity::Info,
        "Charts and chart data are preserved in the presentation package.",
    );
    push_warning_if(
        &mut warnings,
        slide_xml.contains("<a:tbl"),
        "pptx-tables",
        DocumentCompatibilityWarningSeverity::Info,
        "Slide tables are preserved in the presentation package.",
    );
    push_warning_if(
        &mut warnings,
        names
            .iter()
            .any(|name| name.starts_with("ppt/notesSlides/")),
        "pptx-notes",
        DocumentCompatibilityWarningSeverity::Info,
        "Speaker notes are preserved in the presentation package.",
    );
    push_warning_if(
        &mut warnings,
        slide_xml.contains("<p:transition"),
        "pptx-transitions",
        DocumentCompatibilityWarningSeverity::Info,
        "Slide transitions are preserved in the presentation package.",
    );
    push_warning_if(
        &mut warnings,
        slide_xml.contains("<p:timing"),
        "pptx-animations",
        DocumentCompatibilityWarningSeverity::Info,
        "Animation timing nodes are preserved in the presentation package.",
    );
    push_warning_if(
        &mut warnings,
        slide_xml.contains("<p:grpSp"),
        "pptx-groups",
        DocumentCompatibilityWarningSeverity::Info,
        "Grouped shapes are preserved in the presentation package.",
    );
    warnings
}

fn push_warning_if(
    warnings: &mut Vec<DocumentCompatibilityWarning>,
    condition: bool,
    code: &str,
    severity: DocumentCompatibilityWarningSeverity,
    message: &str,
) {
    if condition {
        warnings.push(DocumentCompatibilityWarning {
            code: code.to_string(),
            severity,
            message: message.to_string(),
        });
    }
}

fn docx_model(bytes: &[u8]) -> AppResult<Value> {
    let document = read_zip_text(bytes, "word/document.xml")?;
    let rels = read_zip_text(bytes, "word/_rels/document.xml.rels").unwrap_or_default();
    let relationships = docx_relationship_targets(&rels);
    let numbering = read_zip_text(bytes, "word/numbering.xml").unwrap_or_default();
    let numbering_formats = docx_numbering_formats(&numbering);
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
            "bold": segment.contains("<w:b") || segment.contains("<w:b/>"),
            "italic": segment.contains("<w:i") || segment.contains("<w:i/>"),
            "underline": segment.contains("<w:u"),
            "strikethrough": segment.contains("<w:strike"),
            "verticalAlign": docx_vertical_align(&segment),
            "fontFamily": docx_tag_attr(&segment, "<w:rFonts", "w:ascii"),
            "fontSize": docx_font_size(&segment),
            "color": docx_tag_attr(&segment, "<w:color", "w:val")
                .and_then(|color| docx_hex_color(&color))
                .map(|color| format!("#{color}")),
            "highlight": docx_tag_attr(&segment, "<w:highlight", "w:val"),
            "align": docx_alignment(&segment),
            "listKind": docx_list_kind(&segment, &numbering_formats),
            "indentLeft": docx_u32_attr(&segment, "<w:ind", "w:left"),
            "spacingBefore": docx_u32_attr(&segment, "<w:spacing", "w:before"),
            "spacingAfter": docx_u32_attr(&segment, "<w:spacing", "w:after"),
            "lineSpacing": docx_u32_attr(&segment, "<w:spacing", "w:line"),
            "pageBreakBefore": segment.contains("<w:pageBreakBefore")
        });
        if let Some(relationship_id) = relationship_id {
            block["relationshipId"] = json!(relationship_id);
        }
        if let Some(target) = hyperlink_target {
            block["target"] = json!(target);
        }
        if let Some(footnote_id) = docx_tag_attr(&segment, "<w:footnoteReference", "w:id") {
            block["footnoteId"] = json!(footnote_id);
        }
        if let Some(endnote_id) = docx_tag_attr(&segment, "<w:endnoteReference", "w:id") {
            block["endnoteId"] = json!(endnote_id);
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
        "endnotes": docx_notes(bytes, "word/endnotes.xml", "w:endnote", "endnote")
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
    let document = read_zip_text(original, "word/document.xml")?;
    let document = replace_docx_blocks(&document, &blocks);
    let document = update_docx_page_settings(&document, model.get("page"));
    let document = ensure_docx_relationship_namespace(&document);
    replacements.push(("word/document.xml".to_string(), document.into_bytes()));
    add_docx_text_part_replacements(original, model.get("headers"), "header", &mut replacements);
    add_docx_text_part_replacements(original, model.get("footers"), "footer", &mut replacements);
    add_docx_comment_replacements(original, model.get("comments"), &mut replacements);
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
    let numbering_changed = if docx_blocks_have_lists(&blocks) {
        add_docx_numbering_replacements(
            original,
            &mut relationships,
            &mut content_types,
            &mut replacements,
        );
        true
    } else {
        false
    };
    if manifest_changed
        || numbering_changed
        || hyperlinks_changed
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

fn ensure_content_type_default(content_types: &str, extension: &str, content_type: &str) -> String {
    if content_types.contains(&format!(r#"Extension="{extension}""#)) {
        return content_types.to_string();
    }
    append_before_or_end(
        content_types,
        "</Types>",
        &format!(r#"<Default Extension="{extension}" ContentType="{content_type}"/>"#),
    )
}

fn ensure_content_type_override(
    content_types: &str,
    part_name: &str,
    content_type: &str,
) -> String {
    if content_types.contains(&format!(r#"PartName="{part_name}""#)) {
        return content_types.to_string();
    }
    append_before_or_end(
        content_types,
        "</Types>",
        &format!(r#"<Override PartName="{part_name}" ContentType="{content_type}"/>"#),
    )
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

fn docx_vertical_align(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:vertAlign", "w:val")
        .filter(|value| matches!(value.as_str(), "superscript" | "subscript"))
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

fn xlsx_model(bytes: &[u8]) -> AppResult<Value> {
    let strings = read_shared_strings(bytes).unwrap_or_default();
    let styles = read_zip_text(bytes, "xl/styles.xml")
        .ok()
        .map(|xml| xlsx_styles_from_xml(&xml));
    let workbook_xml = read_zip_text(bytes, "xl/workbook.xml").ok();
    let defined_names = workbook_xml
        .as_deref()
        .map(parse_xlsx_defined_names)
        .unwrap_or_default();
    let workbook_sheets = xlsx_workbook_sheets(bytes).unwrap_or_default();
    if !workbook_sheets.is_empty() {
        let sheets = workbook_sheets
            .into_iter()
            .filter_map(|sheet| {
                let xml = read_zip_text(bytes, &sheet.path).ok()?;
                let tab_color = parse_sheet_tab_color(&xml);
                let sheet_rels = read_zip_text(bytes, &xlsx_worksheet_rels_path(&sheet.path)).ok();
                let hyperlink_targets = sheet_rels
                    .as_deref()
                    .map(xlsx_hyperlink_relationship_targets)
                    .unwrap_or_default();
                let comments = sheet_rels
                    .as_deref()
                    .and_then(|rels| xlsx_relationship_target_by_type(&sheet.path, rels, "/comments"))
                    .and_then(|path| read_zip_text(bytes, &path).ok())
                    .map(|comments_xml| parse_sheet_comments(&comments_xml))
                    .unwrap_or_default();
                let objects = parse_xlsx_sheet_objects(bytes, &sheet.path, &xml, sheet_rels.as_deref());
                let mut item = json!({
                    "id": sheet.path,
                    "name": sheet.name,
                    "state": sheet.state.unwrap_or_else(|| "visible".to_string()),
                    "columns": parse_sheet_columns(&xml),
                    "mergedRanges": parse_sheet_merged_ranges(&xml),
                    "dataValidations": parse_sheet_data_validations(&xml),
                    "conditionalFormattings": parse_sheet_conditional_formattings(&xml, styles.as_ref()),
                    "protection": parse_sheet_protection(&xml),
                    "pageMargins": parse_sheet_page_margins(&xml),
                    "pageSetup": parse_sheet_page_setup(&xml),
                    "hyperlinks": parse_sheet_hyperlinks(&xml, &hyperlink_targets),
                    "comments": comments,
                    "tables": objects.tables,
                    "charts": objects.charts,
                    "images": objects.images,
                    "pivots": objects.pivots,
                    "autoFilter": parse_sheet_auto_filter(&xml),
                    "frozenRows": parse_sheet_frozen_pane(&xml).0,
                    "frozenColumns": parse_sheet_frozen_pane(&xml).1,
                    "rows": parse_sheet_rows(&xml, &strings, styles.as_ref())
                });
                if let Some(tab_color) = tab_color {
                    if let Some(color) = tab_color.color {
                        item["tabColor"] = json!(format!("#{color}"));
                    }
                    item["tabColorSourceXml"] = json!(tab_color.source_xml);
                }
                Some(item)
            })
            .collect::<Vec<_>>();
        return Ok(json!({ "sheets": sheets, "definedNames": defined_names }));
    }

    let mut sheets = Vec::new();
    for name in zip_entry_names(bytes)? {
        if !(name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml")) {
            continue;
        }
        let xml = read_zip_text(bytes, &name)?;
        let tab_color = parse_sheet_tab_color(&xml);
        let sheet_rels = read_zip_text(bytes, &xlsx_worksheet_rels_path(&name)).ok();
        let hyperlink_targets = sheet_rels
            .as_deref()
            .map(xlsx_hyperlink_relationship_targets)
            .unwrap_or_default();
        let comments = sheet_rels
            .as_deref()
            .and_then(|rels| xlsx_relationship_target_by_type(&name, rels, "/comments"))
            .and_then(|path| read_zip_text(bytes, &path).ok())
            .map(|comments_xml| parse_sheet_comments(&comments_xml))
            .unwrap_or_default();
        let objects = parse_xlsx_sheet_objects(bytes, &name, &xml, sheet_rels.as_deref());
        let mut item = json!({
            "id": name,
            "name": name.rsplit('/').next().unwrap_or(&name),
            "state": "visible",
            "columns": parse_sheet_columns(&xml),
            "mergedRanges": parse_sheet_merged_ranges(&xml),
            "dataValidations": parse_sheet_data_validations(&xml),
            "conditionalFormattings": parse_sheet_conditional_formattings(&xml, styles.as_ref()),
            "protection": parse_sheet_protection(&xml),
            "pageMargins": parse_sheet_page_margins(&xml),
            "pageSetup": parse_sheet_page_setup(&xml),
            "hyperlinks": parse_sheet_hyperlinks(&xml, &hyperlink_targets),
            "comments": comments,
            "tables": objects.tables,
            "charts": objects.charts,
            "images": objects.images,
            "pivots": objects.pivots,
            "autoFilter": parse_sheet_auto_filter(&xml),
            "frozenRows": parse_sheet_frozen_pane(&xml).0,
            "frozenColumns": parse_sheet_frozen_pane(&xml).1,
            "rows": parse_sheet_rows(&xml, &strings, styles.as_ref())
        });
        if let Some(tab_color) = tab_color {
            if let Some(color) = tab_color.color {
                item["tabColor"] = json!(format!("#{color}"));
            }
            item["tabColorSourceXml"] = json!(tab_color.source_xml);
        }
        sheets.push(item);
    }
    Ok(json!({ "sheets": sheets, "definedNames": defined_names }))
}

fn update_xlsx(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let sheets = model
        .get("sheets")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("XLSX model requires sheets".into()))?;
    let original_refs = xlsx_workbook_sheets(original).unwrap_or_default();
    let sheet_writes = xlsx_sheet_writes(sheets, &original_refs);
    let mut style_writer = XlsxStyleWriter::new(read_zip_text(original, "xl/styles.xml").ok());
    let mut replacements = Vec::new();
    let existing_names = zip_entry_names(original).unwrap_or_default();
    let mut comments_content_types = Vec::new();
    let mut needs_vml_content_type = false;
    let workbook_has_formulas = xlsx_model_has_formulas(sheets);
    for (sheet, sheet_write) in sheets.iter().zip(sheet_writes.iter()) {
        let Some(rows) = sheet.get("rows").and_then(Value::as_array) else {
            continue;
        };
        let original_xml = read_zip_text(original, &sheet_write.path).unwrap_or_default();
        let rels_path = xlsx_worksheet_rels_path(&sheet_write.path);
        let original_rels = read_zip_text(original, &rels_path).ok();
        let mut update = sheet_update_from_model(sheet, rows);
        style_writer.assign_sheet_styles(&mut update);
        let mut rels_replacement = original_rels.clone();
        if let Some(updated_rels) =
            update_sheet_hyperlink_relationships(rels_replacement.as_deref(), &mut update)
        {
            rels_replacement = Some(updated_rels);
        }
        let mut updated_xml = if original_xml.is_empty() {
            build_xlsx_worksheet(&update)
        } else {
            update_xlsx_worksheet(&original_xml, &update)
        };
        if let Some(comments) = update.comments.as_ref() {
            if let Some(legacy_drawing_id) = update_sheet_comments_package(
                &sheet_write.path,
                &mut rels_replacement,
                comments,
                &existing_names,
                &mut replacements,
                &mut comments_content_types,
                &mut needs_vml_content_type,
            ) {
                updated_xml =
                    update_sheet_legacy_drawing(&updated_xml, Some(legacy_drawing_id.as_str()));
            } else if comments.is_empty() {
                updated_xml = update_sheet_legacy_drawing(&updated_xml, None);
            }
        }
        add_xlsx_table_replacements(original, sheet, &mut replacements);
        add_xlsx_chart_replacements(original, sheet, &mut replacements);
        add_xlsx_pivot_replacements(original, sheet, &mut replacements);
        if rels_replacement != original_rels {
            if let Some(updated_rels) = rels_replacement {
                replacements.push((rels_path, updated_rels.into_bytes()));
            }
        }
        replacements.push((sheet_write.path.clone(), updated_xml.into_bytes()));
    }
    if style_writer.changed {
        replacements.push((
            "xl/styles.xml".to_string(),
            style_writer.xml.clone().into_bytes(),
        ));
    }
    if let (Ok(workbook), Ok(rels), Ok(content_types)) = (
        read_zip_text(original, "xl/workbook.xml"),
        read_zip_text(original, "xl/_rels/workbook.xml.rels"),
        read_zip_text(original, "[Content_Types].xml"),
    ) {
        let rels = if style_writer.changed {
            ensure_xlsx_styles_relationship(&rels)
        } else {
            rels
        };
        let content_types = if style_writer.changed {
            ensure_xlsx_styles_content_type(&content_types)
        } else {
            content_types
        };
        let content_types = ensure_xlsx_comments_content_types(
            &content_types,
            &comments_content_types,
            needs_vml_content_type,
        );
        let (workbook, rels) = update_xlsx_workbook_manifest(&workbook, &rels, &sheet_writes);
        let workbook = update_xlsx_defined_names(
            &workbook,
            model.get("definedNames").and_then(Value::as_array),
        );
        let workbook = if workbook_has_formulas {
            update_xlsx_workbook_calc_properties(&workbook)
        } else {
            workbook
        };
        let content_types = append_xlsx_sheet_content_types(&content_types, &sheet_writes);
        replacements.push(("xl/workbook.xml".to_string(), workbook.into_bytes()));
        replacements.push(("xl/_rels/workbook.xml.rels".to_string(), rels.into_bytes()));
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

fn pptx_model(bytes: &[u8]) -> AppResult<Value> {
    let mut slides = Vec::new();
    for name in zip_entry_names(bytes)? {
        if !(name.starts_with("ppt/slides/slide") && name.ends_with(".xml")) {
            continue;
        }
        let xml = read_zip_text(bytes, &name)?;
        let mut texts = pptx_shape_texts(&xml);
        if texts.is_empty() {
            texts = extract_text_tags(&xml, "a:t")
                .into_iter()
                .enumerate()
                .map(|(text_index, text)| {
                    json!({
                        "id": format!("t{}", text_index + 1),
                        "text": text
                    })
                })
                .collect::<Vec<_>>();
        }
        slides.push(json!({
            "id": name,
            "name": name.rsplit('/').next().unwrap_or(&name),
            "backgroundColor": pptx_slide_background_color(&xml).map(|color| format!("#{color}")),
            "notes": pptx_slide_notes(bytes, &name).unwrap_or_default(),
            "texts": texts,
            "shapes": pptx_slide_shapes(&xml),
            "tables": pptx_slide_tables(&xml),
            "images": pptx_slide_images(bytes, &name, &xml),
            "charts": pptx_slide_charts(bytes, &name, &xml),
            "transition": pptx_slide_transition(&xml),
            "animations": pptx_slide_animations(&xml),
            "animationTimingSourceXml": pptx_slide_timing(&xml),
            "hidden": pptx_slide_hidden(&xml)
        }));
    }
    Ok(json!({ "slides": slides }))
}

fn pptx_slide_notes(bytes: &[u8], slide_path: &str) -> Option<String> {
    let notes_path = pptx_slide_notes_path(bytes, slide_path)?;
    let notes_xml = read_zip_text(bytes, &notes_path).ok()?;
    let notes = extract_text_tags(&notes_xml, "a:t")
        .into_iter()
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Some(notes)
}

fn pptx_slide_notes_path(bytes: &[u8], slide_path: &str) -> Option<String> {
    let rels = read_zip_text(bytes, &xlsx_part_rels_path(slide_path)).ok()?;
    pptx_slide_notes_path_from_rels(slide_path, &rels)
}

fn pptx_slide_notes_path_from_rels(slide_path: &str, rels: &str) -> Option<String> {
    xlsx_relationships_by_id(slide_path, rels)
        .into_iter()
        .find_map(|(_, (relationship_type, target))| {
            relationship_type.ends_with("/notesSlide").then_some(target)
        })
}

fn update_pptx(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let slides = model
        .get("slides")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("PPTX model requires slides".into()))?;
    let original_refs = pptx_presentation_slides(original).unwrap_or_default();
    let slide_writes = pptx_slide_writes(slides, &original_refs);
    let mut replacements = Vec::new();
    let mut existing_names = zip_entry_names(original).unwrap_or_default();
    let mut added_note_paths = Vec::new();
    let mut content_types = if slide_writes.is_empty() {
        None
    } else {
        Some(read_zip_text(original, "[Content_Types].xml")?)
    };
    for (slide, slide_write) in slides.iter().zip(slide_writes.iter()) {
        let text_specs = pptx_text_specs(slide);
        let shape_specs = pptx_shape_specs(slide);
        let table_specs = pptx_table_specs(slide);
        let mut image_specs = pptx_image_specs(slide);
        let mut chart_specs = pptx_chart_specs(slide);
        let animation_specs = pptx_animation_specs(slide);
        let image_model_controls_slide = slide.get("images").is_some();
        let chart_model_controls_slide = slide.get("charts").is_some();
        let animation_model_controls_slide =
            slide.get("animations").is_some() || slide.get("animationTimingSourceXml").is_some();
        let transition_spec = pptx_transition_spec(slide);
        let hidden = slide.get("hidden").and_then(Value::as_bool);
        let background_color = slide
            .get("backgroundColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color);
        if let Some(content_types) = content_types.as_mut() {
            add_pptx_image_replacements(
                original,
                &slide_write.path,
                &mut image_specs,
                &mut existing_names,
                content_types,
                &mut replacements,
            )?;
            add_pptx_chart_clone_replacements(
                original,
                &slide_write.path,
                &mut chart_specs,
                &mut existing_names,
                content_types,
                &mut replacements,
            )?;
        }
        let Ok(original_xml) = read_zip_text(original, &slide_write.path) else {
            let mut slide_xml = build_pptx_slide(
                &text_specs,
                &shape_specs,
                &table_specs,
                &image_specs,
                background_color.as_deref(),
            );
            slide_xml = update_pptx_charts(&slide_xml, &chart_specs, chart_model_controls_slide);
            replacements.push((slide_write.path.clone(), slide_xml.into_bytes()));
            add_pptx_notes_replacement(
                original,
                slide,
                &slide_write.path,
                &mut existing_names,
                &mut added_note_paths,
                &mut replacements,
            )?;
            continue;
        };
        let original_text_count = pptx_shape_texts(&original_xml).len();
        let mut texts = extract_text_tags(&original_xml, "a:t");
        apply_pptx_text_replacements(&mut texts, &text_specs);
        apply_pptx_table_replacements(&mut texts, &table_specs);
        let mut updated = replace_tag_texts(&original_xml, "a:t", &texts);
        updated = update_pptx_shape_geometries(&updated, &text_specs);
        if text_specs.len() > original_text_count {
            updated = insert_pptx_text_shapes(&updated, &text_specs[original_text_count..]);
        }
        updated = replace_pptx_basic_shapes(&updated, &shape_specs);
        updated = update_pptx_tables(&updated, &table_specs, slide.get("tables").is_some());
        updated = update_pptx_images(&updated, &image_specs, image_model_controls_slide);
        updated = update_pptx_charts(&updated, &chart_specs, chart_model_controls_slide);
        updated = update_pptx_transition(&updated, transition_spec.as_ref());
        updated = update_pptx_animations(
            &updated,
            &animation_specs,
            slide
                .get("animationTimingSourceXml")
                .and_then(Value::as_str),
            animation_model_controls_slide,
        );
        updated = update_pptx_slide_visibility(&updated, hidden);
        updated = update_pptx_slide_background(&updated, background_color.as_deref());
        replacements.push((slide_write.path.clone(), updated.into_bytes()));
        add_pptx_chart_replacements(original, &slide_write.path, &chart_specs, &mut replacements);
        add_pptx_notes_replacement(
            original,
            slide,
            &slide_write.path,
            &mut existing_names,
            &mut added_note_paths,
            &mut replacements,
        )?;
    }
    if !slide_writes.is_empty() {
        let presentation = read_zip_text(original, "ppt/presentation.xml")?;
        let rels = read_zip_text(original, "ppt/_rels/presentation.xml.rels")?;
        let content_types = content_types.unwrap_or_default();
        let (presentation, rels) =
            update_pptx_presentation_manifest(&presentation, &rels, &slide_writes);
        let content_types =
            append_pptx_slide_content_types_for_writes(&content_types, &slide_writes);
        let content_types = append_pptx_notes_content_types(&content_types, &added_note_paths);
        replacements.push((
            "ppt/presentation.xml".to_string(),
            presentation.into_bytes(),
        ));
        replacements.push((
            "ppt/_rels/presentation.xml.rels".to_string(),
            rels.into_bytes(),
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

fn add_pptx_image_replacements(
    original: &[u8],
    slide_path: &str,
    images: &mut [PptxImageSpec],
    existing_names: &mut Vec<String>,
    content_types: &mut String,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> AppResult<()> {
    if images.iter().all(|image| {
        image
            .relationship_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
    }) {
        return Ok(());
    }
    let rels_path = xlsx_part_rels_path(slide_path);
    let mut rels = replacement_zip_text_or_default(
        original,
        replacements,
        &rels_path,
        xlsx_empty_relationships,
    );
    let mut next_relationship_id = next_rid(&rels);
    let mut rels_changed = false;
    for image in images.iter_mut() {
        if image
            .relationship_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
        {
            continue;
        }
        let Some(data_url) = image.data_url.as_deref() else {
            return Err(AppError::BadRequest(
                "Inserted PPTX image requires a data URL".into(),
            ));
        };
        let image_data = decode_pptx_image_data_url(data_url)?;
        let media_path = next_pptx_media_path(existing_names, image_data.extension);
        existing_names.push(media_path.clone());
        let relationship_id = format!("rId{next_relationship_id}");
        next_relationship_id += 1;
        let relationship = format!(
            r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{}"/>"#,
            escape_xml(&pptx_slide_relationship_target(&media_path))
        );
        rels = append_before_or_end(&rels, "</Relationships>", &relationship);
        *content_types =
            ensure_content_type_default(content_types, image_data.extension, image_data.mime_type);
        image.relationship_id = Some(relationship_id);
        replacements.push((media_path, image_data.bytes));
        rels_changed = true;
    }
    if rels_changed {
        upsert_zip_replacement(replacements, rels_path, rels.into_bytes());
    }
    Ok(())
}

fn add_pptx_chart_clone_replacements(
    original: &[u8],
    slide_path: &str,
    charts: &mut [PptxChartSpec],
    existing_names: &mut Vec<String>,
    content_types: &mut String,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> AppResult<()> {
    if charts.iter().all(|chart| {
        chart
            .relationship_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
    }) {
        return Ok(());
    }
    let rels_path = xlsx_part_rels_path(slide_path);
    let mut rels = replacement_zip_text_or_default(
        original,
        replacements,
        &rels_path,
        xlsx_empty_relationships,
    );
    let mut next_relationship_id = next_rid(&rels);
    let mut rels_changed = false;
    for chart in charts.iter_mut() {
        if chart
            .relationship_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
        {
            continue;
        }
        let Some(source_path) = chart
            .path
            .as_deref()
            .filter(|path| valid_pptx_chart_path(path))
        else {
            continue;
        };
        let chart_xml =
            replacement_zip_text_or_default(original, replacements, source_path, String::new);
        if chart_xml.trim().is_empty() {
            continue;
        }
        let chart_path = next_pptx_chart_path(existing_names);
        existing_names.push(chart_path.clone());
        let relationship_id = format!("rId{next_relationship_id}");
        next_relationship_id += 1;
        let relationship = format!(
            r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="{}"/>"#,
            escape_xml(&pptx_slide_relationship_target(&chart_path))
        );
        rels = append_before_or_end(&rels, "</Relationships>", &relationship);
        *content_types = ensure_content_type_override(
            content_types,
            &format!("/{}", chart_path),
            "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
        );
        chart.relationship_id = Some(relationship_id);
        chart.path = Some(chart_path.clone());
        replacements.push((chart_path, chart_xml.into_bytes()));
        rels_changed = true;
    }
    if rels_changed {
        upsert_zip_replacement(replacements, rels_path, rels.into_bytes());
    }
    Ok(())
}

fn add_pptx_notes_replacement(
    original: &[u8],
    slide: &Value,
    slide_path: &str,
    existing_names: &mut Vec<String>,
    added_note_paths: &mut Vec<String>,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> AppResult<()> {
    let Some(notes) = slide.get("notes").and_then(Value::as_str) else {
        return Ok(());
    };
    let rels_path = xlsx_part_rels_path(slide_path);
    let rels = replacement_zip_text_or_default(
        original,
        replacements,
        &rels_path,
        xlsx_empty_relationships,
    );
    if let Some(notes_path) = pptx_slide_notes_path_from_rels(slide_path, &rels) {
        let notes_xml =
            read_zip_text(original, &notes_path).unwrap_or_else(|_| build_pptx_notes(""));
        replacements.push((
            notes_path,
            update_pptx_notes_xml(&notes_xml, notes).into_bytes(),
        ));
        return Ok(());
    }
    if notes.trim().is_empty() {
        return Ok(());
    }
    let notes_path = next_pptx_notes_path(existing_names);
    existing_names.push(notes_path.clone());
    added_note_paths.push(notes_path.clone());
    let relationship_id = format!("rId{}", next_rid(&rels));
    let target = pptx_slide_relationship_target(&notes_path);
    let relationship = format!(
        r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="{}"/>"#,
        escape_xml(&target)
    );
    let rels = append_before_or_end(&rels, "</Relationships>", &relationship);
    upsert_zip_replacement(replacements, rels_path, rels.into_bytes());
    replacements.push((notes_path, build_pptx_notes(notes).into_bytes()));
    Ok(())
}

fn update_pptx_notes_xml(xml: &str, notes: &str) -> String {
    if xml.contains("<a:t") {
        return replace_tag_texts(xml, "a:t", &[notes.to_string()]);
    }
    build_pptx_notes(notes)
}

fn build_pptx_notes(notes: &str) -> String {
    let paragraphs = notes
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(|line| format!(r#"<a:p><a:r><a:t>{}</a:t></a:r></a:p>"#, escape_xml(line)))
        .collect::<Vec<_>>()
        .join("");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"#
    )
}

fn next_pptx_notes_path(existing_names: &[String]) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("ppt/notesSlides/notesSlide{index}.xml");
        if !existing_names.iter().any(|name| name == &path) {
            return path;
        }
        index += 1;
    }
}

fn next_pptx_chart_path(existing_names: &[String]) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("ppt/charts/mymy-chart-{index}.xml");
        if !existing_names.iter().any(|name| name == &path) {
            return path;
        }
        index += 1;
    }
}

fn valid_pptx_chart_path(path: &str) -> bool {
    path.starts_with("ppt/charts/") && path.ends_with(".xml") && !path.contains("..")
}

fn pptx_slide_relationship_target(target_path: &str) -> String {
    if target_path.starts_with("ppt/") {
        format!("../{}", target_path.trim_start_matches("ppt/"))
    } else {
        target_path.to_string()
    }
}

fn parse_sheet_rows(
    xml: &str,
    shared_strings: &[String],
    styles: Option<&XlsxParsedStyles>,
) -> Vec<Value> {
    let mut rows = Vec::new();
    for row_xml in xml_segments(xml, "<row", "</row>") {
        let row_ref = attr_value(&row_xml, "r").unwrap_or_default();
        let height = attr_value(&row_xml, "ht").and_then(|value| value.parse::<f64>().ok());
        let hidden = attr_value(&row_xml, "hidden")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let cells = xml_segments(&row_xml, "<c", "</c>")
            .into_iter()
            .map(|cell| {
                let reference = attr_value(&cell, "r").unwrap_or_default();
                let cell_type = attr_value(&cell, "t").unwrap_or_default();
                let style_index =
                    attr_value(&cell, "s").and_then(|value| value.parse::<usize>().ok());
                let formula = first_tag_text(&cell, "f");
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
                let mut cell_json = json!({ "ref": reference, "value": value });
                if let Some(formula) = formula {
                    cell_json["formula"] = json!(formula);
                }
                if let Some(style) = style_index
                    .and_then(|index| styles.and_then(|styles| styles.cell_styles.get(index)))
                {
                    append_xlsx_style_to_cell_json(&mut cell_json, style);
                }
                cell_json
            })
            .collect::<Vec<_>>();
        let mut row = json!({ "index": row_ref, "cells": cells });
        if let Some(height) = height {
            row["height"] = json!(height);
        }
        if hidden {
            row["hidden"] = json!(true);
        }
        rows.push(row);
    }
    rows
}

fn parse_sheet_columns(xml: &str) -> Vec<Value> {
    let mut columns = Vec::new();
    for column_xml in xml_empty_elements(xml, "<col ") {
        let Some(min) = attr_value(&column_xml, "min").and_then(|value| value.parse::<u32>().ok())
        else {
            continue;
        };
        let max = attr_value(&column_xml, "max")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(min);
        let width = attr_value(&column_xml, "width").and_then(|value| value.parse::<f64>().ok());
        let hidden = attr_value(&column_xml, "hidden")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        for index in min..=max {
            let mut column = json!({ "index": index.saturating_sub(1) });
            if let Some(width) = width {
                column["width"] = json!(width);
            }
            if hidden {
                column["hidden"] = json!(true);
            }
            columns.push(column);
        }
    }
    columns
}

fn parse_sheet_tab_color(xml: &str) -> Option<XlsxTabColor> {
    let sheet_pr = xml_named_segments(xml, "sheetPr")
        .into_iter()
        .next()
        .or_else(|| xml_named_empty_elements(xml, "sheetPr").into_iter().next())?;
    let source_xml = xml_named_empty_elements(&sheet_pr, "tabColor")
        .into_iter()
        .chain(xml_named_segments(&sheet_pr, "tabColor"))
        .next()?;
    let color = attr_value(&source_xml, "rgb").and_then(|value| xlsx_hex_color(&value));
    Some(XlsxTabColor { color, source_xml })
}

fn parse_sheet_merged_ranges(xml: &str) -> Vec<Value> {
    xml_empty_elements(xml, "<mergeCell ")
        .into_iter()
        .filter_map(|merge| attr_value(&merge, "ref"))
        .map(|reference| json!({ "ref": reference }))
        .collect()
}

fn parse_sheet_data_validations(xml: &str) -> Vec<Value> {
    xml_named_segments(xml, "dataValidation")
        .into_iter()
        .chain(xml_named_empty_elements(xml, "dataValidation"))
        .filter_map(|validation| {
            let sqref = attr_value(&validation, "sqref")?;
            let mut item = json!({ "sqref": sqref });
            if let Some(validation_type) = attr_value(&validation, "type") {
                item["type"] = json!(validation_type);
            }
            if let Some(operator) = attr_value(&validation, "operator") {
                item["operator"] = json!(operator);
            }
            if let Some(formula1) = first_tag_text(&validation, "formula1") {
                item["formula1"] = json!(formula1);
            }
            if let Some(formula2) = first_tag_text(&validation, "formula2") {
                item["formula2"] = json!(formula2);
            }
            if xml_bool_attr(&validation, "allowBlank") {
                item["allowBlank"] = json!(true);
            }
            if xml_bool_attr(&validation, "showInputMessage") {
                item["showInputMessage"] = json!(true);
            }
            if xml_bool_attr(&validation, "showErrorMessage") {
                item["showErrorMessage"] = json!(true);
            }
            if let Some(prompt_title) = attr_value(&validation, "promptTitle") {
                item["promptTitle"] = json!(unescape_xml(&prompt_title));
            }
            if let Some(prompt) = attr_value(&validation, "prompt") {
                item["prompt"] = json!(unescape_xml(&prompt));
            }
            if let Some(error_title) = attr_value(&validation, "errorTitle") {
                item["errorTitle"] = json!(unescape_xml(&error_title));
            }
            if let Some(error) = attr_value(&validation, "error") {
                item["error"] = json!(unescape_xml(&error));
            }
            Some(item)
        })
        .collect()
}

fn parse_sheet_conditional_formattings(xml: &str, styles: Option<&XlsxParsedStyles>) -> Vec<Value> {
    xml_named_segments(xml, "conditionalFormatting")
        .into_iter()
        .filter_map(|formatting| {
            let sqref = attr_value(&formatting, "sqref")?;
            let rules = xml_named_segments(&formatting, "cfRule")
                .into_iter()
                .chain(xml_named_empty_elements(&formatting, "cfRule"))
                .filter_map(|rule| parse_sheet_conditional_rule(&rule, styles))
                .collect::<Vec<_>>();
            if rules.is_empty() {
                return None;
            }
            Some(json!({
                "sqref": sqref,
                "rules": rules
            }))
        })
        .collect()
}

fn parse_sheet_conditional_rule(rule: &str, styles: Option<&XlsxParsedStyles>) -> Option<Value> {
    let mut item = json!({ "sourceXml": rule });
    if let Some(rule_type) = attr_value(rule, "type") {
        item["type"] = json!(rule_type);
    }
    if let Some(operator) = attr_value(rule, "operator") {
        item["operator"] = json!(operator);
    }
    if let Some(priority) = attr_value(rule, "priority").and_then(|value| value.parse::<u32>().ok())
    {
        item["priority"] = json!(priority);
    }
    if let Some(dxf_id) = attr_value(rule, "dxfId").and_then(|value| value.parse::<usize>().ok()) {
        item["dxfId"] = json!(dxf_id);
        if let Some(fill_color) = styles
            .and_then(|styles| styles.dxfs.get(dxf_id))
            .and_then(|dxf| dxf.fill_color.as_ref())
        {
            item["fillColor"] = json!(format!("#{fill_color}"));
        }
    }
    if let Some(text) = attr_value(rule, "text") {
        item["text"] = json!(unescape_xml(&text));
    }
    if let Some(time_period) = attr_value(rule, "timePeriod") {
        item["timePeriod"] = json!(time_period);
    }
    let formulas = extract_text_tags(rule, "formula");
    if !formulas.is_empty() {
        item["formulas"] = json!(formulas);
    }
    Some(item)
}

fn parse_sheet_protection(xml: &str) -> Option<Value> {
    let protection = xml_named_empty_elements(xml, "sheetProtection")
        .into_iter()
        .chain(xml_named_segments(xml, "sheetProtection"))
        .next()?;
    let mut item = json!({
        "enabled": attr_value(&protection, "sheet")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(true)
    });
    if let Some(password) = attr_value(&protection, "password") {
        item["password"] = json!(password);
    }
    for (json_key, xml_key) in [
        ("objects", "objects"),
        ("scenarios", "scenarios"),
        ("formatCells", "formatCells"),
        ("formatColumns", "formatColumns"),
        ("formatRows", "formatRows"),
        ("insertColumns", "insertColumns"),
        ("insertRows", "insertRows"),
        ("insertHyperlinks", "insertHyperlinks"),
        ("deleteColumns", "deleteColumns"),
        ("deleteRows", "deleteRows"),
        ("sort", "sort"),
        ("autoFilter", "autoFilter"),
        ("pivotTables", "pivotTables"),
    ] {
        if xml_bool_attr(&protection, xml_key) {
            item[json_key] = json!(true);
        }
    }
    Some(item)
}

fn parse_sheet_page_margins(xml: &str) -> Option<Value> {
    let margins = xml_named_empty_elements(xml, "pageMargins")
        .into_iter()
        .next()?;
    let mut item = json!({});
    for key in ["left", "right", "top", "bottom", "header", "footer"] {
        if let Some(value) = attr_value(&margins, key).and_then(|value| value.parse::<f64>().ok()) {
            item[key] = json!(value);
        }
    }
    Some(item)
}

fn parse_sheet_page_setup(xml: &str) -> Option<Value> {
    let setup = xml_named_empty_elements(xml, "pageSetup")
        .into_iter()
        .next()?;
    let mut item = json!({});
    if let Some(orientation) = attr_value(&setup, "orientation") {
        item["orientation"] = json!(orientation);
    }
    for (json_key, xml_key) in [
        ("paperSize", "paperSize"),
        ("scale", "scale"),
        ("fitToWidth", "fitToWidth"),
        ("fitToHeight", "fitToHeight"),
    ] {
        if let Some(value) = attr_value(&setup, xml_key).and_then(|value| value.parse::<u32>().ok())
        {
            item[json_key] = json!(value);
        }
    }
    Some(item)
}

fn parse_sheet_hyperlinks(xml: &str, hyperlink_targets: &BTreeMap<String, String>) -> Vec<Value> {
    xml_named_empty_elements(xml, "hyperlink")
        .into_iter()
        .chain(xml_named_segments(xml, "hyperlink"))
        .filter_map(|hyperlink| {
            let reference = attr_value(&hyperlink, "ref")?;
            let mut item = json!({ "ref": reference });
            if let Some(relationship_id) = attr_value(&hyperlink, "r:id") {
                item["relationshipId"] = json!(relationship_id);
                if let Some(target) = item["relationshipId"]
                    .as_str()
                    .and_then(|id| hyperlink_targets.get(id))
                {
                    item["target"] = json!(target);
                }
            }
            if let Some(location) = attr_value(&hyperlink, "location") {
                item["location"] = json!(unescape_xml(&location));
            }
            if let Some(display) = attr_value(&hyperlink, "display") {
                item["display"] = json!(unescape_xml(&display));
            }
            if let Some(tooltip) = attr_value(&hyperlink, "tooltip") {
                item["tooltip"] = json!(unescape_xml(&tooltip));
            }
            Some(item)
        })
        .collect()
}

fn parse_sheet_auto_filter(xml: &str) -> Option<String> {
    xml_named_empty_elements(xml, "autoFilter")
        .into_iter()
        .chain(xml_named_segments(xml, "autoFilter"))
        .find_map(|auto_filter| attr_value(&auto_filter, "ref"))
}

fn xml_bool_attr(xml: &str, attr: &str) -> bool {
    attr_value(xml, attr)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn xlsx_hyperlink_relationship_targets(rels: &str) -> BTreeMap<String, String> {
    xml_named_empty_elements(rels, "Relationship")
        .into_iter()
        .filter_map(|relationship| {
            let relationship_id = attr_value(&relationship, "Id")?;
            let relationship_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !relationship_type.ends_with("/hyperlink") {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some((relationship_id, unescape_xml(&target)))
        })
        .collect()
}

fn parse_sheet_comments(xml: &str) -> Vec<Value> {
    let authors = xml_named_segments(xml, "authors")
        .into_iter()
        .next()
        .map(|authors_xml| extract_text_tags(&authors_xml, "author"))
        .unwrap_or_default();
    xml_segments(xml, "<comment ", "</comment>")
        .into_iter()
        .filter_map(|comment| {
            let reference = attr_value(&comment, "ref")?;
            let author_id = attr_value(&comment, "authorId")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            let text = extract_text_tags(&comment, "t").join("\n");
            let mut item = json!({
                "ref": reference,
                "text": text,
                "authorId": author_id
            });
            if let Some(author) = authors.get(author_id) {
                item["author"] = json!(author);
            }
            Some(item)
        })
        .collect()
}

fn parse_xlsx_sheet_objects(
    bytes: &[u8],
    sheet_path: &str,
    sheet_xml: &str,
    sheet_rels: Option<&str>,
) -> XlsxSheetObjects {
    let Some(sheet_rels) = sheet_rels else {
        return XlsxSheetObjects::default();
    };
    let relationships = xlsx_relationships_by_id(sheet_path, sheet_rels);
    let mut objects = XlsxSheetObjects {
        tables: parse_xlsx_sheet_tables(bytes, sheet_xml, &relationships),
        pivots: parse_xlsx_sheet_pivots(bytes, sheet_xml, &relationships),
        ..XlsxSheetObjects::default()
    };
    for drawing in xml_named_empty_elements(sheet_xml, "drawing") {
        let Some(relationship_id) = attr_value(&drawing, "r:id") else {
            continue;
        };
        let Some((_, drawing_path)) = relationships.get(&relationship_id) else {
            continue;
        };
        let Ok(drawing_xml) = read_zip_text(bytes, drawing_path) else {
            continue;
        };
        let drawing_rels_path = xlsx_part_rels_path(drawing_path);
        let drawing_rels = read_zip_text(bytes, &drawing_rels_path).unwrap_or_default();
        let drawing_relationships = xlsx_relationships_by_id(drawing_path, &drawing_rels);
        let drawing_objects =
            parse_xlsx_drawing_objects(bytes, drawing_path, &drawing_xml, &drawing_relationships);
        objects.charts.extend(drawing_objects.charts);
        objects.images.extend(drawing_objects.images);
    }
    objects
}

fn parse_xlsx_sheet_tables(
    bytes: &[u8],
    sheet_xml: &str,
    relationships: &BTreeMap<String, (String, String)>,
) -> Vec<Value> {
    xml_named_empty_elements(sheet_xml, "tablePart")
        .into_iter()
        .filter_map(|table_part| {
            let relationship_id = attr_value(&table_part, "r:id")?;
            let (relationship_type, table_path) = relationships.get(&relationship_id)?;
            if !relationship_type.ends_with("/table") {
                return None;
            }
            let table_xml = read_zip_text(bytes, table_path).unwrap_or_default();
            let table_start = xml_named_start_tag(&table_xml, "table").unwrap_or_default();
            let table_style = xml_named_empty_elements(&table_xml, "tableStyleInfo")
                .into_iter()
                .next()
                .unwrap_or_default();
            let columns = xml_named_empty_elements(&table_xml, "tableColumn")
                .into_iter()
                .chain(xml_named_segments(&table_xml, "tableColumn"))
                .map(|column| {
                    json!({
                        "id": attr_value(&column, "id"),
                        "name": attr_value(&column, "name"),
                        "totalsRowFunction": attr_value(&column, "totalsRowFunction")
                    })
                })
                .collect::<Vec<_>>();
            Some(json!({
                "id": relationship_id,
                "path": table_path,
                "name": attr_value(&table_start, "name"),
                "displayName": attr_value(&table_start, "displayName"),
                "ref": attr_value(&table_start, "ref"),
                "autoFilterRef": parse_sheet_auto_filter(&table_xml),
                "totalsRowShown": attr_value(&table_start, "totalsRowShown")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "tableStyleName": attr_value(&table_style, "name"),
                "showFirstColumn": attr_value(&table_style, "showFirstColumn")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "showLastColumn": attr_value(&table_style, "showLastColumn")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "showRowStripes": attr_value(&table_style, "showRowStripes")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "showColumnStripes": attr_value(&table_style, "showColumnStripes")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "columns": columns
            }))
        })
        .collect()
}

fn parse_xlsx_sheet_pivots(
    bytes: &[u8],
    sheet_xml: &str,
    relationships: &BTreeMap<String, (String, String)>,
) -> Vec<Value> {
    xml_named_empty_elements(sheet_xml, "pivotTableDefinition")
        .into_iter()
        .filter_map(|pivot| {
            let relationship_id = attr_value(&pivot, "r:id")?;
            let (_, pivot_path) = relationships.get(&relationship_id)?;
            let pivot_xml = read_zip_text(bytes, pivot_path).unwrap_or_default();
            Some(json!({
                "id": relationship_id,
                "path": pivot_path,
                "name": attr_value(&pivot_xml, "name"),
                "cacheId": attr_value(&pivot_xml, "cacheId")
            }))
        })
        .collect()
}

fn parse_xlsx_drawing_objects(
    bytes: &[u8],
    drawing_path: &str,
    drawing_xml: &str,
    relationships: &BTreeMap<String, (String, String)>,
) -> XlsxSheetObjects {
    let mut objects = XlsxSheetObjects::default();
    let anchors = xml_segments(drawing_xml, "<xdr:twoCellAnchor", "</xdr:twoCellAnchor>")
        .into_iter()
        .chain(xml_segments(
            drawing_xml,
            "<xdr:oneCellAnchor",
            "</xdr:oneCellAnchor>",
        ));
    for anchor in anchors {
        let anchor_json = parse_xlsx_drawing_anchor(&anchor);
        if let Some(chart) = parse_xlsx_chart_object(bytes, &anchor, relationships, &anchor_json) {
            objects.charts.push(chart);
        }
        if let Some(image) =
            parse_xlsx_image_object(bytes, drawing_path, &anchor, relationships, &anchor_json)
        {
            objects.images.push(image);
        }
    }
    objects
}

fn parse_xlsx_chart_object(
    bytes: &[u8],
    anchor: &str,
    relationships: &BTreeMap<String, (String, String)>,
    anchor_json: &Value,
) -> Option<Value> {
    let chart = xml_named_empty_elements(anchor, "c:chart")
        .into_iter()
        .next()?;
    let relationship_id = attr_value(&chart, "r:id")?;
    let (_, chart_path) = relationships.get(&relationship_id)?;
    let chart_xml = read_zip_text(bytes, chart_path).unwrap_or_default();
    Some(json!({
        "id": relationship_id,
        "path": chart_path,
        "type": xlsx_chart_type(&chart_xml),
        "title": xlsx_chart_title(&chart_xml),
        "categories": pptx_chart_series(&chart_xml)
            .first()
            .and_then(|item| item.get("categories"))
            .cloned()
            .unwrap_or_else(|| json!([])),
        "series": pptx_chart_series(&chart_xml),
        "anchor": anchor_json
    }))
}

fn parse_xlsx_image_object(
    bytes: &[u8],
    drawing_path: &str,
    anchor: &str,
    relationships: &BTreeMap<String, (String, String)>,
    anchor_json: &Value,
) -> Option<Value> {
    let relationship_id = docx_tag_attr(anchor, "<a:blip", "r:embed")
        .or_else(|| docx_tag_attr(anchor, "<a:blip", "r:link"))?;
    let (_, image_path) = relationships.get(&relationship_id)?;
    let mime_type = image_mime_type_from_path(image_path);
    let media = read_zip_bytes(bytes, image_path).ok();
    let data_url = media.as_ref().map(|bytes| {
        format!(
            "data:{mime_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    });
    Some(json!({
        "id": relationship_id,
        "drawingPath": drawing_path,
        "mediaPath": image_path,
        "mimeType": mime_type,
        "dataUrl": data_url,
        "anchor": anchor_json
    }))
}

fn parse_xlsx_drawing_anchor(anchor: &str) -> Value {
    let from = xml_named_segments(anchor, "xdr:from")
        .into_iter()
        .next()
        .unwrap_or_default();
    let to = xml_named_segments(anchor, "xdr:to")
        .into_iter()
        .next()
        .unwrap_or_default();
    json!({
        "from": xlsx_marker_position(&from),
        "to": xlsx_marker_position(&to)
    })
}

fn xlsx_marker_position(marker: &str) -> Value {
    json!({
        "column": first_tag_text(marker, "xdr:col").and_then(|value| value.parse::<u32>().ok()).unwrap_or(0),
        "columnOffset": first_tag_text(marker, "xdr:colOff").and_then(|value| value.parse::<u32>().ok()).unwrap_or(0),
        "row": first_tag_text(marker, "xdr:row").and_then(|value| value.parse::<u32>().ok()).unwrap_or(0),
        "rowOffset": first_tag_text(marker, "xdr:rowOff").and_then(|value| value.parse::<u32>().ok()).unwrap_or(0)
    })
}

fn xlsx_chart_type(chart_xml: &str) -> Option<&'static str> {
    [
        ("bar", "<c:barChart"),
        ("line", "<c:lineChart"),
        ("area", "<c:areaChart"),
        ("pie", "<c:pieChart"),
        ("scatter", "<c:scatterChart"),
        ("doughnut", "<c:doughnutChart"),
    ]
    .into_iter()
    .find_map(|(kind, marker)| chart_xml.contains(marker).then_some(kind))
}

fn xlsx_chart_title(chart_xml: &str) -> Option<String> {
    xml_named_segments(chart_xml, "c:title")
        .into_iter()
        .next()
        .map(|title| extract_text_tags(&title, "a:t").join(""))
        .filter(|title| !title.is_empty())
}

fn add_xlsx_table_replacements(
    original: &[u8],
    sheet: &Value,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(tables) = sheet.get("tables").and_then(Value::as_array) else {
        return;
    };
    for table in tables {
        let Some(table_path) = table
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_xlsx_table_path(path))
        else {
            continue;
        };
        let Ok(table_xml) = read_zip_text(original, table_path) else {
            continue;
        };
        let updated = update_xlsx_table_xml(&table_xml, table);
        replacements.push((table_path.to_string(), updated.into_bytes()));
    }
}

fn update_xlsx_table_xml(table_xml: &str, table: &Value) -> String {
    let mut updated = update_xlsx_table_root_attrs(table_xml, table);
    updated = update_xlsx_table_auto_filter(&updated, table);
    updated = update_xlsx_table_columns(&updated, table);
    update_xlsx_table_style_info(&updated, table)
}

fn update_xlsx_table_root_attrs(table_xml: &str, table: &Value) -> String {
    let mut attrs = Vec::new();
    if let Some(name) = xlsx_validation_string(table, "name") {
        attrs.push(("name", name));
    }
    if let Some(display_name) = xlsx_validation_string(table, "displayName") {
        attrs.push(("displayName", display_name));
    }
    if let Some(reference) = xlsx_validation_string(table, "ref")
        .filter(|reference| valid_xlsx_range_reference(reference))
    {
        attrs.push(("ref", reference));
    }
    if let Some(totals_row_shown) = table.get("totalsRowShown").and_then(Value::as_bool) {
        attrs.push((
            "totalsRowShown",
            if totals_row_shown { "1" } else { "0" }.to_string(),
        ));
    }
    if attrs.is_empty() {
        return table_xml.to_string();
    }
    set_first_xml_tag_attrs(table_xml, "<table", &attrs)
}

fn update_xlsx_table_auto_filter(table_xml: &str, table: &Value) -> String {
    let reference = xlsx_validation_string(table, "autoFilterRef")
        .or_else(|| xlsx_validation_string(table, "ref"))
        .filter(|reference| valid_xlsx_range_reference(reference));
    let auto_filter_xml = reference
        .as_deref()
        .map(|reference| format!(r#"<autoFilter ref="{}"/>"#, escape_xml(reference)))
        .unwrap_or_default();
    if let Some(replaced) = replace_xml_element(table_xml, "autoFilter", &auto_filter_xml) {
        return replaced;
    }
    if table_xml.contains("<autoFilter") {
        return replace_empty_xml_element(table_xml, "<autoFilter", &auto_filter_xml);
    }
    if auto_filter_xml.is_empty() {
        return table_xml.to_string();
    }
    if let Some(index) = table_xml.find("<tableColumns") {
        let mut output = String::new();
        output.push_str(&table_xml[..index]);
        output.push_str(&auto_filter_xml);
        output.push_str(&table_xml[index..]);
        return output;
    }
    append_before_or_end(table_xml, "</table>", &auto_filter_xml)
}

fn update_xlsx_table_columns(table_xml: &str, table: &Value) -> String {
    let Some(columns) = table.get("columns").and_then(Value::as_array) else {
        return table_xml.to_string();
    };
    let columns_xml = build_xlsx_table_columns(columns);
    if let Some(replaced) = replace_xml_element(table_xml, "tableColumns", &columns_xml) {
        return replaced;
    }
    if table_xml.contains("<tableColumns") {
        return replace_empty_xml_element(table_xml, "<tableColumns", &columns_xml);
    }
    if let Some(index) = table_xml.find("<tableStyleInfo") {
        let mut output = String::new();
        output.push_str(&table_xml[..index]);
        output.push_str(&columns_xml);
        output.push_str(&table_xml[index..]);
        return output;
    }
    append_before_or_end(table_xml, "</table>", &columns_xml)
}

fn build_xlsx_table_columns(columns: &[Value]) -> String {
    let items = columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let id = xlsx_validation_string(column, "id")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or((index + 1) as u32);
            let name = xlsx_validation_string(column, "name")
                .unwrap_or_else(|| format!("Column{}", index + 1));
            let mut attrs = vec![
                format!(r#"id="{id}""#),
                format!(r#"name="{}""#, escape_xml(&name)),
            ];
            if let Some(function) = xlsx_validation_string(column, "totalsRowFunction")
                .filter(|value| valid_xlsx_table_totals_function(value))
            {
                attrs.push(format!(r#"totalsRowFunction="{}""#, escape_xml(&function)));
            }
            format!("<tableColumn {}/>", attrs.join(" "))
        })
        .collect::<String>();
    format!(
        r#"<tableColumns count="{}">{items}</tableColumns>"#,
        columns.len()
    )
}

fn valid_xlsx_table_totals_function(value: &str) -> bool {
    matches!(
        value,
        "sum"
            | "min"
            | "max"
            | "average"
            | "count"
            | "countNums"
            | "stdDev"
            | "var"
            | "custom"
            | "none"
    )
}

fn update_xlsx_table_style_info(table_xml: &str, table: &Value) -> String {
    let Some(style_xml) = build_xlsx_table_style_info(table) else {
        return table_xml.to_string();
    };
    if let Some(replaced) = replace_xml_element(table_xml, "tableStyleInfo", &style_xml) {
        return replaced;
    }
    if table_xml.contains("<tableStyleInfo") {
        return replace_empty_xml_element(table_xml, "<tableStyleInfo", &style_xml);
    }
    append_before_or_end(table_xml, "</table>", &style_xml)
}

fn build_xlsx_table_style_info(table: &Value) -> Option<String> {
    let mut attrs = Vec::new();
    if let Some(name) = xlsx_validation_string(table, "tableStyleName") {
        attrs.push(format!(r#"name="{}""#, escape_xml(&name)));
    }
    for (key, attr_name) in [
        ("showFirstColumn", "showFirstColumn"),
        ("showLastColumn", "showLastColumn"),
        ("showRowStripes", "showRowStripes"),
        ("showColumnStripes", "showColumnStripes"),
    ] {
        if let Some(value) = table.get(key).and_then(Value::as_bool) {
            attrs.push(format!(
                r#"{attr_name}="{}""#,
                if value { "1" } else { "0" }
            ));
        }
    }
    if attrs.is_empty() {
        None
    } else {
        Some(format!("<tableStyleInfo {}/>", attrs.join(" ")))
    }
}

fn valid_xlsx_table_path(path: &str) -> bool {
    path.starts_with("xl/tables/") && path.ends_with(".xml") && !path.contains("..")
}

fn add_xlsx_chart_replacements(
    original: &[u8],
    sheet: &Value,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(charts) = sheet.get("charts").and_then(Value::as_array) else {
        return;
    };
    for chart in charts {
        let Some(chart_path) = chart
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_xlsx_chart_path(path))
        else {
            continue;
        };
        let Ok(chart_xml) = read_zip_text(original, chart_path) else {
            continue;
        };
        let mut updated = chart_xml;
        if let Some(title) = chart.get("title").and_then(Value::as_str) {
            updated = update_pptx_chart_title(&updated, title);
        }
        updated = update_pptx_chart_series(&updated, &pptx_chart_series_specs(chart));
        replacements.push((chart_path.to_string(), updated.into_bytes()));
    }
}

fn valid_xlsx_chart_path(path: &str) -> bool {
    path.starts_with("xl/charts/") && path.ends_with(".xml") && !path.contains("..")
}

fn add_xlsx_pivot_replacements(
    original: &[u8],
    sheet: &Value,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(pivots) = sheet.get("pivots").and_then(Value::as_array) else {
        return;
    };
    for pivot in pivots {
        let Some(pivot_path) = pivot
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_xlsx_pivot_path(path))
        else {
            continue;
        };
        let Some(name) = pivot.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Ok(pivot_xml) = read_zip_text(original, pivot_path) else {
            continue;
        };
        let updated = set_first_xml_tag_attrs(
            &pivot_xml,
            "<pivotTableDefinition",
            &[("name", name.to_string())],
        );
        replacements.push((pivot_path.to_string(), updated.into_bytes()));
    }
}

fn valid_xlsx_pivot_path(path: &str) -> bool {
    path.starts_with("xl/pivotTables/") && path.ends_with(".xml") && !path.contains("..")
}

fn xlsx_relationships_by_id(source_part: &str, rels: &str) -> BTreeMap<String, (String, String)> {
    xml_named_empty_elements(rels, "Relationship")
        .into_iter()
        .filter_map(|relationship| {
            let relationship_id = attr_value(&relationship, "Id")?;
            let relationship_type = attr_value(&relationship, "Type").unwrap_or_default();
            let target = attr_value(&relationship, "Target")?;
            Some((
                relationship_id,
                (
                    relationship_type,
                    xlsx_relationship_target_to_part_from(source_part, &target),
                ),
            ))
        })
        .collect()
}

fn image_mime_type_from_path(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

fn xlsx_relationship_target_by_type(
    source_part: &str,
    rels: &str,
    type_suffix: &str,
) -> Option<String> {
    xml_named_empty_elements(rels, "Relationship")
        .into_iter()
        .find_map(|relationship| {
            let relationship_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !relationship_type.ends_with(type_suffix) {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some(xlsx_relationship_target_to_part_from(source_part, &target))
        })
}

fn parse_sheet_frozen_pane(xml: &str) -> (u32, u32) {
    let Some(pane) = xml_empty_elements(xml, "<pane ")
        .into_iter()
        .find(|pane| attr_value(pane, "state").as_deref() == Some("frozen"))
    else {
        return (0, 0);
    };
    let rows = attr_value(&pane, "ySplit")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| value.max(0.0).floor() as u32)
        .unwrap_or(0);
    let columns = attr_value(&pane, "xSplit")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| value.max(0.0).floor() as u32)
        .unwrap_or(0);
    (rows, columns)
}

fn build_sheet_views(frozen_rows: u32, frozen_columns: u32) -> String {
    if frozen_rows == 0 && frozen_columns == 0 {
        return String::new();
    }
    let top_left_cell = format!(
        "{}{}",
        column_letters(frozen_columns.saturating_add(1)),
        frozen_rows.saturating_add(1)
    );
    let active_pane = match (frozen_rows > 0, frozen_columns > 0) {
        (true, true) => "bottomRight",
        (true, false) => "bottomLeft",
        (false, true) => "topRight",
        (false, false) => "topLeft",
    };
    let x_split = if frozen_columns > 0 {
        format!(r#" xSplit="{frozen_columns}""#)
    } else {
        String::new()
    };
    let y_split = if frozen_rows > 0 {
        format!(r#" ySplit="{frozen_rows}""#)
    } else {
        String::new()
    };
    format!(
        r#"<sheetViews><sheetView workbookViewId="0"><pane{x_split}{y_split} topLeftCell="{top_left_cell}" activePane="{active_pane}" state="frozen"/><selection pane="{active_pane}"/></sheetView></sheetViews>"#
    )
}

fn update_sheet_views(xml: &str, frozen_rows: u32, frozen_columns: u32) -> String {
    let sheet_views = build_sheet_views(frozen_rows, frozen_columns);
    if let Some(replaced) = replace_xml_element(xml, "sheetViews", &sheet_views) {
        return replaced;
    }
    if sheet_views.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("<sheetFormatPr") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_views);
        output.push_str(&xml[index..]);
        return output;
    }
    if let Some(index) = xml.find("<cols") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_views);
        output.push_str(&xml[index..]);
        return output;
    }
    if let Some(index) = xml.find("<sheetData") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_views);
        output.push_str(&xml[index..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &sheet_views)
}

fn append_xlsx_style_to_cell_json(cell: &mut Value, style: &XlsxCellStyle) {
    if let Some(number_format) = &style.number_format {
        cell["numberFormat"] = json!(number_format);
    }
    if let Some(font_family) = &style.font_family {
        cell["fontFamily"] = json!(font_family);
    }
    if let Some(font_size) = &style.font_size {
        cell["fontSize"] = json!(font_size);
    }
    if style.bold {
        cell["bold"] = json!(true);
    }
    if style.italic {
        cell["italic"] = json!(true);
    }
    if style.underline {
        cell["underline"] = json!(true);
    }
    if style.strikethrough {
        cell["strikethrough"] = json!(true);
    }
    if let Some(color) = &style.color {
        cell["color"] = json!(format!("#{color}"));
    }
    if let Some(fill_color) = &style.fill_color {
        cell["fillColor"] = json!(format!("#{fill_color}"));
    }
    if let Some(align) = &style.align {
        cell["align"] = json!(align);
    }
    if let Some(vertical_align) = &style.vertical_align {
        cell["verticalAlign"] = json!(vertical_align);
    }
    if style.wrap_text {
        cell["wrapText"] = json!(true);
    }
}

fn xlsx_cell_style_from_model(cell: &Value) -> Option<XlsxCellStyle> {
    let style = XlsxCellStyle {
        number_format: xlsx_model_string(cell, "numberFormat"),
        font_family: xlsx_model_string(cell, "fontFamily"),
        font_size: xlsx_model_string(cell, "fontSize")
            .filter(|value| value.parse::<f64>().map(|size| size > 0.0).unwrap_or(false)),
        bold: cell.get("bold").and_then(Value::as_bool).unwrap_or(false),
        italic: cell.get("italic").and_then(Value::as_bool).unwrap_or(false),
        underline: cell
            .get("underline")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        strikethrough: cell
            .get("strikethrough")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        color: cell
            .get("color")
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        fill_color: cell
            .get("fillColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        align: xlsx_model_string(cell, "align")
            .filter(|value| matches!(value.as_str(), "left" | "center" | "right")),
        vertical_align: xlsx_model_string(cell, "verticalAlign")
            .filter(|value| matches!(value.as_str(), "top" | "middle" | "bottom")),
        wrap_text: cell
            .get("wrapText")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    };
    if xlsx_cell_style_is_empty(&style) {
        None
    } else {
        Some(style)
    }
}

fn xlsx_model_string(cell: &Value, key: &str) -> Option<String> {
    cell.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn xlsx_cell_style_is_empty(style: &XlsxCellStyle) -> bool {
    style.number_format.is_none()
        && style.font_family.is_none()
        && style.font_size.is_none()
        && !style.bold
        && !style.italic
        && !style.underline
        && !style.strikethrough
        && style.color.is_none()
        && style.fill_color.is_none()
        && style.align.is_none()
        && style.vertical_align.is_none()
        && !style.wrap_text
}

fn xlsx_styles_from_xml(xml: &str) -> XlsxParsedStyles {
    let num_formats = xlsx_num_formats(xml);
    let fonts = xlsx_fonts(xml);
    let fills = xlsx_fills(xml);
    let dxfs = xlsx_dxfs(xml);
    let cell_xfs = xlsx_cell_xfs(xml);
    let cell_styles = cell_xfs
        .iter()
        .map(|xf| xlsx_cell_style_from_xf(xf, &fonts, &fills, &num_formats))
        .collect::<Vec<_>>();
    XlsxParsedStyles {
        num_formats,
        fonts,
        fills,
        dxfs,
        cell_xfs,
        cell_styles,
    }
}

fn xlsx_num_formats(xml: &str) -> BTreeMap<u32, String> {
    let mut formats = BTreeMap::new();
    for item in xml_empty_elements(xml, "<numFmt ") {
        let Some(id) = attr_value(&item, "numFmtId").and_then(|value| value.parse::<u32>().ok())
        else {
            continue;
        };
        if let Some(format_code) = attr_value(&item, "formatCode") {
            formats.insert(id, unescape_xml(&format_code));
        }
    }
    formats
}

fn xlsx_fonts(xml: &str) -> Vec<XlsxFontStyle> {
    let Some(fonts_xml) = xml_named_segments(xml, "fonts").into_iter().next() else {
        return vec![XlsxFontStyle::default()];
    };
    let fonts = xml_named_segments(&fonts_xml, "font")
        .into_iter()
        .map(|font| XlsxFontStyle {
            family: xml_first_empty_tag_attr(&font, "name", "val")
                .map(|value| unescape_xml(&value)),
            size: xml_first_empty_tag_attr(&font, "sz", "val"),
            bold: xml_has_named_empty_tag(&font, "b"),
            italic: xml_has_named_empty_tag(&font, "i"),
            underline: xml_has_named_empty_tag(&font, "u"),
            strikethrough: xml_has_named_empty_tag(&font, "strike"),
            color: xlsx_color_from_tag(&font, "color"),
        })
        .collect::<Vec<_>>();
    if fonts.is_empty() {
        vec![XlsxFontStyle::default()]
    } else {
        fonts
    }
}

fn xlsx_fills(xml: &str) -> Vec<Option<String>> {
    let Some(fills_xml) = xml_named_segments(xml, "fills").into_iter().next() else {
        return vec![None, None];
    };
    let fills = xml_named_segments(&fills_xml, "fill")
        .into_iter()
        .map(|fill| xlsx_color_from_tag(&fill, "fgColor"))
        .collect::<Vec<_>>();
    if fills.is_empty() {
        vec![None, None]
    } else {
        fills
    }
}

fn xlsx_cell_xfs(xml: &str) -> Vec<XlsxCellXf> {
    let Some(cell_xfs_xml) = xml_named_segments(xml, "cellXfs").into_iter().next() else {
        return vec![XlsxCellXf::default()];
    };
    let mut xfs = xml_named_empty_elements(&cell_xfs_xml, "xf")
        .into_iter()
        .chain(xml_named_segments(&cell_xfs_xml, "xf"))
        .map(|xf| xlsx_cell_xf_from_xml(&xf))
        .collect::<Vec<_>>();
    if xfs.is_empty() {
        xfs.push(XlsxCellXf::default());
    }
    xfs
}

fn xlsx_dxfs(xml: &str) -> Vec<XlsxDxfStyle> {
    let Some(dxfs_xml) = xml_named_segments(xml, "dxfs").into_iter().next() else {
        return Vec::new();
    };
    xml_named_segments(&dxfs_xml, "dxf")
        .into_iter()
        .map(|dxf| XlsxDxfStyle {
            fill_color: xlsx_color_from_tag(&dxf, "fgColor"),
        })
        .collect()
}

fn xlsx_cell_xf_from_xml(xf: &str) -> XlsxCellXf {
    let alignment = xml_named_empty_elements(xf, "alignment")
        .into_iter()
        .chain(xml_named_segments(xf, "alignment"))
        .next();
    XlsxCellXf {
        num_fmt_id: attr_value(xf, "numFmtId")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0),
        font_id: attr_value(xf, "fontId")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0),
        fill_id: attr_value(xf, "fillId")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0),
        align: alignment
            .as_deref()
            .and_then(|xml| attr_value(xml, "horizontal"))
            .filter(|value| matches!(value.as_str(), "left" | "center" | "right")),
        vertical_align: alignment
            .as_deref()
            .and_then(|xml| attr_value(xml, "vertical"))
            .filter(|value| matches!(value.as_str(), "top" | "center" | "bottom"))
            .map(|value| {
                if value == "center" {
                    "middle".to_string()
                } else {
                    value
                }
            }),
        wrap_text: alignment
            .as_deref()
            .and_then(|xml| attr_value(xml, "wrapText"))
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
    }
}

fn xlsx_cell_style_from_xf(
    xf: &XlsxCellXf,
    fonts: &[XlsxFontStyle],
    fills: &[Option<String>],
    num_formats: &BTreeMap<u32, String>,
) -> XlsxCellStyle {
    let font = fonts.get(xf.font_id).cloned().unwrap_or_default();
    let number_format = xlsx_num_format_code(xf.num_fmt_id, num_formats)
        .filter(|format| !format.eq_ignore_ascii_case("general"));
    XlsxCellStyle {
        number_format,
        font_family: font.family,
        font_size: font.size,
        bold: font.bold,
        italic: font.italic,
        underline: font.underline,
        strikethrough: font.strikethrough,
        color: font.color,
        fill_color: fills.get(xf.fill_id).cloned().flatten(),
        align: xf.align.clone(),
        vertical_align: xf.vertical_align.clone(),
        wrap_text: xf.wrap_text,
    }
}

fn xlsx_num_format_code(id: u32, formats: &BTreeMap<u32, String>) -> Option<String> {
    formats
        .get(&id)
        .cloned()
        .or_else(|| xlsx_builtin_num_format(id).map(str::to_string))
}

fn xlsx_builtin_num_format(id: u32) -> Option<&'static str> {
    match id {
        0 => Some("General"),
        1 => Some("0"),
        2 => Some("0.00"),
        3 => Some("#,##0"),
        4 => Some("#,##0.00"),
        9 => Some("0%"),
        10 => Some("0.00%"),
        14 => Some("m/d/yy"),
        18 => Some("h:mm AM/PM"),
        22 => Some("m/d/yy h:mm"),
        49 => Some("@"),
        _ => None,
    }
}

fn xlsx_builtin_num_format_id(format: &str) -> Option<u32> {
    let normalized = format.trim();
    (0..=49).find(|id| {
        xlsx_builtin_num_format(*id)
            .map(|candidate| candidate.eq_ignore_ascii_case(normalized))
            .unwrap_or(false)
    })
}

fn xlsx_color_from_tag(xml: &str, tag: &str) -> Option<String> {
    let color = xml_first_empty_tag_attr(xml, tag, "rgb")?;
    xlsx_hex_color(&color)
}

fn xlsx_hex_color(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('#');
    let value = if value.len() == 8 { &value[2..] } else { value };
    if value.len() == 6 && value.chars().all(|character| character.is_ascii_hexdigit()) {
        Some(value.to_ascii_uppercase())
    } else {
        None
    }
}

impl XlsxStyleWriter {
    fn new(xml: Option<String>) -> Self {
        let xml = xml.unwrap_or_else(default_xlsx_styles_xml);
        let parsed = xlsx_styles_from_xml(&xml);
        let mut font_keys = BTreeMap::new();
        for (index, font) in parsed.fonts.iter().cloned().enumerate() {
            font_keys.entry(font).or_insert(index);
        }
        let mut fill_keys = BTreeMap::new();
        for (index, fill) in parsed.fills.iter().cloned().enumerate() {
            fill_keys.entry(fill).or_insert(index);
        }
        let mut dxf_keys = BTreeMap::new();
        for (index, dxf) in parsed.dxfs.iter().cloned().enumerate() {
            dxf_keys.entry(dxf).or_insert(index);
        }
        let num_format_keys = parsed
            .num_formats
            .iter()
            .map(|(id, format)| (format.clone(), *id))
            .collect::<BTreeMap<_, _>>();
        let mut cell_xf_keys = BTreeMap::new();
        for (index, xf) in parsed.cell_xfs.iter().cloned().enumerate() {
            cell_xf_keys.entry(xf).or_insert(index);
        }
        Self {
            xml,
            parsed,
            font_keys,
            fill_keys,
            dxf_keys,
            num_format_keys,
            cell_xf_keys,
            changed: false,
        }
    }

    fn assign_sheet_styles(&mut self, update: &mut SheetUpdate) {
        for cell in update.cells.values_mut() {
            if let Some(style) = cell.style.clone() {
                cell.style_index = Some(self.ensure_cell_style(&style));
            }
        }
        for formatting in &mut update.conditional_formattings {
            for rule in &mut formatting.rules {
                if let Some(fill_color) = rule.fill_color.clone() {
                    rule.dxf_id = Some(self.ensure_dxf_style(&XlsxDxfStyle {
                        fill_color: Some(fill_color),
                    }));
                }
            }
        }
    }

    fn ensure_cell_style(&mut self, style: &XlsxCellStyle) -> usize {
        if xlsx_cell_style_is_empty(style) {
            return 0;
        }
        let font_id = self.ensure_font(&xlsx_font_style_from_cell_style(style));
        let fill_id = self.ensure_fill(style.fill_color.clone());
        let num_fmt_id = self.ensure_num_format(style.number_format.as_deref());
        let xf = XlsxCellXf {
            num_fmt_id,
            font_id,
            fill_id,
            align: style.align.clone(),
            vertical_align: style.vertical_align.clone(),
            wrap_text: style.wrap_text,
        };
        if let Some(index) = self.cell_xf_keys.get(&xf) {
            return *index;
        }
        let index = self.parsed.cell_xfs.len();
        self.xml = append_to_xlsx_style_collection(
            &self.xml,
            "cellXfs",
            &xlsx_cell_xf_xml(&xf),
            index + 1,
        );
        self.parsed.cell_xfs.push(xf.clone());
        self.parsed.cell_styles.push(style.clone());
        self.cell_xf_keys.insert(xf, index);
        self.changed = true;
        index
    }

    fn ensure_font(&mut self, font: &XlsxFontStyle) -> usize {
        if xlsx_font_style_is_empty(font) {
            return 0;
        }
        if let Some(index) = self.font_keys.get(font) {
            return *index;
        }
        let index = self.parsed.fonts.len();
        self.xml =
            append_to_xlsx_style_collection(&self.xml, "fonts", &xlsx_font_xml(font), index + 1);
        self.parsed.fonts.push(font.clone());
        self.font_keys.insert(font.clone(), index);
        self.changed = true;
        index
    }

    fn ensure_fill(&mut self, fill_color: Option<String>) -> usize {
        if fill_color.is_none() {
            return 0;
        }
        if let Some(index) = self.fill_keys.get(&fill_color) {
            return *index;
        }
        let index = self.parsed.fills.len();
        self.xml = append_to_xlsx_style_collection(
            &self.xml,
            "fills",
            &xlsx_fill_xml(fill_color.as_deref().unwrap_or_default()),
            index + 1,
        );
        self.parsed.fills.push(fill_color.clone());
        self.fill_keys.insert(fill_color, index);
        self.changed = true;
        index
    }

    fn ensure_num_format(&mut self, format: Option<&str>) -> u32 {
        let Some(format) = format.map(str::trim).filter(|value| !value.is_empty()) else {
            return 0;
        };
        if let Some(id) = xlsx_builtin_num_format_id(format) {
            return id;
        }
        if let Some(id) = self.num_format_keys.get(format) {
            return *id;
        }
        let id = self
            .parsed
            .num_formats
            .keys()
            .filter(|id| **id >= 164)
            .max()
            .copied()
            .unwrap_or(163)
            + 1;
        self.xml = append_xlsx_num_format(&self.xml, id, format);
        self.parsed.num_formats.insert(id, format.to_string());
        self.num_format_keys.insert(format.to_string(), id);
        self.changed = true;
        id
    }

    fn ensure_dxf_style(&mut self, style: &XlsxDxfStyle) -> usize {
        if let Some(index) = self.dxf_keys.get(style) {
            return *index;
        }
        let index = self.parsed.dxfs.len();
        self.xml =
            append_to_xlsx_style_collection(&self.xml, "dxfs", &xlsx_dxf_xml(style), index + 1);
        self.parsed.dxfs.push(style.clone());
        self.dxf_keys.insert(style.clone(), index);
        self.changed = true;
        index
    }
}

fn xlsx_font_style_from_cell_style(style: &XlsxCellStyle) -> XlsxFontStyle {
    XlsxFontStyle {
        family: style.font_family.clone(),
        size: style.font_size.clone(),
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        strikethrough: style.strikethrough,
        color: style.color.clone(),
    }
}

fn xlsx_font_style_is_empty(font: &XlsxFontStyle) -> bool {
    font.family.is_none()
        && font.size.is_none()
        && !font.bold
        && !font.italic
        && !font.underline
        && !font.strikethrough
        && font.color.is_none()
}

fn xlsx_font_xml(font: &XlsxFontStyle) -> String {
    let mut output = String::from("<font>");
    if font.bold {
        output.push_str("<b/>");
    }
    if font.italic {
        output.push_str("<i/>");
    }
    if font.underline {
        output.push_str("<u/>");
    }
    if font.strikethrough {
        output.push_str("<strike/>");
    }
    if let Some(size) = &font.size {
        output.push_str(&format!(r#"<sz val="{}"/>"#, escape_xml(size)));
    }
    if let Some(color) = &font.color {
        output.push_str(&format!(r#"<color rgb="FF{color}"/>"#));
    }
    if let Some(family) = &font.family {
        output.push_str(&format!(r#"<name val="{}"/>"#, escape_xml(family)));
    }
    output.push_str("</font>");
    output
}

fn xlsx_fill_xml(color: &str) -> String {
    format!(
        r#"<fill><patternFill patternType="solid"><fgColor rgb="FF{color}"/><bgColor indexed="64"/></patternFill></fill>"#
    )
}

fn xlsx_dxf_xml(style: &XlsxDxfStyle) -> String {
    let Some(fill_color) = style.fill_color.as_deref() else {
        return "<dxf/>".to_string();
    };
    format!(
        r#"<dxf><fill><patternFill patternType="solid"><fgColor rgb="FF{fill_color}"/><bgColor indexed="64"/></patternFill></fill></dxf>"#
    )
}

fn xlsx_cell_xf_xml(xf: &XlsxCellXf) -> String {
    let mut attrs = format!(
        r#"numFmtId="{}" fontId="{}" fillId="{}" borderId="0" xfId="0""#,
        xf.num_fmt_id, xf.font_id, xf.fill_id
    );
    if xf.num_fmt_id != 0 {
        attrs.push_str(r#" applyNumberFormat="1""#);
    }
    if xf.font_id != 0 {
        attrs.push_str(r#" applyFont="1""#);
    }
    if xf.fill_id != 0 {
        attrs.push_str(r#" applyFill="1""#);
    }
    if xf.align.is_some() || xf.vertical_align.is_some() || xf.wrap_text {
        attrs.push_str(r#" applyAlignment="1""#);
        let mut alignment_attrs = Vec::new();
        if let Some(align) = &xf.align {
            alignment_attrs.push(format!(r#"horizontal="{align}""#));
        }
        if let Some(vertical) = &xf.vertical_align {
            let vertical = if vertical == "middle" {
                "center"
            } else {
                vertical
            };
            alignment_attrs.push(format!(r#"vertical="{vertical}""#));
        }
        if xf.wrap_text {
            alignment_attrs.push(r#"wrapText="1""#.to_string());
        }
        format!(
            "<xf {attrs}><alignment {}/></xf>",
            alignment_attrs.join(" ")
        )
    } else {
        format!("<xf {attrs}/>")
    }
}

fn append_to_xlsx_style_collection(xml: &str, tag: &str, child: &str, count: usize) -> String {
    let Some(start) = find_xml_tag_start(xml, tag) else {
        let collection = format!(r#"<{tag} count="{count}">{child}</{tag}>"#);
        return append_before_or_end(xml, "</styleSheet>", &collection);
    };
    let after_start = &xml[start..];
    let Some(open_end) = after_start.find('>') else {
        return xml.to_string();
    };
    let end_marker = format!("</{tag}>");
    let Some(close_start) = after_start.find(&end_marker) else {
        return xml.to_string();
    };
    let opening = set_xml_attr(&after_start[..=open_end], "count", &count.to_string());
    let mut output = String::new();
    output.push_str(&xml[..start]);
    output.push_str(&opening);
    output.push_str(&after_start[open_end + 1..close_start]);
    output.push_str(child);
    output.push_str(&after_start[close_start..]);
    output
}

fn append_xlsx_num_format(xml: &str, id: u32, format: &str) -> String {
    let child = format!(
        r#"<numFmt numFmtId="{id}" formatCode="{}"/>"#,
        escape_xml(format)
    );
    if find_xml_tag_start(xml, "numFmts").is_some() {
        let custom_count = xlsx_num_formats(xml).len() + 1;
        return append_to_xlsx_style_collection(xml, "numFmts", &child, custom_count);
    }
    let collection = format!(r#"<numFmts count="1">{child}</numFmts>"#);
    if let Some(index) = find_xml_tag_start(xml, "fonts") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&collection);
        output.push_str(&xml[index..]);
        output
    } else {
        append_before_or_end(xml, "</styleSheet>", &collection)
    }
}

fn ensure_xlsx_styles_relationship(rels: &str) -> String {
    if rels.contains("/relationships/styles") {
        return rels.to_string();
    }
    let rel_id = format!("rId{}", next_rid(rels));
    let rel = format!(
        r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#
    );
    append_before_or_end(rels, "</Relationships>", &rel)
}

fn ensure_xlsx_styles_content_type(content_types: &str) -> String {
    if content_types.contains(r#"PartName="/xl/styles.xml""#) {
        return content_types.to_string();
    }
    let override_xml = r#"<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>"#;
    append_before_or_end(content_types, "</Types>", override_xml)
}

fn ensure_xlsx_comments_content_types(
    content_types: &str,
    comments_paths: &[String],
    needs_vml: bool,
) -> String {
    let mut output = content_types.to_string();
    for path in comments_paths {
        let part_name = format!("/{path}");
        if output.contains(&format!(r#"PartName="{part_name}""#)) {
            continue;
        }
        let override_xml = format!(
            r#"<Override PartName="{part_name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>"#
        );
        output = append_before_or_end(&output, "</Types>", &override_xml);
    }
    if needs_vml {
        output = ensure_content_type_default(
            &output,
            "vml",
            "application/vnd.openxmlformats-officedocument.vmlDrawing",
        );
    }
    output
}

fn default_xlsx_styles_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#.to_string()
}

fn replace_docx_blocks(document: &str, blocks: &[Value]) -> String {
    let mut output = String::new();
    let mut rest = document;
    let mut block_index = 0usize;
    loop {
        let paragraph = rest.find("<w:p").map(|index| (index, "</w:p>", false));
        let table = rest.find("<w:tbl").map(|index| (index, "</w:tbl>", true));
        let next = match (paragraph, table) {
            (Some(paragraph), Some(table)) => Some(if paragraph.0 <= table.0 {
                paragraph
            } else {
                table
            }),
            (Some(paragraph), None) => Some(paragraph),
            (None, Some(table)) => Some(table),
            (None, None) => None,
        };
        let Some((start, end_marker, is_table)) = next else {
            break;
        };
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find(end_marker) else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + end_marker.len();
        let segment = &after_start[..end_index];
        let has_text = !extract_text_tags(segment, "w:t").join("").trim().is_empty();
        let has_page_break = docx_paragraph_has_page_break(segment);
        let has_section_break = docx_paragraph_has_section_break(segment);
        let has_editor_content = is_table
            || has_text
            || has_page_break
            || has_section_break
            || docx_image_relationship_id(segment).is_some();
        if has_editor_content {
            if let Some(block) = blocks.get(block_index) {
                let block_type = block.get("type").and_then(Value::as_str);
                if block_type == Some("image") {
                    output.push_str(&build_docx_image_paragraph(block));
                } else if matches!(block_type, Some("pageBreak" | "sectionBreak")) || is_table {
                    output.push_str(&build_docx_block(block));
                } else if docx_paragraph_has_complex_content(segment)
                    && !docx_paragraph_needs_note_reference_rebuild(segment, block)
                {
                    let replacement = block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    output.push_str(&replace_tag_texts(segment, "w:t", &[replacement]));
                } else {
                    output.push_str(&build_docx_block(block));
                }
            } else {
                output.push_str(segment);
            }
            block_index += 1;
        } else {
            output.push_str(segment);
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

fn docx_paragraph_has_complex_content(paragraph: &str) -> bool {
    [
        "<w:drawing",
        "<w:pict",
        "<w:object",
        "<w:hyperlink",
        "<w:fldSimple",
        "<w:bookmarkStart",
        "<w:footnoteReference",
        "<w:endnoteReference",
    ]
    .iter()
    .any(|marker| paragraph.contains(marker))
}

fn docx_paragraph_has_page_break(paragraph: &str) -> bool {
    paragraph.contains("<w:br")
        && docx_tag_attr(paragraph, "<w:br", "w:type").as_deref() == Some("page")
}

fn docx_paragraph_has_section_break(paragraph: &str) -> bool {
    paragraph.contains("<w:sectPr")
}

fn docx_section_break_kind(paragraph: &str) -> String {
    docx_tag_attr(paragraph, "<w:type", "w:val")
        .filter(|value| {
            matches!(
                value.as_str(),
                "nextPage" | "continuous" | "evenPage" | "oddPage"
            )
        })
        .unwrap_or_else(|| "nextPage".to_string())
}

fn insert_docx_blocks(document: &str, blocks: &[Value]) -> String {
    let inserted = blocks
        .iter()
        .map(build_docx_block)
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

fn build_docx_block(block: &Value) -> String {
    match block.get("type").and_then(Value::as_str) {
        Some("table") => build_docx_table(block),
        Some("image") => build_docx_image_paragraph(block),
        Some("pageBreak") => build_docx_page_break(),
        Some("sectionBreak") => build_docx_section_break(block),
        _ => build_docx_paragraph(block),
    }
}

fn build_docx_page_break() -> String {
    r#"<w:p><w:r><w:br w:type="page"/></w:r></w:p>"#.to_string()
}

fn build_docx_section_break(block: &Value) -> String {
    let break_kind = block
        .get("breakKind")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "nextPage" | "continuous" | "evenPage" | "oddPage"))
        .unwrap_or("nextPage");
    format!(r#"<w:p><w:pPr><w:sectPr><w:type w:val="{break_kind}"/></w:sectPr></w:pPr></w:p>"#)
}

fn build_docx_paragraph(block: &Value) -> String {
    let text = block
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let style = docx_paragraph_properties(block);
    let run_properties = docx_run_properties(block);
    let text_xml = docx_text_with_breaks(text);
    let run = format!("<w:r>{run_properties}{text_xml}</w:r>");
    let note_references = format!(
        "{}{}",
        docx_note_reference_run(
            block,
            "footnoteId",
            "w:footnoteReference",
            "FootnoteReference"
        ),
        docx_note_reference_run(block, "endnoteId", "w:endnoteReference", "EndnoteReference")
    );
    if let Some(relationship_id) = block
        .get("relationshipId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        format!(
            r#"<w:p>{style}<w:hyperlink r:id="{}">{run}</w:hyperlink>{note_references}</w:p>"#,
            escape_xml(relationship_id)
        )
    } else {
        format!("<w:p>{style}{run}{note_references}</w:p>")
    }
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

fn docx_paragraph_properties(block: &Value) -> String {
    let block_type = block
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("paragraph");
    let mut props = Vec::new();
    if block_type == "heading" {
        let heading_level = block
            .get("headingLevel")
            .and_then(Value::as_u64)
            .filter(|level| (1..=6).contains(level))
            .unwrap_or(1);
        props.push(format!(r#"<w:pStyle w:val="Heading{heading_level}"/>"#));
    }
    if let Some(list_kind) = block.get("listKind").and_then(Value::as_str) {
        let num_id = match list_kind {
            "bullet" => Some(DOCX_BULLET_NUM_ID),
            "number" => Some(DOCX_NUMBER_NUM_ID),
            _ => None,
        };
        if let Some(num_id) = num_id {
            props.push(format!(
                r#"<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num_id}"/></w:numPr>"#
            ));
        }
    }
    if let Some(align) = block
        .get("align")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "left" | "center" | "right" | "justify"))
    {
        props.push(format!(r#"<w:jc w:val="{align}"/>"#));
    }
    if block
        .get("pageBreakBefore")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push("<w:pageBreakBefore/>".to_string());
    }
    if let Some(indent_left) = docx_u32_model_attr(block, "indentLeft", 31_680) {
        props.push(format!(r#"<w:ind w:left="{indent_left}"/>"#));
    }
    let spacing_before = docx_u32_model_attr(block, "spacingBefore", 31_680);
    let spacing_after = docx_u32_model_attr(block, "spacingAfter", 31_680);
    let line_spacing = docx_u32_model_attr(block, "lineSpacing", 2_400);
    if spacing_before.is_some() || spacing_after.is_some() || line_spacing.is_some() {
        let mut attrs = Vec::new();
        if let Some(value) = spacing_before {
            attrs.push(format!(r#"w:before="{value}""#));
        }
        if let Some(value) = spacing_after {
            attrs.push(format!(r#"w:after="{value}""#));
        }
        if let Some(value) = line_spacing {
            attrs.push(format!(r#"w:line="{value}" w:lineRule="auto""#));
        }
        props.push(format!("<w:spacing {}/>", attrs.join(" ")));
    }
    if props.is_empty() {
        String::new()
    } else {
        format!("<w:pPr>{}</w:pPr>", props.join(""))
    }
}

fn docx_run_properties(block: &Value) -> String {
    let mut props = Vec::new();
    if block.get("bold").and_then(Value::as_bool).unwrap_or(false) {
        props.push("<w:b/>".to_string());
    }
    if block
        .get("italic")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push("<w:i/>".to_string());
    }
    if block
        .get("underline")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push(r#"<w:u w:val="single"/>"#.to_string());
    }
    if block
        .get("strikethrough")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push("<w:strike/>".to_string());
    }
    if let Some(vertical_align) = block
        .get("verticalAlign")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "superscript" | "subscript"))
    {
        props.push(format!(r#"<w:vertAlign w:val="{vertical_align}"/>"#));
    }
    if let Some(font) = block.get("fontFamily").and_then(Value::as_str) {
        let font = escape_xml(font);
        props.push(format!(
            r#"<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}"/>"#
        ));
    }
    if let Some(size) = block
        .get("fontSize")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u32>().ok())
    {
        props.push(format!(r#"<w:sz w:val="{}"/>"#, size * 2));
    }
    if let Some(color) = block
        .get("color")
        .and_then(Value::as_str)
        .and_then(docx_hex_color)
    {
        props.push(format!(r#"<w:color w:val="{color}"/>"#));
    }
    if let Some(highlight) = block.get("highlight").and_then(Value::as_str) {
        props.push(format!(
            r#"<w:highlight w:val="{}"/>"#,
            docx_highlight_color(highlight)
        ));
    }
    if props.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{}</w:rPr>", props.join(""))
    }
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

fn docx_highlight_color(value: &str) -> &'static str {
    match value.to_ascii_lowercase().as_str() {
        "#fef08a" | "yellow" => "yellow",
        "#bbf7d0" | "green" => "green",
        "#bfdbfe" | "blue" => "cyan",
        _ => "yellow",
    }
}

fn sheet_update_from_model(sheet: &Value, rows: &[Value]) -> SheetUpdate {
    SheetUpdate {
        cells: sheet_cell_writes(rows),
        rows: sheet_row_writes(rows),
        columns: sheet_column_writes(sheet),
        tab_color_xml: sheet_tab_color_xml(sheet),
        merged_ranges: sheet_merged_ranges(sheet),
        data_validations: sheet_data_validations(sheet),
        conditional_formattings: sheet_conditional_formattings(sheet),
        protection: sheet_protection(sheet),
        page_margins: sheet_page_margins(sheet),
        page_setup: sheet_page_setup(sheet),
        hyperlinks: sheet_hyperlinks(sheet),
        comments: sheet_comments(sheet),
        auto_filter: sheet
            .get("autoFilter")
            .and_then(Value::as_str)
            .filter(|reference| valid_xlsx_range_reference(reference))
            .map(str::to_string),
        frozen_rows: sheet
            .get("frozenRows")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(1_048_575) as u32,
        frozen_columns: sheet
            .get("frozenColumns")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(16_383) as u32,
    }
}

fn sheet_cell_writes(rows: &[Value]) -> BTreeMap<String, SheetCellWrite> {
    let mut writes = BTreeMap::new();
    for row in rows {
        let Some(row_cells) = row.get("cells").and_then(Value::as_array) else {
            continue;
        };
        for cell in row_cells {
            let Some(reference) = cell.get("ref").and_then(Value::as_str) else {
                continue;
            };
            let mut value = cell
                .get("value")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let mut formula = cell
                .get("formula")
                .and_then(Value::as_str)
                .map(str::to_string);
            if formula.is_none() && value.starts_with('=') {
                formula = Some(value.trim_start_matches('=').to_string());
                value.clear();
            }
            writes.insert(
                reference.to_string(),
                SheetCellWrite {
                    value,
                    formula,
                    style: xlsx_cell_style_from_model(cell),
                    style_index: None,
                },
            );
        }
    }
    writes
}

fn sheet_row_writes(rows: &[Value]) -> BTreeMap<u32, SheetRowWrite> {
    let mut row_writes = BTreeMap::new();
    for (index, row) in rows.iter().enumerate() {
        let row_index = row
            .get("index")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or((index + 1) as u32);
        let height = row.get("height").and_then(Value::as_f64);
        let hidden = row.get("hidden").and_then(Value::as_bool).unwrap_or(false);
        if height.is_some() || hidden {
            row_writes.insert(row_index, SheetRowWrite { height, hidden });
        }
    }
    row_writes
}

fn sheet_column_writes(sheet: &Value) -> Vec<SheetColumnWrite> {
    let Some(columns) = sheet.get("columns").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut writes = columns
        .iter()
        .filter_map(|column| {
            let index = column.get("index").and_then(Value::as_u64)?;
            Some(SheetColumnWrite {
                index: (index as u32).saturating_add(1),
                width: column.get("width").and_then(Value::as_f64),
                hidden: column
                    .get("hidden")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect::<Vec<_>>();
    writes.sort_by_key(|column| column.index);
    writes.dedup_by_key(|column| column.index);
    writes
}

fn sheet_tab_color_xml(sheet: &Value) -> Option<String> {
    if let Some(color) = sheet
        .get("tabColor")
        .and_then(Value::as_str)
        .and_then(docx_hex_color)
    {
        return Some(format!(r#"<tabColor rgb="FF{color}"/>"#));
    }
    sheet
        .get("tabColorSourceXml")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|source| source.starts_with("<tabColor") && source.ends_with('>'))
        .map(str::to_string)
}

fn sheet_merged_ranges(sheet: &Value) -> Vec<String> {
    let Some(ranges) = sheet.get("mergedRanges").and_then(Value::as_array) else {
        return Vec::new();
    };
    ranges
        .iter()
        .filter_map(|range| range.get("ref").and_then(Value::as_str))
        .filter(|reference| valid_xlsx_range_reference(reference))
        .map(str::to_string)
        .collect()
}

fn sheet_data_validations(sheet: &Value) -> Vec<SheetDataValidation> {
    let Some(validations) = sheet.get("dataValidations").and_then(Value::as_array) else {
        return Vec::new();
    };
    validations
        .iter()
        .filter_map(|validation| {
            let sqref = validation.get("sqref").and_then(Value::as_str)?;
            if !valid_xlsx_sqref(sqref) {
                return None;
            }
            Some(SheetDataValidation {
                sqref: sqref.to_string(),
                validation_type: xlsx_validation_string(validation, "type")
                    .filter(|value| valid_xlsx_validation_type(value)),
                operator: xlsx_validation_string(validation, "operator")
                    .filter(|value| valid_xlsx_validation_operator(value)),
                formula1: xlsx_validation_string(validation, "formula1"),
                formula2: xlsx_validation_string(validation, "formula2"),
                allow_blank: validation
                    .get("allowBlank")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                show_input_message: validation
                    .get("showInputMessage")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                show_error_message: validation
                    .get("showErrorMessage")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                prompt_title: xlsx_validation_string(validation, "promptTitle"),
                prompt: xlsx_validation_string(validation, "prompt"),
                error_title: xlsx_validation_string(validation, "errorTitle"),
                error: xlsx_validation_string(validation, "error"),
            })
        })
        .collect()
}

fn xlsx_validation_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn valid_xlsx_validation_type(value: &str) -> bool {
    matches!(
        value,
        "whole" | "decimal" | "list" | "date" | "time" | "textLength" | "custom"
    )
}

fn valid_xlsx_validation_operator(value: &str) -> bool {
    matches!(
        value,
        "between"
            | "notBetween"
            | "equal"
            | "notEqual"
            | "greaterThan"
            | "lessThan"
            | "greaterThanOrEqual"
            | "lessThanOrEqual"
    )
}

fn sheet_conditional_formattings(sheet: &Value) -> Vec<SheetConditionalFormatting> {
    let Some(formatting_groups) = sheet
        .get("conditionalFormattings")
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    formatting_groups
        .iter()
        .filter_map(|formatting| {
            let sqref = formatting.get("sqref").and_then(Value::as_str)?;
            if !valid_xlsx_sqref(sqref) {
                return None;
            }
            let rules = formatting
                .get("rules")
                .and_then(Value::as_array)
                .map(|rules| {
                    rules
                        .iter()
                        .filter_map(sheet_conditional_rule)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if rules.is_empty() {
                return None;
            }
            Some(SheetConditionalFormatting {
                sqref: sqref.to_string(),
                rules,
            })
        })
        .collect()
}

fn sheet_conditional_rule(rule: &Value) -> Option<SheetConditionalRule> {
    let source_xml =
        xlsx_validation_string(rule, "sourceXml").filter(|source| source.starts_with("<cfRule"));
    let rule_type = xlsx_validation_string(rule, "type")
        .filter(|value| valid_xlsx_conditional_rule_type(value));
    if source_xml.is_none() && rule_type.is_none() {
        return None;
    }
    let formulas = rule
        .get("formulas")
        .and_then(Value::as_array)
        .map(|formulas| {
            formulas
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Some(SheetConditionalRule {
        rule_type,
        operator: xlsx_validation_string(rule, "operator")
            .filter(|value| valid_xlsx_conditional_operator(value)),
        priority: rule
            .get("priority")
            .and_then(Value::as_u64)
            .map(|value| value.min(u32::MAX as u64) as u32),
        dxf_id: rule
            .get("dxfId")
            .and_then(Value::as_u64)
            .map(|value| value.min(usize::MAX as u64) as usize),
        fill_color: rule
            .get("fillColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        text: xlsx_validation_string(rule, "text"),
        time_period: xlsx_validation_string(rule, "timePeriod"),
        formulas,
        source_xml,
    })
}

fn valid_xlsx_conditional_rule_type(value: &str) -> bool {
    matches!(
        value,
        "cellIs"
            | "expression"
            | "colorScale"
            | "dataBar"
            | "iconSet"
            | "top10"
            | "uniqueValues"
            | "duplicateValues"
            | "containsText"
            | "notContainsText"
            | "beginsWith"
            | "endsWith"
            | "aboveAverage"
            | "timePeriod"
            | "blanks"
            | "notBlanks"
            | "errors"
            | "notErrors"
    )
}

fn valid_xlsx_conditional_operator(value: &str) -> bool {
    matches!(
        value,
        "lessThan"
            | "lessThanOrEqual"
            | "equal"
            | "notEqual"
            | "greaterThanOrEqual"
            | "greaterThan"
            | "between"
            | "notBetween"
            | "containsText"
            | "notContains"
            | "beginsWith"
            | "endsWith"
    )
}

fn sheet_protection(sheet: &Value) -> Option<SheetProtection> {
    let protection = sheet.get("protection")?;
    let enabled = protection
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        return None;
    }
    Some(SheetProtection {
        enabled,
        password: xlsx_validation_string(protection, "password")
            .filter(|value| value.chars().all(|ch| ch.is_ascii_hexdigit())),
        objects: protection
            .get("objects")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        scenarios: protection
            .get("scenarios")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        format_cells: protection
            .get("formatCells")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        format_columns: protection
            .get("formatColumns")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        format_rows: protection
            .get("formatRows")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        insert_columns: protection
            .get("insertColumns")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        insert_rows: protection
            .get("insertRows")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        insert_hyperlinks: protection
            .get("insertHyperlinks")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        delete_columns: protection
            .get("deleteColumns")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        delete_rows: protection
            .get("deleteRows")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        sort: protection
            .get("sort")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        auto_filter: protection
            .get("autoFilter")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        pivot_tables: protection
            .get("pivotTables")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn sheet_page_margins(sheet: &Value) -> Option<SheetPageMargins> {
    let margins = sheet.get("pageMargins")?;
    Some(SheetPageMargins {
        left: sheet_non_negative_float(margins, "left"),
        right: sheet_non_negative_float(margins, "right"),
        top: sheet_non_negative_float(margins, "top"),
        bottom: sheet_non_negative_float(margins, "bottom"),
        header: sheet_non_negative_float(margins, "header"),
        footer: sheet_non_negative_float(margins, "footer"),
    })
}

fn sheet_page_setup(sheet: &Value) -> Option<SheetPageSetup> {
    let setup = sheet.get("pageSetup")?;
    Some(SheetPageSetup {
        orientation: xlsx_validation_string(setup, "orientation")
            .filter(|value| matches!(value.as_str(), "portrait" | "landscape")),
        paper_size: sheet_u32_in_range(setup, "paperSize", 1, 118),
        scale: sheet_u32_in_range(setup, "scale", 10, 400),
        fit_to_width: sheet_u32_in_range(setup, "fitToWidth", 0, 100),
        fit_to_height: sheet_u32_in_range(setup, "fitToHeight", 0, 100),
    })
}

fn sheet_hyperlinks(sheet: &Value) -> Vec<SheetHyperlink> {
    let Some(hyperlinks) = sheet.get("hyperlinks").and_then(Value::as_array) else {
        return Vec::new();
    };
    hyperlinks
        .iter()
        .filter_map(|hyperlink| {
            let reference = hyperlink.get("ref").and_then(Value::as_str)?;
            if !valid_xlsx_sqref(reference) {
                return None;
            }
            let target = xlsx_validation_string(hyperlink, "target");
            let location = xlsx_validation_string(hyperlink, "location");
            if target.is_none() && location.is_none() {
                return None;
            }
            Some(SheetHyperlink {
                reference: reference.to_string(),
                relationship_id: xlsx_validation_string(hyperlink, "relationshipId"),
                target,
                location,
                display: xlsx_validation_string(hyperlink, "display"),
                tooltip: xlsx_validation_string(hyperlink, "tooltip"),
            })
        })
        .collect()
}

fn sheet_comments(sheet: &Value) -> Option<Vec<SheetComment>> {
    let comments = sheet.get("comments")?.as_array()?;
    Some(
        comments
            .iter()
            .filter_map(|comment| {
                let reference = comment.get("ref").and_then(Value::as_str)?;
                split_cell_reference(reference)?;
                let text = xlsx_validation_string(comment, "text")?;
                Some(SheetComment {
                    reference: reference.to_string(),
                    author: xlsx_validation_string(comment, "author"),
                    text,
                })
            })
            .collect(),
    )
}

fn sheet_non_negative_float(value: &Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite() && *number >= 0.0)
}

fn sheet_u32_in_range(value: &Value, key: &str, min: u32, max: u32) -> Option<u32> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .map(|number| number.clamp(min as u64, max as u64) as u32)
}

fn xlsx_workbook_sheets(bytes: &[u8]) -> AppResult<Vec<XlsxWorkbookSheetRef>> {
    let workbook = read_zip_text(bytes, "xl/workbook.xml")?;
    let rels = read_zip_text(bytes, "xl/_rels/workbook.xml.rels")?;
    Ok(xlsx_workbook_sheets_from_xml(&workbook, &rels))
}

fn xlsx_workbook_sheets_from_xml(workbook: &str, rels: &str) -> Vec<XlsxWorkbookSheetRef> {
    let targets = xlsx_relationship_targets(rels);
    xml_empty_elements(workbook, "<sheet ")
        .into_iter()
        .filter_map(|sheet| {
            let rel_id = attr_value(&sheet, "r:id")?;
            let path = targets.get(&rel_id)?.clone();
            Some(XlsxWorkbookSheetRef {
                path,
                name: attr_value(&sheet, "name")
                    .map(|name| unescape_xml(&name))
                    .unwrap_or_else(|| "Sheet".to_string()),
                sheet_id: attr_value(&sheet, "sheetId")
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(1),
                rel_id,
                state: attr_value(&sheet, "state")
                    .filter(|value| matches!(value.as_str(), "hidden" | "veryHidden")),
            })
        })
        .collect()
}

fn xlsx_relationship_targets(rels: &str) -> BTreeMap<String, String> {
    xml_empty_elements(rels, "<Relationship ")
        .into_iter()
        .filter_map(|relationship| {
            let rel_id = attr_value(&relationship, "Id")?;
            let rel_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !rel_type.ends_with("/worksheet") {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some((rel_id, xlsx_relationship_target_to_part(&target)))
        })
        .collect()
}

fn xlsx_relationship_target_to_part(target: &str) -> String {
    let target = target.trim_start_matches('/');
    if target.starts_with("xl/") {
        target.to_string()
    } else {
        format!("xl/{target}")
    }
}

fn xlsx_relationship_target_to_part_from(source_part: &str, target: &str) -> String {
    let target = target.trim_start_matches('/');
    if target.starts_with("xl/") {
        return target.to_string();
    }
    let base = source_part
        .rsplit_once('/')
        .map(|(directory, _)| directory)
        .unwrap_or_default();
    let mut segments = base
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            value => segments.push(value.to_string()),
        }
    }
    segments.join("/")
}

fn xlsx_worksheet_rels_path(sheet_path: &str) -> String {
    xlsx_part_rels_path(sheet_path)
}

fn xlsx_part_rels_path(part_path: &str) -> String {
    let Some((directory, file_name)) = part_path.rsplit_once('/') else {
        return format!("_rels/{part_path}.rels");
    };
    format!("{directory}/_rels/{file_name}.rels")
}

fn xlsx_empty_relationships() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#.to_string()
}

fn xlsx_sheet_writes(
    sheets: &[Value],
    original_refs: &[XlsxWorkbookSheetRef],
) -> Vec<XlsxWorkbookSheetWrite> {
    let mut used_paths = original_refs
        .iter()
        .map(|sheet| sheet.path.clone())
        .collect::<Vec<_>>();
    let mut writes = Vec::new();
    for (index, sheet) in sheets.iter().enumerate() {
        let requested = sheet
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let existing = original_refs
            .iter()
            .any(|sheet_ref| sheet_ref.path == requested);
        let path = if existing || valid_xlsx_sheet_path(&requested) {
            requested
        } else {
            next_xlsx_sheet_path(&used_paths)
        };
        if !used_paths.iter().any(|used| used == &path) {
            used_paths.push(path.clone());
        }
        let name = sheet
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Sheet {}", index + 1));
        let state = xlsx_validation_string(sheet, "state")
            .filter(|value| matches!(value.as_str(), "hidden" | "veryHidden"));
        writes.push(XlsxWorkbookSheetWrite { path, name, state });
    }
    writes
}

fn valid_xlsx_sheet_path(path: &str) -> bool {
    path.starts_with("xl/worksheets/") && path.ends_with(".xml") && !path.contains("..")
}

fn next_xlsx_sheet_path(used_paths: &[String]) -> String {
    let mut index = used_paths
        .iter()
        .filter_map(|path| {
            path.rsplit('/')
                .next()
                .and_then(|name| name.strip_prefix("sheet"))
                .and_then(|name| name.strip_suffix(".xml"))
                .and_then(|value| value.parse::<usize>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;
    loop {
        let path = format!("xl/worksheets/sheet{index}.xml");
        if !used_paths.iter().any(|used| used == &path) {
            return path;
        }
        index += 1;
    }
}

fn update_xlsx_workbook_manifest(
    workbook: &str,
    rels: &str,
    sheets: &[XlsxWorkbookSheetWrite],
) -> (String, String) {
    let existing_refs = xlsx_workbook_sheets_from_xml(workbook, rels);
    let existing_by_path = existing_refs
        .iter()
        .map(|sheet| (sheet.path.clone(), sheet.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut rels_out = rels.to_string();
    let mut next_rel = next_rid(rels);
    let mut next_sheet_id = next_xlsx_sheet_id(workbook);
    let mut sheet_tags = Vec::new();
    for sheet in sheets {
        let (rel_id, sheet_id) = if let Some(existing) = existing_by_path.get(&sheet.path) {
            (existing.rel_id.clone(), existing.sheet_id)
        } else {
            let rel_id = format!("rId{next_rel}");
            next_rel += 1;
            let rel = format!(
                r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="{}"/>"#,
                xlsx_part_to_relationship_target(&sheet.path)
            );
            rels_out = append_before_or_end(&rels_out, "</Relationships>", &rel);
            let sheet_id = next_sheet_id;
            next_sheet_id += 1;
            (rel_id, sheet_id)
        };
        let state = sheet
            .state
            .as_deref()
            .map(|state| format!(r#" state="{state}""#))
            .unwrap_or_default();
        sheet_tags.push(format!(
            r#"<sheet name="{}" sheetId="{sheet_id}" r:id="{rel_id}"{state}/>"#,
            escape_xml(&sheet.name)
        ));
    }
    let sheets_xml = format!("<sheets>{}</sheets>", sheet_tags.join(""));
    let workbook_out = replace_xml_element(workbook, "sheets", &sheets_xml)
        .unwrap_or_else(|| append_before_or_end(workbook, "</workbook>", &sheets_xml));
    (workbook_out, rels_out)
}

fn xlsx_model_has_formulas(sheets: &[Value]) -> bool {
    sheets.iter().any(|sheet| {
        sheet
            .get("rows")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|row| {
                row.get("cells")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .any(|cell| {
                        cell.get("formula")
                            .and_then(Value::as_str)
                            .map(|formula| !formula.trim().is_empty())
                            .unwrap_or(false)
                            || cell
                                .get("value")
                                .and_then(Value::as_str)
                                .map(|value| value.trim_start().starts_with('='))
                                .unwrap_or(false)
                    })
            })
    })
}

fn update_xlsx_workbook_calc_properties(workbook: &str) -> String {
    let attrs = [
        ("calcMode", "auto".to_string()),
        ("fullCalcOnLoad", "1".to_string()),
        ("forceFullCalc", "1".to_string()),
    ];
    if workbook.contains("<calcPr") {
        return set_first_xml_tag_attrs(workbook, "<calcPr", &attrs);
    }
    append_before_or_end(
        workbook,
        "</workbook>",
        r#"<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>"#,
    )
}

fn parse_xlsx_defined_names(workbook: &str) -> Vec<Value> {
    xml_named_segments(workbook, "definedName")
        .into_iter()
        .filter_map(|defined_name| {
            let name = attr_value(&defined_name, "name").map(|name| unescape_xml(&name))?;
            let mut item = json!({
                "name": name,
                "value": xlsx_defined_name_text(&defined_name),
                "sourceXml": defined_name
            });
            let source_xml = item["sourceXml"].as_str().unwrap_or_default().to_string();
            if let Some(local_sheet_id) =
                attr_value(&source_xml, "localSheetId").and_then(|value| value.parse::<u32>().ok())
            {
                item["localSheetId"] = json!(local_sheet_id);
            }
            if xml_bool_attr(&source_xml, "hidden") {
                item["hidden"] = json!(true);
            }
            if let Some(comment) = attr_value(&source_xml, "comment") {
                item["comment"] = json!(unescape_xml(&comment));
            }
            Some(item)
        })
        .collect()
}

fn xlsx_defined_name_text(defined_name: &str) -> String {
    let Some(open_end) = defined_name.find('>') else {
        return String::new();
    };
    let end_marker = "</definedName>";
    let Some(close_start) = defined_name.rfind(end_marker) else {
        return String::new();
    };
    unescape_xml(&defined_name[open_end + 1..close_start])
}

fn update_xlsx_defined_names(workbook: &str, defined_names: Option<&Vec<Value>>) -> String {
    let Some(defined_names) = defined_names else {
        return workbook.to_string();
    };
    let items = defined_names
        .iter()
        .filter_map(build_xlsx_defined_name)
        .collect::<String>();
    let replacement = if items.is_empty() {
        String::new()
    } else {
        format!("<definedNames>{items}</definedNames>")
    };
    if let Some(replaced) = replace_xml_element(workbook, "definedNames", &replacement) {
        return replaced;
    }
    if replacement.is_empty() {
        return workbook.to_string();
    }
    if let Some(index) = workbook.find("<calcPr") {
        let mut output = String::new();
        output.push_str(&workbook[..index]);
        output.push_str(&replacement);
        output.push_str(&workbook[index..]);
        return output;
    }
    append_before_or_end(workbook, "</workbook>", &replacement)
}

fn build_xlsx_defined_name(value: &Value) -> Option<String> {
    let name = xlsx_validation_string(value, "name")?;
    let text = xlsx_validation_string(value, "value").unwrap_or_default();
    if let Some(source_xml) = value
        .get("sourceXml")
        .and_then(Value::as_str)
        .filter(|source| source.starts_with("<definedName"))
    {
        let mut updated = set_first_xml_tag_attrs(source_xml, "<definedName", &[("name", name)]);
        if let Some(local_sheet_id) = value
            .get("localSheetId")
            .and_then(Value::as_u64)
            .map(|number| number.min(u32::MAX as u64) as u32)
        {
            updated = set_first_xml_tag_attrs(
                &updated,
                "<definedName",
                &[("localSheetId", local_sheet_id.to_string())],
            );
        }
        if value
            .get("hidden")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            updated =
                set_first_xml_tag_attrs(&updated, "<definedName", &[("hidden", "1".to_string())]);
        }
        if let Some(comment) = xlsx_validation_string(value, "comment") {
            updated = set_first_xml_tag_attrs(&updated, "<definedName", &[("comment", comment)]);
        }
        return Some(replace_xlsx_defined_name_text(&updated, &text));
    }
    let mut attrs = vec![format!(r#"name="{}""#, escape_xml(&name))];
    if let Some(local_sheet_id) = value
        .get("localSheetId")
        .and_then(Value::as_u64)
        .map(|number| number.min(u32::MAX as u64) as u32)
    {
        attrs.push(format!(r#"localSheetId="{local_sheet_id}""#));
    }
    if value
        .get("hidden")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        attrs.push(r#"hidden="1""#.to_string());
    }
    if let Some(comment) = xlsx_validation_string(value, "comment") {
        attrs.push(format!(r#"comment="{}""#, escape_xml(&comment)));
    }
    Some(format!(
        "<definedName {}>{}</definedName>",
        attrs.join(" "),
        escape_xml(&text)
    ))
}

fn replace_xlsx_defined_name_text(source_xml: &str, text: &str) -> String {
    let Some(open_end) = source_xml.find('>') else {
        return source_xml.to_string();
    };
    let end_marker = "</definedName>";
    let Some(close_start) = source_xml.rfind(end_marker) else {
        return source_xml.to_string();
    };
    let mut output = String::new();
    output.push_str(&source_xml[..=open_end]);
    output.push_str(&escape_xml(text));
    output.push_str(&source_xml[close_start..]);
    output
}

fn xlsx_part_to_relationship_target(path: &str) -> String {
    path.strip_prefix("xl/").unwrap_or(path).to_string()
}

fn next_xlsx_sheet_id(workbook: &str) -> u32 {
    xml_empty_elements(workbook, "<sheet ")
        .iter()
        .filter_map(|sheet| attr_value(sheet, "sheetId"))
        .filter_map(|value| value.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        + 1
}

fn append_xlsx_sheet_content_types(
    content_types: &str,
    sheets: &[XlsxWorkbookSheetWrite],
) -> String {
    let mut output = content_types.to_string();
    for sheet in sheets {
        let part_name = format!("/{}", sheet.path);
        if output.contains(&part_name) {
            continue;
        }
        let override_xml = format!(
            r#"<Override PartName="{part_name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#
        );
        output = append_before_or_end(&output, "</Types>", &override_xml);
    }
    output
}

fn build_xlsx_worksheet(update: &SheetUpdate) -> String {
    let sheet_pr = build_sheet_pr(update.tab_color_xml.as_deref());
    let columns = build_sheet_columns(&update.columns);
    let sheet_data = build_sheet_data(update, &BTreeMap::new());
    let protection = build_sheet_protection(update.protection.as_ref());
    let auto_filter = build_sheet_auto_filter(update.auto_filter.as_deref());
    let merge_cells = build_sheet_merge_cells(&update.merged_ranges);
    let conditional_formattings =
        build_sheet_conditional_formattings(&update.conditional_formattings);
    let data_validations = build_sheet_data_validations(&update.data_validations);
    let hyperlinks = build_sheet_hyperlinks(&update.hyperlinks);
    let page_margins = build_sheet_page_margins(update.page_margins.as_ref());
    let page_setup = build_sheet_page_setup(update.page_setup.as_ref());
    let sheet_views = build_sheet_views(update.frozen_rows, update.frozen_columns);
    let worksheet = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{sheet_pr}<dimension ref="A1"/>{sheet_views}{columns}{sheet_data}{protection}{auto_filter}{merge_cells}{conditional_formattings}{data_validations}{hyperlinks}{page_margins}{page_setup}</worksheet>"#
    );
    let worksheet = ensure_xlsx_relationship_namespace(&worksheet, &update.hyperlinks);
    update_sheet_dimension(&worksheet, update.cells.keys())
}

fn update_xlsx_worksheet(xml: &str, update: &SheetUpdate) -> String {
    let original_cells = original_sheet_cells(xml);
    let sheet_data = build_sheet_data(update, &original_cells);
    let replaced = replace_xml_element(xml, "sheetData", &sheet_data)
        .unwrap_or_else(|| insert_sheet_data(xml, &sheet_data));
    let replaced = update_sheet_pr(&replaced, update.tab_color_xml.as_deref());
    let replaced = update_sheet_views(&replaced, update.frozen_rows, update.frozen_columns);
    let replaced = update_sheet_columns(&replaced, &update.columns);
    let replaced = update_sheet_protection(&replaced, update.protection.as_ref());
    let replaced = update_sheet_auto_filter(&replaced, update.auto_filter.as_deref());
    let replaced = update_sheet_merge_cells(&replaced, &update.merged_ranges);
    let replaced = update_sheet_conditional_formattings(&replaced, &update.conditional_formattings);
    let replaced = update_sheet_data_validations(&replaced, &update.data_validations);
    let replaced = update_sheet_hyperlinks(&replaced, &update.hyperlinks);
    let replaced = update_sheet_page_margins(&replaced, update.page_margins.as_ref());
    let replaced = update_sheet_page_setup(&replaced, update.page_setup.as_ref());
    let replaced = ensure_xlsx_relationship_namespace(&replaced, &update.hyperlinks);
    update_sheet_dimension(&replaced, update.cells.keys())
}

fn build_sheet_pr(tab_color_xml: Option<&str>) -> String {
    tab_color_xml
        .filter(|xml| !xml.trim().is_empty())
        .map(|xml| format!("<sheetPr>{xml}</sheetPr>"))
        .unwrap_or_default()
}

fn update_sheet_pr(xml: &str, tab_color_xml: Option<&str>) -> String {
    let tab_color_xml = tab_color_xml.filter(|value| !value.trim().is_empty());
    if let Some(sheet_pr) = xml_named_segments(xml, "sheetPr").into_iter().next() {
        let updated = update_sheet_pr_tab_color(&sheet_pr, tab_color_xml);
        return replace_xml_element(xml, "sheetPr", &updated).unwrap_or_else(|| xml.to_string());
    }
    if let Some(sheet_pr) = xml_named_empty_elements(xml, "sheetPr").into_iter().next() {
        let replacement = tab_color_xml
            .map(|tab_color| {
                let opening = sheet_pr.trim_end_matches("/>").trim_end();
                format!("{opening}>{tab_color}</sheetPr>")
            })
            .unwrap_or_else(|| sheet_pr.clone());
        return replace_empty_xml_element(xml, "<sheetPr", &replacement);
    }
    let Some(tab_color_xml) = tab_color_xml else {
        return xml.to_string();
    };
    let sheet_pr = build_sheet_pr(Some(tab_color_xml));
    if let Some(index) = xml.find("<dimension") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_pr);
        output.push_str(&xml[index..]);
        return output;
    }
    if let Some(index) = xml.find("<sheetViews") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_pr);
        output.push_str(&xml[index..]);
        return output;
    }
    if let Some(index) = xml.find("<sheetData") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_pr);
        output.push_str(&xml[index..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &sheet_pr)
}

fn update_sheet_pr_tab_color(sheet_pr: &str, tab_color_xml: Option<&str>) -> String {
    let stripped = remove_xml_named_elements(sheet_pr, "tabColor");
    let Some(tab_color_xml) = tab_color_xml else {
        return stripped;
    };
    let Some(open_end) = stripped.find('>') else {
        return stripped;
    };
    let mut output = String::new();
    output.push_str(&stripped[..=open_end]);
    output.push_str(tab_color_xml);
    output.push_str(&stripped[open_end + 1..]);
    output
}

fn build_sheet_cell(original: &str, reference: &str, cell: &SheetCellWrite) -> String {
    let style = cell
        .style_index
        .map(|style| style.to_string())
        .or_else(|| attr_value(original, "s"))
        .map(|style| format!(r#" s="{}""#, escape_xml(&style)))
        .unwrap_or_default();
    if let Some(formula) = cell
        .formula
        .as_deref()
        .filter(|formula| !formula.is_empty())
    {
        let value = if cell.value.is_empty() {
            String::new()
        } else {
            format!("<v>{}</v>", escape_xml(&cell.value))
        };
        return format!(
            r#"<c r="{reference}"{style}><f>{}</f>{value}</c>"#,
            escape_xml(formula)
        );
    }
    format!(
        r#"<c r="{reference}"{style} t="inlineStr"><is><t>{}</t></is></c>"#,
        escape_xml(&cell.value)
    )
}

fn original_sheet_cells(xml: &str) -> BTreeMap<String, String> {
    let mut cells = BTreeMap::new();
    for cell in xml_segments(xml, "<c", "</c>") {
        if let Some(reference) = attr_value(&cell, "r") {
            cells.insert(reference, cell);
        }
    }
    cells
}

fn build_sheet_data(update: &SheetUpdate, original_cells: &BTreeMap<String, String>) -> String {
    let mut rows: BTreeMap<u32, Vec<(u32, String, SheetCellWrite)>> = BTreeMap::new();
    for (reference, value) in &update.cells {
        if let Some((column, row)) = split_cell_reference(reference) {
            rows.entry(row)
                .or_default()
                .push((column, reference.clone(), value.clone()));
        }
    }
    for row in update.rows.keys() {
        rows.entry(*row).or_default();
    }
    let mut output = String::from("<sheetData>");
    for (row_index, mut cells) in rows {
        cells.sort_by_key(|(column, _, _)| *column);
        output.push_str(&build_sheet_row_start(
            row_index,
            update.rows.get(&row_index),
        ));
        for (_, reference, value) in cells {
            let original = original_cells
                .get(&reference)
                .map(String::as_str)
                .unwrap_or_default();
            output.push_str(&build_sheet_cell(original, &reference, &value));
        }
        output.push_str("</row>");
    }
    output.push_str("</sheetData>");
    output
}

fn build_sheet_row_start(row_index: u32, row: Option<&SheetRowWrite>) -> String {
    let mut attrs = format!(r#" r="{row_index}""#);
    if let Some(row) = row {
        if let Some(height) = row.height {
            attrs.push_str(&format!(r#" ht="{}" customHeight="1""#, trim_float(height)));
        }
        if row.hidden {
            attrs.push_str(r#" hidden="1""#);
        }
    }
    format!("<row{attrs}>")
}

fn build_sheet_columns(columns: &[SheetColumnWrite]) -> String {
    if columns.is_empty() {
        return String::new();
    }
    let mut output = String::from("<cols>");
    for column in columns {
        let mut attrs = format!(r#" min="{0}" max="{0}""#, column.index);
        if let Some(width) = column.width {
            attrs.push_str(&format!(
                r#" width="{}" customWidth="1""#,
                trim_float(width)
            ));
        }
        if column.hidden {
            attrs.push_str(r#" hidden="1""#);
        }
        output.push_str(&format!("<col{attrs}/>"));
    }
    output.push_str("</cols>");
    output
}

fn update_sheet_columns(xml: &str, columns: &[SheetColumnWrite]) -> String {
    let columns_xml = build_sheet_columns(columns);
    if let Some(replaced) = replace_xml_element(xml, "cols", &columns_xml) {
        return replaced;
    }
    if columns_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("<sheetData") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&columns_xml);
        output.push_str(&xml[index..]);
        return output;
    }
    xml.to_string()
}

fn build_sheet_merge_cells(ranges: &[String]) -> String {
    if ranges.is_empty() {
        return String::new();
    }
    let cells = ranges
        .iter()
        .map(|range| format!(r#"<mergeCell ref="{}"/>"#, escape_xml(range)))
        .collect::<String>();
    format!(
        r#"<mergeCells count="{}">{cells}</mergeCells>"#,
        ranges.len()
    )
}

fn update_sheet_merge_cells(xml: &str, ranges: &[String]) -> String {
    let merge_xml = build_sheet_merge_cells(ranges);
    if let Some(replaced) = replace_xml_element(xml, "mergeCells", &merge_xml) {
        return replaced;
    }
    if merge_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&merge_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &merge_xml)
}

fn build_sheet_auto_filter(reference: Option<&str>) -> String {
    reference
        .filter(|reference| valid_xlsx_range_reference(reference))
        .map(|reference| format!(r#"<autoFilter ref="{}"/>"#, escape_xml(reference)))
        .unwrap_or_default()
}

fn update_sheet_auto_filter(xml: &str, reference: Option<&str>) -> String {
    let auto_filter_xml = build_sheet_auto_filter(reference);
    if let Some(replaced) = replace_xml_element(xml, "autoFilter", &auto_filter_xml) {
        return replaced;
    }
    if xml.contains("<autoFilter") {
        return replace_empty_xml_element(xml, "<autoFilter", &auto_filter_xml);
    }
    if auto_filter_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&auto_filter_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &auto_filter_xml)
}

fn build_sheet_data_validations(validations: &[SheetDataValidation]) -> String {
    if validations.is_empty() {
        return String::new();
    }
    let children = validations
        .iter()
        .map(build_sheet_data_validation)
        .collect::<String>();
    format!(
        r#"<dataValidations count="{}">{children}</dataValidations>"#,
        validations.len()
    )
}

fn build_sheet_data_validation(validation: &SheetDataValidation) -> String {
    let mut attrs = vec![format!(r#"sqref="{}""#, escape_xml(&validation.sqref))];
    if let Some(validation_type) = &validation.validation_type {
        attrs.push(format!(r#"type="{}""#, escape_xml(validation_type)));
    }
    if let Some(operator) = &validation.operator {
        attrs.push(format!(r#"operator="{}""#, escape_xml(operator)));
    }
    if validation.allow_blank {
        attrs.push(r#"allowBlank="1""#.to_string());
    }
    if validation.show_input_message {
        attrs.push(r#"showInputMessage="1""#.to_string());
    }
    if validation.show_error_message {
        attrs.push(r#"showErrorMessage="1""#.to_string());
    }
    if let Some(prompt_title) = &validation.prompt_title {
        attrs.push(format!(r#"promptTitle="{}""#, escape_xml(prompt_title)));
    }
    if let Some(prompt) = &validation.prompt {
        attrs.push(format!(r#"prompt="{}""#, escape_xml(prompt)));
    }
    if let Some(error_title) = &validation.error_title {
        attrs.push(format!(r#"errorTitle="{}""#, escape_xml(error_title)));
    }
    if let Some(error) = &validation.error {
        attrs.push(format!(r#"error="{}""#, escape_xml(error)));
    }
    let formula1 = validation
        .formula1
        .as_deref()
        .map(|formula| format!("<formula1>{}</formula1>", escape_xml(formula)))
        .unwrap_or_default();
    let formula2 = validation
        .formula2
        .as_deref()
        .map(|formula| format!("<formula2>{}</formula2>", escape_xml(formula)))
        .unwrap_or_default();
    if formula1.is_empty() && formula2.is_empty() {
        format!("<dataValidation {}/>", attrs.join(" "))
    } else {
        format!(
            "<dataValidation {}>{formula1}{formula2}</dataValidation>",
            attrs.join(" ")
        )
    }
}

fn update_sheet_data_validations(xml: &str, validations: &[SheetDataValidation]) -> String {
    let validations_xml = build_sheet_data_validations(validations);
    if let Some(replaced) = replace_xml_element(xml, "dataValidations", &validations_xml) {
        return replaced;
    }
    if xml.contains("<dataValidations") {
        return replace_empty_xml_element(xml, "<dataValidations", &validations_xml);
    }
    if validations_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</mergeCells>") {
        let insert_at = index + "</mergeCells>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&validations_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&validations_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &validations_xml)
}

fn build_sheet_conditional_formattings(formatings: &[SheetConditionalFormatting]) -> String {
    formatings
        .iter()
        .filter(|formatting| valid_xlsx_sqref(&formatting.sqref))
        .filter_map(|formatting| {
            let rules = formatting
                .rules
                .iter()
                .enumerate()
                .filter_map(|(index, rule)| build_sheet_conditional_rule(rule, index + 1))
                .collect::<String>();
            if rules.is_empty() {
                return None;
            }
            Some(format!(
                r#"<conditionalFormatting sqref="{}">{rules}</conditionalFormatting>"#,
                escape_xml(&formatting.sqref)
            ))
        })
        .collect::<String>()
}

fn build_sheet_conditional_rule(
    rule: &SheetConditionalRule,
    fallback_priority: usize,
) -> Option<String> {
    if let Some(source_xml) = rule.source_xml.as_deref() {
        return Some(source_xml.to_string());
    }
    let rule_type = rule.rule_type.as_deref()?;
    if !valid_xlsx_conditional_rule_type(rule_type) {
        return None;
    }
    let priority = rule.priority.unwrap_or(fallback_priority as u32);
    let mut attrs = vec![
        format!(r#"type="{}""#, escape_xml(rule_type)),
        format!(r#"priority="{priority}""#),
    ];
    if let Some(operator) = &rule.operator {
        attrs.push(format!(r#"operator="{}""#, escape_xml(operator)));
    }
    if let Some(dxf_id) = rule.dxf_id {
        attrs.push(format!(r#"dxfId="{dxf_id}""#));
    }
    if let Some(text) = &rule.text {
        attrs.push(format!(r#"text="{}""#, escape_xml(text)));
    }
    if let Some(time_period) = &rule.time_period {
        attrs.push(format!(r#"timePeriod="{}""#, escape_xml(time_period)));
    }
    let formulas = rule
        .formulas
        .iter()
        .map(|formula| format!("<formula>{}</formula>", escape_xml(formula)))
        .collect::<String>();
    if formulas.is_empty() {
        Some(format!("<cfRule {}/>", attrs.join(" ")))
    } else {
        Some(format!("<cfRule {}>{formulas}</cfRule>", attrs.join(" ")))
    }
}

fn update_sheet_conditional_formattings(
    xml: &str,
    formatings: &[SheetConditionalFormatting],
) -> String {
    let formattings_xml = build_sheet_conditional_formattings(formatings);
    let stripped = remove_xml_named_elements(xml, "conditionalFormatting");
    if formattings_xml.is_empty() {
        return stripped;
    }
    if let Some(index) = stripped.find("</mergeCells>") {
        let insert_at = index + "</mergeCells>".len();
        let mut output = String::new();
        output.push_str(&stripped[..insert_at]);
        output.push_str(&formattings_xml);
        output.push_str(&stripped[insert_at..]);
        return output;
    }
    if let Some(index) = stripped.find("<dataValidations") {
        let mut output = String::new();
        output.push_str(&stripped[..index]);
        output.push_str(&formattings_xml);
        output.push_str(&stripped[index..]);
        return output;
    }
    if let Some(index) = stripped.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&stripped[..insert_at]);
        output.push_str(&formattings_xml);
        output.push_str(&stripped[insert_at..]);
        return output;
    }
    append_before_or_end(&stripped, "</worksheet>", &formattings_xml)
}

fn build_sheet_protection(protection: Option<&SheetProtection>) -> String {
    let Some(protection) = protection.filter(|protection| protection.enabled) else {
        return String::new();
    };
    let mut attrs = vec![r#"sheet="1""#.to_string()];
    if let Some(password) = &protection.password {
        attrs.push(format!(r#"password="{}""#, escape_xml(password)));
    }
    for (enabled, xml_key) in [
        (protection.objects, "objects"),
        (protection.scenarios, "scenarios"),
        (protection.format_cells, "formatCells"),
        (protection.format_columns, "formatColumns"),
        (protection.format_rows, "formatRows"),
        (protection.insert_columns, "insertColumns"),
        (protection.insert_rows, "insertRows"),
        (protection.insert_hyperlinks, "insertHyperlinks"),
        (protection.delete_columns, "deleteColumns"),
        (protection.delete_rows, "deleteRows"),
        (protection.sort, "sort"),
        (protection.auto_filter, "autoFilter"),
        (protection.pivot_tables, "pivotTables"),
    ] {
        if enabled {
            attrs.push(format!(r#"{xml_key}="1""#));
        }
    }
    format!("<sheetProtection {}/>", attrs.join(" "))
}

fn update_sheet_protection(xml: &str, protection: Option<&SheetProtection>) -> String {
    let protection_xml = build_sheet_protection(protection);
    if let Some(replaced) = replace_xml_element(xml, "sheetProtection", &protection_xml) {
        return replaced;
    }
    if xml.contains("<sheetProtection") {
        return replace_empty_xml_element(xml, "<sheetProtection", &protection_xml);
    }
    if protection_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&protection_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &protection_xml)
}

fn build_sheet_page_margins(margins: Option<&SheetPageMargins>) -> String {
    let Some(margins) = margins else {
        return String::new();
    };
    let mut attrs = Vec::new();
    for (value, key) in [
        (margins.left, "left"),
        (margins.right, "right"),
        (margins.top, "top"),
        (margins.bottom, "bottom"),
        (margins.header, "header"),
        (margins.footer, "footer"),
    ] {
        if let Some(value) = value {
            attrs.push(format!(r#"{key}="{}""#, trim_float(value)));
        }
    }
    if attrs.is_empty() {
        String::new()
    } else {
        format!("<pageMargins {}/>", attrs.join(" "))
    }
}

fn update_sheet_page_margins(xml: &str, margins: Option<&SheetPageMargins>) -> String {
    let margins_xml = build_sheet_page_margins(margins);
    if let Some(replaced) = replace_xml_element(xml, "pageMargins", &margins_xml) {
        return replaced;
    }
    if xml.contains("<pageMargins") {
        return replace_empty_xml_element(xml, "<pageMargins", &margins_xml);
    }
    if margins_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("<pageSetup") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&margins_xml);
        output.push_str(&xml[index..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &margins_xml)
}

fn build_sheet_page_setup(setup: Option<&SheetPageSetup>) -> String {
    let Some(setup) = setup else {
        return String::new();
    };
    let mut attrs = Vec::new();
    if let Some(orientation) = &setup.orientation {
        attrs.push(format!(r#"orientation="{}""#, escape_xml(orientation)));
    }
    for (value, key) in [
        (setup.paper_size, "paperSize"),
        (setup.scale, "scale"),
        (setup.fit_to_width, "fitToWidth"),
        (setup.fit_to_height, "fitToHeight"),
    ] {
        if let Some(value) = value {
            attrs.push(format!(r#"{key}="{value}""#));
        }
    }
    if attrs.is_empty() {
        String::new()
    } else {
        format!("<pageSetup {}/>", attrs.join(" "))
    }
}

fn update_sheet_page_setup(xml: &str, setup: Option<&SheetPageSetup>) -> String {
    let setup_xml = build_sheet_page_setup(setup);
    if let Some(replaced) = replace_xml_element(xml, "pageSetup", &setup_xml) {
        return replaced;
    }
    if xml.contains("<pageSetup") {
        return replace_empty_xml_element(xml, "<pageSetup", &setup_xml);
    }
    if setup_xml.is_empty() {
        return xml.to_string();
    }
    append_before_or_end(xml, "</worksheet>", &setup_xml)
}

fn build_sheet_hyperlinks(hyperlinks: &[SheetHyperlink]) -> String {
    if hyperlinks.is_empty() {
        return String::new();
    }
    let links = hyperlinks
        .iter()
        .filter(|hyperlink| valid_xlsx_sqref(&hyperlink.reference))
        .filter_map(|hyperlink| {
            if hyperlink.relationship_id.is_none() && hyperlink.location.is_none() {
                return None;
            }
            let mut attrs = vec![format!(r#"ref="{}""#, escape_xml(&hyperlink.reference))];
            if let Some(relationship_id) = &hyperlink.relationship_id {
                attrs.push(format!(r#"r:id="{}""#, escape_xml(relationship_id)));
            }
            if let Some(location) = &hyperlink.location {
                attrs.push(format!(r#"location="{}""#, escape_xml(location)));
            }
            if let Some(display) = &hyperlink.display {
                attrs.push(format!(r#"display="{}""#, escape_xml(display)));
            }
            if let Some(tooltip) = &hyperlink.tooltip {
                attrs.push(format!(r#"tooltip="{}""#, escape_xml(tooltip)));
            }
            Some(format!("<hyperlink {}/>", attrs.join(" ")))
        })
        .collect::<String>();
    if links.is_empty() {
        String::new()
    } else {
        format!("<hyperlinks>{links}</hyperlinks>")
    }
}

fn update_sheet_hyperlinks(xml: &str, hyperlinks: &[SheetHyperlink]) -> String {
    let hyperlinks_xml = build_sheet_hyperlinks(hyperlinks);
    if let Some(replaced) = replace_xml_element(xml, "hyperlinks", &hyperlinks_xml) {
        return replaced;
    }
    if xml.contains("<hyperlinks") {
        return replace_empty_xml_element(xml, "<hyperlinks", &hyperlinks_xml);
    }
    if hyperlinks_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</dataValidations>") {
        let insert_at = index + "</dataValidations>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&hyperlinks_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    if let Some(index) = xml.find("</conditionalFormatting>") {
        let insert_at = index + "</conditionalFormatting>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&hyperlinks_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&hyperlinks_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &hyperlinks_xml)
}

fn update_sheet_legacy_drawing(xml: &str, relationship_id: Option<&str>) -> String {
    let Some(relationship_id) = relationship_id else {
        return xml.to_string();
    };
    let legacy_xml = format!(r#"<legacyDrawing r:id="{}"/>"#, escape_xml(relationship_id));
    let updated = if let Some(replaced) = replace_xml_element(xml, "legacyDrawing", &legacy_xml) {
        replaced
    } else if xml.contains("<legacyDrawing") {
        replace_empty_xml_element(xml, "<legacyDrawing", &legacy_xml)
    } else if let Some(index) = xml.find("<pageMargins") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&legacy_xml);
        output.push_str(&xml[index..]);
        output
    } else if let Some(index) = xml.find("<pageSetup") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&legacy_xml);
        output.push_str(&xml[index..]);
        output
    } else {
        append_before_or_end(xml, "</worksheet>", &legacy_xml)
    };
    ensure_xlsx_relationship_namespace_for_r_id(&updated)
}

fn ensure_xlsx_relationship_namespace(xml: &str, hyperlinks: &[SheetHyperlink]) -> String {
    if !hyperlinks
        .iter()
        .any(|hyperlink| hyperlink.relationship_id.is_some())
        || xml.contains("xmlns:r=")
    {
        return xml.to_string();
    }
    ensure_xlsx_relationship_namespace_for_r_id(xml)
}

fn ensure_xlsx_relationship_namespace_for_r_id(xml: &str) -> String {
    if xml.contains("xmlns:r=") {
        return xml.to_string();
    }
    let Some(start) = xml.find("<worksheet") else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find('>') else {
        return xml.to_string();
    };
    let original = &after_start[..=end];
    let updated = set_xml_attr(
        original,
        "xmlns:r",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );
    let mut output = String::new();
    output.push_str(&xml[..start]);
    output.push_str(&updated);
    output.push_str(&after_start[end + 1..]);
    output
}

fn update_sheet_hyperlink_relationships(
    original_rels: Option<&str>,
    update: &mut SheetUpdate,
) -> Option<String> {
    let has_external_hyperlinks = update.hyperlinks.iter().any(|link| link.target.is_some());
    if original_rels.is_none() && !has_external_hyperlinks {
        return None;
    }
    let mut rels = original_rels
        .map(str::to_string)
        .unwrap_or_else(xlsx_empty_relationships);
    rels = remove_relationships_by_type(&rels, "/hyperlink");
    let mut next_id = next_rid(&rels);
    for hyperlink in &mut update.hyperlinks {
        let Some(target) = hyperlink.target.as_deref() else {
            hyperlink.relationship_id = None;
            continue;
        };
        let relationship_id = format!("rId{next_id}");
        next_id += 1;
        let relationship = format!(
            r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{}" TargetMode="External"/>"#,
            escape_xml(target)
        );
        rels = append_before_or_end(&rels, "</Relationships>", &relationship);
        hyperlink.relationship_id = Some(relationship_id);
    }
    Some(rels)
}

fn update_sheet_comments_package(
    sheet_path: &str,
    rels_replacement: &mut Option<String>,
    comments: &[SheetComment],
    existing_names: &[String],
    replacements: &mut Vec<(String, Vec<u8>)>,
    comments_content_types: &mut Vec<String>,
    needs_vml_content_type: &mut bool,
) -> Option<String> {
    if comments.is_empty() {
        return None;
    }
    let rels = rels_replacement.get_or_insert_with(xlsx_empty_relationships);
    let comments_path = xlsx_relationship_by_type(sheet_path, rels, "/comments")
        .map(|(_, path)| path)
        .unwrap_or_else(|| next_xlsx_comments_path(existing_names, comments_content_types));
    let vml_path = xlsx_relationship_by_type(sheet_path, rels, "/vmlDrawing")
        .map(|(_, path)| path)
        .unwrap_or_else(|| next_xlsx_vml_path(existing_names, replacements));
    let (updated_rels, _) = ensure_xlsx_sheet_relationship(
        rels,
        sheet_path,
        &comments_path,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
    );
    let (updated_rels, legacy_drawing_id) = ensure_xlsx_sheet_relationship(
        &updated_rels,
        sheet_path,
        &vml_path,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
    );
    *rels = updated_rels;
    replacements.push((
        comments_path.clone(),
        build_xlsx_comments_xml(comments).into_bytes(),
    ));
    replacements.push((vml_path, build_xlsx_comments_vml(comments).into_bytes()));
    if !comments_content_types
        .iter()
        .any(|path| path == &comments_path)
    {
        comments_content_types.push(comments_path);
    }
    *needs_vml_content_type = true;
    Some(legacy_drawing_id)
}

fn xlsx_relationship_by_type(
    source_part: &str,
    rels: &str,
    type_suffix: &str,
) -> Option<(String, String)> {
    xml_named_empty_elements(rels, "Relationship")
        .into_iter()
        .find_map(|relationship| {
            let relationship_id = attr_value(&relationship, "Id")?;
            let relationship_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !relationship_type.ends_with(type_suffix) {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some((
                relationship_id,
                xlsx_relationship_target_to_part_from(source_part, &target),
            ))
        })
}

fn ensure_xlsx_sheet_relationship(
    rels: &str,
    source_part: &str,
    target_part: &str,
    relationship_type: &str,
) -> (String, String) {
    if let Some((relationship_id, _)) = xlsx_relationship_by_type(
        source_part,
        rels,
        relationship_type.rsplit('/').next().unwrap_or_default(),
    ) {
        return (rels.to_string(), relationship_id);
    }
    let relationship_id = format!("rId{}", next_rid(rels));
    let target = xlsx_part_to_relationship_target_from(source_part, target_part);
    let relationship = format!(
        r#"<Relationship Id="{relationship_id}" Type="{relationship_type}" Target="{}"/>"#,
        escape_xml(&target)
    );
    (
        append_before_or_end(rels, "</Relationships>", &relationship),
        relationship_id,
    )
}

fn next_xlsx_comments_path(existing_names: &[String], allocated_paths: &[String]) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("xl/comments{index}.xml");
        if !existing_names.iter().any(|name| name == &path)
            && !allocated_paths.iter().any(|name| name == &path)
        {
            return path;
        }
        index += 1;
    }
}

fn next_xlsx_vml_path(existing_names: &[String], replacements: &[(String, Vec<u8>)]) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("xl/drawings/vmlDrawing{index}.vml");
        if !existing_names.iter().any(|name| name == &path)
            && !replacements.iter().any(|(name, _)| name == &path)
        {
            return path;
        }
        index += 1;
    }
}

fn xlsx_part_to_relationship_target_from(source_part: &str, target_part: &str) -> String {
    if source_part.starts_with("xl/worksheets/") && target_part.starts_with("xl/") {
        return format!("../{}", target_part.trim_start_matches("xl/"));
    }
    target_part.to_string()
}

fn build_xlsx_comments_xml(comments: &[SheetComment]) -> String {
    let mut author_ids = BTreeMap::new();
    for comment in comments {
        let author = comment.author.as_deref().unwrap_or("mymy").to_string();
        if !author_ids.contains_key(&author) {
            author_ids.insert(author, author_ids.len());
        }
    }
    let authors = author_ids
        .keys()
        .map(|author| format!("<author>{}</author>", escape_xml(author)))
        .collect::<String>();
    let comment_list = comments
        .iter()
        .map(|comment| {
            let author = comment.author.as_deref().unwrap_or("mymy");
            let author_id = author_ids.get(author).copied().unwrap_or(0);
            format!(
                r#"<comment ref="{}" authorId="{author_id}"><text><t xml:space="preserve">{}</t></text></comment>"#,
                escape_xml(&comment.reference),
                escape_xml(&comment.text)
            )
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors>{authors}</authors><commentList>{comment_list}</commentList></comments>"#
    )
}

fn build_xlsx_comments_vml(comments: &[SheetComment]) -> String {
    let shapes = comments
        .iter()
        .enumerate()
        .filter_map(|(index, comment)| {
            let (column, row) = split_cell_reference(&comment.reference)?;
            let row_index = row.saturating_sub(1);
            let column_index = column.saturating_sub(1);
            let shape_id = 1025 + index;
            Some(format!(
                r##"<v:shape id="_x0000_s{shape_id}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:{index};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>1, 15, 0, 2, 3, 15, 4, 16</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>{row_index}</x:Row><x:Column>{column_index}</x:Column></x:ClientData></v:shape>"##
            ))
        })
        .collect::<String>();
    format!(
        r##"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>{shapes}</xml>"##
    )
}

fn remove_relationships_by_type(rels: &str, type_suffix: &str) -> String {
    let mut output = String::new();
    let mut rest = rels;
    while let Some(start) = find_xml_tag_start(rest, "Relationship") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let element = &after_start[..=end];
        let relationship_type = attr_value(element, "Type").unwrap_or_default();
        if !relationship_type.ends_with(type_suffix) {
            output.push_str(element);
        }
        rest = &after_start[end + 1..];
    }
    output.push_str(rest);
    output
}

fn insert_sheet_data(xml: &str, sheet_data: &str) -> String {
    if let Some(index) = xml.find("</worksheet>") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(sheet_data);
        output.push_str(&xml[index..]);
        return output;
    }
    format!("{xml}{sheet_data}")
}

fn update_sheet_dimension<'a>(xml: &str, references: impl Iterator<Item = &'a String>) -> String {
    let Some((max_column, max_row)) = max_cell_reference(references) else {
        return xml.to_string();
    };
    let dimension = format!(
        r#"<dimension ref="A1:{}{}"/>"#,
        column_letters(max_column),
        max_row
    );
    if let Some(start) = xml.find("<dimension") {
        let after_start = &xml[start..];
        if let Some(end) = after_start.find("/>") {
            let mut output = String::new();
            output.push_str(&xml[..start]);
            output.push_str(&dimension);
            output.push_str(&after_start[end + 2..]);
            return output;
        }
    }
    if let Some(index) = xml.find("<sheetData") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&dimension);
        output.push_str(&xml[index..]);
        return output;
    }
    xml.to_string()
}

fn max_cell_reference<'a>(references: impl Iterator<Item = &'a String>) -> Option<(u32, u32)> {
    let mut max_column = 0;
    let mut max_row = 0;
    for reference in references {
        if let Some((column, row)) = split_cell_reference(reference) {
            max_column = max_column.max(column);
            max_row = max_row.max(row);
        }
    }
    if max_column == 0 || max_row == 0 {
        None
    } else {
        Some((max_column, max_row))
    }
}

fn split_cell_reference(reference: &str) -> Option<(u32, u32)> {
    let mut column = 0u32;
    let mut row = String::new();
    for ch in reference.chars() {
        if ch.is_ascii_alphabetic() {
            column = column * 26 + (ch.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
        } else if ch.is_ascii_digit() {
            row.push(ch);
        }
    }
    let row = row.parse::<u32>().ok()?;
    if column == 0 || row == 0 {
        None
    } else {
        Some((column, row))
    }
}

fn valid_xlsx_range_reference(reference: &str) -> bool {
    let Some((start, end)) = reference.split_once(':') else {
        return false;
    };
    split_cell_reference(start).is_some() && split_cell_reference(end).is_some()
}

fn valid_xlsx_sqref(reference: &str) -> bool {
    let references = reference.split_whitespace().collect::<Vec<_>>();
    !references.is_empty()
        && references.iter().all(|item| {
            if item.contains(':') {
                valid_xlsx_range_reference(item)
            } else {
                split_cell_reference(item).is_some()
            }
        })
}

fn trim_float(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

fn pptx_shape_texts(xml: &str) -> Vec<Value> {
    pptx_shape_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (offset, shape))| {
            let text = extract_text_tags(&shape, "a:t").join("");
            if text.trim().is_empty() {
                return None;
            }
            let text_index = extract_text_tags(&xml[..offset], "a:t").len();
            let (x, y, width, height, rotation) = pptx_shape_geometry(&shape);
            let run = pptx_run_properties_segment(&shape).unwrap_or_default();
            Some(json!({
                "id": format!("t{}", index + 1),
                "text": text,
                "textIndex": text_index,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "fontSize": pptx_run_font_size(&run).map(|size| size.to_string()),
                "fontFamily": docx_tag_attr(&run, "<a:latin", "typeface"),
                "color": pptx_run_color(&run).map(|color| format!("#{color}")),
                "fillColor": pptx_shape_fill_color(&shape).map(|color| format!("#{color}")),
                "bold": docx_tag_attr(&run, "<a:rPr", "b").is_some_and(|value| value == "1"),
                "italic": docx_tag_attr(&run, "<a:rPr", "i").is_some_and(|value| value == "1"),
                "underline": docx_tag_attr(&run, "<a:rPr", "u").is_some_and(|value| value == "sng"),
                "strikethrough": docx_tag_attr(&run, "<a:rPr", "strike").is_some_and(|value| value == "sngStrike"),
                "align": pptx_paragraph_alignment(&shape)
            }))
        })
        .collect()
}

fn pptx_shape_segments(xml: &str) -> Vec<(usize, String)> {
    let mut shapes = Vec::new();
    let mut offset = 0usize;
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, "<p:sp") {
        let absolute_start = offset + start;
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:sp>") else {
            break;
        };
        let end_index = end + "</p:sp>".len();
        shapes.push((absolute_start, after_start[..end_index].to_string()));
        offset = absolute_start + end_index;
        rest = &xml[offset..];
    }
    shapes
}

fn pptx_slide_shapes(xml: &str) -> Vec<Value> {
    xml_segments(xml, "<p:sp", "</p:sp>")
        .into_iter()
        .enumerate()
        .filter_map(|(index, shape)| {
            let kind = pptx_managed_basic_shape_kind(&shape)?;
            let (x, y, width, height, rotation) = pptx_shape_geometry(&shape);
            Some(json!({
                "id": format!("s{}", index + 1),
                "kind": kind.as_value(),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "fillColor": pptx_shape_fill_color(&shape).map(|color| format!("#{color}")),
                "strokeColor": pptx_shape_stroke_color(&shape).map(|color| format!("#{color}")),
                "strokeWidth": pptx_shape_stroke_width(&shape)
            }))
        })
        .collect()
}

fn pptx_slide_tables(xml: &str) -> Vec<Value> {
    pptx_graphic_frame_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (offset, frame))| {
            if !frame.contains("<a:tbl") {
                return None;
            }
            let text_index_start = extract_text_tags(&xml[..offset], "a:t").len();
            let (x, y, width, height, rotation) = pptx_shape_geometry(&frame);
            let rows = xml_segments(&frame, "<a:tr", "</a:tr>")
                .into_iter()
                .map(|row| {
                    xml_segments(&row, "<a:tc", "</a:tc>")
                        .into_iter()
                        .map(|cell| extract_text_tags(&cell, "a:t").join(""))
                        .collect::<Vec<_>>()
                })
                .filter(|row| !row.is_empty())
                .collect::<Vec<_>>();
            Some(json!({
                "id": format!("tbl{}", index + 1),
                "textIndexStart": text_index_start,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "rows": rows
            }))
        })
        .collect()
}

fn pptx_graphic_frame_segments(xml: &str) -> Vec<(usize, String)> {
    let mut frames = Vec::new();
    let mut offset = 0usize;
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, "<p:graphicFrame") {
        let absolute_start = offset + start;
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:graphicFrame>") else {
            break;
        };
        let end_index = end + "</p:graphicFrame>".len();
        frames.push((absolute_start, after_start[..end_index].to_string()));
        offset = absolute_start + end_index;
        rest = &xml[offset..];
    }
    frames
}

fn pptx_slide_images(bytes: &[u8], slide_path: &str, xml: &str) -> Vec<Value> {
    let relationships = read_zip_text(bytes, &xlsx_part_rels_path(slide_path))
        .ok()
        .map(|rels| xlsx_relationships_by_id(slide_path, &rels))
        .unwrap_or_default();
    pptx_picture_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, picture)| {
            let relationship_id = docx_tag_attr(&picture, "<a:blip", "r:embed")
                .or_else(|| docx_tag_attr(&picture, "<a:blip", "r:link"))?;
            let (_, media_path) = relationships.get(&relationship_id)?;
            let mime_type = image_mime_type_from_path(media_path);
            let data_url = read_zip_bytes(bytes, media_path).ok().map(|bytes| {
                format!(
                    "data:{mime_type};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )
            });
            let (x, y, width, height, rotation) = pptx_shape_geometry(&picture);
            Some(json!({
                "id": format!("img{}", index + 1),
                "relationshipId": relationship_id,
                "mediaPath": media_path,
                "mimeType": mime_type,
                "dataUrl": data_url,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "altText": pptx_picture_alt_text(&picture)
            }))
        })
        .collect()
}

fn pptx_slide_charts(bytes: &[u8], slide_path: &str, xml: &str) -> Vec<Value> {
    let relationships = read_zip_text(bytes, &xlsx_part_rels_path(slide_path))
        .ok()
        .map(|rels| xlsx_relationships_by_id(slide_path, &rels))
        .unwrap_or_default();
    pptx_graphic_frame_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (_, frame))| {
            let chart = xml_named_empty_elements(&frame, "c:chart")
                .into_iter()
                .next()?;
            let relationship_id = attr_value(&chart, "r:id")?;
            let (relationship_type, chart_path) = relationships.get(&relationship_id)?;
            if !relationship_type.ends_with("/chart") {
                return None;
            }
            let chart_xml = read_zip_text(bytes, chart_path).unwrap_or_default();
            let (x, y, width, height, rotation) = pptx_shape_geometry(&frame);
            let series = pptx_chart_series(&chart_xml);
            let categories = series
                .first()
                .and_then(|item| item.get("categories"))
                .cloned()
                .unwrap_or_else(|| json!([]));
            Some(json!({
                "id": format!("chart{}", index + 1),
                "relationshipId": relationship_id,
                "path": chart_path,
                "type": xlsx_chart_type(&chart_xml),
                "title": xlsx_chart_title(&chart_xml),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "categories": categories,
                "series": series
            }))
        })
        .collect()
}

fn pptx_chart_series(chart_xml: &str) -> Vec<Value> {
    xml_named_segments(chart_xml, "c:ser")
        .into_iter()
        .enumerate()
        .map(|(index, series)| {
            json!({
                "name": pptx_chart_series_name(&series)
                    .unwrap_or_else(|| format!("Series {}", index + 1)),
                "categories": pptx_chart_points(&series, "c:cat"),
                "values": pptx_chart_points(&series, "c:val")
            })
        })
        .collect()
}

fn pptx_chart_series_name(series: &str) -> Option<String> {
    xml_named_segments(series, "c:tx")
        .into_iter()
        .next()
        .and_then(|text| {
            first_tag_text(&text, "c:v")
                .or_else(|| first_tag_text(&text, "a:t"))
                .map(|value| value.trim().to_string())
        })
        .filter(|value| !value.is_empty())
}

fn pptx_chart_points(series: &str, container_tag: &str) -> Vec<String> {
    xml_named_segments(series, container_tag)
        .into_iter()
        .next()
        .map(|container| {
            extract_text_tags(&container, "c:v")
                .into_iter()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn pptx_slide_transition(xml: &str) -> Option<Value> {
    let transition = xml_named_segments(xml, "p:transition")
        .into_iter()
        .next()
        .or_else(|| {
            xml_named_empty_elements(xml, "p:transition")
                .into_iter()
                .next()
        })?;
    let kind = pptx_transition_kind(&transition).unwrap_or_else(|| "fade".to_string());
    let speed = docx_tag_attr(&transition, "<p:transition", "spd")
        .filter(|value| matches!(value.as_str(), "fast" | "med" | "slow"));
    let direction = pptx_transition_direction(&transition);
    let advance_on_click = docx_tag_attr(&transition, "<p:transition", "advClick")
        .map(|value| value != "0" && !value.eq_ignore_ascii_case("false"))
        .unwrap_or(true);
    let advance_after_ms = docx_tag_attr(&transition, "<p:transition", "advTm")
        .and_then(|value| value.parse::<u32>().ok());
    Some(json!({
        "type": kind,
        "speed": speed,
        "direction": direction,
        "advanceOnClick": advance_on_click,
        "advanceAfterMs": advance_after_ms
    }))
}

fn pptx_slide_timing(xml: &str) -> Option<String> {
    xml_named_segments(xml, "p:timing")
        .into_iter()
        .next()
        .or_else(|| xml_named_empty_elements(xml, "p:timing").into_iter().next())
}

fn pptx_slide_animations(xml: &str) -> Vec<Value> {
    let Some(timing) = pptx_slide_timing(xml) else {
        return Vec::new();
    };
    pptx_timing_ctn_segments(&timing)
        .into_iter()
        .enumerate()
        .map(|(index, segment)| {
            let source_xml = segment.clone();
            let mut item = json!({
                "id": attr_value(&segment, "id").unwrap_or_else(|| format!("ctn{}", index + 1)),
                "nodeType": attr_value(&segment, "nodeType"),
                "sourceXml": source_xml
            });
            if let Some(preset_class) = attr_value(&segment, "presetClass") {
                item["presetClass"] = json!(preset_class);
            }
            if let Some(preset_id) = attr_value(&segment, "presetID") {
                item["presetId"] = json!(preset_id);
            }
            if let Some(target_shape_id) = docx_tag_attr(&segment, "<p:spTgt", "spid") {
                item["targetShapeId"] = json!(target_shape_id);
            }
            if let Some(delay_ms) =
                attr_value(&segment, "delay").and_then(|value| value.parse::<u32>().ok())
            {
                item["delayMs"] = json!(delay_ms);
            }
            if let Some(duration_ms) =
                attr_value(&segment, "dur").and_then(|value| value.parse::<u32>().ok())
            {
                item["durationMs"] = json!(duration_ms);
            }
            item
        })
        .collect()
}

fn pptx_timing_ctn_segments(timing: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut rest = timing;
    while let Some(start) = find_xml_tag_start(rest, "p:cTn") {
        let after_start = &rest[start..];
        let Some(open_end) = after_start.find('>') else {
            break;
        };
        if after_start[..=open_end].ends_with("/>") {
            segments.push(after_start[..=open_end].to_string());
            rest = &after_start[open_end + 1..];
            continue;
        }
        let end_marker = "</p:cTn>";
        let Some(close_start) = after_start.find(end_marker) else {
            break;
        };
        let end = close_start + end_marker.len();
        segments.push(after_start[..end].to_string());
        rest = &after_start[end..];
    }
    segments
}

fn pptx_transition_kind(transition: &str) -> Option<String> {
    [
        "fade", "push", "wipe", "split", "cut", "cover", "uncover", "zoom",
    ]
    .into_iter()
    .find_map(|kind| {
        let tag = format!("p:{kind}");
        (find_xml_tag_start(transition, &tag).is_some()
            || !xml_named_empty_elements(transition, &tag).is_empty())
        .then(|| kind.to_string())
    })
}

fn pptx_transition_direction(transition: &str) -> Option<String> {
    [
        "p:push",
        "p:wipe",
        "p:split",
        "p:cover",
        "p:uncover",
        "p:zoom",
    ]
    .into_iter()
    .find_map(|tag| {
        xml_named_empty_elements(transition, tag)
            .into_iter()
            .chain(xml_named_segments(transition, tag))
            .next()
            .and_then(|segment| attr_value(&segment, "dir"))
    })
}

fn pptx_picture_segments(xml: &str) -> Vec<String> {
    xml_segments(xml, "<p:pic", "</p:pic>")
}

fn pptx_picture_alt_text(picture: &str) -> Option<String> {
    docx_tag_attr(picture, "<p:cNvPr", "descr")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| docx_tag_attr(picture, "<p:cNvPr", "title"))
        .or_else(|| docx_tag_attr(picture, "<p:cNvPr", "name"))
}

fn pptx_managed_basic_shape_kind(shape: &str) -> Option<PptxShapeKind> {
    if !extract_text_tags(shape, "a:t").join("").trim().is_empty() {
        return None;
    }
    pptx_basic_shape_kind(shape)
}

fn pptx_basic_shape_kind(shape: &str) -> Option<PptxShapeKind> {
    let preset = docx_tag_attr(shape, "<a:prstGeom", "prst")?;
    PptxShapeKind::from_value(&preset)
}

fn pptx_shape_geometry(shape: &str) -> (f64, f64, f64, f64, f64) {
    let x = docx_tag_attr(shape, "<a:off", "x")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / PPTX_SLIDE_WIDTH_EMU) * 100.0)
        .unwrap_or(10.0);
    let y = docx_tag_attr(shape, "<a:off", "y")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / PPTX_SLIDE_HEIGHT_EMU) * 100.0)
        .unwrap_or(12.0);
    let width = docx_tag_attr(shape, "<a:ext", "cx")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / PPTX_SLIDE_WIDTH_EMU) * 100.0)
        .unwrap_or(80.0);
    let height = docx_tag_attr(shape, "<a:ext", "cy")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / PPTX_SLIDE_HEIGHT_EMU) * 100.0)
        .unwrap_or(10.0);
    let rotation = docx_tag_attr(shape, "<a:xfrm", "rot")
        .or_else(|| docx_tag_attr(shape, "<p:xfrm", "rot"))
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| value / 60_000.0)
        .unwrap_or(0.0);
    (x, y, width, height, rotation)
}

fn pptx_run_properties_segment(shape: &str) -> Option<String> {
    let start = shape.find("<a:rPr")?;
    let after_start = &shape[start..];
    if let Some(end) = after_start.find("</a:rPr>") {
        return Some(after_start[..end + "</a:rPr>".len()].to_string());
    }
    let end = after_start.find("/>")?;
    Some(after_start[..end + 2].to_string())
}

fn pptx_run_font_size(run: &str) -> Option<u32> {
    docx_tag_attr(run, "<a:rPr", "sz")
        .and_then(|value| value.parse::<u32>().ok())
        .map(|centipoints| centipoints / 100)
}

fn pptx_run_color(run: &str) -> Option<String> {
    docx_tag_attr(run, "<a:srgbClr", "val").and_then(|color| docx_hex_color(&color))
}

fn pptx_paragraph_alignment(shape: &str) -> Option<String> {
    let align = docx_tag_attr(shape, "<a:pPr", "algn")?;
    match align.as_str() {
        "ctr" => Some("center".to_string()),
        "r" => Some("right".to_string()),
        "l" => Some("left".to_string()),
        _ => None,
    }
}

fn pptx_shape_fill_color(shape: &str) -> Option<String> {
    let sppr = pptx_sppr_segment(shape)?;
    let search_end = sppr.find("<a:ln").unwrap_or(sppr.len());
    let shape_fill_area = &sppr[..search_end];
    let fill_start = shape_fill_area.find("<a:solidFill")?;
    let after_start = &shape_fill_area[fill_start..];
    let fill = if let Some(end) = after_start.find("</a:solidFill>") {
        &after_start[..end + "</a:solidFill>".len()]
    } else {
        let end = after_start.find("/>")?;
        &after_start[..end + 2]
    };
    docx_tag_attr(fill, "<a:solidFill", "val")
        .or_else(|| docx_tag_attr(fill, "<a:srgbClr", "val"))
        .and_then(|color| docx_hex_color(&color))
}

fn pptx_shape_stroke_color(shape: &str) -> Option<String> {
    let line = pptx_line_segment(shape)?;
    docx_tag_attr(&line, "<a:srgbClr", "val").and_then(|color| docx_hex_color(&color))
}

fn pptx_shape_stroke_width(shape: &str) -> Option<f64> {
    let line = pptx_line_segment(shape)?;
    docx_tag_attr(&line, "<a:ln", "w")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|emu| (emu / 12_700.0).clamp(0.0, 72.0))
}

fn pptx_sppr_segment(shape: &str) -> Option<&str> {
    let sppr_start = shape.find("<p:spPr")?;
    let after_start = &shape[sppr_start..];
    let sppr_end = after_start.find("</p:spPr>")?;
    Some(&after_start[..sppr_end + "</p:spPr>".len()])
}

fn pptx_line_segment(shape: &str) -> Option<String> {
    let sppr = pptx_sppr_segment(shape)?;
    xml_named_segments(sppr, "a:ln")
        .into_iter()
        .next()
        .or_else(|| xml_named_empty_elements(sppr, "a:ln").into_iter().next())
}

fn pptx_slide_background_color(slide: &str) -> Option<String> {
    let background_start = slide.find("<p:bg")?;
    let after_start = &slide[background_start..];
    let background_end = after_start.find("</p:bg>")?;
    let background = &after_start[..background_end];
    docx_tag_attr(background, "<a:srgbClr", "val").and_then(|color| docx_hex_color(&color))
}

fn pptx_slide_hidden(slide: &str) -> bool {
    docx_tag_attr(slide, "<p:sld", "show")
        .map(|value| value == "0" || value.eq_ignore_ascii_case("false"))
        .unwrap_or(false)
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

fn pptx_text_specs(slide: &Value) -> Vec<PptxTextSpec> {
    slide
        .get("texts")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, item)| PptxTextSpec {
                    text: item
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    text_index: value_as_usize(item.get("textIndex")),
                    x: item
                        .get("x")
                        .and_then(Value::as_f64)
                        .unwrap_or(10.0)
                        .clamp(0.0, 100.0),
                    y: item
                        .get("y")
                        .and_then(Value::as_f64)
                        .unwrap_or(12.0 + index as f64 * 18.0)
                        .clamp(0.0, 100.0),
                    width: item
                        .get("width")
                        .and_then(Value::as_f64)
                        .unwrap_or(80.0)
                        .clamp(1.0, 100.0),
                    height: item
                        .get("height")
                        .and_then(Value::as_f64)
                        .unwrap_or(10.0)
                        .clamp(1.0, 100.0),
                    rotation: normalize_degrees(
                        item.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
                    ),
                    font_size: item
                        .get("fontSize")
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse::<u32>().ok())
                        .unwrap_or(18)
                        .clamp(6, 96),
                    font_family: item
                        .get("fontFamily")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    color: item
                        .get("color")
                        .and_then(Value::as_str)
                        .and_then(docx_hex_color),
                    fill_color: item
                        .get("fillColor")
                        .and_then(Value::as_str)
                        .and_then(docx_hex_color),
                    bold: item.get("bold").and_then(Value::as_bool).unwrap_or(false),
                    italic: item.get("italic").and_then(Value::as_bool).unwrap_or(false),
                    underline: item
                        .get("underline")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    strikethrough: item
                        .get("strikethrough")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    align: item
                        .get("align")
                        .and_then(Value::as_str)
                        .and_then(pptx_alignment_value)
                        .map(str::to_string),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn pptx_table_specs(slide: &Value) -> Vec<PptxTableSpec> {
    slide
        .get("tables")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|table| {
            let rows = table
                .get("rows")
                .and_then(Value::as_array)?
                .iter()
                .map(|row| {
                    row.as_array()
                        .map(|cells| {
                            cells
                                .iter()
                                .map(|cell| {
                                    cell.as_str()
                                        .map(str::to_string)
                                        .unwrap_or_else(|| cell.to_string())
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>();
            if rows.is_empty() || rows.iter().all(Vec::is_empty) {
                return None;
            }
            Some(PptxTableSpec {
                text_index_start: value_as_usize(table.get("textIndexStart")),
                rows,
                x: table
                    .get("x")
                    .and_then(Value::as_f64)
                    .unwrap_or(14.0)
                    .clamp(0.0, 100.0),
                y: table
                    .get("y")
                    .and_then(Value::as_f64)
                    .unwrap_or(28.0)
                    .clamp(0.0, 100.0),
                width: table
                    .get("width")
                    .and_then(Value::as_f64)
                    .unwrap_or(60.0)
                    .clamp(1.0, 100.0),
                height: table
                    .get("height")
                    .and_then(Value::as_f64)
                    .unwrap_or(28.0)
                    .clamp(1.0, 100.0),
                rotation: normalize_degrees(
                    table.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
                ),
            })
        })
        .collect()
}

fn apply_pptx_text_replacements(texts: &mut [String], specs: &[PptxTextSpec]) {
    let mut fallback_index = 0usize;
    for spec in specs {
        let text_index = spec.text_index.unwrap_or_else(|| {
            let current = fallback_index;
            fallback_index += 1;
            current
        });
        if let Some(slot) = texts.get_mut(text_index) {
            *slot = spec.text.clone();
        }
    }
}

fn apply_pptx_table_replacements(texts: &mut [String], specs: &[PptxTableSpec]) {
    for spec in specs {
        let Some(text_index_start) = spec.text_index_start else {
            continue;
        };
        let mut offset = 0usize;
        for row in &spec.rows {
            for cell in row {
                if let Some(slot) = texts.get_mut(text_index_start + offset) {
                    *slot = cell.clone();
                }
                offset += 1;
            }
        }
    }
}

fn pptx_image_specs(slide: &Value) -> Vec<PptxImageSpec> {
    slide
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|image| PptxImageSpec {
            relationship_id: image
                .get("relationshipId")
                .and_then(Value::as_str)
                .map(str::to_string),
            data_url: image
                .get("dataUrl")
                .and_then(Value::as_str)
                .map(str::to_string),
            x: image
                .get("x")
                .and_then(Value::as_f64)
                .unwrap_or(10.0)
                .clamp(0.0, 100.0),
            y: image
                .get("y")
                .and_then(Value::as_f64)
                .unwrap_or(12.0)
                .clamp(0.0, 100.0),
            width: image
                .get("width")
                .and_then(Value::as_f64)
                .unwrap_or(30.0)
                .clamp(1.0, 100.0),
            height: image
                .get("height")
                .and_then(Value::as_f64)
                .unwrap_or(30.0)
                .clamp(1.0, 100.0),
            rotation: normalize_degrees(
                image.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
            ),
            alt_text: image
                .get("altText")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
        .collect()
}

fn pptx_chart_specs(slide: &Value) -> Vec<PptxChartSpec> {
    slide
        .get("charts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|chart| PptxChartSpec {
            relationship_id: chart
                .get("relationshipId")
                .and_then(Value::as_str)
                .map(str::to_string),
            path: chart
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_string),
            title: chart
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_string),
            series: pptx_chart_series_specs(chart),
            x: chart
                .get("x")
                .and_then(Value::as_f64)
                .unwrap_or(18.0)
                .clamp(0.0, 100.0),
            y: chart
                .get("y")
                .and_then(Value::as_f64)
                .unwrap_or(18.0)
                .clamp(0.0, 100.0),
            width: chart
                .get("width")
                .and_then(Value::as_f64)
                .unwrap_or(58.0)
                .clamp(1.0, 100.0),
            height: chart
                .get("height")
                .and_then(Value::as_f64)
                .unwrap_or(44.0)
                .clamp(1.0, 100.0),
            rotation: normalize_degrees(
                chart.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
            ),
        })
        .collect()
}

fn pptx_chart_series_specs(chart: &Value) -> Vec<PptxChartSeriesSpec> {
    chart
        .get("series")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|series| PptxChartSeriesSpec {
            name: series
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string),
            categories: series
                .get("categories")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .map(|value| {
                            value
                                .as_str()
                                .map(str::to_string)
                                .unwrap_or_else(|| value.to_string())
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            values: series
                .get("values")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .map(|value| {
                            value
                                .as_str()
                                .map(str::to_string)
                                .unwrap_or_else(|| value.to_string())
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
        })
        .collect()
}

fn pptx_transition_spec(slide: &Value) -> Option<PptxTransitionSpec> {
    let transition = slide.get("transition")?;
    Some(PptxTransitionSpec {
        kind: transition
            .get("type")
            .and_then(Value::as_str)
            .filter(|value| valid_pptx_transition_kind(value))
            .unwrap_or("none")
            .to_string(),
        speed: transition
            .get("speed")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "fast" | "med" | "slow"))
            .map(str::to_string),
        direction: transition
            .get("direction")
            .and_then(Value::as_str)
            .filter(|value| valid_pptx_transition_direction(value))
            .map(str::to_string),
        advance_on_click: transition
            .get("advanceOnClick")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        advance_after_ms: transition
            .get("advanceAfterMs")
            .and_then(Value::as_u64)
            .map(|value| value.min(600_000) as u32),
    })
}

fn pptx_animation_specs(slide: &Value) -> Vec<PptxAnimationSpec> {
    slide
        .get("animations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|animation| PptxAnimationSpec {
            source_xml: animation
                .get("sourceXml")
                .and_then(Value::as_str)
                .filter(|source| source.starts_with("<p:cTn"))
                .map(str::to_string),
            delay_ms: animation
                .get("delayMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
            duration_ms: animation
                .get("durationMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
        })
        .collect()
}

fn valid_pptx_transition_kind(value: &str) -> bool {
    matches!(
        value,
        "none" | "fade" | "push" | "wipe" | "split" | "cut" | "cover" | "uncover" | "zoom"
    )
}

fn valid_pptx_transition_direction(value: &str) -> bool {
    matches!(
        value,
        "l" | "r" | "u" | "d" | "lu" | "ru" | "ld" | "rd" | "in" | "out" | "horz" | "vert"
    )
}

fn value_as_usize(value: Option<&Value>) -> Option<usize> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

fn pptx_shape_specs(slide: &Value) -> Vec<PptxShapeSpec> {
    slide
        .get("shapes")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let kind = item
                        .get("kind")
                        .and_then(Value::as_str)
                        .and_then(PptxShapeKind::from_value)?;
                    let default_height = if kind == PptxShapeKind::Line {
                        0.0
                    } else {
                        20.0
                    };
                    let min_height = if kind == PptxShapeKind::Line {
                        0.0
                    } else {
                        1.0
                    };
                    Some(PptxShapeSpec {
                        kind,
                        x: item
                            .get("x")
                            .and_then(Value::as_f64)
                            .unwrap_or(24.0)
                            .clamp(0.0, 100.0),
                        y: item
                            .get("y")
                            .and_then(Value::as_f64)
                            .unwrap_or(34.0)
                            .clamp(0.0, 100.0),
                        width: item
                            .get("width")
                            .and_then(Value::as_f64)
                            .unwrap_or(26.0)
                            .clamp(1.0, 100.0),
                        height: item
                            .get("height")
                            .and_then(Value::as_f64)
                            .unwrap_or(default_height)
                            .clamp(min_height, 100.0),
                        rotation: normalize_degrees(
                            item.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
                        ),
                        fill_color: item
                            .get("fillColor")
                            .and_then(Value::as_str)
                            .and_then(docx_hex_color),
                        stroke_color: item
                            .get("strokeColor")
                            .and_then(Value::as_str)
                            .and_then(docx_hex_color),
                        stroke_width: item
                            .get("strokeWidth")
                            .and_then(Value::as_f64)
                            .unwrap_or(2.0)
                            .clamp(0.0, 72.0),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn build_pptx_slide(
    texts: &[PptxTextSpec],
    basic_shapes: &[PptxShapeSpec],
    tables: &[PptxTableSpec],
    images: &[PptxImageSpec],
    background_color: Option<&str>,
) -> String {
    let shape_xml = basic_shapes
        .iter()
        .enumerate()
        .map(|(index, shape)| build_pptx_basic_shape(index + 2, shape))
        .collect::<Vec<_>>()
        .join("");
    let text_xml = texts
        .iter()
        .enumerate()
        .map(|(index, text)| build_pptx_text_shape(basic_shapes.len() + index + 2, text))
        .collect::<Vec<_>>()
        .join("");
    let table_xml = tables
        .iter()
        .enumerate()
        .map(|(index, table)| build_pptx_table(10_000 + index, table))
        .collect::<Vec<_>>()
        .join("");
    let image_xml = images
        .iter()
        .enumerate()
        .filter(|(_, image)| image.relationship_id.is_some())
        .map(|(index, image)| build_pptx_image(20_000 + index, image))
        .collect::<Vec<_>>()
        .join("");
    let background = pptx_slide_background_xml(background_color);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>{background}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{shape_xml}{text_xml}{table_xml}{image_xml}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#
    )
}

fn pptx_slide_background_xml(background_color: Option<&str>) -> String {
    background_color
        .map(|color| {
            format!(
                r#"<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></p:bgPr></p:bg>"#
            )
        })
        .unwrap_or_default()
}

fn update_pptx_slide_background(xml: &str, background_color: Option<&str>) -> String {
    let background = pptx_slide_background_xml(background_color);
    if let Some(replaced) = replace_xml_element(xml, "p:bg", &background) {
        return replaced;
    }
    if background.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("<p:spTree") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&background);
        output.push_str(&xml[index..]);
        return output;
    }
    xml.to_string()
}

fn update_pptx_slide_visibility(xml: &str, hidden: Option<bool>) -> String {
    let Some(hidden) = hidden else {
        return xml.to_string();
    };
    set_first_xml_tag_attrs(
        xml,
        "<p:sld",
        &[("show", if hidden { "0" } else { "1" }.to_string())],
    )
}

fn insert_pptx_text_shapes(slide_xml: &str, texts: &[PptxTextSpec]) -> String {
    let shapes = texts
        .iter()
        .enumerate()
        .map(|(index, text)| build_pptx_text_shape(10_000 + index, text))
        .collect::<Vec<_>>()
        .join("");
    if let Some(index) = slide_xml.find("</p:spTree>") {
        let mut output = String::new();
        output.push_str(&slide_xml[..index]);
        output.push_str(&shapes);
        output.push_str(&slide_xml[index..]);
        output
    } else {
        slide_xml.to_string()
    }
}

fn replace_pptx_basic_shapes(xml: &str, specs: &[PptxShapeSpec]) -> String {
    let mut output = String::new();
    let mut rest = xml;
    let mut spec_index = 0usize;
    let mut shape_id = 20_000usize;
    while let Some(start) = rest.find("<p:sp") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:sp>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:sp>".len();
        let shape = &after_start[..end_index];
        if pptx_managed_basic_shape_kind(shape).is_some() {
            if let Some(spec) = specs.get(spec_index) {
                output.push_str(&build_pptx_basic_shape(shape_id, spec));
                shape_id += 1;
            }
            spec_index += 1;
        } else {
            output.push_str(shape);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    if spec_index < specs.len() {
        insert_pptx_basic_shapes(&output, &specs[spec_index..], shape_id)
    } else {
        output
    }
}

fn insert_pptx_basic_shapes(
    slide_xml: &str,
    specs: &[PptxShapeSpec],
    first_shape_id: usize,
) -> String {
    let shapes = specs
        .iter()
        .enumerate()
        .map(|(index, shape)| build_pptx_basic_shape(first_shape_id + index, shape))
        .collect::<Vec<_>>()
        .join("");
    if shapes.is_empty() {
        return slide_xml.to_string();
    }
    if let Some(index) = slide_xml.find("</p:grpSpPr>") {
        let insert_at = index + "</p:grpSpPr>".len();
        let mut output = String::new();
        output.push_str(&slide_xml[..insert_at]);
        output.push_str(&shapes);
        output.push_str(&slide_xml[insert_at..]);
        return output;
    }
    append_before_or_end(slide_xml, "</p:spTree>", &shapes)
}

fn update_pptx_tables(xml: &str, specs: &[PptxTableSpec], remove_missing: bool) -> String {
    if specs.is_empty() && !remove_missing {
        return xml.to_string();
    }
    let mut output = String::new();
    let mut rest = xml;
    let mut spec_index = 0usize;
    while let Some(start) = find_xml_start(rest, "<p:graphicFrame") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:graphicFrame>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:graphicFrame>".len();
        let frame = &after_start[..end_index];
        if frame.contains("<a:tbl") {
            if let Some(spec) = specs.get(spec_index) {
                output.push_str(&build_pptx_table(
                    next_pptx_drawing_id(xml) + spec_index,
                    spec,
                ));
            } else if !remove_missing {
                output.push_str(frame);
            }
            spec_index += 1;
        } else {
            output.push_str(frame);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    if spec_index < specs.len() {
        insert_pptx_tables(&output, &specs[spec_index..])
    } else {
        output
    }
}

fn insert_pptx_tables(slide_xml: &str, tables: &[PptxTableSpec]) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let table_xml = tables
        .iter()
        .enumerate()
        .map(|(index, table)| build_pptx_table(first_shape_id + index, table))
        .collect::<Vec<_>>()
        .join("");
    if table_xml.is_empty() {
        return slide_xml.to_string();
    }
    if let Some(index) = slide_xml.find("</p:spTree>") {
        let mut output = String::new();
        output.push_str(&slide_xml[..index]);
        output.push_str(&table_xml);
        output.push_str(&slide_xml[index..]);
        output
    } else {
        slide_xml.to_string()
    }
}

fn build_pptx_table(shape_id: usize, spec: &PptxTableSpec) -> String {
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    let column_count = spec.rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let row_count = spec.rows.len().max(1);
    let column_width = (width / column_count as i64).max(1);
    let row_height = (height / row_count as i64).max(1);
    let grid = (0..column_count)
        .map(|_| format!(r#"<a:gridCol w="{column_width}"/>"#))
        .collect::<Vec<_>>()
        .join("");
    let rows = spec
        .rows
        .iter()
        .map(|row| {
            let cells = (0..column_count)
                .map(|column| {
                    let value = row.get(column).map(String::as_str).unwrap_or_default();
                    format!(
                        r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>"#,
                        escape_xml(value)
                    )
                })
                .collect::<Vec<_>>()
                .join("");
            format!(r#"<a:tr h="{row_height}">{cells}</a:tr>"#)
        })
        .collect::<Vec<_>>()
        .join("");
    format!(
        r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{shape_id}" name="Table {shape_id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{{5940675A-B579-460E-94D1-54222C63F5DA}}</a:tableStyleId></a:tblPr><a:tblGrid>{grid}</a:tblGrid>{rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#
    )
}

fn update_pptx_images(xml: &str, specs: &[PptxImageSpec], remove_missing: bool) -> String {
    if specs.is_empty() && !remove_missing {
        return xml.to_string();
    }
    let mut output = String::new();
    let mut rest = xml;
    let mut matched = vec![false; specs.len()];
    while let Some(start) = find_xml_start(rest, "<p:pic") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:pic>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:pic>".len();
        let picture = &after_start[..end_index];
        let relationship_id = docx_tag_attr(picture, "<a:blip", "r:embed")
            .or_else(|| docx_tag_attr(picture, "<a:blip", "r:link"));
        let spec_index = relationship_id
            .as_deref()
            .and_then(|id| {
                specs
                    .iter()
                    .position(|spec| spec.relationship_id.as_deref() == Some(id))
            })
            .or_else(|| {
                specs
                    .iter()
                    .enumerate()
                    .find(|(index, spec)| !matched[*index] && spec.relationship_id.is_none())
                    .map(|(index, _)| index)
            });
        if let Some(spec_index) = spec_index {
            matched[spec_index] = true;
            let spec = &specs[spec_index];
            output.push_str(&update_pptx_image_segment(picture, spec));
        } else if !remove_missing {
            output.push_str(picture);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    let new_images = specs
        .iter()
        .enumerate()
        .filter(|(index, spec)| !matched[*index] && spec.relationship_id.is_some())
        .map(|(_, spec)| spec)
        .collect::<Vec<_>>();
    if new_images.is_empty() {
        output
    } else {
        insert_pptx_images(&output, &new_images)
    }
}

fn update_pptx_image_segment(segment: &str, spec: &PptxImageSpec) -> String {
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    let mut output = set_first_xml_tag_attrs(
        segment,
        "<a:off",
        &[("x", x.to_string()), ("y", y.to_string())],
    );
    output = set_first_xml_tag_attrs(
        &output,
        "<a:ext",
        &[("cx", width.to_string()), ("cy", height.to_string())],
    );
    output = set_first_xml_tag_attrs(&output, "<a:xfrm", &[("rot", rotation.to_string())]);
    if let Some(alt_text) = &spec.alt_text {
        output = set_first_xml_tag_attrs(
            &output,
            "<p:cNvPr",
            &[
                ("descr", alt_text.to_string()),
                ("title", alt_text.to_string()),
            ],
        );
    }
    output
}

fn insert_pptx_images(slide_xml: &str, images: &[&PptxImageSpec]) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let pictures = images
        .iter()
        .enumerate()
        .map(|(index, image)| build_pptx_image(first_shape_id + index, image))
        .collect::<Vec<_>>()
        .join("");
    if pictures.is_empty() {
        return slide_xml.to_string();
    }
    if let Some(index) = slide_xml.find("</p:spTree>") {
        let mut output = String::new();
        output.push_str(&slide_xml[..index]);
        output.push_str(&pictures);
        output.push_str(&slide_xml[index..]);
        output
    } else {
        slide_xml.to_string()
    }
}

fn build_pptx_image(shape_id: usize, spec: &PptxImageSpec) -> String {
    let relationship_id = spec.relationship_id.as_deref().unwrap_or_default();
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    let alt_text = spec
        .alt_text
        .as_deref()
        .map(escape_xml)
        .unwrap_or_else(|| format!("Picture {shape_id}"));
    format!(
        r#"<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="Picture {shape_id}" descr="{alt_text}" title="{alt_text}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#,
        escape_xml(relationship_id)
    )
}

fn next_pptx_drawing_id(slide_xml: &str) -> usize {
    xml_named_empty_elements(slide_xml, "p:cNvPr")
        .into_iter()
        .filter_map(|element| attr_value(&element, "id"))
        .filter_map(|value| value.parse::<usize>().ok())
        .max()
        .unwrap_or(1)
        + 1
}

fn update_pptx_charts(xml: &str, specs: &[PptxChartSpec], remove_missing: bool) -> String {
    if specs.is_empty() && !remove_missing {
        return xml.to_string();
    }
    let mut output = String::new();
    let mut rest = xml;
    let mut matched = vec![false; specs.len()];
    while let Some(start) = find_xml_start(rest, "<p:graphicFrame") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:graphicFrame>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:graphicFrame>".len();
        let frame = &after_start[..end_index];
        let relationship_id = xml_named_empty_elements(frame, "c:chart")
            .into_iter()
            .next()
            .and_then(|chart| attr_value(&chart, "r:id"));
        if let Some(relationship_id) = relationship_id {
            let spec_index = specs
                .iter()
                .enumerate()
                .find(|(index, spec)| {
                    !matched[*index]
                        && spec.relationship_id.as_deref() == Some(relationship_id.as_str())
                })
                .map(|(index, _)| index)
                .or_else(|| {
                    specs
                        .iter()
                        .enumerate()
                        .find(|(index, _)| !matched[*index])
                        .map(|(index, _)| index)
                });
            if let Some(spec_index) = spec_index {
                matched[spec_index] = true;
                let spec = &specs[spec_index];
                output.push_str(&update_pptx_chart_frame(frame, spec));
            } else if !remove_missing {
                output.push_str(frame);
            }
        } else {
            output.push_str(frame);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    let inserted = specs
        .iter()
        .enumerate()
        .filter(|(index, spec)| !matched[*index] && spec.relationship_id.is_some())
        .map(|(_, spec)| spec)
        .collect::<Vec<_>>();
    if inserted.is_empty() {
        output
    } else {
        insert_pptx_charts(&output, &inserted)
    }
}

fn update_pptx_chart_frame(frame: &str, spec: &PptxChartSpec) -> String {
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    let mut output = set_first_xml_tag_attrs(
        frame,
        "<a:off",
        &[("x", x.to_string()), ("y", y.to_string())],
    );
    output = set_first_xml_tag_attrs(
        &output,
        "<a:ext",
        &[("cx", width.to_string()), ("cy", height.to_string())],
    );
    set_first_xml_tag_attrs(&output, "<p:xfrm", &[("rot", rotation.to_string())])
}

fn insert_pptx_charts(slide_xml: &str, charts: &[&PptxChartSpec]) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let frames = charts
        .iter()
        .enumerate()
        .map(|(index, chart)| build_pptx_chart_frame(first_shape_id + index, chart))
        .collect::<Vec<_>>()
        .join("");
    if frames.is_empty() {
        return slide_xml.to_string();
    }
    if let Some(index) = slide_xml.find("</p:spTree>") {
        let mut output = String::new();
        output.push_str(&slide_xml[..index]);
        output.push_str(&frames);
        output.push_str(&slide_xml[index..]);
        output
    } else {
        slide_xml.to_string()
    }
}

fn build_pptx_chart_frame(shape_id: usize, spec: &PptxChartSpec) -> String {
    let relationship_id = spec.relationship_id.as_deref().unwrap_or_default();
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    format!(
        r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{shape_id}" name="Chart {shape_id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="{}"/></a:graphicData></a:graphic></p:graphicFrame>"#,
        escape_xml(relationship_id)
    )
}

fn add_pptx_chart_replacements(
    original: &[u8],
    slide_path: &str,
    specs: &[PptxChartSpec],
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    if specs.is_empty() {
        return;
    }
    let rels = read_zip_text(original, &xlsx_part_rels_path(slide_path)).unwrap_or_default();
    let relationships = xlsx_relationships_by_id(slide_path, &rels);
    for spec in specs {
        let chart_path = spec
            .relationship_id
            .as_deref()
            .and_then(|id| relationships.get(id))
            .filter(|(relationship_type, _)| relationship_type.ends_with("/chart"))
            .map(|(_, path)| path.clone())
            .or_else(|| spec.path.clone());
        let Some(chart_path) = chart_path else {
            continue;
        };
        let chart_xml =
            replacement_zip_text_or_default(original, replacements, &chart_path, String::new);
        if chart_xml.is_empty() {
            continue;
        }
        let mut updated = chart_xml;
        if let Some(title) = spec.title.as_deref() {
            updated = update_pptx_chart_title(&updated, title);
        }
        updated = update_pptx_chart_series(&updated, &spec.series);
        replacements.push((chart_path, updated.into_bytes()));
    }
}

fn update_pptx_chart_title(xml: &str, title: &str) -> String {
    let title_xml = build_pptx_chart_title(title);
    if let Some(replaced) = replace_xml_element(xml, "c:title", &title_xml) {
        return replaced;
    }
    if let Some(index) = xml.find("<c:plotArea") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&title_xml);
        output.push_str(&xml[index..]);
        return output;
    }
    append_before_or_end(xml, "</c:chart>", &title_xml)
}

fn build_pptx_chart_title(title: &str) -> String {
    format!(
        r#"<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></c:rich></c:tx></c:title>"#,
        escape_xml(title)
    )
}

fn update_pptx_chart_series(xml: &str, specs: &[PptxChartSeriesSpec]) -> String {
    if specs.is_empty() {
        return xml.to_string();
    }
    let mut output = String::new();
    let mut rest = xml;
    let mut index = 0usize;
    while let Some(start) = find_xml_start(rest, "<c:ser") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</c:ser>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</c:ser>".len();
        let segment = &after_start[..end_index];
        if let Some(spec) = specs.get(index) {
            output.push_str(&update_pptx_chart_series_segment(segment, spec));
        } else {
            output.push_str(segment);
        }
        index += 1;
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

fn update_pptx_chart_series_segment(segment: &str, spec: &PptxChartSeriesSpec) -> String {
    let mut output = if let Some(name) = spec.name.as_deref() {
        update_pptx_chart_series_name(segment, name)
    } else {
        segment.to_string()
    };
    output = update_pptx_chart_point_values(&output, "c:cat", &spec.categories);
    update_pptx_chart_point_values(&output, "c:val", &spec.values)
}

fn update_pptx_chart_series_name(segment: &str, name: &str) -> String {
    let Some(tx) = xml_named_segments(segment, "c:tx").into_iter().next() else {
        return segment.to_string();
    };
    let updated_tx = if tx.contains("<c:v") {
        replace_tag_texts(&tx, "c:v", &[name.to_string()])
    } else if tx.contains("<a:t") {
        replace_tag_texts(&tx, "a:t", &[name.to_string()])
    } else {
        tx.clone()
    };
    segment.replacen(&tx, &updated_tx, 1)
}

fn update_pptx_chart_point_values(segment: &str, tag: &str, values: &[String]) -> String {
    if values.is_empty() {
        return segment.to_string();
    }
    let Some(container) = xml_named_segments(segment, tag).into_iter().next() else {
        return segment.to_string();
    };
    let updated_container = replace_tag_texts(&container, "c:v", values);
    segment.replacen(&container, &updated_container, 1)
}

fn update_pptx_transition(xml: &str, spec: Option<&PptxTransitionSpec>) -> String {
    let Some(spec) = spec else {
        return xml.to_string();
    };
    let stripped = remove_pptx_transition(xml);
    if spec.kind == "none" {
        return stripped;
    }
    let transition = build_pptx_transition(spec);
    if let Some(index) = stripped.find("<p:timing") {
        let mut output = String::new();
        output.push_str(&stripped[..index]);
        output.push_str(&transition);
        output.push_str(&stripped[index..]);
        return output;
    }
    if let Some(index) = stripped.find("</p:cSld>") {
        let insert_at = index + "</p:cSld>".len();
        let mut output = String::new();
        output.push_str(&stripped[..insert_at]);
        output.push_str(&transition);
        output.push_str(&stripped[insert_at..]);
        return output;
    }
    append_before_or_end(&stripped, "</p:sld>", &transition)
}

fn update_pptx_animations(
    xml: &str,
    specs: &[PptxAnimationSpec],
    timing_source_xml: Option<&str>,
    model_controls_slide: bool,
) -> String {
    if !model_controls_slide {
        return xml.to_string();
    }
    let timing = timing_source_xml
        .filter(|source| source.starts_with("<p:timing"))
        .map(str::to_string)
        .or_else(|| pptx_slide_timing(xml));
    let Some(timing) = timing else {
        return xml.to_string();
    };
    let timing = update_pptx_timing_ctn_attrs(&timing, specs);
    if let Some(replaced) = replace_xml_element(xml, "p:timing", &timing) {
        return replaced;
    }
    if xml.contains("<p:timing") {
        return replace_empty_xml_element(xml, "<p:timing", &timing);
    }
    append_before_or_end(xml, "</p:sld>", &timing)
}

fn update_pptx_timing_ctn_attrs(timing: &str, specs: &[PptxAnimationSpec]) -> String {
    if specs.is_empty() {
        return timing.to_string();
    }
    let mut output = String::new();
    let mut rest = timing;
    let mut index = 0usize;
    while let Some(start) = find_xml_tag_start(rest, "p:cTn") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(open_end) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let (segment, next_rest) = if after_start[..=open_end].ends_with("/>") {
            (&after_start[..=open_end], &after_start[open_end + 1..])
        } else {
            let end_marker = "</p:cTn>";
            let Some(close_start) = after_start.find(end_marker) else {
                output.push_str(after_start);
                return output;
            };
            let end = close_start + end_marker.len();
            (&after_start[..end], &after_start[end..])
        };
        let updated_segment = if let Some(spec) = specs.get(index) {
            update_pptx_animation_segment(segment, spec)
        } else {
            segment.to_string()
        };
        output.push_str(&updated_segment);
        rest = next_rest;
        index += 1;
    }
    output.push_str(rest);
    output
}

fn update_pptx_animation_segment(segment: &str, spec: &PptxAnimationSpec) -> String {
    let source = spec.source_xml.as_deref().unwrap_or(segment);
    let Some(open_end) = source.find('>') else {
        return source.to_string();
    };
    let original_tag = &source[..=open_end];
    let mut updated_tag = original_tag.to_string();
    if let Some(delay_ms) = spec.delay_ms {
        updated_tag = set_xml_attr(&updated_tag, "delay", &delay_ms.to_string());
    }
    if let Some(duration_ms) = spec.duration_ms {
        updated_tag = set_xml_attr(&updated_tag, "dur", &duration_ms.to_string());
    }
    let mut output = String::new();
    output.push_str(&updated_tag);
    output.push_str(&source[open_end + 1..]);
    output
}

fn remove_pptx_transition(xml: &str) -> String {
    let removed_segments = remove_xml_named_elements(xml, "p:transition");
    replace_empty_xml_element(&removed_segments, "<p:transition", "")
}

fn build_pptx_transition(spec: &PptxTransitionSpec) -> String {
    let mut attrs = Vec::new();
    if let Some(speed) = spec.speed.as_deref() {
        attrs.push(format!(r#"spd="{}""#, escape_xml(speed)));
    }
    if !spec.advance_on_click {
        attrs.push(r#"advClick="0""#.to_string());
    }
    if let Some(advance_after_ms) = spec.advance_after_ms {
        attrs.push(format!(r#"advTm="{advance_after_ms}""#));
    }
    let attrs = if attrs.is_empty() {
        String::new()
    } else {
        format!(" {}", attrs.join(" "))
    };
    let child = build_pptx_transition_child(spec);
    format!(r#"<p:transition{attrs}>{child}</p:transition>"#)
}

fn build_pptx_transition_child(spec: &PptxTransitionSpec) -> String {
    let direction = spec
        .direction
        .as_deref()
        .filter(|direction| valid_pptx_transition_direction(direction))
        .map(|direction| format!(r#" dir="{}""#, escape_xml(direction)))
        .unwrap_or_default();
    match spec.kind.as_str() {
        "push" | "wipe" | "split" | "cover" | "uncover" | "zoom" => {
            format!(r#"<p:{}{direction}/>"#, spec.kind)
        }
        "cut" => "<p:cut/>".to_string(),
        _ => "<p:fade/>".to_string(),
    }
}

fn build_pptx_basic_shape(shape_id: usize, spec: &PptxShapeSpec) -> String {
    let (x, y, width, height) = pptx_shape_geometry_emu(spec);
    let rotation = pptx_rotation_unit(spec.rotation);
    let fill = if spec.kind == PptxShapeKind::Line {
        "<a:noFill/>".to_string()
    } else {
        pptx_shape_fill_xml(spec.fill_color.as_deref())
    };
    let line = pptx_line_xml(spec.stroke_color.as_deref(), spec.stroke_width);
    let preset = spec.kind.as_value();
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="Shape {shape_id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="{preset}"><a:avLst/></a:prstGeom>{fill}{line}</p:spPr></p:sp>"#
    )
}

fn pptx_line_xml(stroke_color: Option<&str>, stroke_width: f64) -> String {
    let width = (stroke_width.clamp(0.0, 72.0) * 12_700.0).round() as i64;
    let fill = stroke_color
        .map(|color| format!(r#"<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>"#))
        .unwrap_or_else(|| "<a:noFill/>".to_string());
    format!(r#"<a:ln w="{width}">{fill}</a:ln>"#)
}

fn build_pptx_text_shape(shape_id: usize, spec: &PptxTextSpec) -> String {
    let (x, y, width, height) = pptx_geometry_emu(spec);
    let rotation = pptx_rotation_unit(spec.rotation);
    let shape_fill = pptx_shape_fill_xml(spec.fill_color.as_deref());
    let run_properties = pptx_run_properties_xml("a:rPr", spec);
    let end_properties = pptx_run_properties_xml("a:endParaRPr", spec);
    let paragraph_properties = spec
        .align
        .as_deref()
        .map(|align| format!(r#"<a:pPr algn="{align}"/>"#))
        .unwrap_or_default();
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="TextBox {shape_id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{shape_fill}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/><a:p>{paragraph_properties}<a:r>{run_properties}<a:t>{}</a:t></a:r>{end_properties}</a:p></p:txBody></p:sp>"#,
        escape_xml(&spec.text)
    )
}

fn pptx_run_properties_xml(tag: &str, spec: &PptxTextSpec) -> String {
    let size = spec.font_size * 100;
    let bold = if spec.bold { r#" b="1""# } else { "" };
    let italic = if spec.italic { r#" i="1""# } else { "" };
    let underline = if spec.underline { r#" u="sng""# } else { "" };
    let strikethrough = if spec.strikethrough {
        r#" strike="sngStrike""#
    } else {
        ""
    };
    let latin_font = spec
        .font_family
        .as_deref()
        .map(escape_xml)
        .map(|font| format!(r#"<a:latin typeface="{font}"/>"#))
        .unwrap_or_default();
    let color = spec
        .color
        .as_deref()
        .map(|color| format!(r#"<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>"#))
        .unwrap_or_default();
    format!(
        r#"<{tag} lang="en-US" sz="{size}"{bold}{italic}{underline}{strikethrough}>{latin_font}{color}</{tag}>"#
    )
}

fn pptx_alignment_value(value: &str) -> Option<&'static str> {
    match value {
        "left" => Some("l"),
        "center" => Some("ctr"),
        "right" => Some("r"),
        _ => None,
    }
}

fn pptx_shape_fill_xml(fill_color: Option<&str>) -> String {
    fill_color
        .map(|color| format!(r#"<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>"#))
        .unwrap_or_else(|| "<a:noFill/>".to_string())
}

fn update_pptx_shape_geometries(xml: &str, specs: &[PptxTextSpec]) -> String {
    let mut output = String::new();
    let mut rest = xml;
    let mut text_shape_index = 0usize;
    while let Some(start) = rest.find("<p:sp") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:sp>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:sp>".len();
        let shape = &after_start[..end_index];
        if shape.contains("<a:t") {
            if let Some(spec) = specs.get(text_shape_index) {
                output.push_str(&replace_pptx_shape_geometry(shape, spec));
            } else {
                output.push_str(shape);
            }
            text_shape_index += 1;
        } else {
            output.push_str(shape);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

fn replace_pptx_shape_geometry(shape: &str, spec: &PptxTextSpec) -> String {
    let (x, y, width, height) = pptx_geometry_emu(spec);
    let shape = replace_empty_xml_element(shape, "<a:off", &format!(r#"<a:off x="{x}" y="{y}"/>"#));
    let shape = replace_empty_xml_element(
        &shape,
        "<a:ext",
        &format!(r#"<a:ext cx="{width}" cy="{height}"/>"#),
    );
    let shape = set_xml_start_attr(
        &shape,
        "<a:xfrm",
        "rot",
        &pptx_rotation_unit(spec.rotation).to_string(),
    );
    let shape = replace_pptx_run_properties(&shape, spec);
    replace_pptx_shape_fill(&shape, spec)
}

fn replace_pptx_run_properties(shape: &str, spec: &PptxTextSpec) -> String {
    let run_properties = pptx_run_properties_xml("a:rPr", spec);
    let end_properties = pptx_run_properties_xml("a:endParaRPr", spec);
    let shape = replace_xml_element(shape, "a:rPr", &run_properties)
        .unwrap_or_else(|| replace_empty_xml_element(shape, "<a:rPr", &run_properties));
    replace_xml_element(&shape, "a:endParaRPr", &end_properties)
        .unwrap_or_else(|| replace_empty_xml_element(&shape, "<a:endParaRPr", &end_properties))
}

fn replace_pptx_shape_fill(shape: &str, spec: &PptxTextSpec) -> String {
    let fill = pptx_shape_fill_xml(spec.fill_color.as_deref());
    if let Some(start) = shape.find("<p:spPr") {
        let after_start = &shape[start..];
        if let Some(end) = after_start.find("</p:spPr>") {
            let sppr_end = start + end + "</p:spPr>".len();
            let sppr = &shape[start..sppr_end];
            let updated_sppr = replace_xml_element(sppr, "a:solidFill", &fill)
                .unwrap_or_else(|| replace_empty_xml_element(sppr, "<a:noFill", &fill));
            let mut output = String::new();
            output.push_str(&shape[..start]);
            output.push_str(&updated_sppr);
            output.push_str(&shape[sppr_end..]);
            return output;
        }
    }
    shape.to_string()
}

fn pptx_geometry_emu(spec: &PptxTextSpec) -> (i64, i64, i64, i64) {
    pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height)
}

fn pptx_shape_geometry_emu(spec: &PptxShapeSpec) -> (i64, i64, i64, i64) {
    pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height)
}

fn pptx_percent_geometry_emu(x: f64, y: f64, width: f64, height: f64) -> (i64, i64, i64, i64) {
    let x = ((x.clamp(0.0, 100.0) / 100.0) * PPTX_SLIDE_WIDTH_EMU).round() as i64;
    let y = ((y.clamp(0.0, 100.0) / 100.0) * PPTX_SLIDE_HEIGHT_EMU).round() as i64;
    let width = ((width.clamp(1.0, 100.0) / 100.0) * PPTX_SLIDE_WIDTH_EMU)
        .round()
        .max(1.0) as i64;
    let height = ((height.clamp(1.0, 100.0) / 100.0) * PPTX_SLIDE_HEIGHT_EMU)
        .round()
        .max(1.0) as i64;
    (x, y, width, height)
}

fn pptx_rotation_unit(rotation: f64) -> i64 {
    (normalize_degrees(rotation) * 60_000.0).round() as i64
}

fn normalize_degrees(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    let normalized = value % 360.0;
    if normalized < 0.0 {
        normalized + 360.0
    } else {
        normalized
    }
}

fn set_xml_start_attr(xml: &str, marker: &str, attr: &str, value: &str) -> String {
    let Some(start) = xml.find(marker) else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find('>') else {
        return xml.to_string();
    };
    let tag_end = start + end;
    let start_tag = &xml[start..tag_end];
    let attr_prefix = format!("{attr}=");
    let next_tag = if let Some(attr_start) = start_tag.find(&attr_prefix) {
        let absolute_attr_start = start + attr_start;
        let quote_index = absolute_attr_start + attr_prefix.len();
        let Some(quote) = xml[quote_index..].chars().next() else {
            return xml.to_string();
        };
        if quote != '"' && quote != '\'' {
            return xml.to_string();
        }
        let value_start = quote_index + quote.len_utf8();
        let Some(value_end_offset) = xml[value_start..tag_end].find(quote) else {
            return xml.to_string();
        };
        let value_end = value_start + value_end_offset;
        format!(
            "{}{}{}",
            &xml[start..value_start],
            escape_xml(value),
            &xml[value_end..tag_end]
        )
    } else {
        format!("{start_tag} {attr}=\"{}\"", escape_xml(value))
    };
    format!("{}{}{}", &xml[..start], next_tag, &xml[tag_end..])
}

fn append_pptx_slide_content_types(content_types: &str, slide_ids: &[String]) -> String {
    let mut output = content_types.to_string();
    for slide_id in slide_ids {
        let part_name = format!("/{}", slide_id);
        if output.contains(&part_name) {
            continue;
        }
        let override_xml = format!(
            r#"<Override PartName="{part_name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>"#
        );
        output = append_before_or_end(&output, "</Types>", &override_xml);
    }
    output
}

fn pptx_presentation_slides(bytes: &[u8]) -> AppResult<Vec<PptxPresentationSlideRef>> {
    let presentation = read_zip_text(bytes, "ppt/presentation.xml")?;
    let rels = read_zip_text(bytes, "ppt/_rels/presentation.xml.rels")?;
    Ok(pptx_presentation_slides_from_xml(&presentation, &rels))
}

fn pptx_presentation_slides_from_xml(
    presentation: &str,
    rels: &str,
) -> Vec<PptxPresentationSlideRef> {
    let targets = pptx_relationship_targets(rels);
    xml_empty_elements(presentation, "<p:sldId ")
        .into_iter()
        .filter_map(|slide| {
            let rel_id = attr_value(&slide, "r:id")?;
            let path = targets.get(&rel_id)?.clone();
            Some(PptxPresentationSlideRef {
                path,
                slide_id: attr_value(&slide, "id")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(256),
                rel_id,
            })
        })
        .collect()
}

fn pptx_relationship_targets(rels: &str) -> BTreeMap<String, String> {
    xml_empty_elements(rels, "<Relationship ")
        .into_iter()
        .filter_map(|relationship| {
            let rel_id = attr_value(&relationship, "Id")?;
            let rel_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !rel_type.ends_with("/slide") {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some((rel_id, pptx_relationship_target_to_part(&target)))
        })
        .collect()
}

fn pptx_relationship_target_to_part(target: &str) -> String {
    let target = target.trim_start_matches('/');
    if target.starts_with("ppt/") {
        target.to_string()
    } else {
        format!("ppt/{target}")
    }
}

fn pptx_slide_writes(
    slides: &[Value],
    original_refs: &[PptxPresentationSlideRef],
) -> Vec<PptxPresentationSlideWrite> {
    let mut used_paths = original_refs
        .iter()
        .map(|slide| slide.path.clone())
        .collect::<Vec<_>>();
    slides
        .iter()
        .map(|slide| {
            let requested = slide
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let existing = original_refs
                .iter()
                .any(|slide_ref| slide_ref.path == requested);
            let path = if existing || valid_pptx_slide_path(&requested) {
                requested
            } else {
                next_pptx_slide_path(&used_paths)
            };
            if !used_paths.iter().any(|used| used == &path) {
                used_paths.push(path.clone());
            }
            PptxPresentationSlideWrite { path }
        })
        .collect()
}

fn valid_pptx_slide_path(path: &str) -> bool {
    path.starts_with("ppt/slides/slide") && path.ends_with(".xml") && !path.contains("..")
}

fn next_pptx_slide_path(used_paths: &[String]) -> String {
    let mut index = used_paths
        .iter()
        .filter_map(|path| {
            path.rsplit('/')
                .next()
                .and_then(|name| name.strip_prefix("slide"))
                .and_then(|name| name.strip_suffix(".xml"))
                .and_then(|value| value.parse::<usize>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;
    loop {
        let path = format!("ppt/slides/slide{index}.xml");
        if !used_paths.iter().any(|used| used == &path) {
            return path;
        }
        index += 1;
    }
}

fn update_pptx_presentation_manifest(
    presentation: &str,
    rels: &str,
    slides: &[PptxPresentationSlideWrite],
) -> (String, String) {
    let existing_refs = pptx_presentation_slides_from_xml(presentation, rels);
    let existing_by_path = existing_refs
        .iter()
        .map(|slide| (slide.path.clone(), slide.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut rels_out = rels.to_string();
    let mut next_rel = next_rid(rels);
    let mut next_slide_id = next_presentation_slide_id(presentation);
    let mut slide_tags = Vec::new();
    for slide in slides {
        let (rel_id, slide_id) = if let Some(existing) = existing_by_path.get(&slide.path) {
            (existing.rel_id.clone(), existing.slide_id)
        } else {
            let rel_id = format!("rId{next_rel}");
            next_rel += 1;
            let rel = format!(
                r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="{}"/>"#,
                pptx_part_to_relationship_target(&slide.path)
            );
            rels_out = append_before_or_end(&rels_out, "</Relationships>", &rel);
            let slide_id = next_slide_id;
            next_slide_id += 1;
            (rel_id, slide_id)
        };
        slide_tags.push(format!(r#"<p:sldId id="{slide_id}" r:id="{rel_id}"/>"#));
    }
    let list = format!("<p:sldIdLst>{}</p:sldIdLst>", slide_tags.join(""));
    let presentation_out = replace_xml_element(presentation, "p:sldIdLst", &list)
        .unwrap_or_else(|| append_before_or_end(presentation, "</p:presentation>", &list));
    (presentation_out, rels_out)
}

fn pptx_part_to_relationship_target(path: &str) -> String {
    path.strip_prefix("ppt/").unwrap_or(path).to_string()
}

fn append_pptx_slide_content_types_for_writes(
    content_types: &str,
    slides: &[PptxPresentationSlideWrite],
) -> String {
    let slide_ids = slides
        .iter()
        .map(|slide| slide.path.clone())
        .collect::<Vec<_>>();
    append_pptx_slide_content_types(content_types, &slide_ids)
}

fn append_pptx_notes_content_types(content_types: &str, notes_paths: &[String]) -> String {
    let mut output = content_types.to_string();
    for notes_path in notes_paths {
        let part_name = format!("/{notes_path}");
        if output.contains(&format!(r#"PartName="{part_name}""#)) {
            continue;
        }
        let override_xml = format!(
            r#"<Override PartName="{part_name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>"#
        );
        output = append_before_or_end(&output, "</Types>", &override_xml);
    }
    output
}

fn append_before_or_end(xml: &str, marker: &str, inserted: &str) -> String {
    if let Some(index) = xml.find(marker) {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(inserted);
        output.push_str(&xml[index..]);
        output
    } else {
        format!("{xml}{inserted}")
    }
}

fn next_rid(rels: &str) -> usize {
    rels.split("Id=\"rId")
        .skip(1)
        .filter_map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse::<usize>()
                .ok()
        })
        .max()
        .unwrap_or(0)
        + 1
}

fn next_presentation_slide_id(presentation: &str) -> usize {
    presentation
        .split("<p:sldId ")
        .skip(1)
        .filter_map(|part| attr_value(part, "id"))
        .filter_map(|id| id.parse::<usize>().ok())
        .max()
        .unwrap_or(255)
        + 1
}

fn read_shared_strings(bytes: &[u8]) -> AppResult<Vec<String>> {
    let xml = read_zip_text(bytes, "xl/sharedStrings.xml")?;
    Ok(xml_segments(&xml, "<si", "</si>")
        .into_iter()
        .map(|item| extract_text_tags(&item, "t").join(""))
        .collect())
}

fn replacement_zip_text_or_default<F>(
    original: &[u8],
    replacements: &[(String, Vec<u8>)],
    path: &str,
    default: F,
) -> String
where
    F: FnOnce() -> String,
{
    if let Some((_, bytes)) = replacements.iter().rev().find(|(name, _)| name == path) {
        if let Ok(text) = std::str::from_utf8(bytes) {
            return text.to_string();
        }
    }
    read_zip_text(original, path).unwrap_or_else(|_| default())
}

fn upsert_zip_replacement(replacements: &mut Vec<(String, Vec<u8>)>, path: String, bytes: Vec<u8>) {
    if let Some((_, existing)) = replacements.iter_mut().find(|(name, _)| name == &path) {
        *existing = bytes;
        return;
    }
    replacements.push((path, bytes));
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

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
    fn text_model_preserves_utf8_bom_and_line_ending_metadata() {
        let model = text_model(b"\xEF\xBB\xBFalpha\r\nbeta\r\n").expect("text model should parse");

        assert_eq!(model["content"], "alpha\nbeta\n");
        assert_eq!(model["encoding"], "utf-8");
        assert_eq!(model["bom"], true);
        assert_eq!(model["lineEnding"], "\r\n");
        assert_eq!(model["trailingNewline"], true);
    }

    #[test]
    fn text_serializer_restores_selected_line_ending_and_bom() {
        let model = json!({
            "content": "alpha\nbeta\n",
            "bom": true,
            "lineEnding": "\r\n",
        });

        let bytes = text_bytes(&[], &model).expect("text should serialize");

        assert_eq!(bytes, b"\xEF\xBB\xBFalpha\r\nbeta\r\n");
    }

    #[test]
    fn text_serializer_falls_back_to_original_metadata() {
        let model = json!({
            "content": "alpha\nbeta",
        });

        let bytes = text_bytes(b"\xEF\xBB\xBFold\rsecond", &model)
            .expect("text should serialize with original metadata");

        assert_eq!(bytes, b"\xEF\xBB\xBFalpha\rbeta");
    }

    #[test]
    fn structured_text_validation_accepts_valid_json_yaml_and_toml() {
        validate_structured_text_for_path(Path::new("config.json"), br#"{"name":"mymy"}"#)
            .expect("valid JSON should pass");
        validate_structured_text_for_path(
            Path::new("config.yaml"),
            b"name: mymy\nitems:\n  - one\n",
        )
        .expect("valid YAML should pass");
        validate_structured_text_for_path(Path::new("config.toml"), b"name = \"mymy\"\n")
            .expect("valid TOML should pass");
    }

    #[test]
    fn structured_text_validation_rejects_invalid_json_yaml_and_toml() {
        assert!(validate_structured_text_for_path(Path::new("config.json"), b"{").is_err());
        assert!(validate_structured_text_for_path(Path::new("config.yaml"), b"name: [").is_err());
        assert!(validate_structured_text_for_path(Path::new("config.toml"), b"name =").is_err());
    }

    #[test]
    fn ooxml_validation_accepts_required_parts_and_relationship_targets() {
        let bytes = test_ooxml_package(&[
            ("[Content_Types].xml", "<Types/>"),
            (
                "_rels/.rels",
                r#"<Relationships><Relationship Id="rId1" Target="word/document.xml"/></Relationships>"#,
            ),
            ("word/document.xml", "<w:document/>"),
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships><Relationship Id="rId2" Target="media/image1.png"/></Relationships>"#,
            ),
            ("word/media/image1.png", "image"),
        ]);

        validate_ooxml_package(DocumentEditorKind::Docx, &bytes)
            .expect("valid DOCX package should pass");
    }

    #[test]
    fn ooxml_validation_rejects_missing_required_part() {
        let bytes = test_ooxml_package(&[
            ("[Content_Types].xml", "<Types/>"),
            ("_rels/.rels", "<Relationships/>"),
            ("word/document.xml", "<w:document/>"),
        ]);

        assert!(validate_ooxml_package(DocumentEditorKind::Docx, &bytes).is_err());
    }

    #[test]
    fn ooxml_validation_rejects_missing_internal_relationship_target() {
        let bytes = test_ooxml_package(&[
            ("[Content_Types].xml", "<Types/>"),
            (
                "_rels/.rels",
                r#"<Relationships><Relationship Id="rId1" Target="word/document.xml"/></Relationships>"#,
            ),
            ("word/document.xml", "<w:document/>"),
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships><Relationship Id="rId2" Target="media/missing.png"/></Relationships>"#,
            ),
        ]);

        assert!(validate_ooxml_package(DocumentEditorKind::Docx, &bytes).is_err());
    }

    #[test]
    fn docx_compatibility_warnings_detect_preserved_uneditable_parts() {
        let bytes = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:drawing/></w:r></w:p><w:sectPr/></w:body></w:document>"#,
            ),
            ("word/header1.xml", "<w:hdr/>"),
        ]);

        let warnings = compatibility_warnings_for_bytes(DocumentEditorKind::Docx, &bytes);
        let codes = warning_codes(&warnings);

        assert!(codes.contains(&"docx-drawing"));
        assert!(codes.contains(&"docx-header-footer"));
        assert!(codes.contains(&"docx-section"));
    }

    #[test]
    fn xlsx_compatibility_warnings_detect_formulas_and_macros() {
        let bytes = test_ooxml_package(&[
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData><row r="1"><c r="A1"><f>B1+C1</f><v>3</v></c></row></sheetData></worksheet>"#,
            ),
            ("xl/styles.xml", "<styleSheet/>"),
            ("xl/vbaProject.bin", "macro"),
        ]);

        let warnings = compatibility_warnings_for_bytes(DocumentEditorKind::Xlsx, &bytes);
        let codes = warning_codes(&warnings);

        assert!(codes.contains(&"xlsx-formulas"));
        assert!(codes.contains(&"xlsx-styles"));
        assert!(codes.contains(&"xlsx-macros"));
        assert!(warnings
            .iter()
            .any(|warning| warning.severity == DocumentCompatibilityWarningSeverity::Danger));
    }

    #[test]
    fn pptx_compatibility_warnings_detect_media_and_motion() {
        let bytes = test_ooxml_package(&[
            (
                "ppt/slides/slide1.xml",
                r#"<p:sld><p:cSld><p:spTree><p:pic/><p:sp><p:txBody><a:p><a:r><a:t>Hi</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:transition/><p:timing/></p:sld>"#,
            ),
            ("ppt/media/image1.png", "image"),
        ]);

        let warnings = compatibility_warnings_for_bytes(DocumentEditorKind::Pptx, &bytes);
        let codes = warning_codes(&warnings);

        assert!(codes.contains(&"pptx-media"));
        assert!(codes.contains(&"pptx-transitions"));
        assert!(codes.contains(&"pptx-animations"));
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

        let bytes = delimited_bytes(&[], &model, ',').expect("CSV should serialize");
        assert_eq!(
            String::from_utf8(bytes).expect("CSV is UTF-8"),
            "name,note\nalpha,\"one, two\"\nbeta,\"quote \"\"inside\"\"\""
        );
    }

    #[test]
    fn delimited_model_strips_and_records_utf8_bom() {
        let model = delimited_model(b"\xEF\xBB\xBFname,note\r\nalpha,one\r\n", ',')
            .expect("CSV should parse");

        assert_eq!(model["rows"][0][0], "name");
        assert_eq!(model["encoding"], "utf-8");
        assert_eq!(model["bom"], true);
        assert_eq!(model["quoteStyle"], "minimal");
        assert_eq!(model["lineEnding"], "\r\n");
        assert_eq!(model["trailingNewline"], true);
    }

    #[test]
    fn delimited_model_detects_always_quoted_csv() {
        let model = delimited_model(b"\"name\",\"note\"\n\"alpha\",\"one\"\n", ',')
            .expect("CSV should parse");

        assert_eq!(model["quoteStyle"], "always");
    }

    #[test]
    fn delimited_serializer_preserves_original_always_quote_style_when_model_omits_it() {
        let model = json!({
            "rows": [
                ["name", "note"],
                ["alpha", "one"]
            ],
            "trailingNewline": true,
        });

        let bytes =
            delimited_bytes(b"\"old\",\"note\"\n", &model, ',').expect("CSV should serialize");

        assert_eq!(
            String::from_utf8(bytes).expect("CSV is UTF-8"),
            "\"name\",\"note\"\n\"alpha\",\"one\"\n"
        );
    }

    #[test]
    fn delimited_serializer_uses_explicit_always_quote_style() {
        let model = json!({
            "rows": [
                ["name", "note"],
                ["alpha", "one"]
            ],
            "quoteStyle": "always",
        });

        let bytes = delimited_bytes(&[], &model, ',').expect("CSV should serialize");

        assert_eq!(
            String::from_utf8(bytes).expect("CSV is UTF-8"),
            "\"name\",\"note\"\n\"alpha\",\"one\""
        );
    }

    #[test]
    fn delimited_serializer_restores_original_bom_when_model_omits_it() {
        let model = json!({
            "rows": [
                ["name", "note"],
                ["alpha", "one"]
            ],
            "lineEnding": "\r\n",
            "trailingNewline": true,
        });

        let bytes = delimited_bytes(b"\xEF\xBB\xBFold,note\r\n", &model, ',')
            .expect("CSV should serialize");

        assert_eq!(bytes, b"\xEF\xBB\xBFname,note\r\nalpha,one\r\n");
    }

    #[test]
    fn delimited_serializer_preserves_crlf_and_trailing_newline() {
        let model = json!({
            "rows": [
                ["name", "note"],
                ["alpha", "one"],
            ],
            "lineEnding": "\r\n",
            "trailingNewline": true,
        });

        let bytes = delimited_bytes(&[], &model, ',').expect("CSV should serialize");
        assert_eq!(
            String::from_utf8(bytes).expect("CSV is UTF-8"),
            "name,note\r\nalpha,one\r\n"
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

    #[test]
    fn xlsx_sheet_update_writes_new_cells_into_sheet_data() {
        let xml = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A1"/><sheetData><row r="1"><c r="A1"><v>old</v></c></row></sheetData></worksheet>"#;
        let update = SheetUpdate {
            cells: BTreeMap::from([
                (
                    "A1".to_string(),
                    SheetCellWrite {
                        value: "updated".to_string(),
                        formula: None,
                        ..SheetCellWrite::default()
                    },
                ),
                (
                    "B2".to_string(),
                    SheetCellWrite {
                        value: "new".to_string(),
                        formula: None,
                        ..SheetCellWrite::default()
                    },
                ),
            ]),
            ..SheetUpdate::default()
        };

        let updated = update_xlsx_worksheet(xml, &update);

        assert!(updated.contains(r#"<dimension ref="A1:B2"/>"#));
        assert!(updated.contains(r#"<row r="2">"#));
        assert!(updated.contains(r#"<c r="B2" t="inlineStr"><is><t>new</t></is></c>"#));
        assert!(updated.contains(r#"<c r="A1" t="inlineStr"><is><t>updated</t></is></c>"#));
    }

    #[test]
    fn xlsx_sheet_update_preserves_formula_cells() {
        let xml = r#"<worksheet><dimension ref="A1:C1"/><sheetData><row r="1"><c r="C1"><f>A1+B1</f><v>3</v></c></row></sheetData></worksheet>"#;
        let update = SheetUpdate {
            cells: BTreeMap::from([(
                "C1".to_string(),
                SheetCellWrite {
                    value: "3".to_string(),
                    formula: Some("A1+B1".to_string()),
                    ..SheetCellWrite::default()
                },
            )]),
            ..SheetUpdate::default()
        };

        let updated = update_xlsx_worksheet(xml, &update);

        assert!(updated.contains(r#"<c r="C1"><f>A1+B1</f><v>3</v></c>"#));
    }

    #[test]
    fn xlsx_sheet_update_writes_columns_rows_and_merge_cells() {
        let xml = r#"<worksheet><dimension ref="A1:A1"/><sheetData><row r="1"><c r="A1"><v>old</v></c></row></sheetData></worksheet>"#;
        let update = SheetUpdate {
            cells: BTreeMap::from([(
                "A1".to_string(),
                SheetCellWrite {
                    value: "updated".to_string(),
                    formula: None,
                    ..SheetCellWrite::default()
                },
            )]),
            rows: BTreeMap::from([(
                1,
                SheetRowWrite {
                    height: Some(24.0),
                    hidden: true,
                },
            )]),
            columns: vec![SheetColumnWrite {
                index: 1,
                width: Some(18.0),
                hidden: true,
            }],
            merged_ranges: vec!["A1:B1".to_string()],
            ..SheetUpdate::default()
        };

        let updated = update_xlsx_worksheet(xml, &update);

        assert!(updated.contains(
            r#"<cols><col min="1" max="1" width="18" customWidth="1" hidden="1"/></cols>"#
        ));
        assert!(updated.contains(r#"<row r="1" ht="24" customHeight="1" hidden="1">"#));
        assert!(updated.contains(r#"<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>"#));
    }

    #[test]
    fn xlsx_sheet_update_reads_and_writes_frozen_panes() {
        let xml = r#"<worksheet><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1"><v>old</v></c></row></sheetData></worksheet>"#;
        let update = SheetUpdate {
            cells: BTreeMap::from([(
                "A1".to_string(),
                SheetCellWrite {
                    value: "updated".to_string(),
                    ..SheetCellWrite::default()
                },
            )]),
            frozen_rows: 1,
            frozen_columns: 2,
            ..SheetUpdate::default()
        };

        let updated = update_xlsx_worksheet(xml, &update);

        assert!(updated.contains(r#"<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>"#));
        assert_eq!(parse_sheet_frozen_pane(&updated), (1, 2));
    }

    #[test]
    fn xlsx_parser_exposes_data_validations() {
        let xml = r#"<worksheet><sheetData/><dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="A1:A3" errorTitle="Invalid" error="Choose from list"><formula1>"A,B,C"</formula1></dataValidation></dataValidations></worksheet>"#;

        let validations = parse_sheet_data_validations(xml);

        assert_eq!(validations[0]["sqref"], "A1:A3");
        assert_eq!(validations[0]["type"], "list");
        assert_eq!(validations[0]["formula1"], "\"A,B,C\"");
        assert_eq!(validations[0]["allowBlank"], true);
        assert_eq!(validations[0]["showErrorMessage"], true);
        assert_eq!(validations[0]["errorTitle"], "Invalid");
        assert_eq!(validations[0]["error"], "Choose from list");
    }

    #[test]
    fn xlsx_sheet_update_writes_data_validations() {
        let xml = r#"<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#;
        let update = SheetUpdate {
            cells: BTreeMap::from([(
                "A1".to_string(),
                SheetCellWrite {
                    value: "1".to_string(),
                    ..SheetCellWrite::default()
                },
            )]),
            data_validations: vec![SheetDataValidation {
                sqref: "A1:A2".to_string(),
                validation_type: Some("whole".to_string()),
                operator: Some("between".to_string()),
                formula1: Some("1".to_string()),
                formula2: Some("10".to_string()),
                allow_blank: true,
                show_error_message: true,
                error_title: Some("Invalid".to_string()),
                error: Some("Enter 1 through 10".to_string()),
                ..SheetDataValidation::default()
            }],
            ..SheetUpdate::default()
        };

        let updated = update_xlsx_worksheet(xml, &update);

        assert!(updated.contains(r#"<dataValidations count="1">"#));
        assert!(updated.contains(r#"<dataValidation sqref="A1:A2" type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Invalid" error="Enter 1 through 10">"#));
        assert!(updated.contains("<formula1>1</formula1>"));
        assert!(updated.contains("<formula2>10</formula2>"));
    }

    #[test]
    fn xlsx_parser_reads_and_writes_auto_filter() {
        let xml = r#"<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><autoFilter ref="A1:B3"/></worksheet>"#;

        assert_eq!(parse_sheet_auto_filter(xml), Some("A1:B3".to_string()));

        let update = SheetUpdate {
            cells: BTreeMap::from([(
                "A1".to_string(),
                SheetCellWrite {
                    value: "1".to_string(),
                    ..SheetCellWrite::default()
                },
            )]),
            auto_filter: Some("A1:C10".to_string()),
            ..SheetUpdate::default()
        };
        let updated = update_xlsx_worksheet(xml, &update);

        assert!(updated.contains(r#"<autoFilter ref="A1:C10"/>"#));
        assert!(!updated.contains(r#"<autoFilter ref="A1:B3"/>"#));
    }

    #[test]
    fn xlsx_parser_exposes_conditional_formatting_fill() {
        let styles = xlsx_styles_from_xml(
            r#"<styleSheet><dxfs count="1"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFF3BF"/></patternFill></fill></dxf></dxfs></styleSheet>"#,
        );
        let xml = r#"<worksheet><sheetData/><conditionalFormatting sqref="A1:A3"><cfRule type="cellIs" operator="greaterThan" dxfId="0" priority="1"><formula>10</formula></cfRule></conditionalFormatting></worksheet>"#;

        let formattings = parse_sheet_conditional_formattings(xml, Some(&styles));

        assert_eq!(formattings[0]["sqref"], "A1:A3");
        assert_eq!(formattings[0]["rules"][0]["type"], "cellIs");
        assert_eq!(formattings[0]["rules"][0]["operator"], "greaterThan");
        assert_eq!(formattings[0]["rules"][0]["fillColor"], "#FFF3BF");
        assert_eq!(formattings[0]["rules"][0]["formulas"][0], "10");
    }

    #[test]
    fn xlsx_sheet_update_writes_conditional_formatting() {
        let xml = r#"<worksheet><sheetData><row r="1"><c r="A1"><v>11</v></c></row></sheetData><conditionalFormatting sqref="B1:B2"><cfRule type="duplicateValues" priority="1"/></conditionalFormatting></worksheet>"#;
        let update = SheetUpdate {
            cells: BTreeMap::from([(
                "A1".to_string(),
                SheetCellWrite {
                    value: "11".to_string(),
                    ..SheetCellWrite::default()
                },
            )]),
            conditional_formattings: vec![SheetConditionalFormatting {
                sqref: "A1:A2".to_string(),
                rules: vec![SheetConditionalRule {
                    rule_type: Some("cellIs".to_string()),
                    operator: Some("greaterThan".to_string()),
                    priority: Some(3),
                    dxf_id: Some(2),
                    formulas: vec!["10".to_string()],
                    ..SheetConditionalRule::default()
                }],
            }],
            ..SheetUpdate::default()
        };

        let updated = update_xlsx_worksheet(xml, &update);

        assert!(updated.contains(r#"<conditionalFormatting sqref="A1:A2">"#));
        assert!(updated.contains(
            r#"<cfRule type="cellIs" priority="3" operator="greaterThan" dxfId="2"><formula>10</formula></cfRule>"#
        ));
        assert!(!updated.contains("B1:B2"));
    }

    #[test]
    fn xlsx_style_writer_adds_conditional_formatting_dxf() {
        let mut update = SheetUpdate {
            conditional_formattings: vec![SheetConditionalFormatting {
                sqref: "A1:A1".to_string(),
                rules: vec![SheetConditionalRule {
                    rule_type: Some("cellIs".to_string()),
                    operator: Some("equal".to_string()),
                    fill_color: Some("E7F5D8".to_string()),
                    formulas: vec!["1".to_string()],
                    ..SheetConditionalRule::default()
                }],
            }],
            ..SheetUpdate::default()
        };
        let mut writer = XlsxStyleWriter::new(None);

        writer.assign_sheet_styles(&mut update);

        assert_eq!(update.conditional_formattings[0].rules[0].dxf_id, Some(0));
        assert!(writer.xml.contains(r#"<dxfs count="1">"#));
        assert!(writer.xml.contains(r#"<fgColor rgb="FFE7F5D8"/>"#));
    }

    #[test]
    fn xlsx_parser_reads_sheet_protection_and_page_setup() {
        let xml = r#"<worksheet><sheetData/><sheetProtection sheet="1" password="ABCD" objects="1" autoFilter="1"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9" scale="90"/></worksheet>"#;

        let protection = parse_sheet_protection(xml).expect("protection should parse");
        let margins = parse_sheet_page_margins(xml).expect("margins should parse");
        let setup = parse_sheet_page_setup(xml).expect("setup should parse");

        assert_eq!(protection["enabled"], true);
        assert_eq!(protection["password"], "ABCD");
        assert_eq!(protection["objects"], true);
        assert_eq!(protection["autoFilter"], true);
        assert_eq!(margins["left"], 0.7);
        assert_eq!(margins["footer"], 0.3);
        assert_eq!(setup["orientation"], "landscape");
        assert_eq!(setup["paperSize"], 9);
        assert_eq!(setup["scale"], 90);
    }

    #[test]
    fn xlsx_sheet_update_writes_sheet_protection_and_page_setup() {
        let xml = r#"<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><sheetProtection sheet="1" password="OLD"/><pageMargins left="1"/><pageSetup orientation="portrait"/></worksheet>"#;
        let update = SheetUpdate {
            cells: BTreeMap::from([(
                "A1".to_string(),
                SheetCellWrite {
                    value: "1".to_string(),
                    ..SheetCellWrite::default()
                },
            )]),
            protection: Some(SheetProtection {
                enabled: true,
                password: Some("ABCD".to_string()),
                objects: true,
                auto_filter: true,
                ..SheetProtection::default()
            }),
            page_margins: Some(SheetPageMargins {
                left: Some(0.7),
                right: Some(0.7),
                top: Some(0.75),
                bottom: Some(0.75),
                header: Some(0.3),
                footer: Some(0.3),
            }),
            page_setup: Some(SheetPageSetup {
                orientation: Some("landscape".to_string()),
                paper_size: Some(9),
                scale: Some(90),
                ..SheetPageSetup::default()
            }),
            ..SheetUpdate::default()
        };

        let updated = update_xlsx_worksheet(xml, &update);

        assert!(updated.contains(
            r#"<sheetProtection sheet="1" password="ABCD" objects="1" autoFilter="1"/>"#
        ));
        assert!(updated.contains(
            r#"<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>"#
        ));
        assert!(
            updated.contains(r#"<pageSetup orientation="landscape" paperSize="9" scale="90"/>"#)
        );
        assert!(!updated.contains("OLD"));
    }

    #[test]
    fn xlsx_parser_exposes_hyperlink_targets() {
        let xml = r#"<worksheet><sheetData/><hyperlinks><hyperlink ref="A1" r:id="rId2" display="Open" tooltip="Docs"/><hyperlink ref="B2" location="Sheet2!A1" display="Jump"/></hyperlinks></worksheet>"#;
        let targets =
            BTreeMap::from([("rId2".to_string(), "https://example.com/docs".to_string())]);

        let hyperlinks = parse_sheet_hyperlinks(xml, &targets);

        assert_eq!(hyperlinks[0]["ref"], "A1");
        assert_eq!(hyperlinks[0]["relationshipId"], "rId2");
        assert_eq!(hyperlinks[0]["target"], "https://example.com/docs");
        assert_eq!(hyperlinks[0]["display"], "Open");
        assert_eq!(hyperlinks[0]["tooltip"], "Docs");
        assert_eq!(hyperlinks[1]["ref"], "B2");
        assert_eq!(hyperlinks[1]["location"], "Sheet2!A1");
    }

    #[test]
    fn xlsx_sheet_update_writes_hyperlinks_and_namespace() {
        let xml = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><hyperlinks><hyperlink ref="B1" location="Old!A1"/></hyperlinks></worksheet>"#;
        let update = SheetUpdate {
            cells: BTreeMap::from([(
                "A1".to_string(),
                SheetCellWrite {
                    value: "1".to_string(),
                    ..SheetCellWrite::default()
                },
            )]),
            hyperlinks: vec![
                SheetHyperlink {
                    reference: "A1".to_string(),
                    relationship_id: Some("rId3".to_string()),
                    target: Some("https://example.com".to_string()),
                    display: Some("Example".to_string()),
                    tooltip: Some("Open example".to_string()),
                    ..SheetHyperlink::default()
                },
                SheetHyperlink {
                    reference: "C1".to_string(),
                    location: Some("Sheet2!A1".to_string()),
                    display: Some("Jump".to_string()),
                    ..SheetHyperlink::default()
                },
            ],
            ..SheetUpdate::default()
        };

        let updated = update_xlsx_worksheet(xml, &update);

        assert!(updated.contains(
            r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#
        ));
        assert!(updated.contains(
            r#"<hyperlink ref="A1" r:id="rId3" display="Example" tooltip="Open example"/>"#
        ));
        assert!(updated.contains(r#"<hyperlink ref="C1" location="Sheet2!A1" display="Jump"/>"#));
        assert!(!updated.contains("Old!A1"));
    }

    #[test]
    fn xlsx_hyperlink_relationships_replace_only_hyperlink_rels() {
        let rels = r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://old.example" TargetMode="External"/></Relationships>"#;
        let mut update = SheetUpdate {
            hyperlinks: vec![SheetHyperlink {
                reference: "A1".to_string(),
                target: Some("https://new.example".to_string()),
                ..SheetHyperlink::default()
            }],
            ..SheetUpdate::default()
        };

        let updated =
            update_sheet_hyperlink_relationships(Some(rels), &mut update).expect("rels update");

        assert!(updated.contains("relationships/drawing"));
        assert!(updated.contains(r#"Target="../drawings/drawing1.xml""#));
        assert!(updated.contains("https://new.example"));
        assert!(!updated.contains("https://old.example"));
        assert_eq!(
            update.hyperlinks[0].relationship_id,
            Some("rId2".to_string())
        );
    }

    #[test]
    fn xlsx_parser_exposes_comments_with_authors() {
        let xml = r#"<comments><authors><author>Elena</author></authors><commentList><comment ref="B2" authorId="0"><text><t>First</t><t>Second</t></text></comment></commentList></comments>"#;

        let comments = parse_sheet_comments(xml);

        assert_eq!(comments[0]["ref"], "B2");
        assert_eq!(comments[0]["author"], "Elena");
        assert_eq!(comments[0]["authorId"], 0);
        assert_eq!(comments[0]["text"], "First\nSecond");
    }

    #[test]
    fn xlsx_comment_package_adds_relationships_parts_and_content_types() {
        let mut rels = None;
        let mut replacements = Vec::new();
        let mut comments_content_types = Vec::new();
        let mut needs_vml_content_type = false;
        let comments = vec![SheetComment {
            reference: "C3".to_string(),
            author: Some("Elena".to_string()),
            text: "Check this".to_string(),
        }];

        let legacy_drawing_id = update_sheet_comments_package(
            "xl/worksheets/sheet1.xml",
            &mut rels,
            &comments,
            &[],
            &mut replacements,
            &mut comments_content_types,
            &mut needs_vml_content_type,
        )
        .expect("legacy drawing relationship");
        let worksheet = update_sheet_legacy_drawing(
            "<worksheet><sheetData/></worksheet>",
            Some(&legacy_drawing_id),
        );
        let content_types = ensure_xlsx_comments_content_types(
            "<Types></Types>",
            &comments_content_types,
            needs_vml_content_type,
        );

        let rels = rels.expect("sheet rels");
        assert!(rels.contains("relationships/comments"));
        assert!(rels.contains(r#"Target="../comments1.xml""#));
        assert!(rels.contains("relationships/vmlDrawing"));
        assert!(rels.contains(r#"Target="../drawings/vmlDrawing1.vml""#));
        assert!(worksheet.contains(r#"<legacyDrawing r:id=""#));
        assert!(worksheet.contains("xmlns:r="));
        assert_eq!(replacements[0].0, "xl/comments1.xml");
        assert!(String::from_utf8_lossy(&replacements[0].1).contains("Check this"));
        assert_eq!(replacements[1].0, "xl/drawings/vmlDrawing1.vml");
        assert!(String::from_utf8_lossy(&replacements[1].1).contains("<x:Row>2</x:Row>"));
        assert!(String::from_utf8_lossy(&replacements[1].1).contains("<x:Column>2</x:Column>"));
        assert!(content_types.contains("spreadsheetml.comments+xml"));
        assert!(content_types.contains("vmlDrawing"));
    }

    #[test]
    fn xlsx_sheet_objects_parse_charts_images_and_pivots() {
        let sheet_xml = r#"<worksheet><drawing r:id="rIdDrawing"/><tableParts count="1"><tablePart r:id="rIdTable"/></tableParts><pivotTableDefinitions><pivotTableDefinition r:id="rIdPivot"/></pivotTableDefinitions></worksheet>"#;
        let sheet_rels = r#"<Relationships><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rIdTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/><Relationship Id="rIdPivot" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>"#;
        let drawing_xml = r#"<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:row>9</xdr:row></xdr:to><xdr:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor><xdr:oneCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:row>6</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>"#;
        let drawing_rels = r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#;
        let chart_xml = r#"<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Series A</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#;
        let table_xml = r#"<table name="Table1" displayName="Sales" ref="A1:B3" totalsRowShown="1"><autoFilter ref="A1:B3"/><tableColumns count="2"><tableColumn id="1" name="Region"/><tableColumn id="2" name="Revenue" totalsRowFunction="sum"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="1" showRowStripes="1" showColumnStripes="0"/></table>"#;
        let pivot_xml =
            r#"<pivotTableDefinition name="Pivot A" cacheId="3"></pivotTableDefinition>"#;
        let bytes = test_ooxml_package(&[
            ("xl/drawings/drawing1.xml", drawing_xml),
            ("xl/drawings/_rels/drawing1.xml.rels", drawing_rels),
            ("xl/charts/chart1.xml", chart_xml),
            ("xl/media/image1.png", "png-bytes"),
            ("xl/tables/table1.xml", table_xml),
            ("xl/pivotTables/pivotTable1.xml", pivot_xml),
        ]);

        let objects = parse_xlsx_sheet_objects(
            &bytes,
            "xl/worksheets/sheet1.xml",
            sheet_xml,
            Some(sheet_rels),
        );

        assert_eq!(objects.charts[0]["path"], "xl/charts/chart1.xml");
        assert_eq!(objects.charts[0]["type"], "bar");
        assert_eq!(objects.charts[0]["title"], "Revenue");
        assert_eq!(objects.charts[0]["categories"][0], "Q1");
        assert_eq!(objects.charts[0]["series"][0]["values"][0], "120");
        assert_eq!(objects.charts[0]["anchor"]["from"]["column"], 1);
        assert_eq!(objects.images[0]["mediaPath"], "xl/media/image1.png");
        assert_eq!(objects.images[0]["mimeType"], "image/png");
        assert!(objects.images[0]["dataUrl"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert_eq!(objects.tables[0]["path"], "xl/tables/table1.xml");
        assert_eq!(objects.tables[0]["displayName"], "Sales");
        assert_eq!(objects.tables[0]["ref"], "A1:B3");
        assert_eq!(objects.tables[0]["autoFilterRef"], "A1:B3");
        assert_eq!(objects.tables[0]["totalsRowShown"], true);
        assert_eq!(objects.tables[0]["tableStyleName"], "TableStyleMedium2");
        assert_eq!(objects.tables[0]["showLastColumn"], true);
        assert_eq!(objects.tables[0]["showRowStripes"], true);
        assert_eq!(objects.tables[0]["columns"][1]["name"], "Revenue");
        assert_eq!(objects.tables[0]["columns"][1]["totalsRowFunction"], "sum");
        assert_eq!(objects.pivots[0]["path"], "xl/pivotTables/pivotTable1.xml");
        assert_eq!(objects.pivots[0]["name"], "Pivot A");
        assert_eq!(objects.pivots[0]["cacheId"], "3");
    }

    #[test]
    fn xlsx_table_update_writes_table_metadata() {
        let xml = r#"<table name="OldTable" displayName="Old" ref="A1:B3" totalsRowShown="0"><autoFilter ref="A1:B3"/><tableColumns count="2"><tableColumn id="1" name="Old A"/><tableColumn id="2" name="Old B"/></tableColumns><tableStyleInfo name="TableStyleLight1" showRowStripes="1"/></table>"#;
        let table = json!({
            "name": "Table1",
            "displayName": "Sales",
            "ref": "A1:C5",
            "autoFilterRef": "A1:C5",
            "totalsRowShown": true,
            "tableStyleName": "TableStyleMedium9",
            "showFirstColumn": true,
            "showLastColumn": false,
            "showRowStripes": true,
            "showColumnStripes": true,
            "columns": [
                { "id": "1", "name": "Region" },
                { "id": "2", "name": "Revenue", "totalsRowFunction": "sum" },
                { "id": "3", "name": "Margin", "totalsRowFunction": "average" }
            ]
        });

        let updated = update_xlsx_table_xml(xml, &table);

        assert!(updated.contains(
            r#"<table name="Table1" displayName="Sales" ref="A1:C5" totalsRowShown="1">"#
        ));
        assert!(updated.contains(r#"<autoFilter ref="A1:C5"/>"#));
        assert!(updated.contains(r#"<tableColumns count="3">"#));
        assert!(updated.contains(r#"<tableColumn id="2" name="Revenue" totalsRowFunction="sum"/>"#));
        assert!(updated.contains(
            r#"<tableStyleInfo name="TableStyleMedium9" showFirstColumn="1" showLastColumn="0" showRowStripes="1" showColumnStripes="1"/>"#
        ));
        assert!(!updated.contains("OldTable"));
    }

    #[test]
    fn xlsx_update_rewrites_chart_title_and_cached_series_values() {
        let chart_xml = r#"<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Series A</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#;
        let original = test_ooxml_package(&[
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData/></worksheet>"#,
            ),
            ("xl/charts/chart1.xml", chart_xml),
        ]);
        let model = json!({
            "sheets": [{
                "id": "xl/worksheets/sheet1.xml",
                "name": "Sheet1",
                "rows": [],
                "charts": [{
                    "id": "rIdChart",
                    "path": "xl/charts/chart1.xml",
                    "title": "Updated revenue",
                    "series": [{
                        "name": "Updated series",
                        "categories": ["Q2"],
                        "values": ["240"]
                    }]
                }]
            }]
        });

        let updated = update_xlsx(&original, &model).unwrap();
        let chart = read_zip_text(&updated, "xl/charts/chart1.xml").unwrap();

        assert!(chart.contains(">Updated revenue<"));
        assert!(chart.contains(">Updated series<"));
        assert!(chart.contains(">Q2<"));
        assert!(chart.contains(">240<"));
        assert!(!chart.contains(">120<"));
    }

    #[test]
    fn xlsx_update_rewrites_pivot_table_name() {
        let original = test_ooxml_package(&[
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData/></worksheet>"#,
            ),
            (
                "xl/pivotTables/pivotTable1.xml",
                r#"<pivotTableDefinition name="Old Pivot" cacheId="1"></pivotTableDefinition>"#,
            ),
        ]);
        let model = json!({
            "sheets": [{
                "id": "xl/worksheets/sheet1.xml",
                "name": "Sheet1",
                "rows": [],
                "pivots": [{
                    "id": "rIdPivot",
                    "path": "xl/pivotTables/pivotTable1.xml",
                    "name": "Updated Pivot"
                }]
            }]
        });

        let updated = update_xlsx(&original, &model).unwrap();
        let pivot = read_zip_text(&updated, "xl/pivotTables/pivotTable1.xml").unwrap();

        assert!(pivot.contains(r#"name="Updated Pivot""#));
        assert!(pivot.contains(r#"cacheId="1""#));
        assert!(!pivot.contains("Old Pivot"));
    }

    #[test]
    fn xlsx_update_marks_workbook_for_recalculation_when_formulas_exist() {
        let original = test_ooxml_package(&[
            ("[Content_Types].xml", "<Types></Types>"),
            (
                "xl/workbook.xml",
                r#"<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData/></worksheet>"#,
            ),
        ]);
        let model = json!({
            "sheets": [{
                "id": "xl/worksheets/sheet1.xml",
                "name": "Sheet1",
                "rows": [{
                    "index": "1",
                    "cells": [{
                        "ref": "A1",
                        "value": "",
                        "formula": "B1+C1"
                    }]
                }]
            }]
        });

        let updated = update_xlsx(&original, &model).unwrap();
        let workbook = read_zip_text(&updated, "xl/workbook.xml").unwrap();

        assert!(workbook.contains(r#"calcMode="auto""#));
        assert!(workbook.contains(r#"fullCalcOnLoad="1""#));
        assert!(workbook.contains(r#"forceFullCalc="1""#));
    }

    #[test]
    fn xlsx_parser_exposes_formula_cells() {
        let xml = r#"<worksheet><sheetData><row r="1"><c r="C1"><f>A1+B1</f><v>3</v></c></row></sheetData></worksheet>"#;

        let rows = parse_sheet_rows(xml, &[], None);

        assert_eq!(rows[0]["cells"][0]["formula"], "A1+B1");
        assert_eq!(rows[0]["cells"][0]["value"], "3");
    }

    #[test]
    fn xlsx_parser_exposes_basic_cell_styles() {
        let styles = xlsx_styles_from_xml(
            r##"<styleSheet>
                <numFmts count="1"><numFmt numFmtId="164" formatCode="$#,##0.00"/></numFmts>
                <fonts count="2">
                  <font><sz val="11"/><name val="Calibri"/></font>
                  <font><b/><i/><u/><strike/><sz val="14"/><color rgb="FF1F2937"/><name val="Noto Sans"/></font>
                </fonts>
                <fills count="3">
                  <fill><patternFill patternType="none"/></fill>
                  <fill><patternFill patternType="gray125"/></fill>
                  <fill><patternFill patternType="solid"><fgColor rgb="FFFDE68A"/></patternFill></fill>
                </fills>
                <cellXfs count="2">
                  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
                  <xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
                </cellXfs>
              </styleSheet>"##,
        );
        let xml = r#"<worksheet><sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Total</t></is></c></row></sheetData></worksheet>"#;

        let rows = parse_sheet_rows(xml, &[], Some(&styles));
        let cell = &rows[0]["cells"][0];

        assert_eq!(cell["fontFamily"], "Noto Sans");
        assert_eq!(cell["fontSize"], "14");
        assert_eq!(cell["numberFormat"], "$#,##0.00");
        assert_eq!(cell["color"], "#1F2937");
        assert_eq!(cell["fillColor"], "#FDE68A");
        assert_eq!(cell["align"], "center");
        assert_eq!(cell["verticalAlign"], "middle");
        assert_eq!(cell["bold"], true);
        assert_eq!(cell["italic"], true);
        assert_eq!(cell["underline"], true);
        assert_eq!(cell["strikethrough"], true);
        assert_eq!(cell["wrapText"], true);
    }

    #[test]
    fn xlsx_style_writer_assigns_cell_style_indexes() {
        let mut writer = XlsxStyleWriter::new(None);
        let mut update = SheetUpdate {
            cells: BTreeMap::from([(
                "A1".to_string(),
                SheetCellWrite {
                    value: "Total".to_string(),
                    style: Some(XlsxCellStyle {
                        number_format: Some("$#,##0.00".to_string()),
                        font_family: Some("Noto Sans".to_string()),
                        font_size: Some("14".to_string()),
                        bold: true,
                        color: Some("1F2937".to_string()),
                        fill_color: Some("FDE68A".to_string()),
                        align: Some("right".to_string()),
                        wrap_text: true,
                        ..XlsxCellStyle::default()
                    }),
                    ..SheetCellWrite::default()
                },
            )]),
            ..SheetUpdate::default()
        };

        writer.assign_sheet_styles(&mut update);
        let updated = build_xlsx_worksheet(&update);

        assert!(writer.changed);
        assert!(writer.xml.contains(r#"<b/>"#));
        assert!(writer.xml.contains(r#"<name val="Noto Sans"/>"#));
        assert!(writer.xml.contains(r#"<fgColor rgb="FFFDE68A"/>"#));
        assert!(writer.xml.contains(r#"formatCode="$#,##0.00""#));
        assert!(updated.contains(r#"<c r="A1" s="1" t="inlineStr"><is><t>Total</t></is></c>"#));
    }

    #[test]
    fn xlsx_workbook_parser_maps_sheet_names_to_worksheet_paths() {
        let workbook = r#"<workbook><sheets><sheet name="Budget" sheetId="1" state="hidden" r:id="rId1"/></sheets></workbook>"#;
        let rels = r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#;

        let sheets = xlsx_workbook_sheets_from_xml(workbook, rels);

        assert_eq!(sheets[0].name, "Budget");
        assert_eq!(sheets[0].path, "xl/worksheets/sheet1.xml");
        assert_eq!(sheets[0].sheet_id, 1);
        assert_eq!(sheets[0].rel_id, "rId1");
        assert_eq!(sheets[0].state, Some("hidden".to_string()));
    }

    #[test]
    fn xlsx_workbook_manifest_updates_renames_and_registers_new_sheets() {
        let workbook = r#"<workbook><sheets><sheet name="Old" sheetId="1" state="hidden" r:id="rId1"/></sheets></workbook>"#;
        let rels = r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#;
        let sheets = vec![
            XlsxWorkbookSheetWrite {
                path: "xl/worksheets/sheet1.xml".to_string(),
                name: "Renamed".to_string(),
                state: Some("veryHidden".to_string()),
            },
            XlsxWorkbookSheetWrite {
                path: "xl/worksheets/sheet2.xml".to_string(),
                name: "Added".to_string(),
                state: None,
            },
        ];

        let (workbook, rels) = update_xlsx_workbook_manifest(workbook, rels, &sheets);
        let content_types = append_xlsx_sheet_content_types("<Types></Types>", &sheets);

        assert!(workbook
            .contains(r#"<sheet name="Renamed" sheetId="1" r:id="rId1" state="veryHidden"/>"#));
        assert!(workbook.contains(r#"<sheet name="Added" sheetId="2" r:id="rId2"/>"#));
        assert!(rels.contains(r#"Target="worksheets/sheet2.xml""#));
        assert!(content_types.contains(r#"PartName="/xl/worksheets/sheet2.xml""#));
    }

    #[test]
    fn xlsx_sheet_pr_reads_and_writes_tab_color() {
        let xml = r#"<worksheet><sheetPr codeName="Sheet1"><tabColor rgb="FFFF0000"/></sheetPr><sheetData/></worksheet>"#;

        let tab_color = parse_sheet_tab_color(xml).expect("tab color should parse");
        assert_eq!(tab_color.color, Some("FF0000".to_string()));

        let update = SheetUpdate {
            tab_color_xml: Some(r#"<tabColor rgb="FF22C55E"/>"#.to_string()),
            ..SheetUpdate::default()
        };
        let updated = update_xlsx_worksheet(xml, &update);

        assert!(
            updated.contains(r#"<sheetPr codeName="Sheet1"><tabColor rgb="FF22C55E"/></sheetPr>"#)
        );
        assert!(!updated.contains("FFFF0000"));
    }

    #[test]
    fn xlsx_defined_names_parse_and_update_workbook() {
        let workbook = r#"<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Budget!$A$1:$D$20</definedName><definedName name="HiddenRate" hidden="1" comment="Internal">Budget!$B$2</definedName></definedNames></workbook>"#;

        let mut names = parse_xlsx_defined_names(workbook);
        assert_eq!(names[0]["name"], "_xlnm.Print_Area");
        assert_eq!(names[0]["localSheetId"], 0);
        assert_eq!(names[1]["hidden"], true);
        assert_eq!(names[1]["comment"], "Internal");

        names[0]["value"] = json!("Budget!$A$1:$E$30");
        names.push(json!({
            "name": "ForecastRange",
            "value": "Budget!$F$1:$G$10"
        }));
        let updated = update_xlsx_defined_names(workbook, Some(&names));

        assert!(updated.contains(">Budget!$A$1:$E$30<"));
        assert!(updated
            .contains(r#"<definedName name="ForecastRange">Budget!$F$1:$G$10</definedName>"#));
        assert!(updated.contains(r#"comment="Internal""#));
        assert!(!updated.contains(">Budget!$A$1:$D$20<"));
    }

    #[test]
    fn docx_paragraph_builder_writes_basic_wordprocessor_formatting() {
        let block = json!({
            "type": "heading",
            "headingLevel": 3,
            "text": "Formatted",
            "bold": true,
            "italic": true,
            "underline": true,
            "fontFamily": "Noto Sans",
            "fontSize": "18",
            "verticalAlign": "superscript",
            "color": "#1f2937",
            "align": "justify",
            "highlight": "yellow",
            "indentLeft": 720,
            "spacingBefore": 120,
            "spacingAfter": 240,
            "lineSpacing": 360,
            "pageBreakBefore": true,
        });

        let xml = build_docx_paragraph(&block);

        assert!(xml.contains(r#"<w:pStyle w:val="Heading3"/>"#));
        assert!(xml.contains(r#"<w:jc w:val="justify"/>"#));
        assert!(xml.contains(r#"<w:ind w:left="720"/>"#));
        assert!(xml.contains(
            r#"<w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/>"#
        ));
        assert!(xml.contains("<w:pageBreakBefore/>"));
        assert!(xml.contains("<w:b/>"));
        assert!(xml.contains("<w:i/>"));
        assert!(xml.contains(r#"<w:u w:val="single"/>"#));
        assert!(xml.contains(r#"<w:vertAlign w:val="superscript"/>"#));
        assert!(xml.contains(r#"<w:rFonts w:ascii="Noto Sans""#));
        assert!(xml.contains(r#"<w:sz w:val="36"/>"#));
        assert!(xml.contains(r#"<w:color w:val="1F2937"/>"#));
        assert!(xml.contains(r#"<w:highlight w:val="yellow"/>"#));
    }

    #[test]
    fn docx_paragraph_builder_writes_line_breaks() {
        let xml = build_docx_paragraph(&json!({
            "type": "paragraph",
            "text": "Line one\nLine two"
        }));

        assert!(xml.contains(r#"<w:t xml:space="preserve">Line one</w:t><w:br/><w:t xml:space="preserve">Line two</w:t>"#));
    }

    #[test]
    fn docx_paragraph_builder_writes_note_references() {
        let xml = build_docx_paragraph(&json!({
            "type": "paragraph",
            "text": "Body",
            "footnoteId": "2",
            "endnoteId": "3"
        }));

        assert!(xml.contains(r#"<w:footnoteReference w:id="2"/>"#));
        assert!(xml.contains(r#"<w:endnoteReference w:id="3"/>"#));
        assert!(xml.contains(r#"<w:rStyle w:val="FootnoteReference"/>"#));
        assert!(xml.contains(r#"<w:rStyle w:val="EndnoteReference"/>"#));
    }

    #[test]
    fn docx_model_exposes_superscript_and_subscript() {
        let bytes = test_ooxml_package(&[(
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>Squared</w:t></w:r></w:p><w:p><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>Base</w:t></w:r></w:p></w:body></w:document>"#,
        )]);

        let model = docx_model(&bytes).expect("DOCX vertical align model should parse");

        assert_eq!(model["blocks"][0]["verticalAlign"], "superscript");
        assert_eq!(model["blocks"][1]["verticalAlign"], "subscript");
    }

    #[test]
    fn docx_model_exposes_page_breaks() {
        let bytes = test_ooxml_package(&[(
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Before</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>"#,
        )]);

        let model = docx_model(&bytes).expect("DOCX page break model should parse");

        assert_eq!(model["blocks"][0]["text"], "Before");
        assert_eq!(model["blocks"][0]["pageBreakBefore"], true);
        assert_eq!(model["blocks"][1]["type"], "pageBreak");
        assert_eq!(model["blocks"][2]["text"], "After");
    }

    #[test]
    fn docx_update_writes_page_break_blocks() {
        let original = test_ooxml_package(&[(
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
        )]);
        let model = json!({
            "blocks": [
                { "type": "paragraph", "text": "Before" },
                { "type": "pageBreak", "text": "" },
                { "type": "paragraph", "text": "After" }
            ]
        });

        let updated = update_docx(&original, &model).unwrap();
        let document = read_zip_text(&updated, "word/document.xml").unwrap();

        assert!(document.contains("<w:t xml:space=\"preserve\">Before</w:t>"));
        assert!(document.contains(r#"<w:br w:type="page"/>"#));
        assert!(document.contains("<w:t xml:space=\"preserve\">After</w:t>"));
    }

    #[test]
    fn docx_model_exposes_section_breaks() {
        let bytes = test_ooxml_package(&[(
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Before</w:t></w:r></w:p><w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>"#,
        )]);

        let model = docx_model(&bytes).expect("DOCX section break model should parse");

        assert_eq!(model["blocks"][1]["type"], "sectionBreak");
        assert_eq!(model["blocks"][1]["breakKind"], "continuous");
    }

    #[test]
    fn docx_update_writes_section_break_blocks() {
        let original = test_ooxml_package(&[(
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
        )]);
        let model = json!({
            "blocks": [
                { "type": "paragraph", "text": "Before" },
                { "type": "sectionBreak", "text": "", "breakKind": "nextPage" },
                { "type": "paragraph", "text": "After" }
            ]
        });

        let updated = update_docx(&original, &model).unwrap();
        let document = read_zip_text(&updated, "word/document.xml").unwrap();

        assert!(document.contains("<w:t xml:space=\"preserve\">Before</w:t>"));
        assert!(document.contains(r#"<w:sectPr><w:type w:val="nextPage"/></w:sectPr>"#));
        assert!(document.contains("<w:t xml:space=\"preserve\">After</w:t>"));
    }

    #[test]
    fn docx_model_exposes_hyperlink_targets() {
        let bytes = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:hyperlink r:id="rId5"><w:r><w:t>Docs</w:t></w:r></w:hyperlink></w:p></w:body></w:document>"#,
            ),
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/docs" TargetMode="External"/></Relationships>"#,
            ),
        ]);

        let model = docx_model(&bytes).expect("DOCX hyperlink model should parse");
        let block = &model["blocks"][0];

        assert_eq!(block["text"], "Docs");
        assert_eq!(block["relationshipId"], "rId5");
        assert_eq!(block["target"], "https://example.com/docs");
    }

    #[test]
    fn docx_update_writes_new_hyperlink_relationship() {
        let original = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
            ),
            (
                "[Content_Types].xml",
                r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
            ),
        ]);
        let model = json!({
            "blocks": [
                {
                    "type": "paragraph",
                    "text": "Docs",
                    "target": "https://example.com/docs"
                }
            ]
        });

        let updated = update_docx(&original, &model).unwrap();
        let document = read_zip_text(&updated, "word/document.xml").unwrap();
        let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();

        assert!(document.contains("xmlns:r="));
        assert!(document.contains(r#"<w:hyperlink r:id="rId1">"#));
        assert!(document.contains("<w:t xml:space=\"preserve\">Docs</w:t>"));
        assert!(rels.contains("relationships/hyperlink"));
        assert!(rels.contains(r#"Target="https://example.com/docs""#));
        assert!(rels.contains(r#"TargetMode="External""#));
    }

    #[test]
    fn docx_model_exposes_inline_images() {
        let bytes = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1" descr="Diagram"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId7"/><a:srcRect l="5000" t="10000" r="15000" b="20000"/></pic:blipFill><pic:spPr><a:xfrm rot="2700000"><a:ext cx="952500" cy="476250"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>"#,
            ),
            ("word/media/image1.png", "png-bytes"),
        ]);

        let model = docx_model(&bytes).expect("DOCX image model should parse");
        let block = &model["blocks"][0];

        assert_eq!(block["type"], "image");
        assert_eq!(block["relationshipId"], "rId7");
        assert_eq!(block["mediaPath"], "word/media/image1.png");
        assert_eq!(block["mimeType"], "image/png");
        assert_eq!(block["width"], 100);
        assert_eq!(block["height"], 50);
        assert_eq!(block["imageRotation"], 45);
        assert_eq!(block["imageCropLeft"], 5.0);
        assert_eq!(block["imageCropTop"], 10.0);
        assert_eq!(block["imageCropRight"], 15.0);
        assert_eq!(block["imageCropBottom"], 20.0);
        assert_eq!(block["altText"], "Diagram");
        assert!(block["dataUrl"]
            .as_str()
            .expect("image data URL")
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn docx_image_block_updates_extent_and_alt_text() {
        let source_xml = r#"<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1" descr="Diagram"/><a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="476250"/></a:xfrm></pic:spPr><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#;
        let block = json!({
            "type": "image",
            "relationshipId": "rId7",
            "width": 120,
            "height": 80,
            "imageRotation": 90,
            "imageCropLeft": 2.5,
            "imageCropTop": 5,
            "imageCropRight": 7.5,
            "imageCropBottom": 10,
            "altText": "Updated diagram",
            "sourceXml": source_xml,
        });

        let xml = build_docx_image_paragraph(&block);

        assert!(xml.contains(r#"<wp:extent cx="1143000" cy="762000"/>"#));
        assert!(xml.contains(r#"<a:ext cx="1143000" cy="762000"/>"#));
        assert!(xml.contains(r#"descr="Updated diagram""#));
        assert!(xml.contains(r#"title="Updated diagram""#));
        assert!(xml.contains(r#"<a:xfrm rot="5400000">"#));
        assert!(xml.contains(r#"<a:srcRect l="2500" t="5000" r="7500" b="10000"/>"#));
        assert!(xml.contains(r#"r:embed="rId7""#));
    }

    #[test]
    fn docx_inserted_image_adds_media_relationship_and_content_type() {
        let original = test_ooxml_package(&[
            (
                "[Content_Types].xml",
                r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
            ),
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
            ),
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
            ),
        ]);
        let updated = update_docx(
            &original,
            &json!({
                "blocks": [
                    { "type": "paragraph", "text": "Item", "listKind": "bullet" },
                    {
                        "type": "image",
                        "text": "",
                        "dataUrl": "data:image/png;base64,cG5nLWJ5dGVz",
                        "width": 120,
                        "height": 80,
                        "altText": "Inserted"
                    }
                ]
            }),
        )
        .expect("DOCX image should insert");

        let document = read_zip_text(&updated, "word/document.xml").unwrap();
        let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
        let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();
        let media = read_zip_bytes(&updated, "word/media/mymy-image-1.png").unwrap();

        assert_eq!(media, b"png-bytes");
        assert!(document.contains(r#"r:embed="rId1""#));
        assert!(document.contains(r#"descr="Inserted""#));
        assert!(rels.contains("relationships/image"));
        assert!(rels.contains(r#"Target="media/mymy-image-1.png""#));
        assert!(rels.contains("relationships/numbering"));
        assert!(content_types.contains(r#"Extension="png" ContentType="image/png""#));
        assert!(content_types.contains(r#"PartName="/word/numbering.xml""#));
    }

    #[test]
    fn docx_model_exposes_header_and_footer_text_parts() {
        let bytes = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/header1.xml",
                r#"<w:hdr><w:p><w:r><w:t>Header one</w:t></w:r></w:p><w:p><w:r><w:t>Header two</w:t></w:r></w:p></w:hdr>"#,
            ),
            (
                "word/footer1.xml",
                r#"<w:ftr><w:p><w:r><w:t>Footer</w:t></w:r></w:p></w:ftr>"#,
            ),
        ]);

        let model = docx_model(&bytes).expect("DOCX text parts should parse");

        assert_eq!(model["headers"][0]["path"], "word/header1.xml");
        assert_eq!(model["headers"][0]["text"], "Header one\nHeader two");
        assert_eq!(model["footers"][0]["path"], "word/footer1.xml");
        assert_eq!(model["footers"][0]["text"], "Footer");
    }

    #[test]
    fn docx_update_rewrites_existing_header_and_footer_parts() {
        let original = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Old body</w:t></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/header1.xml",
                r#"<w:hdr><w:p><w:r><w:t>Old header</w:t></w:r></w:p></w:hdr>"#,
            ),
            (
                "word/footer1.xml",
                r#"<w:ftr><w:p><w:r><w:t>Old footer</w:t></w:r></w:p></w:ftr>"#,
            ),
        ]);
        let updated = update_docx(
            &original,
            &json!({
                "blocks": [{ "type": "paragraph", "text": "New body" }],
                "headers": [{ "path": "word/header1.xml", "text": "New header\nSecond line" }],
                "footers": [{ "path": "word/footer1.xml", "text": "New footer" }]
            }),
        )
        .expect("DOCX should update text parts");

        let document = read_zip_text(&updated, "word/document.xml").unwrap();
        let header = read_zip_text(&updated, "word/header1.xml").unwrap();
        let footer = read_zip_text(&updated, "word/footer1.xml").unwrap();

        assert!(document.contains("New body"));
        assert!(header.contains("New header"));
        assert!(header.contains("Second line"));
        assert!(footer.contains("New footer"));
    }

    #[test]
    fn docx_model_exposes_existing_comments() {
        let bytes = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/comments.xml",
                r#"<w:comments><w:comment w:id="0" w:author="Elena" w:date="2026-07-06T10:00:00Z"><w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:comment></w:comments>"#,
            ),
        ]);

        let model = docx_model(&bytes).expect("DOCX comments should parse");
        let comment = &model["comments"][0];

        assert_eq!(comment["id"], "0");
        assert_eq!(comment["author"], "Elena");
        assert_eq!(comment["date"], "2026-07-06T10:00:00Z");
        assert_eq!(comment["text"], "First\nSecond");
    }

    #[test]
    fn docx_update_rewrites_existing_comments() {
        let original = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/comments.xml",
                r#"<w:comments><w:comment w:id="0" w:author="Old" w:date="2026-07-06T10:00:00Z"><w:p><w:r><w:t>Old comment</w:t></w:r></w:p></w:comment></w:comments>"#,
            ),
        ]);
        let updated = update_docx(
            &original,
            &json!({
                "blocks": [{ "type": "paragraph", "text": "Body" }],
                "comments": [{
                    "id": "0",
                    "author": "New Author",
                    "date": "2026-07-06T11:00:00Z",
                    "text": "Updated comment\nSecond line"
                }]
            }),
        )
        .expect("DOCX should update comments");

        let comments = read_zip_text(&updated, "word/comments.xml").unwrap();

        assert!(comments.contains(r#"w:author="New Author""#));
        assert!(comments.contains(r#"w:date="2026-07-06T11:00:00Z""#));
        assert!(comments.contains(">Updated comment<"));
        assert!(comments.contains(">Second line<"));
        assert!(!comments.contains("Old comment"));
    }

    #[test]
    fn docx_model_exposes_existing_footnotes_and_endnotes() {
        let bytes = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/footnotes.xml",
                r#"<w:footnotes><w:footnote w:id="-1"><w:p><w:r><w:t>Separator</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>Foot one</w:t></w:r></w:p><w:p><w:r><w:t>Foot two</w:t></w:r></w:p></w:footnote></w:footnotes>"#,
            ),
            (
                "word/endnotes.xml",
                r#"<w:endnotes><w:endnote w:id="3"><w:p><w:r><w:t>End note</w:t></w:r></w:p></w:endnote></w:endnotes>"#,
            ),
        ]);

        let model = docx_model(&bytes).expect("DOCX notes should parse");

        assert_eq!(model["footnotes"].as_array().unwrap().len(), 1);
        assert_eq!(model["footnotes"][0]["id"], "2");
        assert_eq!(model["footnotes"][0]["kind"], "footnote");
        assert_eq!(model["footnotes"][0]["text"], "Foot one\nFoot two");
        assert_eq!(model["endnotes"][0]["id"], "3");
        assert_eq!(model["endnotes"][0]["kind"], "endnote");
        assert_eq!(model["endnotes"][0]["text"], "End note");
    }

    #[test]
    fn docx_model_exposes_body_note_references() {
        let bytes = test_ooxml_package(&[(
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Footed</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p><w:p><w:r><w:t>Ended</w:t></w:r><w:r><w:endnoteReference w:id="3"/></w:r></w:p></w:body></w:document>"#,
        )]);

        let model = docx_model(&bytes).expect("DOCX note references should parse");

        assert_eq!(model["blocks"][0]["footnoteId"], "2");
        assert_eq!(model["blocks"][1]["endnoteId"], "3");
    }

    #[test]
    fn docx_update_rewrites_existing_footnotes_and_endnotes() {
        let original = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/footnotes.xml",
                r#"<w:footnotes><w:footnote w:id="2"><w:p><w:r><w:t>Old foot</w:t></w:r></w:p></w:footnote></w:footnotes>"#,
            ),
            (
                "word/endnotes.xml",
                r#"<w:endnotes><w:endnote w:id="3"><w:p><w:r><w:t>Old end</w:t></w:r></w:p></w:endnote></w:endnotes>"#,
            ),
        ]);
        let updated = update_docx(
            &original,
            &json!({
                "blocks": [{ "type": "paragraph", "text": "Body" }],
                "footnotes": [{ "id": "2", "text": "New foot\nSecond foot" }],
                "endnotes": [{ "id": "3", "text": "New end" }]
            }),
        )
        .expect("DOCX should update notes");

        let footnotes = read_zip_text(&updated, "word/footnotes.xml").unwrap();
        let endnotes = read_zip_text(&updated, "word/endnotes.xml").unwrap();

        assert!(footnotes.contains(">New foot<"));
        assert!(footnotes.contains(">Second foot<"));
        assert!(!footnotes.contains("Old foot"));
        assert!(endnotes.contains(">New end<"));
        assert!(!endnotes.contains("Old end"));
    }

    #[test]
    fn docx_update_adds_footnotes_part_relationship_and_content_type() {
        let original = test_ooxml_package(&[
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
            ),
            (
                "[Content_Types].xml",
                r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
            ),
        ]);
        let updated = update_docx(
            &original,
            &json!({
                "blocks": [{ "type": "paragraph", "text": "Body", "footnoteId": "2" }],
                "footnotes": [{ "id": "2", "text": "New footnote\nSecond line" }]
            }),
        )
        .expect("DOCX should add footnotes part");

        let document = read_zip_text(&updated, "word/document.xml").unwrap();
        let footnotes = read_zip_text(&updated, "word/footnotes.xml").unwrap();
        let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
        let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

        assert!(document.contains(r#"<w:footnoteReference w:id="2"/>"#));
        assert!(footnotes.contains(r#"<w:footnote w:id="2">"#));
        assert!(footnotes.contains(">New footnote<"));
        assert!(footnotes.contains(">Second line<"));
        assert!(rels.contains("relationships/footnotes"));
        assert!(rels.contains(r#"Target="footnotes.xml""#));
        assert!(content_types.contains(r#"PartName="/word/footnotes.xml""#));
        assert!(content_types.contains(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"
        ));
    }

    #[test]
    fn docx_page_settings_read_and_update_section_properties() {
        let document = r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#;
        let page = docx_page_settings(document);

        assert_eq!(page["width"], 12240);
        assert_eq!(page["height"], 15840);
        assert_eq!(page["marginTop"], 1440);

        let updated = update_docx_page_settings(
            document,
            Some(&json!({
                "orientation": "landscape",
                "width": 15840,
                "height": 12240,
                "marginTop": 720,
                "marginRight": 1080,
                "marginBottom": 720,
                "marginLeft": 1080
            })),
        );

        assert!(updated.contains(r#"<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>"#));
        assert!(updated
            .contains(r#"<w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080"/>"#));
    }

    #[test]
    fn docx_paragraph_builder_writes_basic_lists() {
        let bullet = build_docx_paragraph(&json!({
            "type": "paragraph",
            "text": "Bullet item",
            "listKind": "bullet"
        }));
        let numbered = build_docx_paragraph(&json!({
            "type": "paragraph",
            "text": "Numbered item",
            "listKind": "number"
        }));

        assert!(bullet.contains(&format!(r#"<w:numId w:val="{DOCX_BULLET_NUM_ID}"/>"#)));
        assert!(numbered.contains(&format!(r#"<w:numId w:val="{DOCX_NUMBER_NUM_ID}"/>"#)));
    }

    #[test]
    fn docx_list_save_adds_numbering_part_relationship_and_content_type() {
        let original = test_ooxml_package(&[
            (
                "[Content_Types].xml",
                r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
            ),
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
            ),
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
            ),
        ]);
        let updated = update_docx(
            &original,
            &json!({
                "blocks": [
                    { "type": "paragraph", "text": "Item", "listKind": "bullet" }
                ]
            }),
        )
        .expect("DOCX list should save");

        let document = read_zip_text(&updated, "word/document.xml").unwrap();
        let numbering = read_zip_text(&updated, "word/numbering.xml").unwrap();
        let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
        let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

        assert!(document.contains(&format!(r#"<w:numId w:val="{DOCX_BULLET_NUM_ID}"/>"#)));
        assert!(numbering.contains(r#"<w:numFmt w:val="bullet"/>"#));
        assert!(rels.contains("relationships/numbering"));
        assert!(content_types.contains(r#"PartName="/word/numbering.xml""#));
    }

    #[test]
    fn docx_numbering_formats_map_num_ids_to_list_kinds() {
        let numbering = ensure_docx_basic_numbering_xml("");
        let formats = docx_numbering_formats(&numbering);

        assert_eq!(formats.get(DOCX_BULLET_NUM_ID), Some(&"bullet".to_string()));
        assert_eq!(formats.get(DOCX_NUMBER_NUM_ID), Some(&"number".to_string()));
    }

    #[test]
    fn docx_format_helpers_read_common_run_and_paragraph_properties() {
        let paragraph = r##"<w:p><w:pPr><w:pStyle w:val="Heading4"/><w:jc w:val="right"/><w:ind w:left="720"/><w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Sans"/><w:sz w:val="28"/><w:color w:val="1F2937"/><w:highlight w:val="yellow"/><w:u w:val="single"/></w:rPr><w:t>Text</w:t></w:r></w:p>"##;

        assert_eq!(
            docx_tag_attr(paragraph, "<w:rFonts", "w:ascii"),
            Some("Noto Sans".to_string())
        );
        assert_eq!(docx_heading_level(paragraph), Some(4));
        assert_eq!(docx_font_size(paragraph), Some("14".to_string()));
        assert_eq!(docx_alignment(paragraph), Some("right".to_string()));
        assert_eq!(docx_u32_attr(paragraph, "<w:ind", "w:left"), Some(720));
        assert_eq!(
            docx_u32_attr(paragraph, "<w:spacing", "w:before"),
            Some(120)
        );
        assert_eq!(docx_u32_attr(paragraph, "<w:spacing", "w:after"), Some(240));
        assert_eq!(docx_u32_attr(paragraph, "<w:spacing", "w:line"), Some(360));
        assert_eq!(
            docx_tag_attr(paragraph, "<w:color", "w:val").and_then(|color| docx_hex_color(&color)),
            Some("1F2937".to_string())
        );
    }

    #[test]
    fn docx_complex_paragraph_preserves_non_text_markup_when_replacing_text() {
        let document = r#"<w:document><w:body><w:p><w:hyperlink r:id="rId1"><w:r><w:t>Old</w:t></w:r></w:hyperlink></w:p></w:body></w:document>"#;
        let blocks = vec![json!({ "text": "New", "bold": true })];

        let updated = replace_docx_blocks(document, &blocks);

        assert!(updated.contains(r#"<w:hyperlink r:id="rId1">"#));
        assert!(updated.contains("<w:t>New</w:t>"));
        assert!(!updated.contains("<w:b/>"));
    }

    #[test]
    fn docx_table_rows_parse_and_save_basic_cells() {
        let table = r##"<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="1F2937"/></w:tblBorders></w:tblPr><w:tr><w:trPr><w:trHeight w:val="420" w:hRule="atLeast"/><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:trPr><w:trHeight w:val="600" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/></w:tcPr><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"##;

        let rows = parse_docx_table_rows(table);
        assert_eq!(
            rows,
            vec![
                vec!["A1".to_string(), "B1".to_string()],
                vec!["A2".to_string(), "B2".to_string()],
            ]
        );
        assert_eq!(parse_docx_table_column_widths(table), vec![1800, 3000]);
        assert_eq!(parse_docx_table_row_heights(table), vec![420, 600]);
        assert_eq!(parse_docx_table_style(table), Some("TableGrid".to_string()));
        assert_eq!(
            parse_docx_table_border_color(table),
            Some("#1F2937".to_string())
        );
        assert_eq!(parse_docx_table_border_size(table), Some(6));
        assert_eq!(
            parse_docx_table_cell_background(table),
            Some("#FFFFFF".to_string())
        );
        assert!(parse_docx_table_header_row(table));
        assert_eq!(
            parse_docx_table_header_background(table),
            Some("#DBEAFE".to_string())
        );
        assert_eq!(parse_docx_table_cell_vertical_align(table), Some("center"));

        let xml = build_docx_table(&json!({
            "type": "table",
            "rows": [["C1", "D1"], ["C2", "D2\nD3"]],
            "tableColumnWidths": [1800, 3000],
            "tableRowHeights": [420, 600],
            "tableStyle": "TableGrid",
            "tableBorderColor": "#1F2937",
            "tableBorderSize": 6,
            "tableCellBackground": "#FFFFFF",
            "tableHeaderRow": true,
            "tableHeaderBackground": "#DBEAFE",
            "tableCellVerticalAlign": "center"
        }));
        assert!(xml.contains("<w:tbl>"));
        assert!(xml.contains(r#"<w:tblStyle w:val="TableGrid"/>"#));
        assert!(xml.contains(r#"<w:top w:val="single" w:sz="6" w:space="0" w:color="1F2937"/>"#));
        assert!(xml.contains(r#"<w:tcW w:w="1800" w:type="dxa"/>"#));
        assert!(xml.contains(r#"<w:tcW w:w="3000" w:type="dxa"/>"#));
        assert!(xml.contains(r#"<w:trHeight w:val="420" w:hRule="atLeast"/>"#));
        assert!(xml.contains(r#"<w:trHeight w:val="600" w:hRule="atLeast"/>"#));
        assert!(xml.contains("<w:tblHeader/>"));
        assert!(xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/>"#));
        assert!(xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>"#));
        assert!(xml.contains(r#"<w:vAlign w:val="center"/>"#));
        assert!(xml.contains("<w:t xml:space=\"preserve\">C1</w:t>"));
        assert!(xml.contains("<w:t xml:space=\"preserve\">D2</w:t>"));
        assert!(xml.contains("<w:br/><w:t xml:space=\"preserve\">D3</w:t>"));
    }

    #[test]
    fn docx_replace_blocks_handles_paragraph_and_table_order() {
        let document = r#"<w:document><w:body><w:p><w:r><w:t>Old paragraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Old cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
        let blocks = vec![
            json!({ "type": "paragraph", "text": "New paragraph" }),
            json!({ "type": "table", "rows": [["New cell"]] }),
        ];

        let updated = replace_docx_blocks(document, &blocks);

        assert!(updated.contains("<w:t xml:space=\"preserve\">New paragraph</w:t>"));
        assert!(updated.contains("<w:t xml:space=\"preserve\">New cell</w:t>"));
    }

    #[test]
    fn pptx_presentation_manifest_rewrites_order_and_adds_new_slide_relationship() {
        let presentation = r#"<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>"#;
        let rels = r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>"#;
        let slides = vec![
            PptxPresentationSlideWrite {
                path: "ppt/slides/slide2.xml".to_string(),
            },
            PptxPresentationSlideWrite {
                path: "ppt/slides/slide3.xml".to_string(),
            },
        ];

        let (presentation, rels) = update_pptx_presentation_manifest(presentation, rels, &slides);
        let content_types = append_pptx_slide_content_types_for_writes("<Types></Types>", &slides);

        assert!(!presentation.contains(r#"r:id="rId1""#));
        assert!(presentation
            .contains(r#"<p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/>"#));
        assert!(rels.contains(r#"Target="slides/slide3.xml""#));
        assert!(content_types.contains(r#"PartName="/ppt/slides/slide3.xml""#));
    }

    #[test]
    fn pptx_text_shape_writes_basic_run_formatting() {
        let spec = PptxTextSpec {
            text: "Formatted slide text".to_string(),
            text_index: None,
            x: 10.0,
            y: 12.0,
            width: 40.0,
            height: 12.0,
            rotation: 15.0,
            font_size: 24,
            font_family: Some("Noto Sans".to_string()),
            color: Some("112233".to_string()),
            fill_color: Some("F8FAFC".to_string()),
            bold: true,
            italic: true,
            underline: true,
            strikethrough: true,
            align: Some("ctr".to_string()),
        };

        let xml = build_pptx_text_shape(7, &spec);

        assert!(xml
            .contains(r#"<a:rPr lang="en-US" sz="2400" b="1" i="1" u="sng" strike="sngStrike">"#));
        assert!(xml.contains(r#"<a:pPr algn="ctr"/>"#));
        assert!(xml.contains(r#"<a:xfrm rot="900000">"#));
        assert!(xml.contains(r#"<a:latin typeface="Noto Sans"/>"#));
        assert!(xml.contains(r#"<a:srgbClr val="112233"/>"#));
        assert!(xml.contains(r#"<a:srgbClr val="F8FAFC"/>"#));
        assert!(xml.contains("<a:t>Formatted slide text</a:t>"));
    }

    #[test]
    fn pptx_shape_model_reads_and_updates_geometry() {
        let xml = r#"<p:sld><p:sp><p:spPr><a:xfrm rot="1800000"><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="1028700"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr algn="r"/><a:r><a:rPr u="sng" strike="sngStrike"/><a:t>Box</a:t></a:r></a:p></p:txBody></p:sp></p:sld>"#;
        let texts = pptx_shape_texts(xml);
        assert_eq!(texts[0]["text"], "Box");
        assert_eq!(texts[0]["x"], 10.0);
        assert_eq!(texts[0]["y"], 10.0);
        assert_eq!(texts[0]["width"], 20.0);
        assert_eq!(texts[0]["height"], 20.0);
        assert_eq!(texts[0]["rotation"], 30.0);
        assert_eq!(texts[0]["underline"], true);
        assert_eq!(texts[0]["strikethrough"], true);
        assert_eq!(texts[0]["align"], "right");

        let spec = PptxTextSpec {
            text: "Box".to_string(),
            text_index: None,
            x: 20.0,
            y: 30.0,
            width: 40.0,
            height: 50.0,
            rotation: 45.0,
            font_size: 18,
            font_family: None,
            color: None,
            fill_color: None,
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
            align: None,
        };
        let updated = update_pptx_shape_geometries(xml, &[spec]);

        assert!(updated.contains(r#"<a:off x="1828800" y="1543050"/>"#));
        assert!(updated.contains(r#"<a:ext cx="3657600" cy="2571750"/>"#));
        assert!(updated.contains(r#"<a:xfrm rot="2700000">"#));
    }

    #[test]
    fn pptx_basic_shape_model_reads_fill_stroke_and_geometry() {
        let xml = r##"<p:sld><p:sp><p:spPr><a:xfrm rot="900000"><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="1028700"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="DBEAFE"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="1"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="111827"/></a:solidFill></a:ln></p:spPr></p:sp></p:sld>"##;

        let shapes = pptx_slide_shapes(xml);

        assert_eq!(shapes.len(), 2);
        assert_eq!(shapes[0]["kind"], "ellipse");
        assert_eq!(shapes[0]["x"], 10.0);
        assert_eq!(shapes[0]["y"], 10.0);
        assert_eq!(shapes[0]["width"], 20.0);
        assert_eq!(shapes[0]["height"], 20.0);
        assert_eq!(shapes[0]["rotation"], 15.0);
        assert_eq!(shapes[0]["fillColor"], "#DBEAFE");
        assert_eq!(shapes[0]["strokeColor"], "#2563EB");
        assert_eq!(shapes[0]["strokeWidth"], 2.0);
        assert_eq!(shapes[1]["kind"], "line");
        assert_eq!(shapes[1]["fillColor"], Value::Null);
        assert_eq!(shapes[1]["strokeColor"], "#111827");
        assert_eq!(shapes[1]["strokeWidth"], 1.0);
    }

    #[test]
    fn pptx_basic_shape_writes_geometry_fill_and_stroke() {
        let spec = PptxShapeSpec {
            kind: PptxShapeKind::Rect,
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
            rotation: 30.0,
            fill_color: Some("DBEAFE".to_string()),
            stroke_color: Some("2563EB".to_string()),
            stroke_width: 2.0,
        };

        let xml = build_pptx_basic_shape(9, &spec);

        assert!(xml.contains(r#"<p:cNvPr id="9" name="Shape 9"/>"#));
        assert!(xml.contains(r#"<a:xfrm rot="1800000">"#));
        assert!(xml.contains(r#"<a:off x="914400" y="1028700"/>"#));
        assert!(xml.contains(r#"<a:ext cx="2743200" cy="2057400"/>"#));
        assert!(xml.contains(r#"<a:prstGeom prst="rect">"#));
        assert!(xml.contains(r#"<a:srgbClr val="DBEAFE"/>"#));
        assert!(xml.contains(r#"<a:ln w="25400">"#));
        assert!(xml.contains(r#"<a:srgbClr val="2563EB"/>"#));
    }

    #[test]
    fn pptx_basic_shapes_replace_managed_shapes_only() {
        let xml = r#"<p:sld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr></p:grpSpPr><p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:p><a:r><a:t>Keep text</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp><p:sp><p:spPr><a:prstGeom prst="triangle"><a:avLst/></a:prstGeom></p:spPr></p:sp></p:spTree></p:sld>"#;
        let specs = vec![
            PptxShapeSpec {
                kind: PptxShapeKind::Line,
                x: 10.0,
                y: 10.0,
                width: 30.0,
                height: 0.0,
                rotation: 0.0,
                fill_color: None,
                stroke_color: Some("111827".to_string()),
                stroke_width: 1.0,
            },
            PptxShapeSpec {
                kind: PptxShapeKind::Ellipse,
                x: 20.0,
                y: 20.0,
                width: 20.0,
                height: 20.0,
                rotation: 0.0,
                fill_color: Some("DBEAFE".to_string()),
                stroke_color: Some("2563EB".to_string()),
                stroke_width: 2.0,
            },
        ];

        let updated = replace_pptx_basic_shapes(xml, &specs);

        assert!(updated.contains("<a:t>Keep text</a:t>"));
        assert!(updated.contains(r#"<a:prstGeom prst="triangle">"#));
        assert!(updated.contains(r#"<a:prstGeom prst="line">"#));
        assert!(updated.contains(r#"<a:prstGeom prst="ellipse">"#));
        assert!(!updated.contains(r#"<a:srgbClr val="FFFFFF"/>"#));
        assert!(updated.contains(r#"<p:cNvPr id="20000" name="Shape 20000"/>"#));
        assert!(updated.contains(r#"<p:cNvPr id="20001" name="Shape 20001"/>"#));
    }

    #[test]
    fn pptx_slide_background_reads_and_writes_solid_color() {
        let xml = r#"<p:sld><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sld>"#;

        assert_eq!(pptx_slide_background_color(xml), Some("F8FAFC".to_string()));

        let updated = update_pptx_slide_background(xml, Some("112233"));

        assert!(updated.contains(r#"<a:srgbClr val="112233"/>"#));
    }

    #[test]
    fn pptx_slide_visibility_reads_and_writes_hidden_flag() {
        let xml = r#"<p:sld show="0"><p:cSld><p:spTree/></p:cSld></p:sld>"#;

        assert!(pptx_slide_hidden(xml));

        let shown = update_pptx_slide_visibility(xml, Some(false));
        let hidden = update_pptx_slide_visibility(&shown, Some(true));

        assert!(shown.contains(r#"show="1""#));
        assert!(hidden.contains(r#"show="0""#));
    }

    #[test]
    fn pptx_model_exposes_slide_transition() {
        let slide_xml = r#"<p:sld><p:cSld><p:spTree/></p:cSld><p:transition spd="slow" advClick="0" advTm="3500"><p:wipe dir="l"/></p:transition></p:sld>"#;
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml),
        ]);

        let model = pptx_model(&package).unwrap();
        let transition = &model["slides"][0]["transition"];

        assert_eq!(transition["type"], "wipe");
        assert_eq!(transition["speed"], "slow");
        assert_eq!(transition["direction"], "l");
        assert_eq!(transition["advanceOnClick"], false);
        assert_eq!(transition["advanceAfterMs"], 3500);
    }

    #[test]
    fn pptx_update_rewrites_slide_transition() {
        let slide_xml = r#"<p:sld><p:cSld><p:spTree/></p:cSld><p:transition><p:fade/></p:transition><p:timing/></p:sld>"#;
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"][0]["transition"] = json!({
            "type": "push",
            "speed": "fast",
            "direction": "l",
            "advanceOnClick": false,
            "advanceAfterMs": 2500
        });

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

        assert!(slide.contains(r#"<p:transition spd="fast" advClick="0" advTm="2500"><p:push dir="l"/></p:transition><p:timing"#));
        assert!(!slide.contains("<p:fade/>"));
    }

    #[test]
    fn pptx_model_exposes_and_updates_animation_timing() {
        let slide_xml = r#"<p:sld><p:cSld><p:spTree/></p:cSld><p:timing><p:tnLst><p:cTn id="1" nodeType="clickEffect" delay="250" dur="1000" presetClass="entr"><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cTn><p:cTn id="2" nodeType="afterEffect" delay="0" dur="500"/></p:tnLst></p:timing></p:sld>"#;
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml),
        ]);

        let mut model = pptx_model(&package).unwrap();
        assert_eq!(model["slides"][0]["animations"][0]["id"], "1");
        assert_eq!(model["slides"][0]["animations"][0]["targetShapeId"], "4");
        assert_eq!(model["slides"][0]["animations"][0]["delayMs"], 250);
        assert_eq!(model["slides"][0]["animations"][0]["durationMs"], 1000);
        model["slides"][0]["animations"][0]["delayMs"] = json!(750);
        model["slides"][0]["animations"][0]["durationMs"] = json!(1250);
        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

        assert!(slide.contains(r#"id="1" nodeType="clickEffect" delay="750" dur="1250""#));
        assert!(slide.contains(r#"<p:spTgt spid="4"/>"#));
        assert!(slide.contains(r#"id="2" nodeType="afterEffect" delay="0" dur="500""#));
    }

    #[test]
    fn pptx_update_reorders_animation_timing_segments() {
        let slide_xml = r#"<p:sld><p:cSld><p:spTree/></p:cSld><p:timing><p:tnLst><p:cTn id="1" delay="0" dur="100"/><p:cTn id="2" delay="100" dur="200"/></p:tnLst></p:timing></p:sld>"#;
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml),
        ]);

        let mut model = pptx_model(&package).unwrap();
        let first = model["slides"][0]["animations"][0].clone();
        model["slides"][0]["animations"][0] = model["slides"][0]["animations"][1].clone();
        model["slides"][0]["animations"][1] = first;
        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

        assert!(slide.find(r#"id="2""#).unwrap() < slide.find(r#"id="1""#).unwrap());
    }

    #[test]
    fn pptx_model_exposes_slide_tables() {
        let slide_xml = pptx_test_slide_with_table_xml("Title", &[&["A1", "B1"], &["A2", "B2"]]);
        let package = test_ooxml_package(&[("ppt/slides/slide1.xml", slide_xml.as_str())]);

        let model = pptx_model(&package).unwrap();

        assert_eq!(model["slides"][0]["texts"][0]["text"], "Title");
        assert_eq!(model["slides"][0]["texts"][0]["textIndex"], 0);
        assert_eq!(model["slides"][0]["tables"][0]["textIndexStart"], 1);
        assert_eq!(model["slides"][0]["tables"][0]["rows"][0][0], "A1");
        assert_eq!(model["slides"][0]["tables"][0]["rows"][1][1], "B2");
    }

    #[test]
    fn pptx_update_rewrites_slide_table_text_without_clearing_other_text() {
        let slide_xml = pptx_test_slide_with_table_xml("Title", &[&["A1", "B1"], &["A2", "B2"]]);
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"][0]["texts"][0]["text"] = json!("New title");
        model["slides"][0]["tables"][0]["rows"] = json!([["Q1", "Revenue"], ["Q2", "Cost"]]);

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

        assert!(slide.contains("<a:t>New title</a:t>"));
        assert!(slide.contains("<a:t>Q1</a:t>"));
        assert!(slide.contains("<a:t>Revenue</a:t>"));
        assert!(slide.contains("<a:t>Q2</a:t>"));
        assert!(slide.contains("<a:t>Cost</a:t>"));
        assert!(!slide.contains("<a:t>A1</a:t>"));
    }

    #[test]
    fn pptx_update_inserts_new_slide_table_frame() {
        let slide_xml = pptx_test_slide_xml("Title");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"][0]["tables"] = json!([{
            "id": "tbl1",
            "x": 20.0,
            "y": 24.0,
            "width": 50.0,
            "height": 30.0,
            "rows": [["Name", "Value"], ["A", "12"]]
        }]);

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

        assert!(slide.contains("<p:graphicFrame>"));
        assert!(slide.contains("<a:tbl>"));
        assert!(slide.contains("<a:t>Name</a:t>"));
        assert!(slide.contains("<a:t>12</a:t>"));
        assert!(slide.contains(r#"<a:off x="1828800" y="1234440"/>"#));
    }

    #[test]
    fn pptx_model_exposes_slide_images() {
        let slide_xml = pptx_test_slide_with_image_xml("rIdImage", "Original alt");
        let package = test_ooxml_package(&[
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#,
            ),
            ("ppt/media/image1.png", "png-bytes"),
        ]);

        let model = pptx_model(&package).unwrap();
        let image = &model["slides"][0]["images"][0];

        assert_eq!(image["relationshipId"], "rIdImage");
        assert_eq!(image["mediaPath"], "ppt/media/image1.png");
        assert_eq!(image["mimeType"], "image/png");
        assert_eq!(image["altText"], "Original alt");
        assert_eq!(image["x"], 10.0);
        assert_eq!(image["y"], 10.0);
        assert_eq!(image["width"], 20.0);
        assert_eq!(image["height"], 20.0);
        assert!(image["dataUrl"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn pptx_update_rewrites_existing_image_geometry_and_alt_text() {
        let slide_xml = pptx_test_slide_with_image_xml("rIdImage", "Original alt");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#,
            ),
            ("ppt/media/image1.png", "png-bytes"),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"][0]["images"][0]["x"] = json!(20.0);
        model["slides"][0]["images"][0]["y"] = json!(30.0);
        model["slides"][0]["images"][0]["width"] = json!(40.0);
        model["slides"][0]["images"][0]["height"] = json!(50.0);
        model["slides"][0]["images"][0]["rotation"] = json!(15.0);
        model["slides"][0]["images"][0]["altText"] = json!("Updated alt");

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

        assert!(slide.contains(r#"<a:off x="1828800" y="1543050"/>"#));
        assert!(slide.contains(r#"<a:ext cx="3657600" cy="2571750"/>"#));
        assert!(slide.contains(r#"<a:xfrm rot="900000">"#));
        assert!(slide.contains(r#"descr="Updated alt""#));
        assert!(slide.contains(r#"title="Updated alt""#));
        assert!(read_zip_bytes(&updated, "ppt/media/image1.png").is_ok());
    }

    #[test]
    fn pptx_update_inserts_image_media_relationship_and_keeps_notes_relationship() {
        let slide_xml = pptx_test_slide_xml("Title");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
            ),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"][0]["images"] = json!([{
            "id": "img1",
            "dataUrl": "data:image/png;base64,cG5nLWJ5dGVz",
            "x": 12.0,
            "y": 14.0,
            "width": 30.0,
            "height": 20.0,
            "altText": "Inserted image"
        }]);
        model["slides"][0]["notes"] = json!("Remember the inserted image");

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();
        let rels = read_zip_text(&updated, "ppt/slides/_rels/slide1.xml.rels").unwrap();
        let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

        assert_eq!(
            read_zip_bytes(&updated, "ppt/media/mymy-image-1.png").unwrap(),
            b"png-bytes"
        );
        assert!(slide.contains("<p:pic>"));
        assert!(slide.contains(r#"descr="Inserted image""#));
        assert!(slide.contains(r#"r:embed="rId1""#));
        assert!(rels.contains("relationships/image"));
        assert!(rels.contains(r#"Target="../media/mymy-image-1.png""#));
        assert!(rels.contains("relationships/notesSlide"));
        assert!(content_types.contains(r#"Extension="png" ContentType="image/png""#));
        assert!(content_types.contains("presentationml.notesSlide+xml"));
    }

    #[test]
    fn pptx_update_builds_new_slide_with_inserted_image_relationship() {
        let slide_xml = pptx_test_slide_xml("Title");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"].as_array_mut().unwrap().push(json!({
            "id": "ppt/slides/slide2.xml",
            "texts": [{
                "id": "t1",
                "text": "Duplicated slide",
                "x": 10.0,
                "y": 12.0,
                "width": 80.0,
                "height": 10.0
            }],
            "images": [{
                "id": "img1",
                "dataUrl": "data:image/png;base64,cG5nLWJ5dGVz",
                "x": 20.0,
                "y": 20.0,
                "width": 25.0,
                "height": 25.0,
                "altText": "Slide copy image"
            }]
        }));

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide2.xml").unwrap();
        let rels = read_zip_text(&updated, "ppt/slides/_rels/slide2.xml.rels").unwrap();
        let presentation_rels = read_zip_text(&updated, "ppt/_rels/presentation.xml.rels").unwrap();

        assert!(slide.contains("Duplicated slide"));
        assert!(slide.contains("<p:pic>"));
        assert!(slide.contains(r#"descr="Slide copy image""#));
        assert!(rels.contains("relationships/image"));
        assert!(rels.contains(r#"Target="../media/mymy-image-1.png""#));
        assert!(presentation_rels.contains(r#"Target="slides/slide2.xml""#));
        assert_eq!(
            read_zip_bytes(&updated, "ppt/media/mymy-image-1.png").unwrap(),
            b"png-bytes"
        );
    }

    #[test]
    fn pptx_update_removes_deleted_image_segments() {
        let slide_xml = pptx_test_slide_with_image_xml("rIdImage", "Original alt");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#,
            ),
            ("ppt/media/image1.png", "png-bytes"),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"][0]["images"] = json!([]);

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

        assert!(!slide.contains("<p:pic"));
        assert!(read_zip_bytes(&updated, "ppt/media/image1.png").is_ok());
    }

    #[test]
    fn pptx_model_exposes_slide_charts() {
        let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
        let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
            ),
            ("ppt/charts/chart1.xml", chart_xml.as_str()),
        ]);

        let model = pptx_model(&package).unwrap();
        let chart = &model["slides"][0]["charts"][0];

        assert_eq!(chart["relationshipId"], "rIdChart");
        assert_eq!(chart["path"], "ppt/charts/chart1.xml");
        assert_eq!(chart["type"], "bar");
        assert_eq!(chart["title"], "Revenue");
        assert_eq!(chart["categories"][0], "Q1");
        assert_eq!(chart["series"][0]["values"][0], "120");
        assert_eq!(chart["x"], 10.0);
        assert_eq!(chart["y"], 10.0);
        assert_eq!(chart["width"], 40.0);
        assert_eq!(chart["height"], 30.0);
    }

    #[test]
    fn pptx_update_rewrites_existing_chart_geometry_and_title() {
        let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
        let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
            ),
            ("ppt/charts/chart1.xml", chart_xml.as_str()),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"][0]["charts"][0]["x"] = json!(25.0);
        model["slides"][0]["charts"][0]["y"] = json!(20.0);
        model["slides"][0]["charts"][0]["width"] = json!(50.0);
        model["slides"][0]["charts"][0]["height"] = json!(40.0);
        model["slides"][0]["charts"][0]["rotation"] = json!(30.0);
        model["slides"][0]["charts"][0]["title"] = json!("Updated chart");
        model["slides"][0]["charts"][0]["series"][0]["name"] = json!("Updated series");
        model["slides"][0]["charts"][0]["series"][0]["categories"][0] = json!("Q2");
        model["slides"][0]["charts"][0]["series"][0]["values"][0] = json!("240");

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();
        let chart = read_zip_text(&updated, "ppt/charts/chart1.xml").unwrap();

        assert!(slide.contains(r#"x="2286000""#));
        assert!(slide.contains(r#"y="1028700""#));
        assert!(slide.contains(r#"cx="4572000""#));
        assert!(slide.contains(r#"cy="2057400""#));
        assert!(slide.contains(r#"rot="1800000""#));
        assert!(chart.contains(">Updated chart<"));
        assert!(!chart.contains(">Revenue<"));
        assert!(chart.contains(">Updated series<"));
        assert!(chart.contains(">Q2<"));
        assert!(chart.contains(">240<"));
        assert!(!chart.contains(">120<"));
    }

    #[test]
    fn pptx_update_inserts_duplicate_chart_frame_with_cloned_chart_part() {
        let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
        let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
            ),
            ("ppt/charts/chart1.xml", chart_xml.as_str()),
        ]);
        let mut model = pptx_model(&package).unwrap();
        let duplicate = json!({
            "id": "chart2",
            "path": "ppt/charts/chart1.xml",
            "title": "Revenue copy",
            "x": 52.0,
            "y": 20.0,
            "width": 32.0,
            "height": 24.0
        });
        model["slides"][0]["charts"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();
        let rels = read_zip_text(&updated, "ppt/slides/_rels/slide1.xml.rels").unwrap();
        let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();
        let cloned_chart = read_zip_text(&updated, "ppt/charts/mymy-chart-1.xml").unwrap();

        assert_eq!(slide.matches("<p:graphicFrame>").count(), 2);
        assert_eq!(slide.matches(r#"<c:chart r:id="rIdChart"/>"#).count(), 1);
        assert_eq!(slide.matches(r#"<c:chart r:id="rId1"/>"#).count(), 1);
        assert!(slide.contains(r#"x="4754880""#));
        assert!(slide.contains(r#"y="1028700""#));
        assert!(slide.contains(r#"cx="2926080""#));
        assert!(slide.contains(r#"cy="1234440""#));
        assert!(rels.contains(r#"Id="rId1""#));
        assert!(rels.contains(r#"Target="../charts/mymy-chart-1.xml""#));
        assert!(content_types.contains(r#"PartName="/ppt/charts/mymy-chart-1.xml""#));
        assert!(cloned_chart.contains(">Revenue copy<"));
        assert!(cloned_chart.contains(">Q1<"));
        assert!(cloned_chart.contains(">120<"));
    }

    #[test]
    fn pptx_update_removes_deleted_chart_frames() {
        let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
        let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
            ),
            ("ppt/charts/chart1.xml", chart_xml.as_str()),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"][0]["charts"] = json!([]);

        let updated = update_pptx(&package, &model).unwrap();
        let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

        assert!(!slide.contains("<p:graphicFrame"));
        assert!(read_zip_text(&updated, "ppt/charts/chart1.xml").is_ok());
    }

    #[test]
    fn pptx_model_exposes_speaker_notes() {
        let slide_xml = pptx_test_slide_xml("Title");
        let notes_xml = pptx_test_notes_xml("Remember this");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(true)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>"#,
            ),
            ("ppt/notesSlides/notesSlide1.xml", notes_xml.as_str()),
        ]);

        let model = pptx_model(&package).unwrap();

        assert_eq!(model["slides"][0]["notes"], "Remember this");
    }

    #[test]
    fn pptx_update_rewrites_existing_speaker_notes() {
        let slide_xml = pptx_test_slide_xml("Title");
        let notes_xml = pptx_test_notes_xml("Old note");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(true)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>"#,
            ),
            ("ppt/notesSlides/notesSlide1.xml", notes_xml.as_str()),
        ]);
        let mut model = pptx_model(&package).unwrap();
        model["slides"][0]["notes"] = json!("New note");

        let updated = update_pptx(&package, &model).unwrap();
        let notes = read_zip_text(&updated, "ppt/notesSlides/notesSlide1.xml").unwrap();

        assert!(notes.contains("<a:t>New note</a:t>"));
        assert!(!notes.contains("Old note"));
    }

    #[test]
    fn pptx_update_adds_speaker_notes_relationship_and_content_type() {
        let slide_xml = pptx_test_slide_xml("Title");
        let package = test_ooxml_package(&[
            ("[Content_Types].xml", pptx_test_content_types(false)),
            ("ppt/presentation.xml", pptx_test_presentation_xml()),
            (
                "ppt/_rels/presentation.xml.rels",
                pptx_test_presentation_rels(),
            ),
            ("ppt/slides/slide1.xml", slide_xml.as_str()),
        ]);
        let model = json!({
            "slides": [{
                "id": "ppt/slides/slide1.xml",
                "name": "slide1.xml",
                "texts": [{"id": "t1", "text": "Title"}],
                "notes": "Fresh note"
            }]
        });

        let updated = update_pptx(&package, &model).unwrap();
        let rels = read_zip_text(&updated, "ppt/slides/_rels/slide1.xml.rels").unwrap();
        let notes = read_zip_text(&updated, "ppt/notesSlides/notesSlide1.xml").unwrap();
        let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

        assert!(rels.contains(r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide""#));
        assert!(rels.contains(r#"Target="../notesSlides/notesSlide1.xml""#));
        assert!(notes.contains("<a:t>Fresh note</a:t>"));
        assert!(content_types.contains(r#"PartName="/ppt/notesSlides/notesSlide1.xml""#));
        assert!(content_types.contains("presentationml.notesSlide+xml"));
    }

    fn pptx_test_content_types(include_notes: bool) -> &'static str {
        if include_notes {
            r#"<Types><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>"#
        } else {
            r#"<Types><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>"#
        }
    }

    fn pptx_test_presentation_xml() -> &'static str {
        r#"<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>"#
    }

    fn pptx_test_presentation_rels() -> &'static str {
        r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>"#
    }

    fn pptx_test_slide_xml(text: &str) -> String {
        format!(
            r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#,
            escape_xml(text)
        )
    }

    fn pptx_test_notes_xml(text: &str) -> String {
        format!(
            r#"<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>"#,
            escape_xml(text)
        )
    }

    fn pptx_test_slide_with_table_xml(title: &str, rows: &[&[&str]]) -> String {
        let table_rows = rows
            .iter()
            .map(|row| {
                let cells = row
                    .iter()
                    .map(|cell| {
                        format!(
                            r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></a:txBody></a:tc>"#,
                            escape_xml(cell)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("");
                format!(r#"<a:tr>{cells}</a:tr>"#)
            })
            .collect::<Vec<_>>()
            .join("");
        format!(
            r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1828800"/></p:xfrm><a:graphic><a:graphicData><a:tbl>{table_rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>"#,
            escape_xml(title)
        )
    }

    fn pptx_test_slide_with_image_xml(relationship_id: &str, alt_text: &str) -> String {
        format!(
            r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="7" name="Picture 7" descr="{}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="1028700"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>"#,
            escape_xml(alt_text),
            escape_xml(relationship_id)
        )
    }

    fn pptx_test_slide_with_chart_xml(relationship_id: &str) -> String {
        format!(
            r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="Chart 8"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="514350"/><a:ext cx="3657600" cy="1543050"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="{}"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>"#,
            escape_xml(relationship_id)
        )
    }

    fn pptx_test_chart_xml(title: &str, category: &str, value: &str) -> String {
        format!(
            r#"<c:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>{}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Series A</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>{}</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>{}</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#,
            escape_xml(title),
            escape_xml(category),
            escape_xml(value)
        )
    }

    fn test_ooxml_package(entries: &[(&str, &str)]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (path, content) in entries {
            writer.start_file(path, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn warning_codes(warnings: &[DocumentCompatibilityWarning]) -> Vec<&str> {
        warnings
            .iter()
            .map(|warning| warning.code.as_str())
            .collect()
    }
}
