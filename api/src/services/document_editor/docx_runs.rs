use serde_json::{json, Value};

use super::{
    docx_font_size, docx_hex_color, docx_tag_attr, docx_text_with_breaks, docx_vertical_align,
    escape_xml, extract_text_tags, xml_named_segments,
};

/// DOCX stores character styling at run granularity, while the editor also
/// keeps a block-level fallback for newly typed text. This module owns the
/// conversion between those two layers so parsing and writing agree on the same
/// validation rule: run metadata is used only when its concatenated text still
/// matches the paragraph text. That prevents stale frontend run arrays from
/// silently dropping user edits or corrupting the OOXML package.
pub(super) fn docx_run_models(paragraph: &str) -> Vec<Value> {
    xml_named_segments(paragraph, "w:r")
        .into_iter()
        .filter_map(|run| {
            let text = extract_text_tags(&run, "w:t").join("");
            if text.is_empty() {
                return None;
            }
            let mut item = json!({ "text": text });
            if let Some(bold) = docx_bool_run_property(&run, "<w:b") {
                item["bold"] = json!(bold);
            }
            if let Some(italic) = docx_bool_run_property(&run, "<w:i") {
                item["italic"] = json!(italic);
            }
            if let Some(underline) = docx_underline_run_property(&run) {
                item["underline"] = json!(underline);
            }
            if let Some(strikethrough) = docx_bool_run_property(&run, "<w:strike") {
                item["strikethrough"] = json!(strikethrough);
            }
            if let Some(vertical_align) = docx_vertical_align(&run) {
                item["verticalAlign"] = json!(vertical_align);
            }
            if let Some(font_family) = docx_tag_attr(&run, "<w:rFonts", "w:ascii") {
                item["fontFamily"] = json!(font_family);
            }
            if let Some(font_size) = docx_font_size(&run) {
                item["fontSize"] = json!(font_size);
            }
            if let Some(color) = docx_tag_attr(&run, "<w:color", "w:val")
                .and_then(|color| docx_hex_color(&color))
                .map(|color| format!("#{color}"))
            {
                item["color"] = json!(color);
            }
            if let Some(highlight) = docx_tag_attr(&run, "<w:highlight", "w:val") {
                item["highlight"] = json!(highlight);
            }
            Some(item)
        })
        .collect()
}

pub(super) fn docx_runs_text(runs: &[Value]) -> String {
    runs.iter()
        .filter_map(|run| run.get("text").and_then(Value::as_str))
        .collect()
}

pub(super) fn build_docx_run_sequence(block: &Value, paragraph_text: &str) -> String {
    if let Some(runs) = valid_docx_runs(block, paragraph_text) {
        return runs
            .iter()
            .map(|run| build_docx_run(run, run.get("text").and_then(Value::as_str).unwrap_or("")))
            .collect::<Vec<_>>()
            .join("");
    }
    build_docx_run(block, paragraph_text)
}

fn valid_docx_runs<'a>(block: &'a Value, paragraph_text: &str) -> Option<&'a Vec<Value>> {
    let runs = block.get("runs")?.as_array()?;
    if runs.is_empty() {
        return None;
    }
    if docx_runs_text(runs) != paragraph_text {
        return None;
    }
    Some(runs)
}

fn build_docx_run(run: &Value, text: &str) -> String {
    let run_properties = docx_run_properties(run);
    let text_xml = docx_text_with_breaks(text);
    format!("<w:r>{run_properties}{text_xml}</w:r>")
}

fn docx_run_properties(run: &Value) -> String {
    let mut props = Vec::new();
    if let Some(bold) = run.get("bold").and_then(Value::as_bool) {
        props.push(if bold {
            "<w:b/>".to_string()
        } else {
            r#"<w:b w:val="false"/>"#.to_string()
        });
    }
    if let Some(italic) = run.get("italic").and_then(Value::as_bool) {
        props.push(if italic {
            "<w:i/>".to_string()
        } else {
            r#"<w:i w:val="false"/>"#.to_string()
        });
    }
    if let Some(underline) = run.get("underline").and_then(Value::as_bool) {
        props.push(if underline {
            r#"<w:u w:val="single"/>"#.to_string()
        } else {
            r#"<w:u w:val="none"/>"#.to_string()
        });
    }
    if let Some(strikethrough) = run.get("strikethrough").and_then(Value::as_bool) {
        props.push(if strikethrough {
            "<w:strike/>".to_string()
        } else {
            r#"<w:strike w:val="false"/>"#.to_string()
        });
    }
    if let Some(vertical_align) = run
        .get("verticalAlign")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "superscript" | "subscript"))
    {
        props.push(format!(r#"<w:vertAlign w:val="{vertical_align}"/>"#));
    }
    if let Some(font) = run.get("fontFamily").and_then(Value::as_str) {
        let font = escape_xml(font);
        props.push(format!(
            r#"<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}"/>"#
        ));
    }
    if let Some(size) = run
        .get("fontSize")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u32>().ok())
    {
        props.push(format!(r#"<w:sz w:val="{}"/>"#, size * 2));
    }
    if let Some(color) = run
        .get("color")
        .and_then(Value::as_str)
        .and_then(docx_hex_color)
    {
        props.push(format!(r#"<w:color w:val="{color}"/>"#));
    }
    if let Some(highlight) = run.get("highlight").and_then(Value::as_str) {
        props.push(format!(
            r#"<w:highlight w:val="{}"/>"#,
            docx_highlight_color(highlight)
        ));
    }
    if props.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{}</w:rPr>", props.join(""))
    }
}

fn docx_highlight_color(value: &str) -> &'static str {
    match value.to_ascii_lowercase().as_str() {
        "#fef08a" | "yellow" => "yellow",
        "#bbf7d0" | "green" => "green",
        "#bfdbfe" | "blue" => "cyan",
        _ => "yellow",
    }
}

fn docx_bool_run_property(run: &str, marker: &str) -> Option<bool> {
    if !run.contains(marker) {
        return None;
    }
    Some(
        !docx_tag_attr(run, marker, "w:val").is_some_and(|value| {
            matches!(value.to_ascii_lowercase().as_str(), "false" | "0" | "off")
        }),
    )
}

fn docx_underline_run_property(run: &str) -> Option<bool> {
    if !run.contains("<w:u") {
        return None;
    }
    Some(
        !docx_tag_attr(run, "<w:u", "w:val")
            .is_some_and(|value| value.eq_ignore_ascii_case("none")),
    )
}
