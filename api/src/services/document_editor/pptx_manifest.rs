use std::collections::BTreeMap;

use serde_json::Value;

use crate::error::AppResult;

use super::pptx_package::{
    append_pptx_slide_content_types, pptx_part_to_relationship_target, pptx_relationship_targets,
};
use super::{
    append_before_or_end, attr_value, next_rid, read_zip_text, replace_xml_element,
    xml_empty_elements,
};

#[derive(Debug, Clone)]
pub(super) struct PptxPresentationSlideRef {
    pub(super) path: String,
    slide_id: usize,
    rel_id: String,
}

#[derive(Debug, Clone)]
pub(super) struct PptxPresentationSlideWrite {
    pub(super) path: String,
}

pub(super) fn pptx_presentation_slides(bytes: &[u8]) -> AppResult<Vec<PptxPresentationSlideRef>> {
    let presentation = read_zip_text(bytes, "ppt/presentation.xml")?;
    let rels = read_zip_text(bytes, "ppt/_rels/presentation.xml.rels")?;
    Ok(pptx_presentation_slides_from_xml(&presentation, &rels))
}

pub(super) fn pptx_slide_writes(
    slides: &[Value],
    original_refs: &[PptxPresentationSlideRef],
) -> Vec<PptxPresentationSlideWrite> {
    let mut used_paths = original_refs
        .iter()
        .map(|slide| slide.path.clone())
        .collect::<Vec<_>>();
    slides
        .iter()
        .map(|slide| {
            let requested = slide
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let existing = original_refs
                .iter()
                .any(|slide_ref| slide_ref.path == requested);
            let path = if existing || valid_pptx_slide_path(&requested) {
                requested
            } else {
                next_pptx_slide_path(&used_paths)
            };
            if !used_paths.iter().any(|used| used == &path) {
                used_paths.push(path.clone());
            }
            PptxPresentationSlideWrite { path }
        })
        .collect()
}

pub(super) fn update_pptx_presentation_manifest(
    presentation: &str,
    rels: &str,
    slides: &[PptxPresentationSlideWrite],
) -> (String, String) {
    let existing_refs = pptx_presentation_slides_from_xml(presentation, rels);
    let existing_by_path = existing_refs
        .iter()
        .map(|slide| (slide.path.clone(), slide.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut rels_out = rels.to_string();
    let mut next_rel = next_rid(rels);
    let mut next_slide_id = next_presentation_slide_id(presentation);
    let mut slide_tags = Vec::new();
    for slide in slides {
        let (rel_id, slide_id) = if let Some(existing) = existing_by_path.get(&slide.path) {
            (existing.rel_id.clone(), existing.slide_id)
        } else {
            let rel_id = format!("rId{next_rel}");
            next_rel += 1;
            let rel = format!(
                r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="{}"/>"#,
                pptx_part_to_relationship_target(&slide.path)
            );
            rels_out = append_before_or_end(&rels_out, "</Relationships>", &rel);
            let slide_id = next_slide_id;
            next_slide_id += 1;
            (rel_id, slide_id)
        };
        slide_tags.push(format!(r#"<p:sldId id="{slide_id}" r:id="{rel_id}"/>"#));
    }
    let list = format!("<p:sldIdLst>{}</p:sldIdLst>", slide_tags.join(""));
    let presentation_out = replace_xml_element(presentation, "p:sldIdLst", &list)
        .unwrap_or_else(|| append_before_or_end(presentation, "</p:presentation>", &list));
    (presentation_out, rels_out)
}

pub(super) fn append_pptx_slide_content_types_for_writes(
    content_types: &str,
    slides: &[PptxPresentationSlideWrite],
) -> String {
    let slide_ids = slides
        .iter()
        .map(|slide| slide.path.clone())
        .collect::<Vec<_>>();
    append_pptx_slide_content_types(content_types, &slide_ids)
}

fn pptx_presentation_slides_from_xml(
    presentation: &str,
    rels: &str,
) -> Vec<PptxPresentationSlideRef> {
    let targets = pptx_relationship_targets(rels);
    xml_empty_elements(presentation, "<p:sldId ")
        .into_iter()
        .filter_map(|slide| {
            let rel_id = attr_value(&slide, "r:id")?;
            let path = targets.get(&rel_id)?.clone();
            Some(PptxPresentationSlideRef {
                path,
                slide_id: attr_value(&slide, "id")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(256),
                rel_id,
            })
        })
        .collect()
}

fn valid_pptx_slide_path(path: &str) -> bool {
    path.starts_with("ppt/slides/slide") && path.ends_with(".xml") && !path.contains("..")
}

fn next_pptx_slide_path(used_paths: &[String]) -> String {
    let mut index = used_paths
        .iter()
        .filter_map(|path| {
            path.rsplit('/')
                .next()
                .and_then(|name| name.strip_prefix("slide"))
                .and_then(|name| name.strip_suffix(".xml"))
                .and_then(|value| value.parse::<usize>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;
    loop {
        let path = format!("ppt/slides/slide{index}.xml");
        if !used_paths.iter().any(|used| used == &path) {
            return path;
        }
        index += 1;
    }
}

fn next_presentation_slide_id(presentation: &str) -> usize {
    presentation
        .split("<p:sldId ")
        .skip(1)
        .filter_map(|part| attr_value(part, "id"))
        .filter_map(|id| id.parse::<usize>().ok())
        .max()
        .unwrap_or(255)
        + 1
}
