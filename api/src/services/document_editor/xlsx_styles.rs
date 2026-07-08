//! XLSX style parsing and writing.
//!
//! Spreadsheet cell styling touches both the read model and the save path. This
//! module keeps style-table parsing, style JSON projection, and new style
//! allocation together while the worksheet code remains responsible for cell
//! placement and sheet XML structure.

use std::collections::BTreeMap;

mod model;
mod parsing;
mod relationships;
mod writer;

use model::xlsx_cell_style_is_empty;
pub(super) use model::{append_xlsx_style_to_cell_json, xlsx_cell_style_from_model};
use parsing::{xlsx_builtin_num_format_id, xlsx_num_formats};
pub(super) use parsing::{xlsx_hex_color, xlsx_styles_from_xml};
pub(super) use relationships::{
    ensure_xlsx_comments_content_types, ensure_xlsx_styles_content_type,
    ensure_xlsx_styles_relationship,
};

#[derive(Debug, Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
pub(super) struct XlsxCellStyle {
    pub(super) number_format: Option<String>,
    pub(super) font_family: Option<String>,
    pub(super) font_size: Option<String>,
    pub(super) bold: bool,
    pub(super) italic: bool,
    pub(super) underline: bool,
    pub(super) strikethrough: bool,
    pub(super) color: Option<String>,
    pub(super) fill_color: Option<String>,
    pub(super) align: Option<String>,
    pub(super) vertical_align: Option<String>,
    pub(super) wrap_text: bool,
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
pub(super) struct XlsxDxfStyle {
    pub(super) fill_color: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(super) struct XlsxParsedStyles {
    num_formats: BTreeMap<u32, String>,
    fonts: Vec<XlsxFontStyle>,
    fills: Vec<Option<String>>,
    pub(super) dxfs: Vec<XlsxDxfStyle>,
    cell_xfs: Vec<XlsxCellXf>,
    pub(super) cell_styles: Vec<XlsxCellStyle>,
}

#[derive(Debug, Clone)]
pub(super) struct XlsxStyleWriter {
    pub(super) xml: String,
    parsed: XlsxParsedStyles,
    font_keys: BTreeMap<XlsxFontStyle, usize>,
    fill_keys: BTreeMap<Option<String>, usize>,
    dxf_keys: BTreeMap<XlsxDxfStyle, usize>,
    num_format_keys: BTreeMap<String, u32>,
    cell_xf_keys: BTreeMap<XlsxCellXf, usize>,
    pub(super) changed: bool,
}
