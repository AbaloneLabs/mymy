use super::*;

pub(in crate::services::document_editor) fn pptx_shape_specs(slide: &Value) -> Vec<PptxShapeSpec> {
    slide
        .get("shapes")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let kind = item
                        .get("kind")
                        .and_then(Value::as_str)
                        .and_then(PptxShapeKind::from_value)?;
                    let default_height = if kind.is_line_like() { 0.0 } else { 20.0 };
                    let min_height = if kind.is_line_like() { 0.0 } else { 1.0 };
                    Some(PptxShapeSpec {
                        shape_id: pptx_shape_id_from_model(item),
                        group_shape_id: pptx_group_shape_id_from_model(item),
                        kind,
                        group_id: pptx_group_id_from_model(item),
                        x: item
                            .get("x")
                            .and_then(Value::as_f64)
                            .unwrap_or(24.0)
                            .clamp(0.0, 100.0),
                        y: item
                            .get("y")
                            .and_then(Value::as_f64)
                            .unwrap_or(34.0)
                            .clamp(0.0, 100.0),
                        width: item
                            .get("width")
                            .and_then(Value::as_f64)
                            .unwrap_or(26.0)
                            .clamp(1.0, 100.0),
                        height: item
                            .get("height")
                            .and_then(Value::as_f64)
                            .unwrap_or(default_height)
                            .clamp(min_height, 100.0),
                        rotation: normalize_degrees(
                            item.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
                        ),
                        fill_color: item
                            .get("fillColor")
                            .and_then(Value::as_str)
                            .and_then(docx_hex_color),
                        stroke_color: item
                            .get("strokeColor")
                            .and_then(Value::as_str)
                            .and_then(docx_hex_color),
                        stroke_width: item
                            .get("strokeWidth")
                            .and_then(Value::as_f64)
                            .unwrap_or(2.0)
                            .clamp(0.0, 72.0),
                        line_start_arrow: pptx_line_arrow_from_model(item, "lineStartArrow"),
                        line_end_arrow: pptx_line_arrow_from_model(item, "lineEndArrow"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub(in crate::services::document_editor) fn pptx_line_arrow_from_model(
    value: &Value,
    key: &str,
) -> Option<PptxLineArrowKind> {
    value
        .get(key)
        .and_then(Value::as_str)
        .and_then(PptxLineArrowKind::from_value)
}
