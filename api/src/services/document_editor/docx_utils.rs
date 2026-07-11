use std::collections::BTreeSet;

use serde_json::{json, Value};

use super::{
    append_before_or_end, attr_value, escape_xml, find_xml_start, replace_tag_texts,
    set_first_xml_tag_attrs,
};

pub(super) fn replace_docx_paragraph_text(paragraph: &str, text: &str) -> String {
    if paragraph.contains("<w:t") {
        return replace_tag_texts(paragraph, "w:t", &[text.to_string()]);
    }
    let run = format!(
        r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#,
        escape_xml(text)
    );
    append_before_or_end(paragraph, "</w:p>", &run)
}

pub(super) fn docx_plain_paragraph_xml(text: &str) -> String {
    format!(
        r#"<w:p><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        escape_xml(text)
    )
}

pub(super) fn docx_body_segments(document: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut rest = document;
    loop {
        let paragraph = rest.find("<w:p").map(|index| (index, "<w:p", "</w:p>"));
        let table = rest
            .find("<w:tbl")
            .map(|index| (index, "<w:tbl", "</w:tbl>"));
        let next = match (paragraph, table) {
            (Some(paragraph), Some(table)) => {
                if paragraph.0 <= table.0 {
                    paragraph
                } else {
                    table
                }
            }
            (Some(paragraph), None) => paragraph,
            (None, Some(table)) => table,
            (None, None) => break,
        };
        let after_start = &rest[next.0..];
        let Some(end) = after_start.find(next.2) else {
            break;
        };
        let end_index = end + next.2.len();
        segments.push(after_start[..end_index].to_string());
        rest = &after_start[end_index..];
    }
    segments
}

pub(super) fn docx_tag_attr(xml: &str, marker: &str, attr: &str) -> Option<String> {
    let start = find_xml_start(xml, marker)?;
    let after_start = &xml[start..];
    let end = after_start.find('>')?;
    attr_value(&after_start[..end], attr)
}

pub(super) fn docx_font_size(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:sz", "w:val")
        .and_then(|value| value.parse::<u32>().ok())
        .map(|half_points| (half_points / 2).to_string())
}

pub(super) fn docx_alignment(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:jc", "w:val")
        .filter(|value| matches!(value.as_str(), "left" | "center" | "right" | "justify"))
}

pub(super) fn docx_bookmark_name(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:bookmarkStart", "w:name")
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty() && name != "_GoBack")
}

pub(super) fn docx_bookmark_id(xml: &str) -> Option<u32> {
    docx_tag_attr(xml, "<w:bookmarkStart", "w:id").and_then(|value| value.parse().ok())
}

fn docx_bookmark_ids(xml: &str) -> BTreeSet<u32> {
    let mut ids = BTreeSet::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<w:bookmarkStart") {
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            break;
        };
        if let Some(id) =
            attr_value(&after_start[..end], "w:id").and_then(|value| value.parse().ok())
        {
            ids.insert(id);
        }
        rest = &after_start[end + 1..];
    }
    ids
}

pub(super) fn assign_docx_bookmark_ids(document: &str, blocks: &mut [Value]) {
    let mut used = docx_bookmark_ids(document);
    for block in blocks.iter() {
        if docx_bookmark_name_from_model(block).is_some() {
            if let Some(id) = docx_bookmark_id_from_model(block) {
                used.insert(id);
            }
        }
    }
    let mut next = used
        .iter()
        .next_back()
        .copied()
        .unwrap_or(0)
        .saturating_add(1);
    for block in blocks {
        if docx_bookmark_name_from_model(block).is_none()
            || docx_bookmark_id_from_model(block).is_some()
        {
            continue;
        }
        while used.contains(&next) {
            next = next.saturating_add(1);
        }
        if let Some(object) = block.as_object_mut() {
            object.insert("bookmarkId".to_string(), json!(next.to_string()));
        }
        used.insert(next);
        next = next.saturating_add(1);
    }
}

