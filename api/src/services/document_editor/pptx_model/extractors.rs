use super::*;

pub(in crate::services::document_editor) fn pptx_shape_texts_for_size(
    xml: &str,
    slide_size: PptxSlideSize,
) -> Vec<Value> {
    let groups = pptx_group_contexts(xml);
    pptx_shape_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (offset, shape))| {
            let text = extract_text_tags(&shape, "a:t").join("");
            if text.trim().is_empty() {
                return None;
            }
            let text_index = extract_text_tags(&xml[..offset], "a:t").len();
            let (x, y, width, height, rotation) = pptx_shape_geometry_for_size(&shape, slide_size);
            let run = pptx_run_properties_segment(&shape).unwrap_or_default();
            let mut value = json!({
                "id": format!("t{}", index + 1),
                "text": text,
                "textIndex": text_index,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "fontSize": pptx_run_font_size(&run).map(|size| size.to_string()),
                "fontFamily": docx_tag_attr(&run, "<a:latin", "typeface"),
                "color": pptx_run_color(&run).map(|color| format!("#{color}")),
                "fillColor": pptx_shape_fill_color(&shape).map(|color| format!("#{color}")),
                "bold": docx_tag_attr(&run, "<a:rPr", "b").is_some_and(|value| value == "1"),
                "italic": docx_tag_attr(&run, "<a:rPr", "i").is_some_and(|value| value == "1"),
                "underline": docx_tag_attr(&run, "<a:rPr", "u").is_some_and(|value| value == "sng"),
                "strikethrough": docx_tag_attr(&run, "<a:rPr", "strike").is_some_and(|value| value == "sngStrike"),
                "align": pptx_paragraph_alignment(&shape)
            });
            if let Some(group_id) = pptx_group_id_for_offset(&groups, offset) {
                value["groupId"] = json!(group_id);
            }
            Some(value)
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_shape_segments(xml: &str) -> Vec<(usize, String)> {
    let mut shapes = Vec::new();
    let mut offset = 0usize;
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, "<p:sp") {
        let absolute_start = offset + start;
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:sp>") else {
            break;
        };
        let end_index = end + "</p:sp>".len();
        shapes.push((absolute_start, after_start[..end_index].to_string()));
        offset = absolute_start + end_index;
        rest = &xml[offset..];
    }
    shapes
}

