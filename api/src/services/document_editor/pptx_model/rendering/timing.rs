use super::*;

pub(in crate::services::document_editor) fn update_pptx_transition(
    xml: &str,
    spec: Option<&PptxTransitionSpec>,
) -> String {
    let Some(spec) = spec else {
        return xml.to_string();
    };
    let stripped = remove_pptx_transition(xml);
    if spec.kind == "none" {
        return stripped;
    }
    let transition = build_pptx_transition(spec);
    if let Some(index) = stripped.find("<p:timing") {
        let mut output = String::new();
        output.push_str(&stripped[..index]);
        output.push_str(&transition);
        output.push_str(&stripped[index..]);
        return output;
    }
    if let Some(index) = stripped.find("</p:cSld>") {
        let insert_at = index + "</p:cSld>".len();
        let mut output = String::new();
        output.push_str(&stripped[..insert_at]);
        output.push_str(&transition);
        output.push_str(&stripped[insert_at..]);
        return output;
    }
    append_before_or_end(&stripped, "</p:sld>", &transition)
}

pub(in crate::services::document_editor) fn update_pptx_animations(
    xml: &str,
    specs: &[PptxAnimationSpec],
    timing_source_xml: Option<&str>,
    model_controls_slide: bool,
) -> String {
    if !model_controls_slide {
        return xml.to_string();
    }
    let timing = timing_source_xml
        .filter(|source| source.starts_with("<p:timing"))
        .map(str::to_string)
        .or_else(|| pptx_slide_timing(xml));
    let Some(timing) = timing else {
        if specs.is_empty() {
            return xml.to_string();
        }
        let timing = build_pptx_timing(specs);
        return append_before_or_end(xml, "</p:sld>", &timing);
    };
    let timing = update_pptx_timing_ctn_attrs(&timing, specs);
    if let Some(replaced) = replace_xml_element(xml, "p:timing", &timing) {
        return replaced;
    }
    if xml.contains("<p:timing") {
        return replace_empty_xml_element(xml, "<p:timing", &timing);
    }
    append_before_or_end(xml, "</p:sld>", &timing)
}

pub(in crate::services::document_editor) fn update_pptx_media_timing(
    xml: &str,
    specs: &[PptxMediaSpec],
    model_controls_slide: bool,
) -> String {
    if !model_controls_slide || specs.is_empty() {
        return xml.to_string();
    }
    let Some(timing) = pptx_slide_timing(xml) else {
        return xml.to_string();
    };
    let timing = update_pptx_media_timing_nodes(&timing, specs);
    if let Some(replaced) = replace_xml_element(xml, "p:timing", &timing) {
        return replaced;
    }
    if xml.contains("<p:timing") {
        return replace_empty_xml_element(xml, "<p:timing", &timing);
    }
    append_before_or_end(xml, "</p:sld>", &timing)
}

