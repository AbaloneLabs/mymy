use super::*;

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
