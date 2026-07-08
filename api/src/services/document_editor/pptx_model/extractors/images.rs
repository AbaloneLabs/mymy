use super::*;

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