pub(in crate::services::document_editor) fn update_pptx_media_timing_nodes(
    timing: &str,
    specs: &[PptxMediaSpec],
) -> String {
    let mut output = String::new();
    let mut rest = timing;
    let mut timing_index = 0usize;
    while let Some(start) = find_xml_start(rest, "<p:cMediaNode") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:cMediaNode>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:cMediaNode>".len();
        let node = &after_start[..end_index];
        let updated = specs
            .iter()
            .find(|spec| spec.timing_index == Some(timing_index))
            .map(|spec| update_pptx_media_timing_node(node, spec))
            .unwrap_or_else(|| node.to_string());
        output.push_str(&updated);
        rest = &after_start[end_index..];
        timing_index += 1;
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn update_pptx_media_timing_node(
    node: &str,
    spec: &PptxMediaSpec,
) -> String {
    let mut output = node.to_string();
    let mut attrs = Vec::new();
    if let Some(volume_percent) = spec.volume_percent {
        attrs.push((
            "vol",
            ((volume_percent.clamp(0.0, 100.0) * 1000.0).round() as u32).to_string(),
        ));
    }
    if let Some(muted) = spec.muted {
        attrs.push(("mute", pptx_bool_attr_value(muted).to_string()));
    }
    if let Some(show_when_stopped) = spec.show_when_stopped {
        attrs.push((
            "showWhenStopped",
            pptx_bool_attr_value(show_when_stopped).to_string(),
        ));
    }
    if !attrs.is_empty() {
        output = set_first_xml_tag_attrs(&output, "<p:cMediaNode", &attrs);
    }
    let mut timing_attrs = Vec::new();
    if let Some(delay_ms) = spec.delay_ms {
        timing_attrs.push(("delay", delay_ms.to_string()));
    }
    if let Some(duration_ms) = spec.duration_ms {
        timing_attrs.push(("dur", duration_ms.to_string()));
    }
    if !timing_attrs.is_empty() {
        output = set_first_xml_tag_attrs(&output, "<p:cTn", &timing_attrs);
    }
    output
}

pub(in crate::services::document_editor) fn update_pptx_timing_ctn_attrs(
    timing: &str,
    specs: &[PptxAnimationSpec],
) -> String {
    if specs.is_empty() {
        return remove_xml_named_elements(timing, "p:cTn");
    }
    let mut output = String::new();
    let mut rest = timing;
    let mut index = 0usize;
    while let Some(start) = find_xml_tag_start(rest, "p:cTn") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(open_end) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let (segment, next_rest) = if after_start[..=open_end].ends_with("/>") {
            (&after_start[..=open_end], &after_start[open_end + 1..])
        } else {
            let end_marker = "</p:cTn>";
            let Some(close_start) = after_start.find(end_marker) else {
                output.push_str(after_start);
                return output;
            };
            let end = close_start + end_marker.len();
            (&after_start[..end], &after_start[end..])
        };
        let updated_segment = if let Some(spec) = specs.get(index) {
            update_pptx_animation_segment(segment, spec, index + 1)
        } else {
            String::new()
        };
        output.push_str(&updated_segment);
        rest = next_rest;
        index += 1;
    }
    output.push_str(rest);
    if specs.len() > index {
        let inserted = specs[index..]
            .iter()
            .enumerate()
            .map(|(offset, spec)| update_pptx_animation_segment("", spec, index + offset + 1))
            .collect::<Vec<_>>()
            .join("");
        if output.contains("</p:tnLst>") {
            return append_before_or_end(&output, "</p:tnLst>", &inserted);
        }
        return append_before_or_end(&output, "</p:timing>", &inserted);
    }
    output
}

pub(in crate::services::document_editor) fn update_pptx_animation_segment(
    segment: &str,
    spec: &PptxAnimationSpec,
    fallback_id: usize,
) -> String {
    let source = spec
        .source_xml
        .as_deref()
        .filter(|source| !source.trim().is_empty())
        .unwrap_or(segment);
    if source.is_empty() {
        return build_pptx_animation_segment(spec, fallback_id);
    }
    let Some(open_end) = source.find('>') else {
        return source.to_string();
    };
    let original_tag = &source[..=open_end];
    let mut updated_tag = original_tag.to_string();
    if let Some(delay_ms) = spec.delay_ms {
        updated_tag = set_xml_attr(&updated_tag, "delay", &delay_ms.to_string());
    }
    if let Some(duration_ms) = spec.duration_ms {
        updated_tag = set_xml_attr(&updated_tag, "dur", &duration_ms.to_string());
    }
    let mut output = String::new();
    output.push_str(&updated_tag);
    output.push_str(&source[open_end + 1..]);
    output
}

pub(in crate::services::document_editor) fn build_pptx_timing(
    specs: &[PptxAnimationSpec],
) -> String {
    let segments = specs
        .iter()
        .enumerate()
        .map(|(index, spec)| build_pptx_animation_segment(spec, index + 1))
        .collect::<Vec<_>>()
        .join("");
    format!("<p:timing><p:tnLst>{segments}</p:tnLst></p:timing>")
}

