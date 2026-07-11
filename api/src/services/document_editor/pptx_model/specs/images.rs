use super::*;

pub(in crate::services::document_editor) fn pptx_image_specs(slide: &Value) -> Vec<PptxImageSpec> {
    slide
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|image| PptxImageSpec {
            shape_id: pptx_shape_id_from_model(image),
            group_shape_id: pptx_group_shape_id_from_model(image),
            relationship_id: image
                .get("relationshipId")
                .and_then(Value::as_str)
                .map(str::to_string),
            data_url: image
                .get("dataUrl")
                .and_then(Value::as_str)
                .map(str::to_string),
            group_id: pptx_group_id_from_model(image),
            x: image
                .get("x")
                .and_then(Value::as_f64)
                .unwrap_or(10.0)
                .clamp(0.0, 100.0),
            y: image
                .get("y")
                .and_then(Value::as_f64)
                .unwrap_or(12.0)
                .clamp(0.0, 100.0),
            width: image
                .get("width")
                .and_then(Value::as_f64)
                .unwrap_or(30.0)
                .clamp(1.0, 100.0),
            height: image
                .get("height")
                .and_then(Value::as_f64)
                .unwrap_or(30.0)
                .clamp(1.0, 100.0),
            rotation: normalize_degrees(
                image.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
            ),
            crop_left: pptx_crop_percent_from_model(image, "imageCropLeft"),
            crop_top: pptx_crop_percent_from_model(image, "imageCropTop"),
            crop_right: pptx_crop_percent_from_model(image, "imageCropRight"),
            crop_bottom: pptx_crop_percent_from_model(image, "imageCropBottom"),
            alt_text: image
                .get("altText")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_background_image_specs(
    slide: &Value,
) -> Vec<PptxImageSpec> {
    if slide.get("backgroundKind").and_then(Value::as_str) != Some("image") {
        return Vec::new();
    }
    vec![PptxImageSpec {
        shape_id: None,
        group_shape_id: None,
        relationship_id: slide
            .get("backgroundImageRelationshipId")
            .and_then(Value::as_str)
            .map(str::to_string),
        data_url: slide
            .get("backgroundImageDataUrl")
            .and_then(Value::as_str)
            .map(str::to_string),
        group_id: None,
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 100.0,
        rotation: 0.0,
        crop_left: 0.0,
        crop_top: 0.0,
        crop_right: 0.0,
        crop_bottom: 0.0,
        alt_text: None,
    }]
}
