//! Compatibility warning generation for editable document packages.
//!
//! These warnings describe package features that mymy preserves during a
//! round-trip even when the current editor surface only exposes part of their
//! structure. Keeping this in one module prepares the later compatibility
//! report work without mixing warning policy into DOCX/XLSX/PPTX conversion.

use crate::models::document_editor::{
    DocumentCompatibilityWarning, DocumentCompatibilityWarningSeverity, DocumentEditorKind,
};

use super::{read_zip_text, zip_entry_names};

pub(super) fn compatibility_warnings_for_bytes(
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