pub(in crate::services::document_editor) fn pptx_slide_shapes_for_size(
    xml: &str,
    slide_size: PptxSlideSize,
) -> Vec<Value> {
    let groups = pptx_group_contexts(xml);
    pptx_basic_shape_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (offset, shape))| {
            let kind = pptx_managed_basic_shape_kind(&shape)?;
            let (x, y, width, height, rotation) = pptx_shape_geometry_for_size(&shape, slide_size);
            let mut value = json!({
                "id": format!("s{}", index + 1),
                "kind": kind.as_value(),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "fillColor": pptx_shape_fill_color(&shape).map(|color| format!("#{color}")),
                "strokeColor": pptx_shape_stroke_color(&shape).map(|color| format!("#{color}")),
                "strokeWidth": pptx_shape_stroke_width(&shape),
                "lineStartArrow": pptx_shape_line_arrow(&shape, "tailEnd"),
                "lineEndArrow": pptx_shape_line_arrow(&shape, "headEnd")
            });
            if let Some(group_id) = pptx_group_id_for_offset(&groups, offset) {
                value["groupId"] = json!(group_id);
            }
            Some(value)
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_basic_shape_segments(
    xml: &str,
) -> Vec<(usize, String)> {
    let mut segments = pptx_segments_with_offsets(xml, "<p:sp", "</p:sp>");
    segments.extend(pptx_segments_with_offsets(xml, "<p:cxnSp", "</p:cxnSp>"));
    segments.sort_by_key(|(offset, _)| *offset);
    segments
}

pub(in crate::services::document_editor) fn pptx_group_contexts(
    xml: &str,
) -> Vec<PptxGroupContext> {
    pptx_segments_with_offsets(xml, "<p:grpSp", "</p:grpSp>")
        .into_iter()
        .filter_map(|(start, group)| {
            let shape_id = docx_tag_attr(&group, "<p:cNvPr", "id")?;
            let group_id = docx_tag_attr(&group, "<p:cNvPr", "name")
                .and_then(|name| name.strip_prefix("Group ").map(str::to_string))
                .filter(|name| pptx_valid_group_id(name))
                .unwrap_or_else(|| format!("group{shape_id}"));
            Some(PptxGroupContext {
                start,
                end: start + group.len(),
                group_id,
            })
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_group_id_for_offset(
    groups: &[PptxGroupContext],
    offset: usize,
) -> Option<String> {
    groups
        .iter()
        .find(|group| offset > group.start && offset < group.end)
        .map(|group| group.group_id.clone())
}

pub(in crate::services::document_editor) fn pptx_valid_group_id(group_id: &str) -> bool {
    !group_id.is_empty()
        && group_id.len() <= 128
        && group_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

pub(in crate::services::document_editor) fn pptx_segments_with_offsets(
    xml: &str,
    start_marker: &str,
    end_marker: &str,
) -> Vec<(usize, String)> {
    let mut segments = Vec::new();
    let mut offset = 0usize;
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, start_marker) {
        let absolute_start = offset + start;
        let after_start = &rest[start..];
        let Some(end) = after_start.find(end_marker) else {
            break;
        };
        let end_index = end + end_marker.len();
        segments.push((absolute_start, after_start[..end_index].to_string()));
        offset = absolute_start + end_index;
        rest = &xml[offset..];
    }
    segments
}

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
                "textIndexStart": text_index_start,
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
            if let Some(group_id) = pptx_group_id_for_offset(&groups, offset) {
                value["groupId"] = json!(group_id);
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

pub(in crate::services::document_editor) fn pptx_slide_images(
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
    pptx_segments_with_offsets(xml, "<p:pic", "</p:pic>")
        .into_iter()
        .enumerate()
        .filter_map(|(index, (offset, picture))| {
            let relationship_id = docx_tag_attr(&picture, "<a:blip", "r:embed")
                .or_else(|| docx_tag_attr(&picture, "<a:blip", "r:link"))?;
            let (_, media_path) = relationships.get(&relationship_id)?;
            let mime_type = image_mime_type_from_path(media_path);
            let data_url = read_zip_bytes(bytes, media_path).ok().map(|bytes| {
                format!(
                    "data:{mime_type};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )
            });
            let (x, y, width, height, rotation) =
                pptx_shape_geometry_for_size(&picture, slide_size);
            let mut value = json!({
                "id": format!("img{}", index + 1),
                "relationshipId": relationship_id,
                "mediaPath": media_path,
                "mimeType": mime_type,
                "dataUrl": data_url,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "imageCropLeft": pptx_picture_crop_percent(&picture, "l"),
                "imageCropTop": pptx_picture_crop_percent(&picture, "t"),
                "imageCropRight": pptx_picture_crop_percent(&picture, "r"),
                "imageCropBottom": pptx_picture_crop_percent(&picture, "b"),
                "altText": pptx_picture_alt_text(&picture)
            });
            if let Some(group_id) = pptx_group_id_for_offset(&groups, offset) {
                value["groupId"] = json!(group_id);
            }
            Some(value)
        })
        .collect()
}

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

pub(in crate::services::document_editor) fn pptx_slide_media(
    bytes: &[u8],
    slide_path: &str,
    xml: &str,
    slide_size: PptxSlideSize,
) -> Vec<Value> {
    let relationships = read_zip_text(bytes, &xlsx_part_rels_path(slide_path))
        .ok()
        .map(|rels| xlsx_relationships_by_id(slide_path, &rels))
        .unwrap_or_default();
    let timing_by_shape = pptx_media_timing_by_shape(xml);
    pptx_picture_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, picture)| {
            let relationship_id = pptx_media_relationship_id(&picture)?;
            let (_, media_path) = relationships.get(&relationship_id)?;
            let shape_id = docx_tag_attr(&picture, "<p:cNvPr", "id");
            let timing = shape_id
                .as_deref()
                .and_then(|id| timing_by_shape.get(id))
                .cloned()
                .unwrap_or_default();
            let (x, y, width, height, rotation) =
                pptx_shape_geometry_for_size(&picture, slide_size);
            Some(json!({
                "id": format!("media{}", index + 1),
                "kind": pptx_media_kind(&picture, media_path),
                "relationshipId": relationship_id,
                "mediaPath": media_path,
                "mimeType": pptx_media_mime_type_from_path(media_path),
                "shapeId": shape_id,
                "name": docx_tag_attr(&picture, "<p:cNvPr", "name"),
                "description": docx_tag_attr(&picture, "<p:cNvPr", "descr"),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "timingIndex": timing.timing_index,
                "volumePercent": timing.volume_percent,
                "muted": timing.muted,
                "showWhenStopped": timing.show_when_stopped,
                "delayMs": timing.delay_ms,
                "durationMs": timing.duration_ms
            }))
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_media_relationship_id(
    picture: &str,
) -> Option<String> {
    docx_tag_attr(picture, "<a:videoFile", "r:link")
        .or_else(|| docx_tag_attr(picture, "<a:videoFile", "r:embed"))
        .or_else(|| docx_tag_attr(picture, "<a:audioFile", "r:link"))
        .or_else(|| docx_tag_attr(picture, "<a:audioFile", "r:embed"))
        .or_else(|| docx_tag_attr(picture, "<p14:media", "r:embed"))
        .or_else(|| docx_tag_attr(picture, "<p14:media", "r:link"))
}

pub(in crate::services::document_editor) fn pptx_media_kind(
    picture: &str,
    media_path: &str,
) -> &'static str {
    if picture.contains("<a:audioFile")
        || pptx_media_mime_type_from_path(media_path).starts_with("audio/")
    {
        "audio"
    } else {
        "video"
    }
}

pub(in crate::services::document_editor) fn pptx_media_mime_type_from_path(
    path: &str,
) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "oga" | "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "wma" => "audio/x-ms-wma",
        "avi" => "video/x-msvideo",
        "m4v" | "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "webm" => "video/webm",
        "wmv" => "video/x-ms-wmv",
        _ => "application/octet-stream",
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct PptxMediaTimingModel {
    pub(super) timing_index: Option<usize>,
    pub(super) volume_percent: Option<f64>,
    pub(super) muted: Option<bool>,
    pub(super) show_when_stopped: Option<bool>,
    pub(super) delay_ms: Option<u32>,
    pub(super) duration_ms: Option<u32>,
}

pub(super) fn pptx_media_timing_by_shape(xml: &str) -> BTreeMap<String, PptxMediaTimingModel> {
    let mut output = BTreeMap::new();
    let Some(timing) = pptx_slide_timing(xml) else {
        return output;
    };
    for (timing_index, node) in xml_segments(&timing, "<p:cMediaNode", "</p:cMediaNode>")
        .into_iter()
        .enumerate()
    {
        let Some(shape_id) = docx_tag_attr(&node, "<p:spTgt", "spid") else {
            continue;
        };
        output.insert(
            shape_id,
            PptxMediaTimingModel {
                timing_index: Some(timing_index),
                volume_percent: docx_tag_attr(&node, "<p:cMediaNode", "vol")
                    .and_then(|value| value.parse::<f64>().ok())
                    .map(|volume| (volume / 1000.0).clamp(0.0, 100.0)),
                muted: docx_tag_attr(&node, "<p:cMediaNode", "mute")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                show_when_stopped: docx_tag_attr(&node, "<p:cMediaNode", "showWhenStopped")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                delay_ms: docx_tag_attr(&node, "<p:cTn", "delay")
                    .and_then(|value| value.parse().ok()),
                duration_ms: docx_tag_attr(&node, "<p:cTn", "dur")
                    .and_then(|value| value.parse().ok()),
            },
        );
    }
    output
}

pub(in crate::services::document_editor) fn pptx_slide_transition(xml: &str) -> Option<Value> {
    let transition = xml_named_segments(xml, "p:transition")
        .into_iter()
        .next()
        .or_else(|| {
            xml_named_empty_elements(xml, "p:transition")
                .into_iter()
                .next()
        })?;
    let kind = pptx_transition_kind(&transition).unwrap_or_else(|| "fade".to_string());
    let speed = docx_tag_attr(&transition, "<p:transition", "spd")
        .filter(|value| matches!(value.as_str(), "fast" | "med" | "slow"));
    let direction = pptx_transition_direction(&transition);
    let advance_on_click = docx_tag_attr(&transition, "<p:transition", "advClick")
        .map(|value| value != "0" && !value.eq_ignore_ascii_case("false"))
        .unwrap_or(true);
    let advance_after_ms = docx_tag_attr(&transition, "<p:transition", "advTm")
        .and_then(|value| value.parse::<u32>().ok());
    Some(json!({
        "type": kind,
        "speed": speed,
        "direction": direction,
        "advanceOnClick": advance_on_click,
        "advanceAfterMs": advance_after_ms
    }))
}

pub(in crate::services::document_editor) fn pptx_slide_timing(xml: &str) -> Option<String> {
    xml_named_segments(xml, "p:timing")
        .into_iter()
        .next()
        .or_else(|| xml_named_empty_elements(xml, "p:timing").into_iter().next())
}

pub(in crate::services::document_editor) fn pptx_slide_animations(xml: &str) -> Vec<Value> {
    let Some(timing) = pptx_slide_timing(xml) else {
        return Vec::new();
    };
    pptx_timing_ctn_segments(&timing)
        .into_iter()
        .enumerate()
        .map(|(index, segment)| {
            let source_xml = segment.clone();
            let mut item = json!({
                "id": attr_value(&segment, "id").unwrap_or_else(|| format!("ctn{}", index + 1)),
                "nodeType": attr_value(&segment, "nodeType"),
                "sourceXml": source_xml
            });
            if let Some(preset_class) = attr_value(&segment, "presetClass") {
                item["presetClass"] = json!(preset_class);
            }
            if let Some(preset_id) = attr_value(&segment, "presetID") {
                item["presetId"] = json!(preset_id);
            }
            if let Some(target_shape_id) = docx_tag_attr(&segment, "<p:spTgt", "spid") {
                item["targetShapeId"] = json!(target_shape_id);
            }
            if let Some(delay_ms) =
                attr_value(&segment, "delay").and_then(|value| value.parse::<u32>().ok())
            {
                item["delayMs"] = json!(delay_ms);
            }
            if let Some(duration_ms) =
                attr_value(&segment, "dur").and_then(|value| value.parse::<u32>().ok())
            {
                item["durationMs"] = json!(duration_ms);
            }
            item
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_timing_ctn_segments(timing: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut rest = timing;
    while let Some(start) = find_xml_tag_start(rest, "p:cTn") {
        let after_start = &rest[start..];
        let Some(open_end) = after_start.find('>') else {
            break;
        };
        if after_start[..=open_end].ends_with("/>") {
            segments.push(after_start[..=open_end].to_string());
            rest = &after_start[open_end + 1..];
            continue;
        }
        let end_marker = "</p:cTn>";
        let Some(close_start) = after_start.find(end_marker) else {
            break;
        };
        let end = close_start + end_marker.len();
        segments.push(after_start[..end].to_string());
        rest = &after_start[end..];
    }
    segments
}

pub(in crate::services::document_editor) fn pptx_transition_kind(
    transition: &str,
) -> Option<String> {
    [
        "fade", "push", "wipe", "split", "cut", "cover", "uncover", "zoom",
    ]
    .into_iter()
    .find_map(|kind| {
        let tag = format!("p:{kind}");
        (find_xml_tag_start(transition, &tag).is_some()
            || !xml_named_empty_elements(transition, &tag).is_empty())
        .then(|| kind.to_string())
    })
}

pub(in crate::services::document_editor) fn pptx_transition_direction(
    transition: &str,
) -> Option<String> {
    [
        "p:push",
        "p:wipe",
        "p:split",
        "p:cover",
        "p:uncover",
        "p:zoom",
    ]
    .into_iter()
    .find_map(|tag| {
        xml_named_empty_elements(transition, tag)
            .into_iter()
            .chain(xml_named_segments(transition, tag))
            .next()
            .and_then(|segment| attr_value(&segment, "dir"))
    })
}

pub(in crate::services::document_editor) fn pptx_picture_segments(xml: &str) -> Vec<String> {
    xml_segments(xml, "<p:pic", "</p:pic>")
}

pub(in crate::services::document_editor) fn pptx_picture_alt_text(picture: &str) -> Option<String> {
    docx_tag_attr(picture, "<p:cNvPr", "descr")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| docx_tag_attr(picture, "<p:cNvPr", "title"))
        .or_else(|| docx_tag_attr(picture, "<p:cNvPr", "name"))
}

pub(in crate::services::document_editor) fn pptx_picture_crop_percent(
    picture: &str,
    attr: &str,
) -> Option<f64> {
    docx_tag_attr(picture, "<a:srcRect", attr)
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / 1_000.0).clamp(0.0, 95.0))
}

pub(in crate::services::document_editor) fn pptx_crop_percent_from_model(
    value: &Value,
    key: &str,
) -> f64 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .clamp(0.0, 95.0)
}

pub(in crate::services::document_editor) fn pptx_managed_basic_shape_kind(
    shape: &str,
) -> Option<PptxShapeKind> {
    if !extract_text_tags(shape, "a:t").join("").trim().is_empty() {
        return None;
    }
    pptx_basic_shape_kind(shape)
}

pub(in crate::services::document_editor) fn pptx_basic_shape_kind(
    shape: &str,
) -> Option<PptxShapeKind> {
    let preset = docx_tag_attr(shape, "<a:prstGeom", "prst")?;
    PptxShapeKind::from_value(&preset)
}

pub(in crate::services::document_editor) fn pptx_shape_geometry_for_size(
    shape: &str,
    slide_size: PptxSlideSize,
) -> (f64, f64, f64, f64, f64) {
    let x = docx_tag_attr(shape, "<a:off", "x")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / slide_size.width_emu) * 100.0)
        .unwrap_or(10.0);
    let y = docx_tag_attr(shape, "<a:off", "y")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / slide_size.height_emu) * 100.0)
        .unwrap_or(12.0);
    let width = docx_tag_attr(shape, "<a:ext", "cx")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / slide_size.width_emu) * 100.0)
        .unwrap_or(80.0);
    let height = docx_tag_attr(shape, "<a:ext", "cy")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / slide_size.height_emu) * 100.0)
        .unwrap_or(10.0);
    let rotation = docx_tag_attr(shape, "<a:xfrm", "rot")
        .or_else(|| docx_tag_attr(shape, "<p:xfrm", "rot"))
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| value / 60_000.0)
        .unwrap_or(0.0);
    (x, y, width, height, rotation)
}

