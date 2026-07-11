use super::*;

pub(in crate::services::document_editor) fn pptx_table_specs(slide: &Value) -> Vec<PptxTableSpec> {
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
                shape_id: pptx_shape_id_from_model(table),
                group_shape_id: pptx_group_shape_id_from_model(table),
                text_index_start: value_as_usize(table.get("textIndexStart")),
                preservation_only: table
                    .get("preservationOnly")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                group_id: pptx_group_id_from_model(table),
                rows,
                cell_styles: pptx_table_cell_styles_from_model(table.get("cellStyles")),
                column_widths: pptx_table_dimensions_from_model(table.get("columnWidths")),
                row_heights: pptx_table_dimensions_from_model(table.get("rowHeights")),
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
                table_style_id: pptx_table_style_id_from_model(table.get("tableStyleId")),
                first_row: table
                    .get("firstRow")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                first_column: table
                    .get("firstColumn")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                last_row: table
                    .get("lastRow")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                last_column: table
                    .get("lastColumn")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                banded_rows: table
                    .get("bandedRows")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                banded_columns: table
                    .get("bandedColumns")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_table_cell_styles_from_model(
    value: Option<&Value>,
) -> Vec<Vec<PptxTableCellStyle>> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|row| {
            row.as_array()
                .into_iter()
                .flatten()
                .map(pptx_table_cell_style_from_model)
                .collect::<Vec<_>>()
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_table_cell_style_from_model(
    value: &Value,
) -> PptxTableCellStyle {
    PptxTableCellStyle {
        fill_color: value
            .get("fillColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        text_color: value
            .get("textColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        bold: value.get("bold").and_then(Value::as_bool),
        italic: value.get("italic").and_then(Value::as_bool),
        align: value
            .get("align")
            .and_then(Value::as_str)
            .and_then(pptx_alignment_value)
            .map(str::to_string),
    }
}

pub(in crate::services::document_editor) fn pptx_table_dimensions_from_model(
    value: Option<&Value>,
) -> Vec<f64> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(1.0, 100.0))
        .collect()
}

pub(in crate::services::document_editor) fn pptx_table_style_id_from_model(
    value: Option<&Value>,
) -> Option<String> {
    let style_id = value?.as_str()?.trim();
    if style_id.is_empty() || style_id.len() > 128 {
        return None;
    }
    Some(style_id.to_string())
}

pub(in crate::services::document_editor) fn apply_pptx_table_replacements(
    texts: &mut [String],
    specs: &[PptxTableSpec],
) {
    for spec in specs {
        if spec.preservation_only {
            continue;
        }
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
