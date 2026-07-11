use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::docx_runs::{build_docx_run, build_docx_run_sequence, docx_runs_text};
use super::{docx_tag_attr, escape_xml, extract_text_tags};

/// Inline package features are represented by UTF-16 offsets because browser
/// selections use JavaScript string offsets. Keeping parsing and rendering on
/// the same coordinate system prevents an emoji before a comment or hyperlink
/// from shifting the durable OOXML marker away from the visible selection.
pub(super) fn docx_comment_ranges(paragraph: &str) -> Vec<Value> {
    #[derive(Default)]
    struct PendingRange {
        start: Option<usize>,
        end: Option<usize>,
        starts_here: bool,
        ends_here: bool,
    }

    let mut ranges = BTreeMap::<String, PendingRange>::new();
    for (offset, marker, id) in docx_markers(
        paragraph,
        &[
            ("<w:commentRangeStart", "start"),
            ("<w:commentRangeEnd", "end"),
        ],
    ) {
        let range = ranges.entry(id).or_default();
        if marker == "start" {
            range.start = Some(offset);
            range.starts_here = true;
        } else {
            range.end = Some(offset);
            range.ends_here = true;
        }
    }
    if ranges.is_empty() {
        if let Some(id) = docx_tag_attr(paragraph, "<w:commentReference", "w:id") {
            let end = visible_utf16_len(paragraph);
            return vec![json!({ "commentId": id, "start": 0, "end": end })];
        }
    }
    let paragraph_end = visible_utf16_len(paragraph);
    ranges
        .into_iter()
        .filter_map(|(id, range)| {
            let start = range.start.unwrap_or(0).min(paragraph_end);
            let end = range.end.unwrap_or(paragraph_end).min(paragraph_end);
            (end > start).then(|| {
                let mut value = json!({
                    "commentId": id,
                    "start": start,
                    "end": end,
                });
                if !range.starts_here {
                    value["startsHere"] = json!(false);
                }
                if !range.ends_here {
                    value["endsHere"] = json!(false);
                }
                value
            })
        })
        .collect()
}

pub(super) fn docx_hyperlink_ranges(
    paragraph: &str,
    relationship_targets: &BTreeMap<String, String>,
    block_id: &str,
) -> Vec<Value> {
    let mut ranges = Vec::new();
    let mut rest = paragraph;
    let mut absolute_offset = 0usize;
    let mut index = 1usize;
    while let Some(relative_start) = rest.find("<w:hyperlink") {
        let start = absolute_offset + relative_start;
        let after_start = &paragraph[start..];
        let Some(relative_end) = after_start.find("</w:hyperlink>") else {
            break;
        };
        let end = start + relative_end + "</w:hyperlink>".len();
        let segment = &paragraph[start..end];
        if let Some(relationship_id) = docx_tag_attr(segment, "<w:hyperlink", "r:id") {
            let range_start = visible_utf16_len(&paragraph[..start]);
            let range_end = range_start + visible_utf16_len(segment);
            if range_end > range_start {
                let mut item = json!({
                    "id": format!("{block_id}-link-{index}"),
                    "start": range_start,
                    "end": range_end,
                    "relationshipId": relationship_id,
                    "target": relationship_targets
                        .get(&relationship_id)
                        .cloned()
                        .unwrap_or_default(),
                });
                if item["target"].as_str().is_some_and(str::is_empty) {
                    item.as_object_mut().expect("object").remove("target");
                }
                ranges.push(item);
                index += 1;
            }
        }
        absolute_offset = end;
        rest = &paragraph[end..];
    }
    ranges
}

pub(super) fn docx_note_references(paragraph: &str) -> Vec<Value> {
    let mut references = Vec::new();
    for (offset, marker, id) in docx_markers(
        paragraph,
        &[
            ("<w:footnoteReference", "footnote"),
            ("<w:endnoteReference", "endnote"),
        ],
    ) {
        references.push(json!({
            "id": id,
            "kind": marker,
            "offset": offset,
            "affinity": "after",
        }));
    }
    references.sort_by_key(|reference| {
        reference
            .get("offset")
            .and_then(Value::as_u64)
            .unwrap_or_default()
    });
    references
}

pub(super) fn docx_has_explicit_text_anchors(block: &Value) -> bool {
    block.get("commentRanges").is_some()
        || block.get("hyperlinks").is_some()
        || block.get("noteReferences").is_some()
}