pub(in crate::services::document_editor) fn pptx_run_properties_segment(
    shape: &str,
) -> Option<String> {
    let start = shape.find("<a:rPr")?;
    let after_start = &shape[start..];
    if let Some(end) = after_start.find("</a:rPr>") {
        return Some(after_start[..end + "</a:rPr>".len()].to_string());
    }
    let end = after_start.find("/>")?;
    Some(after_start[..end + 2].to_string())
}

pub(in crate::services::document_editor) fn pptx_run_font_size(run: &str) -> Option<u32> {
    docx_tag_attr(run, "<a:rPr", "sz")
        .and_then(|value| value.parse::<u32>().ok())
        .map(|centipoints| centipoints / 100)
}

pub(in crate::services::document_editor) fn pptx_run_color(run: &str) -> Option<String> {
    docx_tag_attr(run, "<a:srgbClr", "val").and_then(|color| docx_hex_color(&color))
}

pub(in crate::services::document_editor) fn pptx_paragraph_alignment(
    shape: &str,
) -> Option<String> {
    let align = docx_tag_attr(shape, "<a:pPr", "algn")?;
    match align.as_str() {
        "ctr" => Some("center".to_string()),
        "r" => Some("right".to_string()),
        "l" => Some("left".to_string()),
        _ => None,
    }
}

