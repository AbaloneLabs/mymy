use super::*;

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
