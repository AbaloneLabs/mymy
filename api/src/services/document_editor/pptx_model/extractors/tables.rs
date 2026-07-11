use super::*;

pub(in crate::services::document_editor) fn pptx_slide_tables(
    xml: &str,
    slide_size: PptxSlideSize,
) -> Vec<Value> {
    let groups = pptx_group_contexts(xml);
    pptx_graphic_frame_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (offset, frame))| {
            if !frame.contains("<a:tbl") {
                return None;
            }
            let text_index_start = extract_text_tags(&xml[..offset], "a:t").len();
            let preservation_only = frame.contains("<a:gridSpan")
                || frame.contains("<a:hMerge")
                || frame.contains("<a:vMerge")
                || frame.contains(" gridSpan=")
                || frame.contains(" rowSpan=")
                || frame.contains(" hMerge=")
                || frame.contains(" vMerge=")
                || xml_segments(&frame, "<a:tc", "</a:tc>").iter().any(|cell| {
                    extract_text_tags(cell, "a:t").len() > 1
                        || xml_segments(cell, "<a:p", "</a:p>").len() > 1
                        || cell.contains("<a:fld")
                        || cell.contains("<a:hlinkClick")
                });
            let (x, y, width, height, rotation) = pptx_shape_geometry_for_size(&frame, slide_size);
            let mut rows = Vec::new();
            let mut cell_styles = Vec::new();
            for row in xml_segments(&frame, "<a:tr", "</a:tr>") {
                let cells = xml_segments(&row, "<a:tc", "</a:tc>");
                if cells.is_empty() {
                    continue;
                }
                rows.push(
                    cells
                        .iter()
                        .map(|cell| extract_text_tags(cell, "a:t").join(""))
                        .collect::<Vec<_>>(),
                );
                cell_styles.push(
                    cells
                        .iter()
                        .map(|cell| pptx_table_cell_style(cell))
                        .collect::<Vec<_>>(),
                );
            }
            let mut value = json!({
                "id": format!("tbl{}", index + 1),
                "shapeId": docx_tag_attr(&frame, "<p:cNvPr", "id"),
                "textIndexStart": text_index_start,
                "preservationOnly": preservation_only,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "rows": rows,
                "cellStyles": pptx_table_cell_style_values(&cell_styles),
                "columnWidths": pptx_table_column_widths(&frame),
                "rowHeights": pptx_table_row_heights(&frame),
                "tableStyleId": pptx_table_style_id(&frame),
                "firstRow": pptx_table_bool_attr(&frame, "firstRow"),
                "firstColumn": pptx_table_bool_attr(&frame, "firstCol"),
                "lastRow": pptx_table_bool_attr(&frame, "lastRow"),
                "lastColumn": pptx_table_bool_attr(&frame, "lastCol"),
                "bandedRows": pptx_table_bool_attr(&frame, "bandRow"),
                "bandedColumns": pptx_table_bool_attr(&frame, "bandCol")
            });
            if let Some(group) = pptx_group_for_offset(&groups, offset) {
                value["groupId"] = json!(group.group_id);
                value["groupShapeId"] = json!(group.shape_id.to_string());
            }
            Some(value)
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_table_column_widths(frame: &str) -> Vec<f64> {
    let widths = xml_empty_elements(frame, "<a:gridCol")
        .into_iter()
        .filter_map(|column| docx_tag_attr(&column, "<a:gridCol", "w"))
        .filter_map(|width| width.parse::<f64>().ok())
        .collect::<Vec<_>>();
    normalize_pptx_table_dimensions(&widths)
}

pub(in crate::services::document_editor) fn pptx_table_row_heights(frame: &str) -> Vec<f64> {
    let rows = xml_segments(frame, "<a:tr", "</a:tr>");
    let heights = rows
        .iter()
        .filter_map(|row| docx_tag_attr(row, "<a:tr", "h"))
        .filter_map(|height| height.parse::<f64>().ok())
        .collect::<Vec<_>>();
    if heights.len() != rows.len() {
        return Vec::new();
    }
    normalize_pptx_table_dimensions(&heights)
}

pub(in crate::services::document_editor) fn normalize_pptx_table_dimensions(
    values: &[f64],
) -> Vec<f64> {
    let total = values.iter().sum::<f64>();
    if total <= 0.0 {
        return Vec::new();
    }
    values
        .iter()
        .map(|value| ((value / total) * 100.0).clamp(1.0, 100.0))
        .collect()
}

pub(in crate::services::document_editor) fn pptx_table_cell_style(
    cell: &str,
) -> PptxTableCellStyle {
    let fill_color = pptx_table_cell_properties_segment(cell)
        .and_then(|properties| docx_tag_attr(&properties, "<a:srgbClr", "val"))
        .and_then(|color| docx_hex_color(&color));
    let run_properties = pptx_run_properties_segment(cell);
    PptxTableCellStyle {
        fill_color,
        text_color: run_properties.as_deref().and_then(pptx_run_color),
        bold: run_properties
            .as_deref()
            .and_then(|run| docx_tag_attr(run, "<a:rPr", "b"))
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
        italic: run_properties
            .as_deref()
            .and_then(|run| docx_tag_attr(run, "<a:rPr", "i"))
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
        align: pptx_paragraph_alignment(cell),
    }
}

pub(in crate::services::document_editor) fn pptx_table_cell_properties_segment(
    cell: &str,
) -> Option<String> {
    xml_named_segments(cell, "a:tcPr")
        .into_iter()
        .next()
        .or_else(|| xml_empty_elements(cell, "<a:tcPr").into_iter().next())
}

pub(in crate::services::document_editor) fn pptx_table_cell_style_values(
    styles: &[Vec<PptxTableCellStyle>],
) -> Vec<Vec<Value>> {
    styles
        .iter()
        .map(|row| {
            row.iter()
                .map(|style| {
                    let mut value = serde_json::Map::new();
                    if let Some(fill_color) = style.fill_color.as_deref() {
                        value.insert("fillColor".to_string(), json!(format!("#{fill_color}")));
                    }
                    if let Some(text_color) = style.text_color.as_deref() {
                        value.insert("textColor".to_string(), json!(format!("#{text_color}")));
                    }
                    if let Some(bold) = style.bold {
                        value.insert("bold".to_string(), json!(bold));
                    }
                    if let Some(italic) = style.italic {
                        value.insert("italic".to_string(), json!(italic));
                    }
                    if let Some(align) = style.align.as_deref() {
                        value.insert("align".to_string(), json!(align));
                    }
                    Value::Object(value)
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_table_style_id(frame: &str) -> Option<String> {
    extract_text_tags(frame, "a:tableStyleId")
        .into_iter()
        .next()
        .filter(|style| !style.trim().is_empty())
}

pub(in crate::services::document_editor) fn pptx_table_bool_attr(frame: &str, attr: &str) -> bool {
    docx_tag_attr(frame, "<a:tblPr", attr)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub(in crate::services::document_editor) fn pptx_graphic_frame_segments(
    xml: &str,
) -> Vec<(usize, String)> {
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
