use serde_json::{json, Value};

use super::{attr_value, extract_text_tags, find_xml_start};

const REVISION_TAGS: [(&str, &str); 4] = [
    ("w:ins", "insertion"),
    ("w:del", "deletion"),
    ("w:moveFrom", "moveFrom"),
    ("w:moveTo", "moveTo"),
];

/// Tracked changes are represented as wrappers around normal run content.
/// mymy keeps those wrappers visible to the editor and applies accept/reject
/// decisions by unwrapping or removing the original XML. The implementation is
/// intentionally positional: it avoids inventing revision identifiers when Word
/// omitted them and keeps unrelated revision metadata intact.
pub(super) fn docx_paragraph_revisions(paragraph: &str) -> Vec<Value> {
    let mut revisions = Vec::new();
    for (index, (_tag, kind, segment)) in revision_segments(paragraph).into_iter().enumerate() {
        let mut item = json!({
            "id": format!("revision{}", index + 1),
            "kind": kind,
            "text": revision_text(&segment, kind)
        });
        if let Some(revision_id) = attr_value(&segment, "w:id") {
            item["revisionId"] = json!(revision_id);
        }
        if let Some(author) = attr_value(&segment, "w:author") {
            item["author"] = json!(author);
        }
        if let Some(date) = attr_value(&segment, "w:date") {
            item["date"] = json!(date);
        }
        revisions.push(item);
    }
    revisions
}

pub(super) fn docx_revisions_have_actions(block: &Value) -> bool {
    block
        .get("revisions")
        .and_then(Value::as_array)
        .is_some_and(|revisions| {
            revisions.iter().any(|revision| {
                revision
                    .get("action")
                    .and_then(Value::as_str)
                    .is_some_and(|action| matches!(action, "accept" | "reject"))
            })
        })
}

pub(super) fn apply_docx_revision_actions(paragraph: &str, block: &Value) -> String {
    let Some(revisions) = block.get("revisions").and_then(Value::as_array) else {
        return paragraph.to_string();
    };
    if revisions.is_empty() {
        return paragraph.to_string();
    }

    let mut output = String::new();
    let mut rest = paragraph;
    let mut revision_index = 0usize;
    while let Some((start, tag, kind)) = next_revision_start(rest) {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let end_marker = format!("</{tag}>");
        let Some(end) = after_start.find(&end_marker) else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + end_marker.len();
        let segment = &after_start[..end_index];
        let action = revisions
            .get(revision_index)
            .and_then(|revision| revision.get("action"))
            .and_then(Value::as_str);
        output.push_str(&revision_segment_after_action(segment, tag, kind, action));
        rest = &after_start[end_index..];
        revision_index += 1;
    }
    output.push_str(rest);
    output
}

fn revision_segments(paragraph: &str) -> Vec<(&'static str, &'static str, String)> {
    let mut segments = Vec::new();
    let mut rest = paragraph;
    while let Some((start, tag, kind)) = next_revision_start(rest) {
        let after_start = &rest[start..];
        let end_marker = format!("</{tag}>");
        let Some(end) = after_start.find(&end_marker) else {
            break;
        };
        let end_index = end + end_marker.len();
        segments.push((tag, kind, after_start[..end_index].to_string()));
        rest = &after_start[end_index..];
    }
    segments
}

fn next_revision_start(xml: &str) -> Option<(usize, &'static str, &'static str)> {
    REVISION_TAGS
        .iter()
        .filter_map(|(tag, kind)| {
            find_xml_start(xml, &format!("<{tag}")).map(|start| (start, *tag, *kind))
        })
        .min_by_key(|(start, _, _)| *start)
}

fn revision_text(segment: &str, kind: &str) -> String {
    if matches!(kind, "deletion" | "moveFrom") {
        let deleted = extract_text_tags(segment, "w:delText").join("");
        if !deleted.is_empty() {
            return deleted;
        }
    }
    extract_text_tags(segment, "w:t").join("")
}

fn revision_segment_after_action(
    segment: &str,
    tag: &str,
    kind: &str,
    action: Option<&str>,
) -> String {
    match (kind, action) {
        ("insertion" | "moveTo", Some("accept")) => unwrap_revision_segment(segment, tag),
        ("insertion" | "moveTo", Some("reject")) => String::new(),
        ("deletion" | "moveFrom", Some("accept")) => String::new(),
        ("deletion" | "moveFrom", Some("reject")) => {
            unwrap_revision_segment(&deleted_text_as_visible_text(segment), tag)
        }
        _ => segment.to_string(),
    }
}

fn unwrap_revision_segment(segment: &str, tag: &str) -> String {
    let Some(open_end) = segment.find('>') else {
        return segment.to_string();
    };
    let end_marker = format!("</{tag}>");
    let Some(close_start) = segment.rfind(&end_marker) else {
        return segment.to_string();
    };
    segment[open_end + 1..close_start].to_string()
}

fn deleted_text_as_visible_text(segment: &str) -> String {
    segment
        .replace("<w:delText", "<w:t")
        .replace("</w:delText>", "</w:t>")
}
