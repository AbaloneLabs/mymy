use super::*;

pub(in crate::services::document_editor) fn pptx_media_specs(slide: &Value) -> Vec<PptxMediaSpec> {
    slide
        .get("media")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|media| PptxMediaSpec {
            timing_index: value_as_usize(media.get("timingIndex")),
            volume_percent: media
                .get("volumePercent")
                .and_then(Value::as_f64)
                .map(|value| value.clamp(0.0, 100.0)),
            muted: media.get("muted").and_then(Value::as_bool),
            show_when_stopped: media.get("showWhenStopped").and_then(Value::as_bool),
            delay_ms: media
                .get("delayMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
            duration_ms: media
                .get("durationMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_background_spec(
    slide: &Value,
    background_image: Option<&PptxImageSpec>,
) -> Option<PptxBackgroundSpec> {
    let kind = slide
        .get("backgroundKind")
        .and_then(Value::as_str)
        .unwrap_or("solid");
    if kind == "gradient" {
        let start_color = slide
            .get("backgroundGradientStart")
            .and_then(Value::as_str)
            .and_then(docx_hex_color)?;
        let end_color = slide
            .get("backgroundGradientEnd")
            .and_then(Value::as_str)
            .and_then(docx_hex_color)?;
        let angle = normalize_degrees(
            slide
                .get("backgroundGradientAngle")
                .and_then(Value::as_f64)
                .unwrap_or(90.0),
        );
        return Some(PptxBackgroundSpec::Gradient {
            start_color,
            end_color,
            angle,
        });
    }
    if kind == "solid" {
        return slide
            .get("backgroundColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color)
            .map(PptxBackgroundSpec::Solid);
    }
    if kind == "image" {
        return background_image
            .and_then(|image| image.relationship_id.as_deref())
            .filter(|relationship_id| !relationship_id.trim().is_empty())
            .map(|relationship_id| PptxBackgroundSpec::Image {
                relationship_id: relationship_id.to_string(),
            });
    }
    None
}

pub(in crate::services::document_editor) fn pptx_transition_spec(
    slide: &Value,
) -> Option<PptxTransitionSpec> {
    let transition = slide.get("transition")?;
    Some(PptxTransitionSpec {
        kind: transition
            .get("type")
            .and_then(Value::as_str)
            .filter(|value| valid_pptx_transition_kind(value))
            .unwrap_or("none")
            .to_string(),
        speed: transition
            .get("speed")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "fast" | "med" | "slow"))
            .map(str::to_string),
        direction: transition
            .get("direction")
            .and_then(Value::as_str)
            .filter(|value| valid_pptx_transition_direction(value))
            .map(str::to_string),
        advance_on_click: transition
            .get("advanceOnClick")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        advance_after_ms: transition
            .get("advanceAfterMs")
            .and_then(Value::as_u64)
            .map(|value| value.min(600_000) as u32),
    })
}

pub(in crate::services::document_editor) fn pptx_animation_specs(
    slide: &Value,
) -> Vec<PptxAnimationSpec> {
    slide
        .get("animations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|animation| PptxAnimationSpec {
            id: pptx_animation_token(animation.get("id")),
            node_type: pptx_animation_token(animation.get("nodeType")),
            preset_class: pptx_animation_token(animation.get("presetClass")),
            preset_id: pptx_animation_token(animation.get("presetId")),
            target_shape_id: pptx_animation_token(animation.get("targetShapeId")),
            source_xml: animation
                .get("sourceXml")
                .and_then(Value::as_str)
                .filter(|source| source.starts_with("<p:cTn"))
                .map(str::to_string),
            delay_ms: animation
                .get("delayMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
            duration_ms: animation
                .get("durationMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
        })
        .collect()
}

fn pptx_animation_token(value: Option<&Value>) -> Option<String> {
    let value = value?.as_str()?.trim();
    (!value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.')))
    .then(|| value.to_string())
}

pub(in crate::services::document_editor) fn valid_pptx_transition_kind(value: &str) -> bool {
    matches!(
        value,
        "none" | "fade" | "push" | "wipe" | "split" | "cut" | "cover" | "uncover" | "zoom"
    )
}

pub(in crate::services::document_editor) fn valid_pptx_transition_direction(value: &str) -> bool {
    matches!(
        value,
        "l" | "r" | "u" | "d" | "lu" | "ru" | "ld" | "rd" | "in" | "out" | "horz" | "vert"
    )
}
