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
        return xml.to_string();
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
        return timing.to_string();
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
            update_pptx_animation_segment(segment, spec)
        } else {
            segment.to_string()
        };
        output.push_str(&updated_segment);
        rest = next_rest;
        index += 1;
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn update_pptx_animation_segment(
    segment: &str,
    spec: &PptxAnimationSpec,
) -> String {
    let source = spec.source_xml.as_deref().unwrap_or(segment);
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
