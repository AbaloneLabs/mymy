use super::*;

pub(in crate::services::document_editor) fn update_pptx_charts(
    xml: &str,
    specs: &[PptxChartSpec],
    remove_missing: bool,
    slide_size: PptxSlideSize,
) -> String {
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
                output.push_str(&update_pptx_chart_frame(frame, spec, slide_size));
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
        insert_pptx_charts(&output, &inserted, slide_size)
    }
}

pub(in crate::services::document_editor) fn update_pptx_chart_frame(
    frame: &str,
    spec: &PptxChartSpec,
    slide_size: PptxSlideSize,
) -> String {
    let (x, y, width, height) =
        pptx_percent_geometry_emu_for_size(spec.x, spec.y, spec.width, spec.height, slide_size);
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

pub(in crate::services::document_editor) fn insert_pptx_charts(
    slide_xml: &str,
    charts: &[&PptxChartSpec],
    slide_size: PptxSlideSize,
) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let frames = charts
        .iter()
        .enumerate()
        .map(|(index, chart)| pptx_chart_renderable(first_shape_id + index, chart, slide_size))
        .collect::<Vec<_>>();
    let frames = render_pptx_objects(frames, first_shape_id + charts.len());
    if frames.is_empty() {
        return slide_xml.to_string();
    }
    insert_pptx_sp_tree_end(slide_xml, &frames)
}

pub(in crate::services::document_editor) fn build_pptx_chart_frame_for_size(
    shape_id: usize,
    spec: &PptxChartSpec,
    slide_size: PptxSlideSize,
) -> String {
    let relationship_id = spec.relationship_id.as_deref().unwrap_or_default();
    let (x, y, width, height) =
        pptx_percent_geometry_emu_for_size(spec.x, spec.y, spec.width, spec.height, slide_size);
    let rotation = pptx_rotation_unit(spec.rotation);
    format!(
        r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{shape_id}" name="Chart {shape_id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="{}"/></a:graphicData></a:graphic></p:graphicFrame>"#,
        escape_xml(relationship_id)
    )
}

pub(in crate::services::document_editor) fn add_pptx_chart_replacements(
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
            updated = update_ooxml_chart_title(&updated, title);
        }
        if let Some(chart_type) = spec.chart_type.as_deref() {
            updated = update_ooxml_chart_type(&updated, chart_type);
        }
        if let Some(legend_visible) = spec.legend_visible {
            updated = update_ooxml_chart_legend(
                &updated,
                legend_visible,
                spec.legend_position.as_deref(),
            );
        }
        updated = update_pptx_chart_axis(updated, "c:catAx", &spec.category_axis);
        updated = update_pptx_chart_axis(updated, "c:valAx", &spec.value_axis);
        updated = update_ooxml_chart_series(&updated, &spec.series);
        replacements.push((chart_path, updated.into_bytes()));
    }
}

pub(in crate::services::document_editor) fn update_pptx_chart_axis(
    mut xml: String,
    axis_tag: &str,
    spec: &PptxChartAxisSpec,
) -> String {
    if let Some(position) = spec.position.as_deref() {
        xml = update_ooxml_chart_axis_position(&xml, axis_tag, position);
    }
    if let Some(visible) = spec.major_gridlines {
        xml = update_ooxml_chart_axis_major_gridlines(&xml, axis_tag, visible);
    }
    if let Some(position) = spec.tick_label_position.as_deref() {
        xml = update_ooxml_chart_axis_tick_label_position(&xml, axis_tag, position);
    }
    if let Some(mark) = spec.major_tick_mark.as_deref() {
        xml = update_ooxml_chart_axis_major_tick_mark(&xml, axis_tag, mark);
    }
    if let Some(mark) = spec.minor_tick_mark.as_deref() {
        xml = update_ooxml_chart_axis_minor_tick_mark(&xml, axis_tag, mark);
    }
    if let Some(format_code) = spec.number_format.as_deref() {
        xml = update_ooxml_chart_axis_number_format(&xml, axis_tag, format_code);
    }
    if let Some(color) = spec.line_color.as_deref() {
        xml = update_ooxml_chart_axis_line_color(&xml, axis_tag, color);
    }
    if let Some(width) = spec.line_width {
        xml = update_ooxml_chart_axis_line_width(&xml, axis_tag, width);
    }
    if let Some(dash) = spec.line_dash.as_deref() {
        xml = update_ooxml_chart_axis_line_dash(&xml, axis_tag, dash);
    }
    if spec.label_text_color.is_some()
        || spec.label_font_size.is_some()
        || spec.label_bold.is_some()
        || spec.label_italic.is_some()
    {
        xml = update_ooxml_chart_axis_label_style(
            &xml,
            axis_tag,
            spec.label_text_color.as_deref(),
            spec.label_font_size,
            spec.label_bold,
            spec.label_italic,
        );
    }
    if let Some(rotation) = spec.label_rotation {
        xml = update_ooxml_chart_axis_label_rotation(&xml, axis_tag, rotation);
    }
    if spec.title.is_some() {
        xml = update_ooxml_chart_axis_title(&xml, axis_tag, spec.title.as_deref());
    }
    xml
}