pub(in crate::services::document_editor) fn pptx_shape_fill_color(shape: &str) -> Option<String> {
    let sppr = pptx_sppr_segment(shape)?;
    let search_end = sppr.find("<a:ln").unwrap_or(sppr.len());
    let shape_fill_area = &sppr[..search_end];
    let fill_start = shape_fill_area.find("<a:solidFill")?;
    let after_start = &shape_fill_area[fill_start..];
    let fill = if let Some(end) = after_start.find("</a:solidFill>") {
        &after_start[..end + "</a:solidFill>".len()]
    } else {
        let end = after_start.find("/>")?;
        &after_start[..end + 2]
    };
    docx_tag_attr(fill, "<a:solidFill", "val")
        .or_else(|| docx_tag_attr(fill, "<a:srgbClr", "val"))
        .and_then(|color| docx_hex_color(&color))
}

pub(in crate::services::document_editor) fn pptx_shape_stroke_color(shape: &str) -> Option<String> {
    let line = pptx_line_segment(shape)?;
    docx_tag_attr(&line, "<a:srgbClr", "val").and_then(|color| docx_hex_color(&color))
}

pub(in crate::services::document_editor) fn pptx_shape_stroke_width(shape: &str) -> Option<f64> {
    let line = pptx_line_segment(shape)?;
    docx_tag_attr(&line, "<a:ln", "w")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|emu| (emu / 12_700.0).clamp(0.0, 72.0))
}

