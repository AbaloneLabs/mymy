use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::{
    append_before_or_end, attr_value, docx_tag_attr, ensure_content_type_override,
    ensure_docx_part_relationship, read_zip_text, xml_segments,
};

pub(super) const DOCX_BULLET_NUM_ID: &str = "9001";
pub(super) const DOCX_NUMBER_NUM_ID: &str = "9002";
const DOCX_BULLET_ABSTRACT_NUM_ID: &str = "9001";
const DOCX_NUMBER_ABSTRACT_NUM_ID: &str = "9002";

pub(super) fn docx_blocks_have_lists(blocks: &[Value]) -> bool {
    blocks.iter().any(|block| {
        block
            .get("listKind")
            .and_then(Value::as_str)
            .is_some_and(|value| matches!(value, "bullet" | "number"))
    })
}

pub(super) fn add_docx_numbering_replacements(
    original: &[u8],
    blocks: &mut [Value],
    relationships: &mut String,
    content_types: &mut String,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let numbering = read_zip_text(original, "word/numbering.xml").unwrap_or_default();
    let numbering = ensure_docx_basic_numbering_xml(&numbering);
    let numbering = ensure_docx_restart_numbering_xml(&numbering, blocks);
    replacements.push(("word/numbering.xml".to_string(), numbering.into_bytes()));
    *relationships = ensure_docx_numbering_relationship(relationships.as_str());
    *content_types = ensure_docx_numbering_content_type(content_types.as_str());
}

pub(super) fn docx_list_numbering_id(xml: &str) -> Option<String> {
    docx_tag_attr(xml, "<w:numId", "w:val")
}

pub(super) fn docx_list_level(xml: &str) -> Option<u32> {
    docx_tag_attr(xml, "<w:ilvl", "w:val").and_then(|value| {
        value
            .parse::<u32>()
            .ok()
            .filter(|level| (0..=8).contains(level))
    })
}

pub(super) fn docx_list_kind(
    xml: &str,
    numbering_formats: &BTreeMap<String, String>,
) -> Option<String> {
    let num_id = docx_tag_attr(xml, "<w:numId", "w:val")?;
    numbering_formats
        .get(&num_id)
        .cloned()
        .or_else(|| Some("number".to_string()))
}

pub(super) fn docx_numbering_start_overrides(numbering: &str) -> BTreeMap<(String, u32), u32> {
    let mut starts = BTreeMap::new();
    for num in xml_segments(numbering, "<w:num ", "</w:num>") {
        let Some(num_id) = attr_value(&num, "w:numId").or_else(|| attr_value(&num, "numId")) else {
            continue;
        };
        for override_xml in xml_segments(&num, "<w:lvlOverride", "</w:lvlOverride>") {
            let Some(level) = attr_value(&override_xml, "w:ilvl")
                .or_else(|| attr_value(&override_xml, "ilvl"))
                .and_then(|value| value.parse::<u32>().ok())
                .filter(|level| (0..=8).contains(level))
            else {
                continue;
            };
            let Some(start) = docx_tag_attr(&override_xml, "<w:startOverride", "w:val")
                .and_then(|value| value.parse::<u32>().ok())
                .filter(|start| *start > 0)
            else {
                continue;
            };
            starts.insert((num_id.clone(), level), start);
        }
    }
    starts
}

pub(super) fn docx_numbering_formats(numbering: &str) -> BTreeMap<String, String> {
    let mut abstract_formats = BTreeMap::new();
    for abstract_num in xml_segments(numbering, "<w:abstractNum", "</w:abstractNum>") {
        let Some(abstract_id) = attr_value(&abstract_num, "w:abstractNumId")
            .or_else(|| attr_value(&abstract_num, "abstractNumId"))
        else {
            continue;
        };
        let Some(format) = docx_number_format_kind(&abstract_num) else {
            continue;
        };
        abstract_formats.insert(abstract_id, format.to_string());
    }
    let mut num_formats = BTreeMap::new();
    for num in xml_segments(numbering, "<w:num ", "</w:num>") {
        let Some(num_id) = attr_value(&num, "w:numId").or_else(|| attr_value(&num, "numId")) else {
            continue;
        };
        let Some(abstract_id) = docx_tag_attr(&num, "<w:abstractNumId", "w:val") else {
            continue;
        };
        if let Some(format) = abstract_formats.get(&abstract_id) {
            num_formats.insert(num_id, format.clone());
        }
    }
    num_formats
}

fn docx_number_format_kind(xml: &str) -> Option<&'static str> {
    let format = docx_tag_attr(xml, "<w:numFmt", "w:val")?;
    if format == "bullet" {
        Some("bullet")
    } else if matches!(
        format.as_str(),
        "decimal" | "decimalZero" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman"
    ) {
        Some("number")
    } else {
        None
    }
}

