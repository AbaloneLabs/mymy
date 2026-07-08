use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{
    attr_value, docx_alignment, docx_font_size, docx_has_enabled_run_property, docx_hex_color,
    docx_tag_attr, docx_vertical_align, first_tag_text, xml_named_segments,
};

/// Word paragraph styles are package-level definitions, while the editor model
/// edits individual blocks. Keeping the style catalog alongside block-local
/// overrides lets the UI render inherited formatting without flattening style
/// definitions into direct paragraph properties during every save.
pub(super) fn docx_paragraph_styles(styles_xml: &str) -> Vec<Value> {
    xml_named_segments(styles_xml, "w:style")
        .into_iter()
        .filter_map(|style| {
            let start_tag = style.split('>').next().unwrap_or_default();
            if attr_value(start_tag, "w:type").as_deref() != Some("paragraph") {
                return None;
            }
            let style_id =
                attr_value(start_tag, "w:styleId").or_else(|| attr_value(start_tag, "styleId"))?;
            let mut item = json!({
                "id": style_id,
                "name": docx_style_name(&style).unwrap_or_else(|| style_id.clone()),
                "type": "paragraph",
                "custom": attr_value(start_tag, "w:customStyle")
                    .or_else(|| attr_value(start_tag, "customStyle"))
                    .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "on")),
                "default": attr_value(start_tag, "w:default")
                    .or_else(|| attr_value(start_tag, "default"))
                    .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "on"))
            });
            if let Some(based_on) = docx_tag_attr(&style, "<w:basedOn", "w:val") {
                item["basedOn"] = json!(based_on);
            }
            if let Some(next) = docx_tag_attr(&style, "<w:next", "w:val") {
                item["next"] = json!(next);
            }
            if style.contains("<w:qFormat") {
                item["quickFormat"] = json!(true);
            }
            append_docx_style_formatting(&style, &mut item);
            Some(item)
        })
        .collect()
}

pub(super) fn docx_style_names(styles_xml: &str) -> BTreeMap<String, String> {
    docx_paragraph_styles(styles_xml)
        .into_iter()
        .filter_map(|style| {
            Some((
                style.get("id")?.as_str()?.to_string(),
                style.get("name")?.as_str()?.to_string(),
            ))
        })
        .collect()
}

pub(super) fn docx_paragraph_style_id(paragraph: &str) -> Option<String> {
    docx_tag_attr(paragraph, "<w:pStyle", "w:val")
}

fn docx_style_name(style: &str) -> Option<String> {
    docx_tag_attr(style, "<w:name", "w:val").or_else(|| first_tag_text(style, "w:name"))
}

fn append_docx_style_formatting(style: &str, item: &mut Value) {
    if let Some(align) = docx_alignment(style) {
        item["align"] = json!(align);
    }
    if let Some(font_family) = docx_tag_attr(style, "<w:rFonts", "w:ascii") {
        item["fontFamily"] = json!(font_family);
    }
    if let Some(font_size) = docx_font_size(style) {
        item["fontSize"] = json!(font_size);
    }
    if docx_has_enabled_run_property(style, "<w:b") {
        item["bold"] = json!(true);
    }
    if docx_has_enabled_run_property(style, "<w:i") {
        item["italic"] = json!(true);
    }
    if style.contains("<w:u") {
        item["underline"] = json!(true);
    }
    if style.contains("<w:strike") {
        item["strikethrough"] = json!(true);
    }
    if let Some(vertical_align) = docx_vertical_align(style) {
        item["verticalAlign"] = json!(vertical_align);
    }
    if let Some(color) =
        docx_tag_attr(style, "<w:color", "w:val").and_then(|color| docx_hex_color(&color))
    {
        item["color"] = json!(format!("#{color}"));
    }
    if let Some(highlight) = docx_tag_attr(style, "<w:highlight", "w:val") {
        item["highlight"] = json!(highlight);
    }
}
