use super::*;

pub(in crate::services::document_editor) fn pptx_text_specs(slide: &Value) -> Vec<PptxTextSpec> {
    slide
        .get("texts")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, item)| PptxTextSpec {
                    shape_id: pptx_shape_id_from_model(item),
                    group_shape_id: pptx_group_shape_id_from_model(item),
                    text: item
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    text_index: value_as_usize(item.get("textIndex")),
                    text_segment_count: value_as_usize(item.get("textSegmentCount"))
                        .unwrap_or(1)
                        .max(1),
                    complex_text: item
                        .get("complexText")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    group_id: pptx_group_id_from_model(item),
                    x: item
                        .get("x")
                        .and_then(Value::as_f64)
                        .unwrap_or(10.0)
                        .clamp(0.0, 100.0),
                    y: item
                        .get("y")
                        .and_then(Value::as_f64)
                        .unwrap_or(12.0 + index as f64 * 18.0)
                        .clamp(0.0, 100.0),
                    width: item
                        .get("width")
                        .and_then(Value::as_f64)
                        .unwrap_or(80.0)
                        .clamp(1.0, 100.0),
                    height: item
                        .get("height")
                        .and_then(Value::as_f64)
                        .unwrap_or(10.0)
                        .clamp(1.0, 100.0),
                    rotation: normalize_degrees(
                        item.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
                    ),
                    font_size: item
                        .get("fontSize")
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse::<u32>().ok())
                        .unwrap_or(18)
                        .clamp(6, 96),
                    font_family: item
                        .get("fontFamily")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    color: item
                        .get("color")
                        .and_then(Value::as_str)
                        .and_then(docx_hex_color),
                    fill_color: item
                        .get("fillColor")
                        .and_then(Value::as_str)
                        .and_then(docx_hex_color),
                    bold: item.get("bold").and_then(Value::as_bool).unwrap_or(false),
                    italic: item.get("italic").and_then(Value::as_bool).unwrap_or(false),
                    underline: item
                        .get("underline")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    strikethrough: item
                        .get("strikethrough")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    align: item
                        .get("align")
                        .and_then(Value::as_str)
                        .and_then(pptx_alignment_value)
                        .map(str::to_string),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub(in crate::services::document_editor) fn apply_pptx_text_replacements(
    texts: &mut [String],
    specs: &[PptxTextSpec],
) -> AppResult<()> {
    let mut fallback_index = 0usize;
    for spec in specs {
        let text_index = spec.text_index.unwrap_or_else(|| {
            let current = fallback_index;
            fallback_index += 1;
            current
        });
        let segment_end = text_index
            .saturating_add(spec.text_segment_count)
            .min(texts.len());
        let current_text = texts
            .get(text_index..segment_end)
            .unwrap_or_default()
            .join("");
        if spec.complex_text {
            if current_text != spec.text {
                return Err(AppError::BadRequest(
                    "Rich PPTX text must be edited with a run-aware model".into(),
                ));
            }
            continue;
        }
        if let Some(slot) = texts.get_mut(text_index) {
            *slot = spec.text.clone();
        }
    }
    Ok(())
}