pub(in crate::services::document_editor) fn build_pptx_animation_segment(
    spec: &PptxAnimationSpec,
    fallback_id: usize,
) -> String {
    let id = spec
        .id
        .as_deref()
        .filter(|value| value.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or_else(|| if fallback_id == 0 { "1" } else { "" });
    let fallback_id_string;
    let id = if id.is_empty() {
        fallback_id_string = fallback_id.max(1).to_string();
        fallback_id_string.as_str()
    } else {
        id
    };
    let node_type = spec
        .node_type
        .as_deref()
        .filter(|value| valid_pptx_animation_token(value))
        .unwrap_or("clickEffect");
    let mut attrs = vec![
        format!(r#"id="{}""#, escape_xml(id)),
        format!(r#"nodeType="{}""#, escape_xml(node_type)),
    ];
    if let Some(preset_class) = spec
        .preset_class
        .as_deref()
        .filter(|value| valid_pptx_animation_token(value))
    {
        attrs.push(format!(r#"presetClass="{}""#, escape_xml(preset_class)));
    }
    if let Some(preset_id) = spec
        .preset_id
        .as_deref()
        .filter(|value| valid_pptx_animation_token(value))
    {
        attrs.push(format!(r#"presetID="{}""#, escape_xml(preset_id)));
    }
    attrs.push(format!(r#"delay="{}""#, spec.delay_ms.unwrap_or(0)));
    attrs.push(format!(r#"dur="{}""#, spec.duration_ms.unwrap_or(500)));
    let attrs = attrs.join(" ");
    let target = spec
        .target_shape_id
        .as_deref()
        .filter(|value| value.chars().all(|ch| ch.is_ascii_digit()))
        .map(|shape_id| {
            format!(
                r#"<p:tgtEl><p:spTgt spid="{}"/></p:tgtEl>"#,
                escape_xml(shape_id)
            )
        });
    if let Some(target) = target {
        format!("<p:cTn {attrs}>{target}</p:cTn>")
    } else {
        format!("<p:cTn {attrs}/>")
    }
}

fn valid_pptx_animation_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
}

pub(in crate::services::document_editor) fn remove_pptx_transition(xml: &str) -> String {
    let removed_segments = remove_xml_named_elements(xml, "p:transition");
    replace_empty_xml_element(&removed_segments, "<p:transition", "")
}

pub(in crate::services::document_editor) fn build_pptx_transition(
    spec: &PptxTransitionSpec,
) -> String {
    let mut attrs = Vec::new();
    if let Some(speed) = spec.speed.as_deref() {
        attrs.push(format!(r#"spd="{}""#, escape_xml(speed)));
    }
    if !spec.advance_on_click {
        attrs.push(r#"advClick="0""#.to_string());
    }
    if let Some(advance_after_ms) = spec.advance_after_ms {
        attrs.push(format!(r#"advTm="{advance_after_ms}""#));
    }
    let attrs = if attrs.is_empty() {
        String::new()
    } else {
        format!(" {}", attrs.join(" "))
    };
    let child = build_pptx_transition_child(spec);
    format!(r#"<p:transition{attrs}>{child}</p:transition>"#)
}

pub(in crate::services::document_editor) fn build_pptx_transition_child(
    spec: &PptxTransitionSpec,
) -> String {
    let direction = spec
        .direction
        .as_deref()
        .filter(|direction| valid_pptx_transition_direction(direction))
        .map(|direction| format!(r#" dir="{}""#, escape_xml(direction)))
        .unwrap_or_default();
    match spec.kind.as_str() {
        "push" | "wipe" | "split" | "cover" | "uncover" | "zoom" => {
            format!(r#"<p:{}{direction}/>"#, spec.kind)
        }
        "cut" => "<p:cut/>".to_string(),
        _ => "<p:fade/>".to_string(),
    }
}