pub(in crate::services::document_editor) fn pptx_shape_line_arrow(
    shape: &str,
    edge_tag: &str,
) -> Option<String> {
    let line = pptx_line_segment(shape)?;
    docx_tag_attr(&line, &format!("<a:{edge_tag}"), "type")
        .and_then(|value| PptxLineArrowKind::from_value(&value))
        .map(|kind| kind.as_value().to_string())
}

pub(in crate::services::document_editor) fn pptx_sppr_segment(shape: &str) -> Option<&str> {
    let sppr_start = shape.find("<p:spPr")?;
    let after_start = &shape[sppr_start..];
    let sppr_end = after_start.find("</p:spPr>")?;
    Some(&after_start[..sppr_end + "</p:spPr>".len()])
}

pub(in crate::services::document_editor) fn pptx_line_segment(shape: &str) -> Option<String> {
    let sppr = pptx_sppr_segment(shape)?;
    xml_named_segments(sppr, "a:ln")
        .into_iter()
        .next()
        .or_else(|| xml_named_empty_elements(sppr, "a:ln").into_iter().next())
}

pub(in crate::services::document_editor) fn pptx_slide_background_segment(
    slide: &str,
) -> Option<String> {
    let background_start = slide.find("<p:bg")?;
    let after_start = &slide[background_start..];
    let background_end = after_start.find("</p:bg>")?;
    Some(after_start[..background_end + "</p:bg>".len()].to_string())
}

