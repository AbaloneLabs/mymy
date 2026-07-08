use serde_json::{json, Value};

use super::{
    attr_value, docx_tag_attr, escape_xml, extract_text_tags, find_xml_start, replace_tag_texts,
    set_xml_attr, xml_named_empty_elements, xml_named_segments,
};

/// DOCX content controls wrap user-editable form-like regions inside regular
/// paragraphs. The editor exposes their identity and common state while keeping
/// the containing `w:sdt` XML intact, because content controls often carry
/// application-specific metadata that must survive a round trip even when mymy
/// only understands part of the control.
pub(super) fn docx_paragraph_content_controls(paragraph: &str) -> Vec<Value> {
    xml_named_segments(paragraph, "w:sdt")
        .into_iter()
        .enumerate()
        .map(|(index, segment)| docx_content_control_model(&segment, index))
        .collect()
}

pub(super) fn replace_docx_content_control_states(paragraph: &str, block: &Value) -> String {
    let Some(controls) = block.get("contentControls").and_then(Value::as_array) else {
        return paragraph.to_string();
    };
    if controls.is_empty() {
        return paragraph.to_string();
    }

    let mut output = String::new();
    let mut rest = paragraph;
    let mut control_index = 0usize;
    while let Some(start) = find_xml_start(rest, "<w:sdt") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</w:sdt>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</w:sdt>".len();
        let segment = &after_start[..end_index];
        let updated = controls.get(control_index).map_or_else(
            || segment.to_string(),
            |control| replace_docx_content_control_segment(segment, control),
        );
        output.push_str(&updated);
        rest = &after_start[end_index..];
        control_index += 1;
    }
    output.push_str(rest);
    output
}

fn replace_docx_content_control_segment(segment: &str, control: &Value) -> String {
    let mut updated = segment.to_string();
    if let Some(checked) = control.get("checked").and_then(Value::as_bool) {
        updated = replace_docx_checkbox_checked(&updated, checked);
    }
    if let Some(text) = control.get("text").and_then(Value::as_str) {
        updated = replace_docx_content_control_text(&updated, text);
    }
    updated
}

fn docx_content_control_model(segment: &str, index: usize) -> Value {
    let kind = docx_content_control_kind(segment);
    let mut item = json!({
        "id": format!("control{}", index + 1),
        "kind": kind,
        "text": extract_text_tags(segment, "w:t").join("")
    });
    if let Some(alias) = docx_tag_attr(segment, "<w:alias", "w:val") {
        item["alias"] = json!(alias);
    }
    if let Some(tag) = docx_tag_attr(segment, "<w:tag", "w:val") {
        item["tag"] = json!(tag);
    }
    if let Some(control_id) = docx_tag_attr(segment, "<w:id", "w:val") {
        item["controlId"] = json!(control_id);
    }
    let items = docx_dropdown_items(segment);
    if !items.is_empty() {
        item["items"] = json!(items);
    }
    if kind == "checkbox" {
        item["checked"] = json!(docx_checkbox_checked(segment));
    }
    item
}

fn docx_content_control_kind(segment: &str) -> &'static str {
    if segment.contains("<w14:checkbox") || segment.contains("<w:checkBox") {
        "checkbox"
    } else if segment.contains("<w:dropDownList") {
        "dropdown"
    } else if segment.contains("<w:comboBox") {
        "comboBox"
    } else if segment.contains("<w:date") {
        "date"
    } else {
        "text"
    }
}

fn docx_dropdown_items(segment: &str) -> Vec<Value> {
    xml_named_empty_elements(segment, "w:listItem")
        .into_iter()
        .map(|item| {
            let value = attr_value(&item, "w:value").unwrap_or_default();
            let display_text = attr_value(&item, "w:displayText").unwrap_or_else(|| value.clone());
            json!({
                "value": value,
                "displayText": display_text
            })
        })
        .collect()
}

fn docx_checkbox_checked(segment: &str) -> bool {
    docx_tag_attr(segment, "<w14:checked", "w14:val")
        .or_else(|| docx_tag_attr(segment, "<w14:checked", "w:val"))
        .or_else(|| docx_tag_attr(segment, "<w:checked", "w:val"))
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "on"))
}

fn replace_docx_checkbox_checked(segment: &str, checked: bool) -> String {
    if segment.contains("<w14:checked") {
        return replace_first_tag_attr(segment, "<w14:checked", "w14:val", checked);
    }
    if segment.contains("<w:checked") {
        return replace_first_tag_attr(segment, "<w:checked", "w:val", checked);
    }
    segment.to_string()
}

fn replace_docx_content_control_text(segment: &str, text: &str) -> String {
    let Some(start) = find_xml_start(segment, "<w:sdtContent") else {
        return replace_tag_texts(segment, "w:t", &[text.to_string()]);
    };
    let after_start = &segment[start..];
    let Some(end) = after_start.find("</w:sdtContent>") else {
        return replace_tag_texts(segment, "w:t", &[text.to_string()]);
    };
    let end_index = end + "</w:sdtContent>".len();
    let content = &after_start[..end_index];
    let updated_content = if content.contains("<w:t") {
        replace_tag_texts(content, "w:t", &[text.to_string()])
    } else if let Some(insert_at) = content.rfind("</w:sdtContent>") {
        format!(
            "{}<w:r><w:t>{}</w:t></w:r>{}",
            &content[..insert_at],
            escape_xml(text),
            &content[insert_at..]
        )
    } else {
        content.to_string()
    };
    format!(
        "{}{}{}",
        &segment[..start],
        updated_content,
        &after_start[end_index..]
    )
}

fn replace_first_tag_attr(segment: &str, marker: &str, attr: &str, checked: bool) -> String {
    let Some(start) = find_xml_start(segment, marker) else {
        return segment.to_string();
    };
    let after_start = &segment[start..];
    let Some(end) = after_start.find('>') else {
        return segment.to_string();
    };
    let tag = &after_start[..=end];
    let value = if checked { "1" } else { "0" };
    let updated = set_xml_attr(tag, attr, value);
    let mut output = String::new();
    output.push_str(&segment[..start]);
    output.push_str(&updated);
    output.push_str(&after_start[end + 1..]);
    output
}
