use serde_json::{json, Value};

use super::{
    append_before_or_end, docx_plain_paragraph_xml, extract_text_tags, read_zip_text,
    replace_docx_paragraph_text, xml_segments, zip_entry_names,
};

pub(super) fn docx_text_parts(bytes: &[u8], kind: &str) -> Vec<Value> {
    zip_entry_names(bytes)
        .unwrap_or_default()
        .into_iter()
        .filter(|name| docx_text_part_path_allowed(name, kind))
        .filter_map(|path| {
            let xml = read_zip_text(bytes, &path).ok()?;
            Some(json!({
                "path": path,
                "kind": kind,
                "text": docx_text_part_lines(&xml).join("\n"),
                "sourceXml": xml
            }))
        })
        .collect()
}

pub(super) fn add_docx_text_part_replacements(
    original: &[u8],
    value: Option<&Value>,
    kind: &str,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(parts) = value.and_then(Value::as_array) else {
        return;
    };
    for part in parts {
        let Some(path) = part.get("path").and_then(Value::as_str) else {
            continue;
        };
        if !docx_text_part_path_allowed(path, kind) {
            continue;
        }
        let Some(text) = part.get("text").and_then(Value::as_str) else {
            continue;
        };
        let Ok(xml) = read_zip_text(original, path) else {
            continue;
        };
        replacements.push((
            path.to_string(),
            update_docx_text_part(&xml, text).into_bytes(),
        ));
    }
}

fn docx_text_part_path_allowed(path: &str, kind: &str) -> bool {
    let prefix = match kind {
        "header" => "word/header",
        "footer" => "word/footer",
        _ => return false,
    };
    path.starts_with(prefix) && path.ends_with(".xml") && !path.contains("..")
}

fn docx_text_part_lines(xml: &str) -> Vec<String> {
    xml_segments(xml, "<w:p", "</w:p>")
        .into_iter()
        .map(|paragraph| extract_text_tags(&paragraph, "w:t").join(""))
        .filter(|line| !line.trim().is_empty())
        .collect()
}

fn update_docx_text_part(xml: &str, text: &str) -> String {
    let lines = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut output = String::new();
    let mut rest = xml;
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
    if line_index < lines.len() {
        insert_docx_text_part_paragraphs(&output, &lines[line_index..])
    } else {
        output
    }
}

fn insert_docx_text_part_paragraphs(xml: &str, lines: &[String]) -> String {
    let paragraphs = lines
        .iter()
        .map(|line| docx_plain_paragraph_xml(line))
        .collect::<Vec<_>>()
        .join("");
    if xml.contains("</w:hdr>") {
        append_before_or_end(xml, "</w:hdr>", &paragraphs)
    } else {
        append_before_or_end(xml, "</w:ftr>", &paragraphs)
    }
}
