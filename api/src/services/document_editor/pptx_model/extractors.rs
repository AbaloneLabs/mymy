use super::*;

mod background;
mod charts;
mod images;
mod media;
mod tables;

pub(in crate::services::document_editor) use background::*;
pub(in crate::services::document_editor) use charts::*;
pub(in crate::services::document_editor) use images::*;
pub(in crate::services::document_editor) use media::*;
pub(in crate::services::document_editor) use tables::*;

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
