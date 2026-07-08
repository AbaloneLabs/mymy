use serde_json::{json, Value};

use super::{
    docx_tag_attr, docx_u32_attr, docx_u32_model_attr, docx_u32_model_attr_allow_zero,
    replace_empty_xml_element, replace_xml_element,
};

pub(super) fn docx_page_settings(document: &str) -> Value {
    let Some((_, _, section)) = docx_section_properties(document) else {
        return json!({});
    };
    let mut page = json!({});
    if let Some(width) = docx_u32_attr(&section, "<w:pgSz", "w:w") {
        page["width"] = json!(width);
    }
    if let Some(height) = docx_u32_attr(&section, "<w:pgSz", "w:h") {
        page["height"] = json!(height);
    }
    if let Some(orientation) = docx_tag_attr(&section, "<w:pgSz", "w:orient")
        .filter(|value| matches!(value.as_str(), "portrait" | "landscape"))
    {
        page["orientation"] = json!(orientation);
    }
    for (xml_attr, key) in [
        ("w:top", "marginTop"),
        ("w:right", "marginRight"),
        ("w:bottom", "marginBottom"),
        ("w:left", "marginLeft"),
    ] {
        if let Some(value) = docx_u32_attr(&section, "<w:pgMar", xml_attr) {
            page[key] = json!(value);
        }
    }
    if let Some(columns) = docx_u32_attr(&section, "<w:cols", "w:num") {
        page["columnCount"] = json!(columns);
    }
    if let Some(spacing) = docx_u32_attr(&section, "<w:cols", "w:space") {
        page["columnSpacing"] = json!(spacing);
    }
    if let Some(equal_width) = docx_tag_attr(&section, "<w:cols", "w:equalWidth") {
        page["columnEqualWidth"] = json!(!matches!(equal_width.as_str(), "0" | "false" | "off"));
    }
    page
}

pub(super) fn update_docx_page_settings(document: &str, page: Option<&Value>) -> String {
    let Some(page) = page.filter(|value| value.is_object()) else {
        return document.to_string();
    };
    let page_size = docx_page_size_xml(page);
    let page_margins = docx_page_margins_xml(page);
    let columns = docx_columns_xml(page);
    if page_size.is_none() && page_margins.is_none() && columns.is_none() {
        return document.to_string();
    }

    if let Some((start, end, section)) = docx_section_properties(document) {
        let mut updated_section = expand_docx_section_properties(&section);
        if let Some(page_size) = page_size {
            updated_section =
                replace_or_insert_docx_section_child(&updated_section, "<w:pgSz", &page_size);
        }
        if let Some(page_margins) = page_margins {
            updated_section =
                replace_or_insert_docx_section_child(&updated_section, "<w:pgMar", &page_margins);
        }
        if let Some(columns) = columns {
            updated_section =
                replace_or_insert_docx_section_child(&updated_section, "<w:cols", &columns);
        }
        let mut output = String::new();
        output.push_str(&document[..start]);
        output.push_str(&updated_section);
        output.push_str(&document[end..]);
        return output;
    }

    let section = format!(
        "<w:sectPr>{}{}{}</w:sectPr>",
        page_size.unwrap_or_default(),
        page_margins.unwrap_or_default(),
        columns.unwrap_or_default()
    );
    if let Some(index) = document.find("</w:body>") {
        let mut output = String::new();
        output.push_str(&document[..index]);
        output.push_str(&section);
        output.push_str(&document[index..]);
        output
    } else {
        format!("{document}{section}")
    }
}

fn docx_columns_xml(page: &Value) -> Option<String> {
    let count = docx_u32_model_attr(page, "columnCount", 12);
    let spacing = docx_u32_model_attr_allow_zero(page, "columnSpacing", 14_400);
    let equal_width = page
        .get("columnEqualWidth")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if count.is_none() && spacing.is_none() && equal_width {
        return None;
    }
    let mut attrs = Vec::new();
    if let Some(count) = count {
        attrs.push(format!(r#"w:num="{}""#, count.max(1)));
    }
    if let Some(spacing) = spacing {
        attrs.push(format!(r#"w:space="{spacing}""#));
    }
    if !equal_width {
        attrs.push(r#"w:equalWidth="0""#.to_string());
    }
    Some(format!("<w:cols {}/>", attrs.join(" ")))
}

fn docx_page_size_xml(page: &Value) -> Option<String> {
    let width = docx_u32_model_attr(page, "width", 31_680);
    let height = docx_u32_model_attr(page, "height", 31_680);
    let orientation = page
        .get("orientation")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "portrait" | "landscape"));
    if width.is_none() && height.is_none() && orientation.is_none() {
        return None;
    }
    let mut attrs = Vec::new();
    if let Some(width) = width {
        attrs.push(format!(r#"w:w="{width}""#));
    }
    if let Some(height) = height {
        attrs.push(format!(r#"w:h="{height}""#));
    }
    if let Some(orientation) = orientation {
        attrs.push(format!(r#"w:orient="{orientation}""#));
    }
    Some(format!("<w:pgSz {}/>", attrs.join(" ")))
}

fn docx_page_margins_xml(page: &Value) -> Option<String> {
    let mut attrs = Vec::new();
    for (key, attr) in [
        ("marginTop", "w:top"),
        ("marginRight", "w:right"),
        ("marginBottom", "w:bottom"),
        ("marginLeft", "w:left"),
    ] {
        if let Some(value) = docx_u32_model_attr_allow_zero(page, key, 14_400) {
            attrs.push(format!(r#"{attr}="{value}""#));
        }
    }
    if attrs.is_empty() {
        None
    } else {
        Some(format!("<w:pgMar {}/>", attrs.join(" ")))
    }
}

fn docx_section_properties(document: &str) -> Option<(usize, usize, String)> {
    let start = document.find("<w:sectPr")?;
    let after_start = &document[start..];
    let open_end = after_start.find('>')?;
    if after_start[..=open_end].ends_with("/>") {
        return Some((
            start,
            start + open_end + 1,
            after_start[..=open_end].to_string(),
        ));
    }
    let end_marker = "</w:sectPr>";
    let end = after_start.find(end_marker)? + end_marker.len();
    Some((start, start + end, after_start[..end].to_string()))
}

fn expand_docx_section_properties(section: &str) -> String {
    let Some(open_end) = section.find('>') else {
        return "<w:sectPr></w:sectPr>".to_string();
    };
    if !section[..=open_end].ends_with("/>") {
        return section.to_string();
    }
    let opening = section[..open_end].trim_end_matches('/').to_string();
    format!("{opening}></w:sectPr>")
}

fn replace_or_insert_docx_section_child(section: &str, marker: &str, child: &str) -> String {
    if section.contains(marker) {
        if let Some(tag) = marker.strip_prefix("<") {
            if let Some(replaced) = replace_xml_element(section, tag, child) {
                return replaced;
            }
        }
        return replace_empty_xml_element(section, marker, child);
    }
    let Some(open_end) = section.find('>') else {
        return section.to_string();
    };
    let mut output = String::new();
    output.push_str(&section[..=open_end]);
    output.push_str(child);
    output.push_str(&section[open_end + 1..]);
    output
}
