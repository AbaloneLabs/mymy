use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use super::{
    append_before_or_end, docx_plain_paragraph_xml, docx_tag_attr, ensure_content_type_override,
    ensure_docx_part_relationship, escape_xml, read_zip_text, replace_docx_paragraph_text,
};

#[derive(Debug, Clone, Copy)]
pub(super) struct DocxNotePartSpec {
    path: &'static str,
    item_tag: &'static str,
    root_tag: &'static str,
    relationship_target: &'static str,
    relationship_type: &'static str,
    content_type: &'static str,
}

pub(super) const DOCX_FOOTNOTE_PART: DocxNotePartSpec = DocxNotePartSpec {
    path: "word/footnotes.xml",
    item_tag: "w:footnote",
    root_tag: "w:footnotes",
    relationship_target: "footnotes.xml",
    relationship_type:
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
    content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
};

pub(super) const DOCX_ENDNOTE_PART: DocxNotePartSpec = DocxNotePartSpec {
    path: "word/endnotes.xml",
    item_tag: "w:endnote",
    root_tag: "w:endnotes",
    relationship_target: "endnotes.xml",
    relationship_type:
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes",
    content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml",
};

pub(super) fn add_docx_note_replacements(
    original: &[u8],
    value: Option<&Value>,
    spec: DocxNotePartSpec,
    relationships: &mut String,
    content_types: &mut String,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> bool {
    let Some(notes) = value.and_then(Value::as_array) else {
        return false;
    };
    if notes.is_empty() {
        return false;
    };
    let xml = read_zip_text(original, spec.path)
        .unwrap_or_else(|_| empty_docx_notes_xml(spec.root_tag, spec.item_tag));
    let updated = update_docx_notes_xml(&xml, notes, spec.item_tag);
    replacements.push((spec.path.to_string(), updated.into_bytes()));
    *relationships = ensure_docx_part_relationship(
        relationships,
        spec.relationship_type,
        spec.relationship_target,
    );
    *content_types =
        ensure_content_type_override(content_types, &format!("/{}", spec.path), spec.content_type);
    true
}

fn update_docx_notes_xml(xml: &str, notes: &[Value], tag: &str) -> String {
    let note_map = notes
        .iter()
        .filter_map(|note| {
            let id = note.get("id").and_then(Value::as_str)?;
            Some((id.to_string(), note))
        })
        .collect::<BTreeMap<_, _>>();
    let mut output = String::new();
    let mut rest = xml;
    let end_tag = format!("</{tag}>");
    let mut seen_ids = BTreeSet::new();
    while let Some(start) = super::find_xml_tag_start(rest, tag) {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find(&end_tag) else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + end_tag.len();
        let segment = &after_start[..end_index];
        let id = docx_tag_attr(segment, &format!("<{tag}"), "w:id");
        if let Some(id) = id {
            seen_ids.insert(id.clone());
            if let Some(note) = note_map.get(&id) {
                output.push_str(&update_docx_note_segment(segment, note));
            } else {
                output.push_str(segment);
            }
        } else {
            output.push_str(segment);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    let missing_notes = notes
        .iter()
        .filter_map(|note| build_missing_docx_note_segment(note, tag, &seen_ids))
        .collect::<Vec<_>>()
        .join("");
    if missing_notes.is_empty() {
        return output;
    }
    let root_end_tag = if tag == "w:footnote" {
        "</w:footnotes>"
    } else {
        "</w:endnotes>"
    };
    append_before_or_end(&output, root_end_tag, &missing_notes)
}

fn empty_docx_notes_xml(root_tag: &str, tag: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><{root_tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><{tag} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></{tag}><{tag} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></{tag}></{root_tag}>"#
    )
}

fn build_missing_docx_note_segment(
    note: &Value,
    tag: &str,
    seen_ids: &BTreeSet<String>,
) -> Option<String> {
    let id = note.get("id").and_then(Value::as_str)?.trim();
    if id.is_empty() || id.starts_with('-') || id == "0" || seen_ids.contains(id) {
        return None;
    }
    let paragraphs = note
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
        r#"<{tag} w:id="{}">{paragraphs}</{tag}>"#,
        escape_xml(id)
    ))
}

fn update_docx_note_segment(segment: &str, note: &Value) -> String {
    if let Some(text) = note.get("text").and_then(Value::as_str) {
        update_docx_note_text(segment, text)
    } else {
        segment.to_string()
    }
}

fn update_docx_note_text(note: &str, text: &str) -> String {
    let lines = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut output = String::new();
    let mut rest = note;
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
            return insert_docx_note_paragraphs(&output, &lines[line_index..]);
        }
        return output;
    }
    let paragraphs = lines
        .iter()
        .map(|line| docx_plain_paragraph_xml(line))
        .collect::<Vec<_>>()
        .join("");
    if note.contains("</w:footnote>") {
        append_before_or_end(note, "</w:footnote>", &paragraphs)
    } else {
        append_before_or_end(note, "</w:endnote>", &paragraphs)
    }
}

fn insert_docx_note_paragraphs(xml: &str, lines: &[String]) -> String {
    let paragraphs = lines
        .iter()
        .map(|line| docx_plain_paragraph_xml(line))
        .collect::<Vec<_>>()
        .join("");
    if xml.contains("</w:footnote>") {
        append_before_or_end(xml, "</w:footnote>", &paragraphs)
    } else {
        append_before_or_end(xml, "</w:endnote>", &paragraphs)
    }
}

pub(super) fn docx_note_reference_run(
    block: &Value,
    field: &str,
    tag: &str,
    reference_style: &str,
) -> String {
    let Some(id) = block
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return String::new();
    };
    format!(
        r#"<w:r><w:rPr><w:rStyle w:val="{reference_style}"/></w:rPr><{tag} w:id="{}"/></w:r>"#,
        escape_xml(id)
    )
}

pub(super) fn docx_paragraph_needs_note_reference_rebuild(paragraph: &str, block: &Value) -> bool {
    [
        ("footnoteId", "<w:footnoteReference"),
        ("endnoteId", "<w:endnoteReference"),
    ]
    .iter()
    .any(|(field, tag)| {
        block
            .get(*field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .is_some_and(|id| docx_tag_attr(paragraph, tag, "w:id").as_deref() != Some(id))
    })
}