pub(in crate::services::document_editor) fn pptx_slide_background_color(
    slide: &str,
) -> Option<String> {
    let background = pptx_slide_background_segment(slide)?;
    let fill_start = background.find("<a:solidFill")?;
    let after_start = &background[fill_start..];
    let fill_end = after_start.find("</a:solidFill>")?;
    let fill = &after_start[..fill_end + "</a:solidFill>".len()];
    docx_tag_attr(fill, "<a:srgbClr", "val").and_then(|color| docx_hex_color(&color))
}

pub(in crate::services::document_editor) fn pptx_slide_background_model(
    bytes: &[u8],
    slide_path: &str,
    slide: &str,
) -> serde_json::Map<String, Value> {
    let mut model = serde_json::Map::new();
    if let Some(color) = pptx_slide_background_color(slide) {
        model.insert("backgroundKind".to_string(), json!("solid"));
        model.insert("backgroundColor".to_string(), json!(format!("#{color}")));
        return model;
    }
    if let Some((start_color, end_color, angle)) = pptx_slide_background_gradient(slide) {
        model.insert("backgroundKind".to_string(), json!("gradient"));
        model.insert(
            "backgroundGradientStart".to_string(),
            json!(format!("#{start_color}")),
        );
        model.insert(
            "backgroundGradientEnd".to_string(),
            json!(format!("#{end_color}")),
        );
        model.insert("backgroundGradientAngle".to_string(), json!(angle));
        return model;
    }
    if let Some((relationship_id, media_path, mime_type, data_url)) =
        pptx_slide_background_image(bytes, slide_path, slide)
    {
        model.insert("backgroundKind".to_string(), json!("image"));
        model.insert(
            "backgroundImageRelationshipId".to_string(),
            json!(relationship_id),
        );
        model.insert("backgroundImageMediaPath".to_string(), json!(media_path));
        model.insert("backgroundImageMimeType".to_string(), json!(mime_type));
        if let Some(data_url) = data_url {
            model.insert("backgroundImageDataUrl".to_string(), json!(data_url));
        }
        return model;
    }
    if let Some(source_xml) = pptx_slide_background_segment(slide) {
        model.insert("backgroundKind".to_string(), json!("preserved"));
        model.insert("backgroundSourceXml".to_string(), json!(source_xml));
    }
    model
}

