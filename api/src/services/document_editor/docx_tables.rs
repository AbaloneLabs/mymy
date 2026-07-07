use serde_json::Value;

use super::{
    docx_hex_color, docx_tag_attr, docx_text_with_breaks, docx_u32_attr,
    docx_u32_model_attr_allow_zero, escape_xml, xml_segments,
};

const DOCX_DEFAULT_TABLE_COLUMN_WIDTH: u32 = 2400;
const DOCX_MIN_TABLE_COLUMN_WIDTH: u32 = 720;
const DOCX_MAX_TABLE_COLUMN_WIDTH: u32 = 14_400;
const DOCX_DEFAULT_TABLE_ROW_HEIGHT: u32 = 360;
const DOCX_MIN_TABLE_ROW_HEIGHT: u32 = 240;
const DOCX_MAX_TABLE_ROW_HEIGHT: u32 = 7200;

pub(super) fn parse_docx_table_rows(table: &str) -> Vec<Vec<String>> {
    xml_segments(table, "<w:tr", "</w:tr>")
        .into_iter()
        .map(|row| {
            xml_segments(&row, "<w:tc", "</w:tc>")
                .into_iter()
                .map(|cell| super::extract_text_tags(&cell, "w:t").join(""))
                .collect::<Vec<_>>()
        })
        .filter(|row| !row.is_empty())
        .collect()
}

pub(super) fn parse_docx_table_column_widths(table: &str) -> Vec<u32> {
    xml_segments(table, "<w:tr", "</w:tr>")
        .into_iter()
        .find_map(|row| {
            let widths = xml_segments(&row, "<w:tc", "</w:tc>")
                .into_iter()
                .filter_map(|cell| docx_tag_attr(&cell, "<w:tcW", "w:w"))
                .filter_map(|value| value.parse::<u32>().ok())
                .collect::<Vec<_>>();
            (!widths.is_empty()).then_some(widths)
        })
        .unwrap_or_default()
}

pub(super) fn parse_docx_table_row_heights(table: &str) -> Vec<u32> {
    xml_segments(table, "<w:tr", "</w:tr>")
        .into_iter()
        .map(|row| {
            docx_tag_attr(&row, "<w:trHeight", "w:val")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(DOCX_DEFAULT_TABLE_ROW_HEIGHT)
        })
        .collect()
}

pub(super) fn parse_docx_table_style(table: &str) -> Option<String> {
    docx_tag_attr(table, "<w:tblStyle", "w:val").filter(|value| !value.trim().is_empty())
}

pub(super) fn parse_docx_table_border_color(table: &str) -> Option<String> {
    docx_tag_attr(table, "<w:top", "w:color").and_then(docx_model_color)
}

pub(super) fn parse_docx_table_border_size(table: &str) -> Option<u32> {
    docx_u32_attr(table, "<w:top", "w:sz")
}

pub(super) fn parse_docx_table_cell_background(table: &str) -> Option<String> {
    xml_segments(table, "<w:tr", "</w:tr>")
        .into_iter()
        .enumerate()
        .filter(|(row_index, row)| *row_index > 0 || !parse_docx_table_header_row(row))
        .flat_map(|(_, row)| xml_segments(&row, "<w:tc", "</w:tc>"))
        .find_map(|cell| docx_tag_attr(&cell, "<w:shd", "w:fill").and_then(docx_model_color))
}

pub(super) fn parse_docx_table_header_row(table: &str) -> bool {
    xml_segments(table, "<w:tr", "</w:tr>")
        .first()
        .is_some_and(|row| row.contains("<w:tblHeader"))
}

pub(super) fn parse_docx_table_header_background(table: &str) -> Option<String> {
    xml_segments(table, "<w:tr", "</w:tr>")
        .first()
        .and_then(|row| {
            xml_segments(row, "<w:tc", "</w:tc>")
                .into_iter()
                .find_map(|cell| {
                    docx_tag_attr(&cell, "<w:shd", "w:fill").and_then(docx_model_color)
                })
        })
}

pub(super) fn parse_docx_table_cell_vertical_align(table: &str) -> Option<&'static str> {
    docx_tag_attr(table, "<w:vAlign", "w:val").and_then(|value| match value.as_str() {
        "center" => Some("center"),
        "bottom" => Some("bottom"),
        "top" => Some("top"),
        _ => None,
    })
}

