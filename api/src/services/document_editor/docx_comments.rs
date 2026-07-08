use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::{
    append_before_or_end, docx_plain_paragraph_xml, docx_tag_attr, ensure_content_type_override,
    ensure_docx_part_relationship, escape_xml, extract_text_tags, find_xml_tag_start,
    read_zip_text, replace_docx_paragraph_text, set_first_xml_tag_attrs,
};

const DOCX_COMMENTS_PART: &str = "word/comments.xml";
const DOCX_COMMENTS_RELATIONSHIP_TARGET: &str = "comments.xml";
const DOCX_COMMENTS_RELATIONSHIP_TYPE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const DOCX_COMMENTS_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";

pub(super) fn docx_comments(bytes: &[u8]) -> Vec<Value> {
    let Ok(xml) = read_zip_text(bytes, DOCX_COMMENTS_PART) else {
        return Vec::new();
    };
    super::xml_named_segments(&xml, "w:comment")
        .into_iter()
        .filter_map(|comment| {
            let id = docx_tag_attr(&comment, "<w:comment", "w:id")?;
            Some(json!({
                "id": id,
                "author": docx_tag_attr(&comment, "<w:comment", "w:author"),
                "date": docx_tag_attr(&comment, "<w:comment", "w:date"),
                "text": extract_text_tags(&comment, "w:t").join("\n"),
                "sourceXml": comment
            }))
        })
        .collect()
}

pub(super) fn add_docx_comment_replacements(
    original: &[u8],
    value: Option<&Value>,
    relationships: &mut String,
    content_types: &mut String,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> bool {
    let Some(comments) = value.and_then(Value::as_array) else {
        return false;
    };
    if comments.is_empty() {
        return false;
    };
    let xml =
        read_zip_text(original, DOCX_COMMENTS_PART).unwrap_or_else(|_| empty_docx_comments_xml());
    let updated = update_docx_comments_xml(&xml, comments);
    replacements.push((DOCX_COMMENTS_PART.to_string(), updated.into_bytes()));
    *relationships = ensure_docx_part_relationship(
        relationships,
        DOCX_COMMENTS_RELATIONSHIP_TYPE,
        DOCX_COMMENTS_RELATIONSHIP_TARGET,
    );
    *content_types = ensure_content_type_override(
        content_types,
        &format!("/{DOCX_COMMENTS_PART}"),
        DOCX_COMMENTS_CONTENT_TYPE,
    );
    true
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
    let mut seen_ids = BTreeSet::new();
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
        if let Some(id) = id {
            seen_ids.insert(id.clone());
            if let Some(comment) = comment_map.get(&id) {
                output.push_str(&update_docx_comment_segment(segment, comment));
            } else {
                output.push_str(segment);
            }
        } else {
            output.push_str(segment);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    let missing_comments = comments
        .iter()
        .filter_map(|comment| build_missing_docx_comment_segment(comment, &seen_ids))
        .collect::<Vec<_>>()
        .join("");
    if !missing_comments.is_empty() {
        return append_before_or_end(&output, "</w:comments>", &missing_comments);
    }
    output
}

fn empty_docx_comments_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:comments>"#.to_string()
}

fn build_missing_docx_comment_segment(
    comment: &Value,
    seen_ids: &BTreeSet<String>,
) -> Option<String> {
    let id = comment.get("id").and_then(Value::as_str)?.trim();
    if id.is_empty() || seen_ids.contains(id) {
        return None;
    }
    let mut attrs = vec![format!(r#"w:id="{}""#, escape_xml(id))];
    if let Some(author) = comment.get("author").and_then(Value::as_str) {
        attrs.push(format!(r#"w:author="{}""#, escape_xml(author)));
    }
    if let Some(date) = comment.get("date").and_then(Value::as_str) {
        attrs.push(format!(r#"w:date="{}""#, escape_xml(date)));
    }
    let paragraphs = comment
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(docx_plain_paragraph_xml)
        .collect::<Vec<_>>()
        .join("");
    Some(format!(
        r#"<w:comment {}>{paragraphs}</w:comment>"#,
        attrs.join(" ")
    ))
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

pub(super) fn docx_comment_id_from_paragraph(paragraph: &str) -> Option<String> {
    docx_tag_attr(paragraph, "<w:commentReference", "w:id")
        .or_else(|| docx_tag_attr(paragraph, "<w:commentRangeStart", "w:id"))
}

pub(super) fn docx_comment_range_start(block: &Value) -> String {
    let Some(id) = docx_comment_id_from_model(block) else {
        return String::new();
    };
    format!(r#"<w:commentRangeStart w:id="{}"/>"#, escape_xml(&id))
}

pub(super) fn docx_comment_range_end_and_reference(block: &Value) -> String {
    let Some(id) = docx_comment_id_from_model(block) else {
        return String::new();
    };
    format!(
        r#"<w:commentRangeEnd w:id="{id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{id}"/></w:r>"#,
        id = escape_xml(&id)
    )
}

pub(super) fn docx_paragraph_needs_comment_reference_rebuild(
    paragraph: &str,
    block: &Value,
) -> bool {
    docx_comment_id_from_paragraph(paragraph) != docx_comment_id_from_model(block)
}

fn docx_comment_id_from_model(block: &Value) -> Option<String> {
    block
        .get("commentId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
