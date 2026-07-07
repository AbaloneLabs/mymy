use serde_json::Value;

use crate::error::AppResult;

use super::pptx_package::pptx_slide_relationship_target;
use super::xlsx_relationships::{
    xlsx_empty_relationships, xlsx_part_rels_path, xlsx_relationships_by_id,
};
use super::{
    append_before_or_end, escape_xml, extract_text_tags, next_rid, read_zip_text,
    replace_tag_texts, replacement_zip_text_or_default, upsert_zip_replacement,
};

pub(super) fn pptx_slide_notes(bytes: &[u8], slide_path: &str) -> Option<String> {
    let notes_path = pptx_slide_notes_path(bytes, slide_path)?;
    let notes_xml = read_zip_text(bytes, &notes_path).ok()?;
    let notes = extract_text_tags(&notes_xml, "a:t")
        .into_iter()
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Some(notes)
}

pub(super) fn add_pptx_notes_replacement(
    original: &[u8],
    slide: &Value,
    slide_path: &str,
    existing_names: &mut Vec<String>,
    added_note_paths: &mut Vec<String>,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> AppResult<()> {
    let Some(notes) = slide.get("notes").and_then(Value::as_str) else {
        return Ok(());
    };
    let rels_path = xlsx_part_rels_path(slide_path);
    let rels = replacement_zip_text_or_default(
        original,
        replacements,
        &rels_path,
        xlsx_empty_relationships,
    );
    if let Some(notes_path) = pptx_slide_notes_path_from_rels(slide_path, &rels) {
        let notes_xml =
            read_zip_text(original, &notes_path).unwrap_or_else(|_| build_pptx_notes(""));
        replacements.push((
            notes_path,
            update_pptx_notes_xml(&notes_xml, notes).into_bytes(),
        ));
        return Ok(());
    }
    if notes.trim().is_empty() {
        return Ok(());
    }
    let notes_path = next_pptx_notes_path(existing_names);
    existing_names.push(notes_path.clone());
    added_note_paths.push(notes_path.clone());
    let relationship_id = format!("rId{}", next_rid(&rels));
    let target = pptx_slide_relationship_target(&notes_path);
    let relationship = format!(
        r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="{}"/>"#,
        escape_xml(&target)
    );
    let rels = append_before_or_end(&rels, "</Relationships>", &relationship);
    upsert_zip_replacement(replacements, rels_path, rels.into_bytes());
    replacements.push((notes_path, build_pptx_notes(notes).into_bytes()));
    Ok(())
}

fn pptx_slide_notes_path(bytes: &[u8], slide_path: &str) -> Option<String> {
    let rels = read_zip_text(bytes, &xlsx_part_rels_path(slide_path)).ok()?;
    pptx_slide_notes_path_from_rels(slide_path, &rels)
}

fn pptx_slide_notes_path_from_rels(slide_path: &str, rels: &str) -> Option<String> {
    xlsx_relationships_by_id(slide_path, rels)
        .into_iter()
        .find_map(|(_, (relationship_type, target))| {
            relationship_type.ends_with("/notesSlide").then_some(target)
        })
}

fn update_pptx_notes_xml(xml: &str, notes: &str) -> String {
    if xml.contains("<a:t") {
        return replace_tag_texts(xml, "a:t", &[notes.to_string()]);
    }
    build_pptx_notes(notes)
}

fn build_pptx_notes(notes: &str) -> String {
    let paragraphs = notes
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(|line| format!(r#"<a:p><a:r><a:t>{}</a:t></a:r></a:p>"#, escape_xml(line)))
        .collect::<Vec<_>>()
        .join("");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"#
    )
}

fn next_pptx_notes_path(existing_names: &[String]) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("ppt/notesSlides/notesSlide{index}.xml");
        if !existing_names.iter().any(|name| name == &path) {
            return path;
        }
        index += 1;
    }
}