pub(super) fn build_docx_table(block: &Value) -> String {
    let rows = block
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let table_style = block
        .get("tableStyle")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let border_color = block
        .get("tableBorderColor")
        .and_then(Value::as_str)
        .and_then(docx_hex_color)
        .unwrap_or_else(|| "A3A3A3".to_string());
    let border_size = docx_u32_model_attr_allow_zero(block, "tableBorderSize", 96).unwrap_or(4);
    let cell_background = block
        .get("tableCellBackground")
        .and_then(Value::as_str)
        .and_then(docx_hex_color);
    let header_background = block
        .get("tableHeaderBackground")
        .and_then(Value::as_str)
        .and_then(docx_hex_color);
    let header_row = block
        .get("tableHeaderRow")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let cell_vertical_align = block
        .get("tableCellVerticalAlign")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "top" | "center" | "bottom"));
    let column_widths = block
        .get("tableColumnWidths")
        .and_then(Value::as_array)
        .map(|widths| {
            widths
                .iter()
                .filter_map(Value::as_u64)
                .map(|width| {
                    width.clamp(
                        u64::from(DOCX_MIN_TABLE_COLUMN_WIDTH),
                        u64::from(DOCX_MAX_TABLE_COLUMN_WIDTH),
                    ) as u32
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let row_heights = block
        .get("tableRowHeights")
        .and_then(Value::as_array)
        .map(|heights| {
            heights
                .iter()
                .filter_map(Value::as_u64)
                .map(|height| {
                    height.clamp(
                        u64::from(DOCX_MIN_TABLE_ROW_HEIGHT),
                        u64::from(DOCX_MAX_TABLE_ROW_HEIGHT),
                    ) as u32
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rows_xml = rows
        .iter()
        .enumerate()
        .map(|(row_index, row)| {
            let cells = row.as_array().cloned().unwrap_or_default();
            let row_height = row_heights
                .get(row_index)
                .copied()
                .unwrap_or(DOCX_DEFAULT_TABLE_ROW_HEIGHT);
            let row_properties = if row_index == 0 && header_row {
                format!(
                    r#"<w:trPr><w:trHeight w:val="{row_height}" w:hRule="atLeast"/><w:tblHeader/></w:trPr>"#
                )
            } else {
                format!(
                    r#"<w:trPr><w:trHeight w:val="{row_height}" w:hRule="atLeast"/></w:trPr>"#
                )
            };
            let cells_xml = cells
                .iter()
                .enumerate()
                .map(|(cell_index, cell)| {
                    let text = cell.as_str().unwrap_or_default();
                    let width = column_widths
                        .get(cell_index)
                        .copied()
                        .unwrap_or(DOCX_DEFAULT_TABLE_COLUMN_WIDTH);
                    let fill = if row_index == 0 && header_row {
                        header_background.as_ref().or(cell_background.as_ref())
                    } else {
                        cell_background.as_ref()
                    };
                    let shading = fill
                        .map(|color| {
                            format!(
                                r#"<w:shd w:val="clear" w:color="auto" w:fill="{color}"/>"#
                            )
                        })
                        .unwrap_or_default();
                    let vertical_align = cell_vertical_align
                        .map(|align| format!(r#"<w:vAlign w:val="{align}"/>"#))
                        .unwrap_or_default();
                    format!(
                        r#"<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shading}{vertical_align}</w:tcPr><w:p><w:r>{}</w:r></w:p></w:tc>"#,
                        docx_text_with_breaks(text)
                    )
                })
                .collect::<Vec<_>>()
                .join("");
            format!(r#"<w:tr>{row_properties}{cells_xml}</w:tr>"#)
        })
        .collect::<Vec<_>>()
        .join("");
    let style_xml = table_style
        .map(|style| format!(r#"<w:tblStyle w:val="{}"/>"#, escape_xml(style)))
        .unwrap_or_default();
    let border_value = if border_size == 0 { "nil" } else { "single" };
    let borders_xml = ["top", "left", "bottom", "right", "insideH", "insideV"]
        .into_iter()
        .map(|side| {
            format!(
                r#"<w:{side} w:val="{border_value}" w:sz="{border_size}" w:space="0" w:color="{border_color}"/>"#
            )
        })
        .collect::<Vec<_>>()
        .join("");
    format!(
        r#"<w:tbl><w:tblPr>{style_xml}<w:tblW w:w="0" w:type="auto"/><w:tblBorders>{borders_xml}</w:tblBorders></w:tblPr>{rows_xml}</w:tbl>"#
    )
}

fn docx_model_color(value: String) -> Option<String> {
    docx_hex_color(&value).map(|color| format!("#{color}"))
}
