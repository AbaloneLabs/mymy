use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::{
    append_before_or_end, attr_value, docx_alignment, docx_font_size,
    docx_has_enabled_run_property, docx_hex_color, docx_tag_attr, docx_vertical_align, escape_xml,
    first_tag_text, read_zip_text, xml_named_empty_elements, xml_named_segments,
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

pub(super) fn add_docx_style_replacements(
    original: &[u8],
    styles_model: Option<&Value>,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> bool {
    let Some(styles) = styles_model.and_then(Value::as_array) else {
        return false;
    };
    if styles.is_empty() {
        return false;
    }
    let original_xml =
        read_zip_text(original, "word/styles.xml").unwrap_or_else(|_| default_docx_styles_xml());
    let updated = update_docx_styles_xml(&original_xml, styles);
    if updated == original_xml {
        return false;
    }
    replacements.push(("word/styles.xml".to_string(), updated.into_bytes()));
    true
}

pub(super) fn add_docx_font_table_replacements(
    original: &[u8],
    model: &Value,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> bool {
    let font_families = docx_font_families_from_model(model);
    if font_families.is_empty() {
        return false;
    }
    let original_xml = read_zip_text(original, "word/fontTable.xml")
        .unwrap_or_else(|_| default_docx_font_table_xml());
    let updated = update_docx_font_table_xml(&original_xml, &font_families);
    if updated == original_xml {
        return false;
    }
    replacements.push(("word/fontTable.xml".to_string(), updated.into_bytes()));
    true
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

fn update_docx_styles_xml(styles_xml: &str, styles: &[Value]) -> String {
    styles.iter().fold(styles_xml.to_string(), |xml, style| {
        let Some(style_id) = docx_style_id_from_model(style) else {
            return xml;
        };
        let replacement = build_docx_paragraph_style(style, &style_id);
        let Some(existing) = xml_named_segments(&xml, "w:style")
            .into_iter()
            .find(|segment| {
                docx_style_id_from_segment(segment).as_deref() == Some(style_id.as_str())
            })
        else {
            return append_before_or_end(&xml, "</w:styles>", &replacement);
        };
        xml.replacen(&existing, &replacement, 1)
    })
}

fn docx_style_id_from_segment(segment: &str) -> Option<String> {
    let start_tag = segment.split('>').next().unwrap_or_default();
    attr_value(start_tag, "w:styleId").or_else(|| attr_value(start_tag, "styleId"))
}

fn docx_style_id_from_model(style: &Value) -> Option<String> {
    style
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .filter(|value| {
            value.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '_' || character == '-'
            })
        })
        .map(str::to_string)
}

fn build_docx_paragraph_style(style: &Value, style_id: &str) -> String {
    let name = style
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(style_id);
    let mut attrs = vec![
        r#"w:type="paragraph""#.to_string(),
        format!(r#"w:styleId="{}""#, escape_xml(style_id)),
    ];
    if style
        .get("custom")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        attrs.push(r#"w:customStyle="1""#.to_string());
    }
    if style
        .get("default")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        attrs.push(r#"w:default="1""#.to_string());
    }
    let based_on = style
        .get("basedOn")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(r#"<w:basedOn w:val="{}"/>"#, escape_xml(value)))
        .unwrap_or_default();
    let next = style
        .get("next")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(r#"<w:next w:val="{}"/>"#, escape_xml(value)))
        .unwrap_or_default();
    let quick_format = style
        .get("quickFormat")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        .then_some("<w:qFormat/>")
        .unwrap_or_default();
    let paragraph_properties = docx_style_paragraph_properties(style);
    let run_properties = docx_style_run_properties(style);
    format!(
        r#"<w:style {}><w:name w:val="{}"/>{based_on}{next}{quick_format}{paragraph_properties}{run_properties}</w:style>"#,
        attrs.join(" "),
        escape_xml(name)
    )
}

fn docx_style_paragraph_properties(style: &Value) -> String {
    let mut props = Vec::new();
    if let Some(align) = style
        .get("align")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "left" | "center" | "right" | "justify"))
    {
        props.push(format!(r#"<w:jc w:val="{align}"/>"#));
    }
    if props.is_empty() {
        String::new()
    } else {
        format!("<w:pPr>{}</w:pPr>", props.join(""))
    }
}

fn docx_style_run_properties(style: &Value) -> String {
    let mut props = Vec::new();
    if style.get("bold").and_then(Value::as_bool).unwrap_or(false) {
        props.push("<w:b/>".to_string());
    }
    if style
        .get("italic")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push("<w:i/>".to_string());
    }
    if style
        .get("underline")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push(r#"<w:u w:val="single"/>"#.to_string());
    }
    if style
        .get("strikethrough")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push("<w:strike/>".to_string());
    }
    if let Some(font) = style
        .get("fontFamily")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let font = escape_xml(font);
        props.push(format!(
            r#"<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}"/>"#
        ));
    }
    if let Some(size) = docx_style_font_size_half_points(style) {
        props.push(format!(r#"<w:sz w:val="{size}"/>"#));
    }
    if let Some(vertical_align) = style
        .get("verticalAlign")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "superscript" | "subscript"))
    {
        props.push(format!(r#"<w:vertAlign w:val="{vertical_align}"/>"#));
    }
    if let Some(color) = style
        .get("color")
        .and_then(Value::as_str)
        .and_then(docx_style_hex_color)
    {
        props.push(format!(r#"<w:color w:val="{color}"/>"#));
    }
    if let Some(highlight) = style
        .get("highlight")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        props.push(format!(
            r#"<w:highlight w:val="{}"/>"#,
            escape_xml(highlight)
        ));
    }
    if props.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{}</w:rPr>", props.join(""))
    }
}

fn docx_style_font_size_half_points(style: &Value) -> Option<u32> {
    let value = style.get("fontSize")?.as_str()?.trim();
    let points = value.parse::<f64>().ok()?;
    (points.is_finite() && points > 0.0 && points <= 400.0).then(|| (points * 2.0).round() as u32)
}

fn docx_style_hex_color(value: &str) -> Option<String> {
    let color = value.trim().trim_start_matches('#');
    (color.len() == 6 && color.chars().all(|character| character.is_ascii_hexdigit()))
        .then(|| color.to_ascii_uppercase())
}

fn default_docx_styles_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:styles>"#.to_string()
}

fn docx_font_families_from_model(model: &Value) -> BTreeSet<String> {
    let mut fonts = BTreeSet::new();
    collect_docx_font_families(model, &mut fonts);
    fonts
}

fn collect_docx_font_families(value: &Value, fonts: &mut BTreeSet<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_docx_font_families(item, fonts);
            }
        }
        Value::Object(map) => {
            if let Some(font) = map
                .get("fontFamily")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|font| !font.is_empty() && font.len() <= 128)
            {
                fonts.insert(font.to_string());
            }
            for item in map.values() {
                collect_docx_font_families(item, fonts);
            }
        }
        _ => {}
    }
}

fn update_docx_font_table_xml(font_table_xml: &str, font_families: &BTreeSet<String>) -> String {
    let existing = docx_existing_font_table_names(font_table_xml);
    let inserted = font_families
        .iter()
        .filter(|font| !existing.contains(*font))
        .map(|font| {
            format!(
                r#"<w:font w:name="{}"><w:family w:val="auto"/></w:font>"#,
                escape_xml(font)
            )
        })
        .collect::<Vec<_>>()
        .join("");
    if inserted.is_empty() {
        return font_table_xml.to_string();
    }
    append_before_or_end(font_table_xml, "</w:fonts>", &inserted)
}

fn docx_existing_font_table_names(font_table_xml: &str) -> BTreeSet<String> {
    xml_named_segments(font_table_xml, "w:font")
        .into_iter()
        .chain(xml_named_empty_elements(font_table_xml, "w:font"))
        .filter_map(|segment| {
            let start_tag = segment.split('>').next().unwrap_or_default();
            attr_value(start_tag, "w:name").or_else(|| attr_value(start_tag, "name"))
        })
        .collect()
}

fn default_docx_font_table_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:fonts>"#.to_string()
}
