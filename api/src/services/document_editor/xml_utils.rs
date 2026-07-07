//! XML string utilities used by the document editor converters.
//!
//! The OOXML support in mymy deliberately edits narrow XML regions instead of
//! rebuilding complete documents. That keeps unsupported Office features intact,
//! but it also means tag matching and escaping rules must be shared consistently
//! across DOCX, XLSX, and PPTX code. These helpers are intentionally small and
//! string-oriented because they operate on already-scoped XML fragments rather
//! than serving as a general XML parser.

pub(super) fn replace_xml_element(xml: &str, tag: &str, replacement: &str) -> Option<String> {
    let start_marker = format!("<{tag}");
    let end_marker = format!("</{tag}>");
    let start = xml.find(&start_marker)?;
    let after_start = &xml[start..];
    let end = after_start.find(&end_marker)? + end_marker.len();
    let mut output = String::new();
    output.push_str(&xml[..start]);
    output.push_str(replacement);
    output.push_str(&after_start[end..]);
    Some(output)
}

pub(super) fn replace_empty_xml_element(xml: &str, marker: &str, replacement: &str) -> String {
    let Some(start) = xml.find(marker) else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find("/>") else {
        return xml.to_string();
    };
    let mut output = String::new();
    output.push_str(&xml[..start]);
    output.push_str(replacement);
    output.push_str(&after_start[end + 2..]);
    output
}

pub(super) fn remove_xml_named_elements(xml: &str, tag: &str) -> String {
    let start_marker = format!("<{tag}");
    let end_marker = format!("</{tag}>");
    let mut output = String::new();
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, &start_marker) {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(open_end) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        if after_start[..=open_end].ends_with("/>") {
            rest = &after_start[open_end + 1..];
            continue;
        }
        let Some(close_start) = after_start.find(&end_marker) else {
            output.push_str(after_start);
            return output;
        };
        rest = &after_start[close_start + end_marker.len()..];
    }
    output.push_str(rest);
    output
}

pub(super) fn xml_segments(xml: &str, start_marker: &str, end_marker: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(start_marker) {
        let after_start = &rest[start..];
        let Some(end) = after_start.find(end_marker) else {
            break;
        };
        let end_index = end + end_marker.len();
        segments.push(after_start[..end_index].to_string());
        rest = &after_start[end_index..];
    }
    segments
}

pub(super) fn xml_empty_elements(xml: &str, start_marker: &str) -> Vec<String> {
    let mut elements = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(start_marker) {
        let after_start = &rest[start..];
        let Some(end) = after_start.find("/>") else {
            break;
        };
        let end_index = end + 2;
        elements.push(after_start[..end_index].to_string());
        rest = &after_start[end_index..];
    }
    elements
}

pub(super) fn xml_named_segments(xml: &str, tag: &str) -> Vec<String> {
    let start_marker = format!("<{tag}");
    let end_marker = format!("</{tag}>");
    let mut segments = Vec::new();
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, &start_marker) {
        let after_start = &rest[start..];
        let Some(open_end) = after_start.find('>') else {
            break;
        };
        if after_start[..=open_end].ends_with("/>") {
            rest = &after_start[open_end + 1..];
            continue;
        }
        let Some(end) = after_start.find(&end_marker) else {
            break;
        };
        let end_index = end + end_marker.len();
        segments.push(after_start[..end_index].to_string());
        rest = &after_start[end_index..];
    }
    segments
}

pub(super) fn xml_named_empty_elements(xml: &str, tag: &str) -> Vec<String> {
    let start_marker = format!("<{tag}");
    let mut elements = Vec::new();
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, &start_marker) {
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            break;
        };
        if after_start[..=end].ends_with("/>") {
            elements.push(after_start[..=end].to_string());
        }
        rest = &after_start[end + 1..];
    }
    elements
}

pub(super) fn xml_named_start_tag(xml: &str, tag: &str) -> Option<String> {
    let start_marker = format!("<{tag}");
    let start = find_xml_start(xml, &start_marker)?;
    let after_start = &xml[start..];
    let end = after_start.find('>')?;
    Some(after_start[..=end].to_string())
}

pub(super) fn xml_has_named_empty_tag(xml: &str, tag: &str) -> bool {
    !xml_named_empty_elements(xml, tag).is_empty()
}

pub(super) fn xml_first_empty_tag_attr(xml: &str, tag: &str, attr: &str) -> Option<String> {
    xml_named_empty_elements(xml, tag)
        .into_iter()
        .find_map(|item| attr_value(&item, attr))
}