pub(super) fn docx_text_anchors_match_model(paragraph: &str, block: &Value) -> bool {
    if let Some(expected) = block.get("commentRanges").and_then(Value::as_array) {
        if !ranges_match(
            &docx_comment_ranges(paragraph),
            expected,
            &["commentId", "start", "end", "startsHere", "endsHere"],
        ) {
            return false;
        }
    }
    if let Some(expected) = block.get("hyperlinks").and_then(Value::as_array) {
        let parsed = docx_hyperlink_ranges(paragraph, &BTreeMap::new(), "block");
        if !ranges_match(&parsed, expected, &["start", "end", "relationshipId"]) {
            return false;
        }
    }
    if let Some(expected) = block.get("noteReferences").and_then(Value::as_array) {
        if !ranges_match(
            &docx_note_references(paragraph),
            expected,
            &["id", "kind", "offset"],
        ) {
            return false;
        }
    }
    true
}

pub(super) fn build_docx_anchored_run_sequence(block: &Value, text: &str) -> String {
    if !docx_has_explicit_text_anchors(block) {
        return build_docx_run_sequence(block, text);
    }
    let text_len = text.encode_utf16().count();
    let comments = valid_ranges(block, "commentRanges", text_len);
    let hyperlinks = valid_ranges(block, "hyperlinks", text_len);
    let notes = valid_note_references(block, text_len);
    let runs = valid_runs_or_block(block, text);
    let mut boundaries = BTreeSet::from([0usize, text_len]);
    let mut run_offset = 0usize;
    for run in &runs {
        boundaries.insert(run_offset);
        run_offset += run
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .encode_utf16()
            .count();
        boundaries.insert(run_offset.min(text_len));
    }
    for range in comments.iter().chain(hyperlinks.iter()) {
        boundaries.insert(range.start);
        boundaries.insert(range.end);
    }
    for note in &notes {
        boundaries.insert(note.offset);
    }
    let boundaries = boundaries.into_iter().collect::<Vec<_>>();
    let mut output = String::new();
    for (index, boundary) in boundaries.iter().enumerate() {
        for note in notes.iter().filter(|note| note.offset == *boundary) {
            output.push_str(&build_note_reference(note));
        }
        let mut opening = comments
            .iter()
            .filter(|range| range.start == *boundary && range.starts_here)
            .collect::<Vec<_>>();
        opening.sort_by_key(|range| std::cmp::Reverse(range.end));
        for range in opening {
            output.push_str(&format!(
                r#"<w:commentRangeStart w:id="{}"/>"#,
                escape_xml(range.reference.as_deref().unwrap_or_default())
            ));
        }
        let Some(next_boundary) = boundaries.get(index + 1).copied() else {
            for range in comments
                .iter()
                .filter(|range| range.end == *boundary && range.ends_here)
            {
                output.push_str(&build_comment_end(range));
            }
            break;
        };
        if next_boundary > *boundary {
            let segment = utf16_slice(text, *boundary, next_boundary);
            if !segment.is_empty() {
                let mut run = run_at_offset(&runs, *boundary).unwrap_or_else(|| block.clone());
                run["text"] = json!(segment);
                let run_xml = build_docx_run(&run, run["text"].as_str().unwrap_or_default());
                if let Some(link) = hyperlinks
                    .iter()
                    .find(|range| range.start <= *boundary && range.end >= next_boundary)
                {
                    if let Some(relationship_id) = link.relationship_id.as_deref() {
                        output.push_str(&format!(
                            r#"<w:hyperlink r:id="{}">{run_xml}</w:hyperlink>"#,
                            escape_xml(relationship_id)
                        ));
                    } else {
                        output.push_str(&run_xml);
                    }
                } else {
                    output.push_str(&run_xml);
                }
            }
        }
        let mut closing = comments
            .iter()
            .filter(|range| range.end == next_boundary && range.ends_here)
            .collect::<Vec<_>>();
        closing.sort_by_key(|range| std::cmp::Reverse(range.start));
        for range in closing {
            output.push_str(&build_comment_end(range));
        }
    }
    output
}

#[derive(Clone)]
struct AnchoredRange {
    start: usize,
    end: usize,
    reference: Option<String>,
    relationship_id: Option<String>,
    starts_here: bool,
    ends_here: bool,
}

#[derive(Clone)]
struct NoteReference {
    id: String,
    kind: String,
    offset: usize,
}

