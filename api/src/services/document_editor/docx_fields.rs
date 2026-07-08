use serde_json::{json, Value};

use super::{attr_value, extract_text_tags, find_xml_start, set_xml_attr, xml_named_segments};

/// DOCX fields are generated structures owned partly by Word and partly by the
/// document author. mymy exposes field instructions so TOC, references,
/// captions, and page fields are visible to the editor while keeping the
/// original OOXML shape intact. Only simple-field instructions are rewritten by
/// position; complex field result runs are preserved because regenerating them
/// correctly requires a full Word field update engine.
pub(super) fn docx_paragraph_fields(paragraph: &str) -> Vec<Value> {
    let mut fields = Vec::new();
    for (index, segment) in xml_named_segments(paragraph, "w:fldSimple")
        .into_iter()
        .enumerate()
    {
        let instruction = attr_value(&segment, "w:instr")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
        fields.push(json!({
            "id": format!("simple{}", index + 1),
            "source": "simple",
            "kind": docx_field_kind(&instruction),
            "instruction": instruction,
            "resultText": extract_text_tags(&segment, "w:t").join("")
        }));
    }

    let instruction = extract_text_tags(paragraph, "w:instrText")
        .join("")
        .trim()
        .to_string();
    if !instruction.is_empty() {
        fields.push(json!({
            "id": format!("complex{}", fields.len() + 1),
            "source": "complex",
            "kind": docx_field_kind(&instruction),
            "instruction": instruction,
            "resultText": extract_text_tags(paragraph, "w:t").join("")
        }));
    }

    fields
}

pub(super) fn replace_docx_simple_field_instructions(paragraph: &str, block: &Value) -> String {
    let Some(fields) = block.get("fields").and_then(Value::as_array) else {
        return paragraph.to_string();
    };
    let simple_fields = fields
        .iter()
        .filter(|field| {
            field
                .get("source")
                .and_then(Value::as_str)
                .is_some_and(|source| source == "simple")
        })
        .collect::<Vec<_>>();
    if simple_fields.is_empty() {
        return paragraph.to_string();
    }

    let mut output = String::new();
    let mut rest = paragraph;
    let mut field_index = 0usize;
    while let Some(start) = find_xml_start(rest, "<w:fldSimple") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(open_end) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let start_tag = &after_start[..=open_end];
        if let Some(instruction) = simple_fields
            .get(field_index)
            .and_then(|field| field.get("instruction"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            output.push_str(&set_xml_attr(start_tag, "w:instr", instruction));
        } else {
            output.push_str(start_tag);
        }
        rest = &after_start[open_end + 1..];
        field_index += 1;
    }
    output.push_str(rest);
    output
}

fn docx_field_kind(instruction: &str) -> String {
    instruction
        .split_whitespace()
        .next()
        .map(|value| value.trim_matches('=').to_ascii_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "FIELD".to_string())
}
