use std::collections::BTreeMap;

use super::xml_utils::{append_before_or_end, attr_value, xml_empty_elements};

pub(super) fn pptx_slide_relationship_target(target_path: &str) -> String {
    if target_path.starts_with("ppt/") {
        format!("../{}", target_path.trim_start_matches("ppt/"))
    } else {
        target_path.to_string()
    }
}

pub(super) fn append_pptx_slide_content_types(content_types: &str, slide_ids: &[String]) -> String {
    let mut output = content_types.to_string();
    for slide_id in slide_ids {
        let part_name = format!("/{slide_id}");
        if output.contains(&part_name) {
            continue;
        }
        let override_xml = format!(
            r#"<Override PartName="{part_name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>"#
        );
        output = append_before_or_end(&output, "</Types>", &override_xml);
    }
    output
}

pub(super) fn append_pptx_notes_content_types(
    content_types: &str,
    notes_paths: &[String],
) -> String {
    let mut output = content_types.to_string();
    for notes_path in notes_paths {
        let part_name = format!("/{notes_path}");
        if output.contains(&format!(r#"PartName="{part_name}""#)) {
            continue;
        }
        let override_xml = format!(
            r#"<Override PartName="{part_name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>"#
        );
        output = append_before_or_end(&output, "</Types>", &override_xml);
    }
    output
}

pub(super) fn pptx_relationship_targets(rels: &str) -> BTreeMap<String, String> {
    xml_empty_elements(rels, "<Relationship ")
        .into_iter()
        .filter_map(|relationship| {
            let rel_id = attr_value(&relationship, "Id")?;
            let rel_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !rel_type.ends_with("/slide") {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some((rel_id, pptx_relationship_target_to_part(&target)))
        })
        .collect()
}

pub(super) fn pptx_relationship_target_to_part(target: &str) -> String {
    let target = target.trim_start_matches('/');
    if target.starts_with("ppt/") {
        target.to_string()
    } else {
        format!("ppt/{target}")
    }
}

pub(super) fn pptx_part_to_relationship_target(path: &str) -> String {
    path.strip_prefix("ppt/").unwrap_or(path).to_string()
}
