use serde_json::Value;

use super::docx_comments::{
    docx_comment_range_end_and_reference, docx_comment_range_start,
    docx_paragraph_needs_comment_reference_rebuild,
};
use super::docx_notes::{docx_note_reference_run, docx_paragraph_needs_note_reference_rebuild};
use super::docx_numbering::{DOCX_BULLET_NUM_ID, DOCX_NUMBER_NUM_ID};
use super::docx_tables::build_docx_table;
use super::ooxml_images::{build_docx_image_paragraph, docx_image_relationship_id};
use super::{
    docx_bookmark_id, docx_bookmark_id_from_model, docx_bookmark_name,
    docx_bookmark_name_from_model, docx_hex_color, docx_tag_attr, docx_text_with_breaks,
    docx_u32_model_attr, escape_xml, extract_text_tags, replace_tag_texts,
};

pub(super) fn replace_docx_blocks(document: &str, blocks: &[Value]) -> String {
    let mut output = String::new();
    let mut rest = document;
    let mut block_index = 0usize;
    loop {
        let paragraph = rest.find("<w:p").map(|index| (index, "</w:p>", false));
        let table = rest.find("<w:tbl").map(|index| (index, "</w:tbl>", true));
        let next = match (paragraph, table) {
            (Some(paragraph), Some(table)) => Some(if paragraph.0 <= table.0 {
                paragraph
            } else {
                table
            }),
            (Some(paragraph), None) => Some(paragraph),
            (None, Some(table)) => Some(table),
            (None, None) => None,
        };
        let Some((start, end_marker, is_table)) = next else {
            break;
        };
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find(end_marker) else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + end_marker.len();
        let segment = &after_start[..end_index];
        let has_text = !extract_text_tags(segment, "w:t").join("").trim().is_empty();
        let has_page_break = docx_paragraph_has_page_break(segment);
        let has_section_break = docx_paragraph_has_section_break(segment);
        let has_editor_content = is_table
            || has_text
            || has_page_break
            || has_section_break
            || docx_image_relationship_id(segment).is_some();
        if has_editor_content {
            if let Some(block) = blocks.get(block_index) {
                let block_type = block.get("type").and_then(Value::as_str);
                if block_type == Some("image") {
                    output.push_str(&build_docx_image_paragraph(block));
                } else if matches!(block_type, Some("pageBreak" | "sectionBreak")) || is_table {
                    output.push_str(&build_docx_block(block));
                } else if docx_paragraph_has_complex_content(segment)
                    && !docx_paragraph_needs_note_reference_rebuild(segment, block)
                    && !docx_paragraph_needs_comment_reference_rebuild(segment, block)
                    && docx_paragraph_bookmark_matches_model(segment, block)
                {
                    let replacement = block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    output.push_str(&replace_tag_texts(segment, "w:t", &[replacement]));
                } else {
                    output.push_str(&build_docx_block(block));
                }
            } else {
                output.push_str(segment);
            }
            block_index += 1;
        } else {
            output.push_str(segment);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    if block_index < blocks.len() {
        insert_docx_blocks(&output, &blocks[block_index..])
    } else {
        output
    }
}

fn docx_paragraph_has_complex_content(paragraph: &str) -> bool {
    [
        "<w:drawing",
        "<w:pict",
        "<w:object",
        "<w:hyperlink",
        "<w:fldSimple",
        "<w:bookmarkStart",
        "<w:footnoteReference",
        "<w:endnoteReference",
    ]
    .iter()
    .any(|marker| paragraph.contains(marker))
}

pub(super) fn docx_paragraph_has_page_break(paragraph: &str) -> bool {
    paragraph.contains("<w:br")
        && docx_tag_attr(paragraph, "<w:br", "w:type").as_deref() == Some("page")
}

pub(super) fn docx_paragraph_has_section_break(paragraph: &str) -> bool {
    paragraph.contains("<w:sectPr")
}

pub(super) fn docx_section_break_kind(paragraph: &str) -> String {
    docx_tag_attr(paragraph, "<w:type", "w:val")
        .filter(|value| {
            matches!(
                value.as_str(),
                "nextPage" | "continuous" | "evenPage" | "oddPage"
            )
        })
        .unwrap_or_else(|| "nextPage".to_string())
}

fn insert_docx_blocks(document: &str, blocks: &[Value]) -> String {
    let inserted = blocks
        .iter()
        .map(build_docx_block)
        .collect::<Vec<_>>()
        .join("");
    if let Some(index) = document.find("<w:sectPr") {
        let mut output = String::new();
        output.push_str(&document[..index]);
        output.push_str(&inserted);
        output.push_str(&document[index..]);
        return output;
    }
    if let Some(index) = document.find("</w:body>") {
        let mut output = String::new();
        output.push_str(&document[..index]);
        output.push_str(&inserted);
        output.push_str(&document[index..]);
        return output;
    }
    format!("{document}{inserted}")
}

fn build_docx_block(block: &Value) -> String {
    match block.get("type").and_then(Value::as_str) {
        Some("table") => build_docx_table(block),
        Some("image") => build_docx_image_paragraph(block),
        Some("pageBreak") => build_docx_page_break(),
        Some("sectionBreak") => build_docx_section_break(block),
        _ => build_docx_paragraph(block),
    }
}

fn build_docx_page_break() -> String {
    r#"<w:p><w:r><w:br w:type="page"/></w:r></w:p>"#.to_string()
}

fn build_docx_section_break(block: &Value) -> String {
    let break_kind = block
        .get("breakKind")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "nextPage" | "continuous" | "evenPage" | "oddPage"))
        .unwrap_or("nextPage");
    format!(r#"<w:p><w:pPr><w:sectPr><w:type w:val="{break_kind}"/></w:sectPr></w:pPr></w:p>"#)
}

pub(super) fn build_docx_paragraph(block: &Value) -> String {
    let text = block
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let style = docx_paragraph_properties(block);
    let run_properties = docx_run_properties(block);
    let text_xml = docx_text_with_breaks(text);
    let run = format!("<w:r>{run_properties}{text_xml}</w:r>");
    let note_references = format!(
        "{}{}",
        docx_note_reference_run(
            block,
            "footnoteId",
            "w:footnoteReference",
            "FootnoteReference"
        ),
        docx_note_reference_run(block, "endnoteId", "w:endnoteReference", "EndnoteReference")
    );
    let bookmark_name = docx_bookmark_name_from_model(block);
    let bookmark_id = docx_bookmark_id_from_model(block).unwrap_or(0);
    let bookmark_start = bookmark_name.as_ref().map_or_else(String::new, |name| {
        format!(
            r#"<w:bookmarkStart w:id="{bookmark_id}" w:name="{}"/>"#,
            escape_xml(name)
        )
    });
    let bookmark_end = bookmark_name.as_ref().map_or_else(String::new, |_| {
        format!(r#"<w:bookmarkEnd w:id="{bookmark_id}"/>"#)
    });
    let comment_start = docx_comment_range_start(block);
    let comment_end_and_reference = docx_comment_range_end_and_reference(block);
    if let Some(relationship_id) = block
        .get("relationshipId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        format!(
            r#"<w:p>{style}{bookmark_start}{comment_start}<w:hyperlink r:id="{}">{run}</w:hyperlink>{comment_end_and_reference}{bookmark_end}{note_references}</w:p>"#,
            escape_xml(relationship_id)
        )
    } else {
        format!("<w:p>{style}{bookmark_start}{comment_start}{run}{comment_end_and_reference}{bookmark_end}{note_references}</w:p>")
    }
}

fn docx_paragraph_bookmark_matches_model(paragraph: &str, block: &Value) -> bool {
    docx_bookmark_name(paragraph) == docx_bookmark_name_from_model(block)
        && docx_bookmark_id(paragraph) == docx_bookmark_id_from_model(block)
}

fn docx_paragraph_properties(block: &Value) -> String {
    let block_type = block
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("paragraph");
    let mut props = Vec::new();
    if block_type == "heading" {
        let heading_level = block
            .get("headingLevel")
            .and_then(Value::as_u64)
            .filter(|level| (1..=6).contains(level))
            .unwrap_or(1);
        props.push(format!(r#"<w:pStyle w:val="Heading{heading_level}"/>"#));
    }
    if let Some(list_kind) = block.get("listKind").and_then(Value::as_str) {
        let num_id = match list_kind {
            "bullet" => Some(DOCX_BULLET_NUM_ID),
            "number" => Some(DOCX_NUMBER_NUM_ID),
            _ => None,
        };
        if let Some(num_id) = num_id {
            props.push(format!(
                r#"<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num_id}"/></w:numPr>"#
            ));
        }
    }
    if let Some(align) = block
        .get("align")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "left" | "center" | "right" | "justify"))
    {
        props.push(format!(r#"<w:jc w:val="{align}"/>"#));
    }
    if block
        .get("pageBreakBefore")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push("<w:pageBreakBefore/>".to_string());
    }
    if let Some(indent_left) = docx_u32_model_attr(block, "indentLeft", 31_680) {
        props.push(format!(r#"<w:ind w:left="{indent_left}"/>"#));
    }
    let spacing_before = docx_u32_model_attr(block, "spacingBefore", 31_680);
    let spacing_after = docx_u32_model_attr(block, "spacingAfter", 31_680);
    let line_spacing = docx_u32_model_attr(block, "lineSpacing", 2_400);
    if spacing_before.is_some() || spacing_after.is_some() || line_spacing.is_some() {
        let mut attrs = Vec::new();
        if let Some(value) = spacing_before {
            attrs.push(format!(r#"w:before="{value}""#));
        }
        if let Some(value) = spacing_after {
            attrs.push(format!(r#"w:after="{value}""#));
        }
        if let Some(value) = line_spacing {
            attrs.push(format!(r#"w:line="{value}" w:lineRule="auto""#));
        }
        props.push(format!("<w:spacing {}/>", attrs.join(" ")));
    }
    if props.is_empty() {
        String::new()
    } else {
        format!("<w:pPr>{}</w:pPr>", props.join(""))
    }
}

fn docx_run_properties(block: &Value) -> String {
    let mut props = Vec::new();
    if block.get("bold").and_then(Value::as_bool).unwrap_or(false) {
        props.push("<w:b/>".to_string());
    }
    if block
        .get("italic")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push("<w:i/>".to_string());
    }
    if block
        .get("underline")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push(r#"<w:u w:val="single"/>"#.to_string());
    }
    if block
        .get("strikethrough")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        props.push("<w:strike/>".to_string());
    }
    if let Some(vertical_align) = block
        .get("verticalAlign")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "superscript" | "subscript"))
    {
        props.push(format!(r#"<w:vertAlign w:val="{vertical_align}"/>"#));
    }
    if let Some(font) = block.get("fontFamily").and_then(Value::as_str) {
        let font = escape_xml(font);
        props.push(format!(
            r#"<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}"/>"#
        ));
    }
    if let Some(size) = block
        .get("fontSize")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u32>().ok())
    {
        props.push(format!(r#"<w:sz w:val="{}"/>"#, size * 2));
    }
    if let Some(color) = block
        .get("color")
        .and_then(Value::as_str)
        .and_then(docx_hex_color)
    {
        props.push(format!(r#"<w:color w:val="{color}"/>"#));
    }
    if let Some(highlight) = block.get("highlight").and_then(Value::as_str) {
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
