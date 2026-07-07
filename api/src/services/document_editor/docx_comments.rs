use std::collections::BTreeMap;

use serde_json::Value;

use super::{
    append_before_or_end, docx_plain_paragraph_xml, docx_tag_attr, find_xml_tag_start,
    read_zip_text, replace_docx_paragraph_text, set_first_xml_tag_attrs,
};

pub(super) fn add_docx_comment_replacements(
    original: &[u8],
    value: Option<&Value>,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(comments) = value.and_then(Value::as_array) else {
        return;
    };
    let Ok(xml) = read_zip_text(original, "word/comments.xml") else {
        return;
    };
    let updated = update_docx_comments_xml(&xml, comments);
    replacements.push(("word/comments.xml".to_string(), updated.into_bytes()));
}

fn update_docx_comments_xml(xml: &str, comments: &[Value]) -> String {
    let comment_map = comments
        .iter()
        .filter_map(|comment| {
            let id = comment.get("id").and_then(Value::as_str)?;
            Some((id.to_string(), comment))
        })
        .collect::<BTreeMap<_, _>>();
    let mut output = String::new();
    let mut rest = xml;
    while let Some(start) = find_xml_tag_start(rest, "w:comment") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</w:comment>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</w:comment>".len();
        let segment = &after_start[..end_index];
        let id = docx_tag_attr(segment, "<w:comment", "w:id");
        if let Some(comment) = id.and_then(|value| comment_map.get(&value)) {
            output.push_str(&update_docx_comment_segment(segment, comment));
        } else {
            output.push_str(segment);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

fn update_docx_comment_segment(segment: &str, comment: &Value) -> String {
    let mut output = segment.to_string();
    let mut attrs = Vec::new();
    if let Some(author) = comment.get("author").and_then(Value::as_str) {
        attrs.push(("w:author", author.to_string()));
    }
    if let Some(date) = comment.get("date").and_then(Value::as_str) {
        attrs.push(("w:date", date.to_string()));
    }
    if !attrs.is_empty() {
        output = set_first_xml_tag_attrs(&output, "<w:comment", &attrs);
    }
    if let Some(text) = comment.get("text").and_then(Value::as_str) {
        output = update_docx_comment_text(&output, text);
    }
    output
}

fn update_docx_comment_text(comment: &str, text: &str) -> String {
    let lines = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut output = String::new();
    let mut rest = comment;
    let mut line_index = 0usize;
    while let Some(start) = rest.find("<w:p") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</w:p>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</w:p>".len();
        let paragraph = &after_start[..end_index];
        let replacement = lines.get(line_index).cloned().unwrap_or_default();
        output.push_str(&replace_docx_paragraph_text(paragraph, &replacement));
        line_index += 1;
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    if line_index > 0 {
        if line_index < lines.len() {
            return insert_docx_comment_paragraphs(&output, &lines[line_index..]);
        }
        return output;
    }
    let paragraphs = lines
        .iter()
        .map(|line| docx_plain_paragraph_xml(line))
        .collect::<Vec<_>>()
        .join("");
    append_before_or_end(comment, "</w:comment>", &paragraphs)
}

fn insert_docx_comment_paragraphs(xml: &str, lines: &[String]) -> String {
    let paragraphs = lines
        .iter()
        .map(|line| docx_plain_paragraph_xml(line))
        .collect::<Vec<_>>()
        .join("");
    append_before_or_end(xml, "</w:comment>", &paragraphs)
}
