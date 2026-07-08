use super::*;

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetCellWrite {
    pub(in crate::services::document_editor) value: String,
    pub(in crate::services::document_editor) formula: Option<String>,
    pub(in crate::services::document_editor) formula_type: Option<String>,
    pub(in crate::services::document_editor) formula_ref: Option<String>,
    pub(in crate::services::document_editor) formula_shared_index: Option<String>,
    pub(in crate::services::document_editor) style: Option<XlsxCellStyle>,
    pub(in crate::services::document_editor) style_index: Option<usize>,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetRowWrite {
    pub(in crate::services::document_editor) height: Option<f64>,
    pub(in crate::services::document_editor) hidden: bool,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct SheetColumnWrite {
    pub(in crate::services::document_editor) index: u32,
    pub(in crate::services::document_editor) width: Option<f64>,
    pub(in crate::services::document_editor) hidden: bool,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetDataValidation {
    pub(in crate::services::document_editor) sqref: String,
    pub(in crate::services::document_editor) validation_type: Option<String>,
    pub(in crate::services::document_editor) operator: Option<String>,
    pub(in crate::services::document_editor) formula1: Option<String>,
    pub(in crate::services::document_editor) formula2: Option<String>,
    pub(in crate::services::document_editor) allow_blank: bool,
    pub(in crate::services::document_editor) show_input_message: bool,
    pub(in crate::services::document_editor) show_error_message: bool,
    pub(in crate::services::document_editor) prompt_title: Option<String>,
    pub(in crate::services::document_editor) prompt: Option<String>,
    pub(in crate::services::document_editor) error_title: Option<String>,
    pub(in crate::services::document_editor) error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetConditionalFormatting {
    pub(in crate::services::document_editor) sqref: String,
    pub(in crate::services::document_editor) rules: Vec<SheetConditionalRule>,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetConditionalRule {
    pub(in crate::services::document_editor) rule_type: Option<String>,
    pub(in crate::services::document_editor) operator: Option<String>,
    pub(in crate::services::document_editor) priority: Option<u32>,
    pub(in crate::services::document_editor) dxf_id: Option<usize>,
    pub(in crate::services::document_editor) fill_color: Option<String>,
    pub(in crate::services::document_editor) text: Option<String>,
    pub(in crate::services::document_editor) time_period: Option<String>,
    pub(in crate::services::document_editor) formulas: Vec<String>,
    pub(in crate::services::document_editor) source_xml: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetProtection {
    pub(in crate::services::document_editor) enabled: bool,
    pub(in crate::services::document_editor) password: Option<String>,
    pub(in crate::services::document_editor) objects: bool,
    pub(in crate::services::document_editor) scenarios: bool,
    pub(in crate::services::document_editor) format_cells: bool,
    pub(in crate::services::document_editor) format_columns: bool,
    pub(in crate::services::document_editor) format_rows: bool,
    pub(in crate::services::document_editor) insert_columns: bool,
    pub(in crate::services::document_editor) insert_rows: bool,
    pub(in crate::services::document_editor) insert_hyperlinks: bool,
    pub(in crate::services::document_editor) delete_columns: bool,
    pub(in crate::services::document_editor) delete_rows: bool,
    pub(in crate::services::document_editor) sort: bool,
    pub(in crate::services::document_editor) auto_filter: bool,
    pub(in crate::services::document_editor) pivot_tables: bool,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetPageMargins {
    pub(in crate::services::document_editor) left: Option<f64>,
    pub(in crate::services::document_editor) right: Option<f64>,
    pub(in crate::services::document_editor) top: Option<f64>,
    pub(in crate::services::document_editor) bottom: Option<f64>,
    pub(in crate::services::document_editor) header: Option<f64>,
    pub(in crate::services::document_editor) footer: Option<f64>,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetPageSetup {
    pub(in crate::services::document_editor) orientation: Option<String>,
    pub(in crate::services::document_editor) paper_size: Option<u32>,
    pub(in crate::services::document_editor) scale: Option<u32>,
    pub(in crate::services::document_editor) fit_to_width: Option<u32>,
    pub(in crate::services::document_editor) fit_to_height: Option<u32>,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetHyperlink {
    pub(in crate::services::document_editor) reference: String,
    pub(in crate::services::document_editor) relationship_id: Option<String>,
    pub(in crate::services::document_editor) target: Option<String>,
    pub(in crate::services::document_editor) location: Option<String>,
    pub(in crate::services::document_editor) display: Option<String>,
    pub(in crate::services::document_editor) tooltip: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetComment {
    pub(in crate::services::document_editor) reference: String,
    pub(in crate::services::document_editor) author: Option<String>,
    pub(in crate::services::document_editor) text: String,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct SheetUpdate {
    pub(in crate::services::document_editor) cells: BTreeMap<String, SheetCellWrite>,
    pub(in crate::services::document_editor) rows: BTreeMap<u32, SheetRowWrite>,
    pub(in crate::services::document_editor) columns: Vec<SheetColumnWrite>,
    pub(in crate::services::document_editor) tab_color_xml: Option<String>,
    pub(in crate::services::document_editor) merged_ranges: Vec<String>,
    pub(in crate::services::document_editor) data_validations: Vec<SheetDataValidation>,
    pub(in crate::services::document_editor) conditional_formattings:
        Vec<SheetConditionalFormatting>,
    pub(in crate::services::document_editor) protection: Option<SheetProtection>,
    pub(in crate::services::document_editor) page_margins: Option<SheetPageMargins>,
    pub(in crate::services::document_editor) page_setup: Option<SheetPageSetup>,
    pub(in crate::services::document_editor) hyperlinks: Vec<SheetHyperlink>,
    pub(in crate::services::document_editor) comments: Option<Vec<SheetComment>>,
    pub(in crate::services::document_editor) auto_filter: Option<String>,
    pub(in crate::services::document_editor) frozen_rows: u32,
    pub(in crate::services::document_editor) frozen_columns: u32,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct XlsxTabColor {
    pub(in crate::services::document_editor) color: Option<String>,
    pub(in crate::services::document_editor) source_xml: String,
}