pub(in crate::services::document_editor) fn pptx_slide_background_image(
    bytes: &[u8],
    slide_path: &str,
    slide: &str,
) -> Option<(String, String, String, Option<String>)> {
    let background = pptx_slide_background_segment(slide)?;
    let fill_start = background.find("<a:blipFill")?;
    let after_start = &background[fill_start..];
    let fill_end = after_start.find("</a:blipFill>")?;
    let fill = &after_start[..fill_end + "</a:blipFill>".len()];
    let blip = xml_named_empty_elements(fill, "a:blip")
        .into_iter()
        .next()?;
    let relationship_id = attr_value(&blip, "r:embed").or_else(|| attr_value(&blip, "r:link"))?;
    let relationships = read_zip_text(bytes, &xlsx_part_rels_path(slide_path))
        .ok()
        .map(|rels| xlsx_relationships_by_id(slide_path, &rels))
        .unwrap_or_default();
    let (_, media_path) = relationships.get(&relationship_id)?;
    let mime_type = image_mime_type_from_path(media_path);
    let data_url = read_zip_bytes(bytes, media_path).ok().map(|bytes| {
        format!(
            "data:{mime_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    });
    Some((
        relationship_id,
        media_path.clone(),
        mime_type.to_string(),
        data_url,
    ))
}

pub(in crate::services::document_editor) fn pptx_slide_background_gradient(
    slide: &str,
) -> Option<(String, String, f64)> {
    let background = pptx_slide_background_segment(slide)?;
    let gradient_start = background.find("<a:gradFill")?;
    let after_start = &background[gradient_start..];
    let gradient_end = after_start.find("</a:gradFill>")?;
    let gradient = &after_start[..gradient_end + "</a:gradFill>".len()];
    let stops = xml_named_segments(gradient, "a:gs");
    let first = stops
        .first()
        .and_then(|stop| docx_tag_attr(stop, "<a:srgbClr", "val"))
        .and_then(|color| docx_hex_color(&color))?;
    let last = stops
        .last()
        .and_then(|stop| docx_tag_attr(stop, "<a:srgbClr", "val"))
        .and_then(|color| docx_hex_color(&color))?;
    let angle = docx_tag_attr(gradient, "<a:lin", "ang")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| normalize_degrees(value / 60_000.0))
        .unwrap_or(90.0);
    Some((first, last, angle))
}

pub(in crate::services::document_editor) fn pptx_slide_hidden(slide: &str) -> bool {
    docx_tag_attr(slide, "<p:sld", "show")
        .map(|value| value == "0" || value.eq_ignore_ascii_case("false"))
        .unwrap_or(false)
}
