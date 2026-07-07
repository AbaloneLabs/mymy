use std::collections::BTreeMap;

use serde_json::{json, Value};

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

#[derive(Clone, Debug, Eq, PartialEq)]
struct DocxMergedCell {
    row: usize,
    column: usize,
    row_span: usize,
    col_span: usize,
}

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

pub(super) fn parse_docx_table_merged_cells(table: &str) -> Vec<Value> {
    let mut ranges: Vec<DocxMergedCell> = Vec::new();
    let mut vertical_ranges_by_column: BTreeMap<usize, usize> = BTreeMap::new();
    for (row_index, row) in xml_segments(table, "<w:tr", "</w:tr>")
        .into_iter()
        .enumerate()
    {
        let mut column_index = 0usize;
        for cell in xml_segments(&row, "<w:tc", "</w:tc>") {
            let col_span = parse_docx_grid_span(&cell);
            match parse_docx_vertical_merge(&cell).as_deref() {
                Some("continue") => {
                    if let Some(range_index) = vertical_ranges_by_column.get(&column_index).copied()
                    {
                        if let Some(range) = ranges.get_mut(range_index) {
                            range.row_span = row_index.saturating_sub(range.row) + 1;
                        }
                    }
                }
                Some("restart") => {
                    clear_vertical_ranges(&mut vertical_ranges_by_column, column_index, col_span);
                    let range_index = ranges.len();
                    ranges.push(DocxMergedCell {
                        row: row_index,
                        column: column_index,
                        row_span: 1,
                        col_span,
                    });
                    for column in column_index..column_index + col_span {
                        vertical_ranges_by_column.insert(column, range_index);
                    }
                }
                _ => {
                    clear_vertical_ranges(&mut vertical_ranges_by_column, column_index, col_span);
                    if col_span > 1 {
                        ranges.push(DocxMergedCell {
                            row: row_index,
                            column: column_index,
                            row_span: 1,
                            col_span,
                        });
                    }
                }
            }
            column_index += col_span;
        }
    }
    ranges
        .into_iter()
        .filter(|range| range.row_span > 1 || range.col_span > 1)
        .map(|range| {
            json!({
                "row": range.row,
                "column": range.column,
                "rowSpan": range.row_span,
                "colSpan": range.col_span
            })
        })
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

fn parse_docx_grid_span(cell: &str) -> usize {
    docx_tag_attr(cell, "<w:gridSpan", "w:val")
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1)
}

fn parse_docx_vertical_merge(cell: &str) -> Option<String> {
    if !cell.contains("<w:vMerge") {
        return None;
    }
    Some(
        docx_tag_attr(cell, "<w:vMerge", "w:val")
            .filter(|value| value == "restart")
            .unwrap_or_else(|| "continue".to_string()),
    )
}

fn clear_vertical_ranges(
    ranges_by_column: &mut BTreeMap<usize, usize>,
    column: usize,
    col_span: usize,
) {
    for current in column..column + col_span {
        ranges_by_column.remove(&current);
    }
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
    let row_cells = rows
        .iter()
        .map(|row| row.as_array().cloned().unwrap_or_default())
        .collect::<Vec<_>>();
    let column_count = row_cells
        .iter()
        .map(Vec::len)
        .chain(std::iter::once(column_widths.len()))
        .max()
        .unwrap_or(1)
        .max(1);
    let merged_cells = docx_merged_cells_from_model(block, row_cells.len(), column_count);
    let rows_xml = row_cells
        .iter()
        .enumerate()
        .map(|(row_index, cells)| {
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
            let cells_xml = (0..column_count)
                .filter_map(|cell_index| {
                    let merged_cell =
                        docx_merged_cell_at(&merged_cells, row_index, cell_index);
                    if let Some(range) = merged_cell {
                        if row_index > range.row && cell_index > range.column {
                            return None;
                        }
                        if row_index == range.row && cell_index > range.column {
                            return None;
                        }
                    }
                    let text = cells
                        .get(cell_index)
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let col_span = merged_cell
                        .filter(|range| range.column == cell_index)
                        .map(|range| range.col_span)
                        .unwrap_or(1);
                    let width = docx_table_cell_width(&column_widths, cell_index, col_span);
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
                    let grid_span = if col_span > 1 {
                        format!(r#"<w:gridSpan w:val="{col_span}"/>"#)
                    } else {
                        String::new()
                    };
                    let vertical_merge = merged_cell
                        .filter(|range| range.row_span > 1)
                        .map(|range| {
                            if row_index == range.row {
                                r#"<w:vMerge w:val="restart"/>"#.to_string()
                            } else {
                                "<w:vMerge/>".to_string()
                            }
                        })
                        .unwrap_or_default();
                    let content = if merged_cell.is_some_and(|range| row_index > range.row) {
                        String::new()
                    } else {
                        docx_text_with_breaks(text)
                    };
                    Some(format!(
                        r#"<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{grid_span}{vertical_merge}{shading}{vertical_align}</w:tcPr><w:p><w:r>{content}</w:r></w:p></w:tc>"#
                    ))
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

fn docx_merged_cells_from_model(
    block: &Value,
    row_count: usize,
    column_count: usize,
) -> Vec<DocxMergedCell> {
    let mut occupied = BTreeMap::<(usize, usize), ()>::new();
    block
        .get("tableMergedCells")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let row = item.get("row").and_then(Value::as_u64)? as usize;
            let column = item.get("column").and_then(Value::as_u64)? as usize;
            if row >= row_count || column >= column_count {
                return None;
            }
            let row_span = item
                .get("rowSpan")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(1)
                .clamp(1, row_count.saturating_sub(row).max(1));
            let col_span = item
                .get("colSpan")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(1)
                .clamp(1, column_count.saturating_sub(column).max(1));
            if row_span == 1 && col_span == 1 {
                return None;
            }
            let range = DocxMergedCell {
                row,
                column,
                row_span,
                col_span,
            };
            let cells = docx_merged_cell_positions(&range);
            if cells.iter().any(|cell| occupied.contains_key(cell)) {
                return None;
            }
            for cell in cells {
                occupied.insert(cell, ());
            }
            Some(range)
        })
        .collect()
}

fn docx_merged_cell_at(
    ranges: &[DocxMergedCell],
    row: usize,
    column: usize,
) -> Option<&DocxMergedCell> {
    ranges.iter().find(|range| {
        row >= range.row
            && row < range.row + range.row_span
            && column >= range.column
            && column < range.column + range.col_span
    })
}

fn docx_merged_cell_positions(range: &DocxMergedCell) -> Vec<(usize, usize)> {
    (range.row..range.row + range.row_span)
        .flat_map(|row| {
            (range.column..range.column + range.col_span).map(move |column| (row, column))
        })
        .collect()
}

fn docx_table_cell_width(column_widths: &[u32], column: usize, col_span: usize) -> u32 {
    (column..column + col_span)
        .map(|index| {
            column_widths
                .get(index)
                .copied()
                .unwrap_or(DOCX_DEFAULT_TABLE_COLUMN_WIDTH)
        })
        .sum()
}

fn docx_model_color(value: String) -> Option<String> {
    docx_hex_color(&value).map(|color| format!("#{color}"))
}