pub(super) fn ensure_docx_basic_numbering_xml(existing: &str) -> String {
    let trimmed = existing.trim();
    if trimmed.is_empty() {
        return format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">{}</w:numbering>"#,
            docx_basic_numbering_definitions(true, true)
        );
    }
    let needs_bullet = !existing.contains(&format!(r#"w:numId="{DOCX_BULLET_NUM_ID}""#));
    let needs_number = !existing.contains(&format!(r#"w:numId="{DOCX_NUMBER_NUM_ID}""#));
    let inserted = docx_basic_numbering_definitions(needs_bullet, needs_number);
    if inserted.is_empty() {
        return existing.to_string();
    }
    append_before_or_end(existing, "</w:numbering>", &inserted)
}

fn docx_basic_numbering_definitions(include_bullet: bool, include_number: bool) -> String {
    let mut xml = String::new();
    if include_bullet {
        xml.push_str(&format!(
            r#"<w:abstractNum w:abstractNumId="{DOCX_BULLET_ABSTRACT_NUM_ID}"><w:multiLevelType w:val="hybridMultilevel"/>{}</w:abstractNum><w:num w:numId="{DOCX_BULLET_NUM_ID}"><w:abstractNumId w:val="{DOCX_BULLET_ABSTRACT_NUM_ID}"/></w:num>"#,
            docx_basic_levels("bullet")
        ));
    }
    if include_number {
        xml.push_str(&format!(
            r#"<w:abstractNum w:abstractNumId="{DOCX_NUMBER_ABSTRACT_NUM_ID}"><w:multiLevelType w:val="hybridMultilevel"/>{}</w:abstractNum><w:num w:numId="{DOCX_NUMBER_NUM_ID}"><w:abstractNumId w:val="{DOCX_NUMBER_ABSTRACT_NUM_ID}"/></w:num>"#,
            docx_basic_levels("number")
        ));
    }
    xml
}

fn docx_basic_levels(kind: &str) -> String {
    (0..=8)
        .map(|level| {
            let left = (level + 1) * 720;
            let (format, text) = if kind == "bullet" {
                ("bullet", "&#8226;".to_string())
            } else {
                ("decimal", format!("%{}.", level + 1))
            };
            format!(
                r#"<w:lvl w:ilvl="{level}"><w:start w:val="1"/><w:numFmt w:val="{format}"/><w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{left}" w:hanging="360"/></w:pPr></w:lvl>"#
            )
        })
        .collect::<Vec<_>>()
        .join("")
}

fn ensure_docx_restart_numbering_xml(existing: &str, blocks: &mut [Value]) -> String {
    let existing_starts = docx_numbering_start_overrides(existing);
    let mut used_ids = docx_numbering_ids(existing);
    let mut inserted = String::new();
    for block in blocks {
        if block.get("listKind").and_then(Value::as_str) != Some("number") {
            continue;
        }
        let Some(start) = block
            .get("listStart")
            .and_then(Value::as_u64)
            .filter(|start| *start > 0 && *start <= 100_000)
            .map(|start| start as u32)
        else {
            continue;
        };
        let level = block
            .get("listLevel")
            .and_then(Value::as_u64)
            .filter(|level| *level <= 8)
            .map(|level| level as u32)
            .unwrap_or(0);
        if let Some(existing_id) = block
            .get("listNumberingId")
            .and_then(Value::as_str)
            .filter(|id| existing_starts.get(&(id.to_string(), level)) == Some(&start))
        {
            used_ids.insert(existing_id.to_string());
            continue;
        }
        let num_id = next_docx_numbering_id(&used_ids);
        used_ids.insert(num_id.clone());
        block["listNumberingId"] = json!(num_id.clone());
        inserted.push_str(&docx_restart_numbering_definition(&num_id, level, start));
    }
    if inserted.is_empty() {
        existing.to_string()
    } else {
        append_before_or_end(existing, "</w:numbering>", &inserted)
    }
}

fn docx_restart_numbering_definition(num_id: &str, level: u32, start: u32) -> String {
    format!(
        r#"<w:num w:numId="{num_id}"><w:abstractNumId w:val="{DOCX_NUMBER_ABSTRACT_NUM_ID}"/><w:lvlOverride w:ilvl="{level}"><w:startOverride w:val="{start}"/></w:lvlOverride></w:num>"#
    )
}

fn docx_numbering_ids(numbering: &str) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    for num in xml_segments(numbering, "<w:num ", "</w:num>") {
        if let Some(num_id) = attr_value(&num, "w:numId").or_else(|| attr_value(&num, "numId")) {
            ids.insert(num_id);
        }
    }
    ids
}

fn next_docx_numbering_id(used_ids: &BTreeSet<String>) -> String {
    let mut id = 9100u32;
    while used_ids.contains(&id.to_string()) {
        id += 1;
    }
    id.to_string()
}

fn ensure_docx_numbering_relationship(rels: &str) -> String {
    ensure_docx_part_relationship(
        rels,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
        "numbering.xml",
    )
}

fn ensure_docx_numbering_content_type(content_types: &str) -> String {
    ensure_content_type_override(
        content_types,
        "/word/numbering.xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
    )
}
