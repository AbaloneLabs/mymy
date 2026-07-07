use std::collections::BTreeMap;

use super::xml_utils::{attr_value, find_xml_tag_start, xml_named_empty_elements};

pub(super) fn xlsx_relationships_by_id(
    source_part: &str,
    rels: &str,
) -> BTreeMap<String, (String, String)> {
    xml_named_empty_elements(rels, "Relationship")
        .into_iter()
        .filter_map(|relationship| {
            let relationship_id = attr_value(&relationship, "Id")?;
            let relationship_type = attr_value(&relationship, "Type").unwrap_or_default();
            let target = attr_value(&relationship, "Target")?;
            Some((
                relationship_id,
                (
                    relationship_type,
                    xlsx_relationship_target_to_part_from(source_part, &target),
                ),
            ))
        })
        .collect()
}

pub(super) fn xlsx_relationship_target_by_type(
    source_part: &str,
    rels: &str,
    type_suffix: &str,
) -> Option<String> {
    xml_named_empty_elements(rels, "Relationship")
        .into_iter()
        .find_map(|relationship| {
            let relationship_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !relationship_type.ends_with(type_suffix) {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some(xlsx_relationship_target_to_part_from(source_part, &target))
        })
}

pub(super) fn xlsx_relationship_target_to_part(target: &str) -> String {
    let target = target.trim_start_matches('/');
    if target.starts_with("xl/") {
        target.to_string()
    } else {
        format!("xl/{target}")
    }
}

pub(super) fn xlsx_relationship_target_to_part_from(source_part: &str, target: &str) -> String {
    let target = target.trim_start_matches('/');
    if target.starts_with("xl/") {
        return target.to_string();
    }
    let base = source_part
        .rsplit_once('/')
        .map(|(directory, _)| directory)
        .unwrap_or_default();
    let mut segments = base
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            value => segments.push(value.to_string()),
        }
    }
    segments.join("/")
}

pub(super) fn xlsx_worksheet_rels_path(sheet_path: &str) -> String {
    xlsx_part_rels_path(sheet_path)
}

pub(super) fn xlsx_part_rels_path(part_path: &str) -> String {
    let Some((directory, file_name)) = part_path.rsplit_once('/') else {
        return format!("_rels/{part_path}.rels");
    };
    format!("{directory}/_rels/{file_name}.rels")
}

pub(super) fn xlsx_empty_relationships() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#.to_string()
}

pub(super) fn xlsx_relationship_by_type(
    source_part: &str,
    rels: &str,
    type_suffix: &str,
) -> Option<(String, String)> {
    xml_named_empty_elements(rels, "Relationship")
        .into_iter()
        .find_map(|relationship| {
            let relationship_id = attr_value(&relationship, "Id")?;
            let relationship_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !relationship_type.ends_with(type_suffix) {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some((
                relationship_id,
                xlsx_relationship_target_to_part_from(source_part, &target),
            ))
        })
}

pub(super) fn xlsx_part_to_relationship_target_from(
    source_part: &str,
    target_part: &str,
) -> String {
    if source_part.starts_with("xl/worksheets/") && target_part.starts_with("xl/") {
        return format!("../{}", target_part.trim_start_matches("xl/"));
    }
    target_part.to_string()
}

pub(super) fn remove_relationships_by_type(rels: &str, type_suffix: &str) -> String {
    let mut output = String::new();
    let mut rest = rels;
    while let Some(start) = find_xml_tag_start(rest, "Relationship") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let element = &after_start[..=end];
        let relationship_type = attr_value(element, "Type").unwrap_or_default();
        if !relationship_type.ends_with(type_suffix) {
            output.push_str(element);
        }
        rest = &after_start[end + 1..];
    }
    output.push_str(rest);
    output
}
