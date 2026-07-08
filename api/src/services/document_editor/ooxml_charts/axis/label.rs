use super::super::super::{
    append_before_or_end, attr_value, escape_xml, find_xml_start, replace_empty_xml_element,
    replace_xml_element, set_first_xml_tag_attrs, xml_named_empty_elements, xml_named_segments,
};
use super::{ooxml_chart_axis, ooxml_first_srgb_color, ooxml_segment_or_empty};

pub(in crate::services::document_editor) fn ooxml_chart_axis_label_text_color(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
    let run_properties = ooxml_chart_axis_label_run_properties(chart_xml, axis_tag)?;
    ooxml_first_srgb_color(&run_properties)
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_label_rotation(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<f64> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let text_properties = ooxml_segment_or_empty(&axis, "c:txPr")?;
    let body_properties = ooxml_segment_or_empty(&text_properties, "a:bodyPr")?;
    attr_value(&body_properties, "rot")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / 60_000.0).clamp(-90.0, 90.0))
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_label_font_size(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<u32> {
    let run_properties = ooxml_chart_axis_label_run_properties(chart_xml, axis_tag)?;
    attr_value(&run_properties, "sz")
        .and_then(|value| value.parse::<u32>().ok())
        .map(|centipoints| centipoints / 100)
        .filter(|points| *points > 0)
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_label_bold(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<bool> {
    ooxml_chart_axis_label_bool_attr(chart_xml, axis_tag, "b")
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_label_italic(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<bool> {
    ooxml_chart_axis_label_bool_attr(chart_xml, axis_tag, "i")
}

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_label_rotation(
    xml: &str,
    axis_tag: &str,
    rotation: f64,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_label_rotation(&axis, axis_tag, rotation);
    xml.replacen(&axis, &updated_axis, 1)
}

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_label_style(
    xml: &str,
    axis_tag: &str,
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis =
        update_ooxml_axis_label_style(&axis, axis_tag, text_color, font_size, bold, italic);
    xml.replacen(&axis, &updated_axis, 1)
}

fn ooxml_chart_axis_label_run_properties(chart_xml: &str, axis_tag: &str) -> Option<String> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let text_properties = ooxml_segment_or_empty(&axis, "c:txPr")?;
    ooxml_segment_or_empty(&text_properties, "a:defRPr")
}

fn ooxml_chart_axis_label_bool_attr(chart_xml: &str, axis_tag: &str, attr: &str) -> Option<bool> {
    let run_properties = ooxml_chart_axis_label_run_properties(chart_xml, axis_tag)?;
    attr_value(&run_properties, attr)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

fn update_ooxml_axis_label_rotation(axis: &str, axis_tag: &str, rotation: f64) -> String {
    let rotation = (rotation.clamp(-90.0, 90.0) * 60_000.0).round() as i64;
    if let Some(text_properties) = xml_named_empty_elements(axis, "c:txPr").into_iter().next() {
        let replacement =
            format!(r#"<c:txPr><a:bodyPr rot="{rotation}"/><a:lstStyle/><a:p/></c:txPr>"#);
        return axis.replacen(&text_properties, &replacement, 1);
    }
    if let Some(text_properties) = xml_named_segments(axis, "c:txPr").into_iter().next() {
        let updated_text_properties =
            update_ooxml_axis_text_properties_rotation(&text_properties, rotation);
        return axis.replacen(&text_properties, &updated_text_properties, 1);
    }
    let text_properties =
        format!(r#"<c:txPr><a:bodyPr rot="{rotation}"/><a:lstStyle/><a:p/></c:txPr>"#);
    insert_ooxml_axis_late_child(axis, axis_tag, &text_properties)
}

fn update_ooxml_axis_text_properties_rotation(text_properties: &str, rotation: i64) -> String {
    if let Some(body_properties) = xml_named_empty_elements(text_properties, "a:bodyPr")
        .into_iter()
        .next()
    {
        let updated_body_properties = set_first_xml_tag_attrs(
            &body_properties,
            "<a:bodyPr",
            &[("rot", rotation.to_string())],
        );
        return text_properties.replacen(&body_properties, &updated_body_properties, 1);
    }
    if let Some(body_properties) = xml_named_segments(text_properties, "a:bodyPr")
        .into_iter()
        .next()
    {
        let updated_body_properties = set_first_xml_tag_attrs(
            &body_properties,
            "<a:bodyPr",
            &[("rot", rotation.to_string())],
        );
        return text_properties.replacen(&body_properties, &updated_body_properties, 1);
    }
    insert_after_start_tag(
        text_properties,
        "<c:txPr",
        &format!(r#"<a:bodyPr rot="{rotation}"/>"#),
    )
}

fn update_ooxml_axis_label_style(
    axis: &str,
    axis_tag: &str,
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    if let Some(text_properties) = xml_named_empty_elements(axis, "c:txPr").into_iter().next() {
        let run_properties =
            build_ooxml_chart_axis_label_run_properties(text_color, font_size, bold, italic);
        let replacement = build_ooxml_chart_axis_text_properties(&run_properties);
        return axis.replacen(&text_properties, &replacement, 1);
    }
    if let Some(text_properties) = xml_named_segments(axis, "c:txPr").into_iter().next() {
        let updated_text_properties = update_ooxml_chart_axis_text_properties(
            &text_properties,
            text_color,
            font_size,
            bold,
            italic,
        );
        return axis.replacen(&text_properties, &updated_text_properties, 1);
    }
    let run_properties =
        build_ooxml_chart_axis_label_run_properties(text_color, font_size, bold, italic);
    let text_properties = build_ooxml_chart_axis_text_properties(&run_properties);
    insert_ooxml_axis_late_child(axis, axis_tag, &text_properties)
}

fn update_ooxml_chart_axis_text_properties(
    text_properties: &str,
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    if let Some(existing) = xml_named_empty_elements(text_properties, "a:defRPr")
        .into_iter()
        .next()
    {
        let updated_run_properties = update_ooxml_chart_axis_label_run_properties(
            &existing, text_color, font_size, bold, italic,
        );
        return text_properties.replacen(&existing, &updated_run_properties, 1);
    }
    if let Some(existing) = xml_named_segments(text_properties, "a:defRPr")
        .into_iter()
        .next()
    {
        let updated_run_properties = update_ooxml_chart_axis_label_run_properties(
            &existing, text_color, font_size, bold, italic,
        );
        return text_properties.replacen(&existing, &updated_run_properties, 1);
    }
    let run_properties =
        build_ooxml_chart_axis_label_run_properties(text_color, font_size, bold, italic);
    if let Some(paragraph_properties) = xml_named_empty_elements(text_properties, "a:pPr")
        .into_iter()
        .next()
    {
        let replacement = format!("<a:pPr>{run_properties}</a:pPr>");
        return text_properties.replacen(&paragraph_properties, &replacement, 1);
    }
    if let Some(paragraph_properties) = xml_named_segments(text_properties, "a:pPr")
        .into_iter()
        .next()
    {
        let updated_paragraph_properties =
            append_before_or_end(&paragraph_properties, "</a:pPr>", &run_properties);
        return text_properties.replacen(&paragraph_properties, &updated_paragraph_properties, 1);
    }
    if let Some(paragraph) = xml_named_segments(text_properties, "a:p")
        .into_iter()
        .next()
    {
        let replacement = insert_after_start_tag(
            &paragraph,
            "<a:p",
            &format!("<a:pPr>{run_properties}</a:pPr>"),
        );
        return text_properties.replacen(&paragraph, &replacement, 1);
    }
    append_before_or_end(
        text_properties,
        "</c:txPr>",
        &format!("<a:p><a:pPr>{run_properties}</a:pPr></a:p>"),
    )
}

fn build_ooxml_chart_axis_text_properties(run_properties: &str) -> String {
    format!("<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>{run_properties}</a:pPr></a:p></c:txPr>")
}

fn build_ooxml_chart_axis_label_run_properties(
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    update_ooxml_chart_axis_label_run_properties("<a:defRPr/>", text_color, font_size, bold, italic)
}

fn update_ooxml_chart_axis_label_run_properties(
    run_properties: &str,
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    let mut updated = expand_ooxml_empty_def_rpr(run_properties);
    let mut attrs = Vec::new();
    if let Some(font_size) = font_size {
        attrs.push(("sz", (font_size * 100).to_string()));
    }
    if let Some(bold) = bold {
        attrs.push(("b", if bold { "1" } else { "0" }.to_string()));
    }
    if let Some(italic) = italic {
        attrs.push(("i", if italic { "1" } else { "0" }.to_string()));
    }
    if !attrs.is_empty() {
        updated = set_first_xml_tag_attrs(&updated, "<a:defRPr", &attrs);
    }
    if let Some(text_color) = text_color {
        let fill_xml = format!(
            r#"<a:solidFill><a:srgbClr val="{}"/></a:solidFill>"#,
            escape_xml(text_color)
        );
        updated = replace_ooxml_run_properties_fill(&updated, &fill_xml);
    }
    updated
}

fn expand_ooxml_empty_def_rpr(run_properties: &str) -> String {
    if !run_properties.trim_end().ends_with("/>") {
        return run_properties.to_string();
    }
    let trimmed = run_properties.trim_end();
    let prefix_len = trimmed.len().saturating_sub(2);
    let mut output = String::new();
    output.push_str(&trimmed[..prefix_len]);
    output.push('>');
    output.push_str("</a:defRPr>");
    output
}

fn replace_ooxml_run_properties_fill(run_properties: &str, fill_xml: &str) -> String {
    if run_properties.trim_end().ends_with("/>") {
        let trimmed = run_properties.trim_end();
        let prefix_len = trimmed.len().saturating_sub(2);
        let mut output = String::new();
        output.push_str(&trimmed[..prefix_len]);
        output.push('>');
        output.push_str(fill_xml);
        output.push_str("</a:defRPr>");
        return output;
    }
    if let Some(updated) = replace_xml_element(run_properties, "a:solidFill", fill_xml) {
        return updated;
    }
    let updated = replace_empty_xml_element(run_properties, "<a:solidFill", fill_xml);
    if updated == run_properties {
        append_before_or_end(run_properties, "</a:defRPr>", fill_xml)
    } else {
        updated
    }
}

fn insert_ooxml_axis_late_child(axis: &str, axis_tag: &str, child_xml: &str) -> String {
    for tag in ["c:crossAx", "c:crosses", "c:crossesAt"] {
        let marker = format!("<{tag}");
        if let Some(index) = find_xml_start(axis, &marker) {
            let mut output = String::new();
            output.push_str(&axis[..index]);
            output.push_str(child_xml);
            output.push_str(&axis[index..]);
            return output;
        }
    }
    append_before_or_end(axis, &format!("</{axis_tag}>"), child_xml)
}

fn insert_after_start_tag(xml: &str, marker: &str, insertion: &str) -> String {
    let Some(start) = find_xml_start(xml, marker) else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find('>') else {
        return xml.to_string();
    };
    let insert_at = start + end + 1;
    let mut output = String::new();
    output.push_str(&xml[..insert_at]);
    output.push_str(insertion);
    output.push_str(&xml[insert_at..]);
    output
}
