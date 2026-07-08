use super::*;

pub(in crate::services::document_editor) fn pptx_slide_charts(
    bytes: &[u8],
    slide_path: &str,
    xml: &str,
    slide_size: PptxSlideSize,
) -> Vec<Value> {
    let relationships = read_zip_text(bytes, &xlsx_part_rels_path(slide_path))
        .ok()
        .map(|rels| xlsx_relationships_by_id(slide_path, &rels))
        .unwrap_or_default();
    let groups = pptx_group_contexts(xml);
    pptx_graphic_frame_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (offset, frame))| {
            let chart = xml_named_empty_elements(&frame, "c:chart")
                .into_iter()
                .next()?;
            let relationship_id = attr_value(&chart, "r:id")?;
            let (relationship_type, chart_path) = relationships.get(&relationship_id)?;
            if !relationship_type.ends_with("/chart") {
                return None;
            }
            let chart_xml = read_zip_text(bytes, chart_path).unwrap_or_default();
            let (x, y, width, height, rotation) = pptx_shape_geometry_for_size(&frame, slide_size);
            let series = ooxml_chart_series(&chart_xml);
            let categories = series
                .first()
                .and_then(|item| item.get("categories"))
                .cloned()
                .unwrap_or_else(|| json!([]));
            let mut value = json!({
                "id": format!("chart{}", index + 1),
                "relationshipId": relationship_id,
                "path": chart_path,
                "type": ooxml_chart_type(&chart_xml),
                "title": ooxml_chart_title(&chart_xml),
                "legendVisible": ooxml_chart_legend_visible(&chart_xml),
                "legendPosition": ooxml_chart_legend_position(&chart_xml),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "categories": categories,
                "series": series
            });
            pptx_extend_chart_axis_model(&mut value, &chart_xml);
            if let Some(group_id) = pptx_group_id_for_offset(&groups, offset) {
                value["groupId"] = json!(group_id);
            }
            Some(value)
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_extend_chart_axis_model(
    value: &mut Value,
    chart_xml: &str,
) {
    for (prefix, axis_tag) in [("category", "c:catAx"), ("value", "c:valAx")] {
        value[&format!("{prefix}AxisTitle")] = json!(ooxml_chart_axis_title(chart_xml, axis_tag));
        value[&format!("{prefix}AxisPosition")] =
            json!(ooxml_chart_axis_position(chart_xml, axis_tag));
        value[&format!("{prefix}MajorGridlines")] = json!(
            ooxml_chart_axis_major_gridlines_visible(chart_xml, axis_tag)
        );
        value[&format!("{prefix}AxisTickLabelPosition")] =
            json!(ooxml_chart_axis_tick_label_position(chart_xml, axis_tag));
        value[&format!("{prefix}AxisMajorTickMark")] =
            json!(ooxml_chart_axis_major_tick_mark(chart_xml, axis_tag));
        value[&format!("{prefix}AxisMinorTickMark")] =
            json!(ooxml_chart_axis_minor_tick_mark(chart_xml, axis_tag));
        value[&format!("{prefix}AxisNumberFormat")] =
            json!(ooxml_chart_axis_number_format(chart_xml, axis_tag));
        value[&format!("{prefix}AxisLineColor")] = json!(ooxml_chart_axis_line_color(
            chart_xml, axis_tag
        )
        .map(|color| format!("#{color}")));
        value[&format!("{prefix}AxisLineWidth")] =
            json!(ooxml_chart_axis_line_width(chart_xml, axis_tag));
        value[&format!("{prefix}AxisLineDash")] =
            json!(ooxml_chart_axis_line_dash(chart_xml, axis_tag));
        value[&format!("{prefix}AxisLabelTextColor")] =
            json!(ooxml_chart_axis_label_text_color(chart_xml, axis_tag)
                .map(|color| format!("#{color}")));
        value[&format!("{prefix}AxisLabelFontSize")] =
            json!(ooxml_chart_axis_label_font_size(chart_xml, axis_tag));
        value[&format!("{prefix}AxisLabelRotation")] =
            json!(ooxml_chart_axis_label_rotation(chart_xml, axis_tag));
        value[&format!("{prefix}AxisLabelBold")] =
            json!(ooxml_chart_axis_label_bold(chart_xml, axis_tag));
        value[&format!("{prefix}AxisLabelItalic")] =
            json!(ooxml_chart_axis_label_italic(chart_xml, axis_tag));
    }
}