pub(super) fn find_xml_tag_start(xml: &str, tag: &str) -> Option<usize> {
    let marker = format!("<{tag}");
    find_xml_start(xml, &marker)
}

pub(super) fn set_xml_attr(tag_xml: &str, name: &str, value: &str) -> String {
    let marker = format!(r#"{name}=""#);
    if let Some(start) = tag_xml.find(&marker) {
        let value_start = start + marker.len();
        if let Some(value_end) = tag_xml[value_start..].find('"') {
            let mut output = String::new();
            output.push_str(&tag_xml[..value_start]);
            output.push_str(&escape_xml(value));
            output.push_str(&tag_xml[value_start + value_end..]);
            return output;
        }
    }
    if let Some(end) = tag_xml.rfind('>') {
        let mut output = String::new();
        output.push_str(&tag_xml[..end]);
        output.push(' ');
        output.push_str(name);
        output.push_str(r#"=""#);
        output.push_str(&escape_xml(value));
        output.push('"');
        output.push_str(&tag_xml[end..]);
        return output;
    }
    tag_xml.to_string()
}

pub(super) fn set_first_xml_tag_attrs(xml: &str, marker: &str, attrs: &[(&str, String)]) -> String {
    let Some(start) = xml.find(marker) else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find('>') else {
        return xml.to_string();
    };
    let original_tag = &after_start[..=end];
    let updated_tag = attrs
        .iter()
        .fold(original_tag.to_string(), |tag, (name, value)| {
            set_xml_attr(&tag, name, value)
        });
    let mut output = String::new();
    output.push_str(&xml[..start]);
    output.push_str(&updated_tag);
    output.push_str(&after_start[end + 1..]);
    output
}

pub(super) fn first_tag_text(xml: &str, tag: &str) -> Option<String> {
    extract_text_tags(xml, tag).into_iter().next()
}

pub(super) fn extract_text_tags(xml: &str, tag: &str) -> Vec<String> {
    let start_marker = format!("<{tag}");
    let end_marker = format!("</{tag}>");
    let mut values = Vec::new();
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, &start_marker) {
        let after_start = &rest[start..];
        let Some(gt) = after_start.find('>') else {
            break;
        };
        let Some(end) = after_start.find(&end_marker) else {
            break;
        };
        values.push(unescape_xml(&after_start[gt + 1..end]));
        rest = &after_start[end + end_marker.len()..];
    }
    values
}

pub(super) fn replace_tag_texts(xml: &str, tag: &str, values: &[String]) -> String {
    let start_marker = format!("<{tag}");
    let end_marker = format!("</{tag}>");
    let mut output = String::new();
    let mut rest = xml;
    let mut index = 0usize;
    while let Some(start) = find_xml_start(rest, &start_marker) {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(gt) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let Some(end) = after_start.find(&end_marker) else {
            output.push_str(after_start);
            return output;
        };
        output.push_str(&after_start[..gt + 1]);
        output.push_str(&escape_xml(
            values.get(index).map(String::as_str).unwrap_or_default(),
        ));
        output.push_str(&after_start[end..end + end_marker.len()]);
        rest = &after_start[end + end_marker.len()..];
        index += 1;
    }
    output.push_str(rest);
    output
}

pub(super) fn find_xml_start(xml: &str, start_marker: &str) -> Option<usize> {
    let mut offset = 0usize;
    let mut rest = xml;
    while let Some(start) = rest.find(start_marker) {
        let absolute_start = offset + start;
        let after_start = &rest[start..];
        if xml_start_matches_tag(after_start, start_marker) {
            return Some(absolute_start);
        }
        let skip = start + start_marker.len();
        offset += skip;
        rest = &rest[skip..];
    }
    None
}

fn xml_start_matches_tag(xml: &str, start_marker: &str) -> bool {
    xml[start_marker.len()..]
        .chars()
        .next()
        .is_some_and(|value| value == '>' || value == '/' || value.is_whitespace())
}

pub(super) fn attr_value(xml: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let pattern = format!("{name}={quote}");
        let Some(found) = xml.find(&pattern) else {
            continue;
        };
        let start = found + pattern.len();
        if let Some(end) = xml[start..].find(quote) {
            return Some(xml[start..start + end].to_string());
        }
    }
    None
}

pub(super) fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub(super) fn unescape_xml(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}