pub(super) fn docx_bookmark_name_from_model(block: &Value) -> Option<String> {
    let name = block.get("bookmarkName")?.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    let mut normalized = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if normalized
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_digit())
    {
        normalized.insert(0, '_');
    }
    let normalized = normalized.trim_matches('_').to_string();
    (!normalized.is_empty()).then(|| normalized.chars().take(40).collect())
}

pub(super) fn docx_bookmark_id_from_model(block: &Value) -> Option<u32> {
    block
        .get("bookmarkId")
        .and_then(Value::as_str)
        .and_then(|value| value.parse().ok())
        .or_else(|| {
            block
                .get("bookmarkId")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok())
        })
}

pub(super) fn docx_vertical_align(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:vertAlign", "w:val")
        .filter(|value| matches!(value.as_str(), "superscript" | "subscript"))
}

pub(super) fn docx_has_enabled_run_property(xml: &str, marker: &str) -> bool {
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, marker) {
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            return true;
        };
        let tag = &after_start[..=end];
        if !docx_tag_attr(tag, marker, "w:val").is_some_and(|value| {
            matches!(value.to_ascii_lowercase().as_str(), "false" | "0" | "off")
        }) {
            return true;
        }
        rest = &after_start[end + 1..];
    }
    false
}

pub(super) fn docx_has_enabled_underline(xml: &str) -> bool {
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, "<w:u") {
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            return true;
        };
        let tag = &after_start[..=end];
        if !docx_tag_attr(tag, "<w:u", "w:val")
            .is_some_and(|value| value.eq_ignore_ascii_case("none"))
        {
            return true;
        }
        rest = &after_start[end + 1..];
    }
    false
}

pub(super) fn docx_heading_level(xml: &str) -> Option<u32> {
    let style = docx_tag_attr(xml, "<w:pStyle", "w:val")?;
    let normalized = style
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    let level = normalized.strip_prefix("heading")?.parse::<u32>().ok()?;
    (1..=6).contains(&level).then_some(level)
}

pub(super) fn docx_text_with_breaks(text: &str) -> String {
    text.split('\n')
        .enumerate()
        .map(|(index, line)| {
            let prefix = if index == 0 { "" } else { "<w:br/>" };
            format!(
                "{prefix}<w:t xml:space=\"preserve\">{}</w:t>",
                escape_xml(line)
            )
        })
        .collect::<Vec<_>>()
        .join("")
}

pub(super) fn ensure_docx_relationship_namespace(document: &str) -> String {
    if !document.contains("r:id=") || document.contains("xmlns:r=") {
        return document.to_string();
    }
    set_first_xml_tag_attrs(
        document,
        "<w:document",
        &[(
            "xmlns:r",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships".to_string(),
        )],
    )
}

pub(super) fn docx_hex_color(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('#');
    if value.len() == 6 && value.chars().all(|character| character.is_ascii_hexdigit()) {
        Some(value.to_ascii_uppercase())
    } else {
        None
    }
}

pub(super) fn docx_u32_model_attr(block: &Value, key: &str, max: u32) -> Option<u32> {
    block
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value.min(u64::from(max)) as u32)
        .filter(|value| *value > 0)
}

pub(super) fn docx_u32_model_attr_allow_zero(block: &Value, key: &str, max: u32) -> Option<u32> {
    block
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value.min(u64::from(max)) as u32)
}

pub(super) fn docx_u32_attr(xml: &str, tag: &str, attr: &str) -> Option<u32> {
    docx_tag_attr(xml, tag, attr).and_then(|value| value.parse::<u32>().ok())
}

pub(super) fn column_letters(mut column: u32) -> String {
    let mut output = String::new();
    while column > 0 {
        let remainder = (column - 1) % 26;
        output.insert(0, char::from_u32('A' as u32 + remainder).unwrap_or('A'));
        column = (column - remainder - 1) / 26;
    }
    output
}
