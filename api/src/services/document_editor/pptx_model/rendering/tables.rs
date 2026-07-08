use super::*;

pub(in crate::services::document_editor) fn update_pptx_tables(
    xml: &str,
    specs: &[PptxTableSpec],
    remove_missing: bool,
    slide_size: PptxSlideSize,
) -> String {
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
                output.push_str(&build_pptx_table_for_size(
                    next_pptx_drawing_id(xml) + spec_index,
                    spec,
                    slide_size,
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
        insert_pptx_tables(&output, &specs[spec_index..], slide_size)
    } else {
        output
    }
}

pub(in crate::services::document_editor) fn insert_pptx_tables(
    slide_xml: &str,
    tables: &[PptxTableSpec],
    slide_size: PptxSlideSize,
) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let table_xml = tables
        .iter()
        .enumerate()
        .map(|(index, table)| pptx_table_renderable(first_shape_id + index, table, slide_size))
        .collect::<Vec<_>>();
    let table_xml = render_pptx_objects(table_xml, first_shape_id + tables.len());
    if table_xml.is_empty() {
        return slide_xml.to_string();
    }
    insert_pptx_sp_tree_end(slide_xml, &table_xml)
}

pub(in crate::services::document_editor) fn build_pptx_table_for_size(
    shape_id: usize,
    spec: &PptxTableSpec,
    slide_size: PptxSlideSize,
) -> String {
    let (x, y, width, height) =
        pptx_percent_geometry_emu_for_size(spec.x, spec.y, spec.width, spec.height, slide_size);
    let rotation = pptx_rotation_unit(spec.rotation);
    let column_count = spec.rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let row_count = spec.rows.len().max(1);
    let column_widths = pptx_table_dimension_units(column_count, width, &spec.column_widths);
    let row_heights = pptx_table_dimension_units(row_count, height, &spec.row_heights);
    let grid = column_widths
        .iter()
        .map(|column_width| format!(r#"<a:gridCol w="{column_width}"/>"#))
        .collect::<Vec<_>>()
        .join("");
    let rows = spec
        .rows
        .iter()
        .enumerate()
        .map(|(row_index, row)| {
            let row_height = row_heights.get(row_index).copied().unwrap_or(1);
            let cells = (0..column_count)
                .map(|column| {
                    let value = row.get(column).map(String::as_str).unwrap_or_default();
                    let style = spec
                        .cell_styles
                        .get(row_index)
                        .and_then(|row| row.get(column));
                    build_pptx_table_cell(value, style)
                })
                .collect::<Vec<_>>()
                .join("");
            format!(r#"<a:tr h="{row_height}">{cells}</a:tr>"#)
        })
        .collect::<Vec<_>>()
        .join("");
    let table_style_id = escape_xml(
        spec.table_style_id
            .as_deref()
            .unwrap_or(PPTX_DEFAULT_TABLE_STYLE_ID),
    );
    let first_row = pptx_bool_attr_value(spec.first_row);
    let first_column = pptx_bool_attr_value(spec.first_column);
    let last_row = pptx_bool_attr_value(spec.last_row);
    let last_column = pptx_bool_attr_value(spec.last_column);
    let banded_rows = pptx_bool_attr_value(spec.banded_rows);
    let banded_columns = pptx_bool_attr_value(spec.banded_columns);
    format!(
        r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{shape_id}" name="Table {shape_id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="{first_row}" firstCol="{first_column}" lastRow="{last_row}" lastCol="{last_column}" bandRow="{banded_rows}" bandCol="{banded_columns}"><a:tableStyleId>{table_style_id}</a:tableStyleId></a:tblPr><a:tblGrid>{grid}</a:tblGrid>{rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#
    )
}

pub(in crate::services::document_editor) fn build_pptx_table_cell(
    value: &str,
    style: Option<&PptxTableCellStyle>,
) -> String {
    let paragraph_properties = style
        .and_then(|style| style.align.as_deref())
        .map(|align| format!(r#"<a:pPr algn="{}"/>"#, escape_xml(align)))
        .unwrap_or_default();
    let run_properties = pptx_table_cell_run_properties_xml(style);
    let cell_properties = pptx_table_cell_properties_xml(style);
    format!(
        r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>{paragraph_properties}<a:r>{run_properties}<a:t>{}</a:t></a:r></a:p></a:txBody>{cell_properties}</a:tc>"#,
        escape_xml(value)
    )
}

pub(in crate::services::document_editor) fn pptx_table_cell_run_properties_xml(
    style: Option<&PptxTableCellStyle>,
) -> String {
    let Some(style) = style else {
        return String::new();
    };
    let mut attrs = Vec::new();
    if style.bold == Some(true) {
        attrs.push(r#" b="1""#);
    }
    if style.italic == Some(true) {
        attrs.push(r#" i="1""#);
    }
    let color = style
        .text_color
        .as_deref()
        .map(|color| format!(r#"<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>"#));
    if attrs.is_empty() && color.is_none() {
        return String::new();
    }
    format!(
        r#"<a:rPr{}>{}</a:rPr>"#,
        attrs.join(""),
        color.unwrap_or_default()
    )
}

pub(in crate::services::document_editor) fn pptx_table_cell_properties_xml(
    style: Option<&PptxTableCellStyle>,
) -> String {
    let Some(fill_color) = style.and_then(|style| style.fill_color.as_deref()) else {
        return "<a:tcPr/>".to_string();
    };
    format!(r#"<a:tcPr><a:solidFill><a:srgbClr val="{fill_color}"/></a:solidFill></a:tcPr>"#)
}

pub(in crate::services::document_editor) fn pptx_table_dimension_units(
    count: usize,
    total: i64,
    values: &[f64],
) -> Vec<i64> {
    if count == 0 {
        return Vec::new();
    }
    let usable_values = values
        .iter()
        .copied()
        .take(count)
        .filter(|value| value.is_finite() && *value > 0.0)
        .collect::<Vec<_>>();
    if usable_values.len() != count {
        let unit = (total / count as i64).max(1);
        return vec![unit; count];
    }
    let sum = usable_values.iter().sum::<f64>();
    if sum <= 0.0 {
        let unit = (total / count as i64).max(1);
        return vec![unit; count];
    }
    usable_values
        .iter()
        .map(|value| (((value / sum) * total as f64).round() as i64).max(1))
        .collect()
}

pub(in crate::services::document_editor) fn pptx_bool_attr_value(value: bool) -> &'static str {
    if value {
        "1"
    } else {
        "0"
    }
}