fn valid_ranges(block: &Value, key: &str, text_len: usize) -> Vec<AnchoredRange> {
    block
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|range| {
            let start = range.get("start")?.as_u64()? as usize;
            let end = range.get("end")?.as_u64()? as usize;
            if start >= end || end > text_len {
                return None;
            }
            Some(AnchoredRange {
                start,
                end,
                reference: range
                    .get("commentId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                relationship_id: range
                    .get("relationshipId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                starts_here: range
                    .get("startsHere")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                ends_here: range
                    .get("endsHere")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            })
        })
        .collect()
}

fn valid_note_references(block: &Value, text_len: usize) -> Vec<NoteReference> {
    block
        .get("noteReferences")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|reference| {
            let id = reference.get("id")?.as_str()?.trim();
            let kind = reference.get("kind")?.as_str()?;
            let offset = reference.get("offset")?.as_u64()? as usize;
            (!id.is_empty() && matches!(kind, "footnote" | "endnote") && offset <= text_len).then(
                || NoteReference {
                    id: id.to_string(),
                    kind: kind.to_string(),
                    offset,
                },
            )
        })
        .collect()
}

fn valid_runs_or_block(block: &Value, text: &str) -> Vec<Value> {
    let Some(runs) = block.get("runs").and_then(Value::as_array) else {
        return vec![block.clone()];
    };
    if runs.is_empty() || docx_runs_text(runs) != text {
        vec![block.clone()]
    } else {
        runs.clone()
    }
}

fn run_at_offset(runs: &[Value], target: usize) -> Option<Value> {
    let mut offset = 0usize;
    for run in runs {
        let length = run
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .encode_utf16()
            .count();
        if target >= offset && target < offset + length {
            return Some(run.clone());
        }
        offset += length;
    }
    runs.last().cloned()
}

fn build_note_reference(reference: &NoteReference) -> String {
    let (tag, style) = if reference.kind == "footnote" {
        ("w:footnoteReference", "FootnoteReference")
    } else {
        ("w:endnoteReference", "EndnoteReference")
    };
    format!(
        r#"<w:r><w:rPr><w:rStyle w:val="{style}"/></w:rPr><{tag} w:id="{}"/></w:r>"#,
        escape_xml(&reference.id)
    )
}

fn build_comment_end(range: &AnchoredRange) -> String {
    let id = escape_xml(range.reference.as_deref().unwrap_or_default());
    format!(
        r#"<w:commentRangeEnd w:id="{id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{id}"/></w:r>"#
    )
}

fn docx_markers(paragraph: &str, markers: &[(&str, &str)]) -> Vec<(usize, String, String)> {
    let mut found = Vec::new();
    for (needle, kind) in markers {
        let mut cursor = 0usize;
        while let Some(relative) = paragraph[cursor..].find(needle) {
            let start = cursor + relative;
            let Some(tag_end) = paragraph[start..].find('>') else {
                break;
            };
            let segment = &paragraph[start..start + tag_end + 1];
            if let Some(id) = docx_tag_attr(segment, needle, "w:id") {
                found.push((
                    visible_utf16_len(&paragraph[..start]),
                    (*kind).to_string(),
                    id,
                ));
            }
            cursor = start + tag_end + 1;
        }
    }
    found.sort_by_key(|(offset, _, _)| *offset);
    found
}

fn visible_utf16_len(xml: &str) -> usize {
    extract_text_tags(xml, "w:t")
        .iter()
        .map(|text| text.encode_utf16().count())
        .sum()
}

fn utf16_slice(value: &str, start: usize, end: usize) -> String {
    let start_byte = utf16_byte_index(value, start);
    let end_byte = utf16_byte_index(value, end);
    value[start_byte..end_byte].to_string()
}

fn utf16_byte_index(value: &str, target: usize) -> usize {
    let mut utf16_offset = 0usize;
    for (byte_index, character) in value.char_indices() {
        if utf16_offset >= target {
            return byte_index;
        }
        let next = utf16_offset + character.len_utf16();
        if next > target {
            return byte_index;
        }
        utf16_offset = next;
    }
    value.len()
}

fn ranges_match(parsed: &[Value], expected: &[Value], keys: &[&str]) -> bool {
    if parsed.len() != expected.len() {
        return false;
    }
    parsed.iter().zip(expected).all(|(left, right)| {
        keys.iter().all(|key| {
            let left_value = left.get(*key);
            let right_value = right.get(*key);
            match (*key, left_value, right_value) {
                ("startsHere" | "endsHere", None, None) => true,
                ("startsHere" | "endsHere", None, Some(Value::Bool(true))) => true,
                ("startsHere" | "endsHere", Some(Value::Bool(true)), None) => true,
                _ => left_value == right_value,
            }
        })
    })
}
