use serde_json::{json, Value};

use super::{
    append_before_or_end, attr_value, escape_xml, next_rid, set_xml_attr, xml_named_empty_elements,
};

pub(super) fn add_docx_hyperlink_relationships(
    blocks: &mut [Value],
    relationships: &mut String,
) -> bool {
    let mut changed = false;
    let mut next_relationship_id = next_rid(relationships);
    for block in blocks.iter_mut() {
        if block.get("type").and_then(Value::as_str) == Some("image") {
            continue;
        }
        let Some(target) = block
            .get("target")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
        else {
            continue;
        };
        let relationship_id = block
            .get("relationshipId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                let id = format!("rId{next_relationship_id}");
                next_relationship_id += 1;
                block["relationshipId"] = json!(id.clone());
                id
            });
        *relationships =
            upsert_docx_hyperlink_relationship(relationships, &relationship_id, &target);
        changed = true;
    }
    changed
}

pub(super) fn ensure_docx_part_relationship(
    rels: &str,
    relationship_type: &str,
    target: &str,
) -> String {
    if rels.contains(relationship_type) || rels.contains(&format!(r#"Target="{target}""#)) {
        return rels.to_string();
    }
    let rel_id = format!("rId{}", next_rid(rels));
    let relationship =
        format!(r#"<Relationship Id="{rel_id}" Type="{relationship_type}" Target="{target}"/>"#);
    append_before_or_end(rels, "</Relationships>", &relationship)
}

pub(super) fn docx_empty_relationships() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#.to_string()
}

pub(super) fn docx_empty_content_types() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>"#.to_string()
}

fn upsert_docx_hyperlink_relationship(rels: &str, relationship_id: &str, target: &str) -> String {
    for relationship in xml_named_empty_elements(rels, "Relationship") {
        if attr_value(&relationship, "Id").as_deref() != Some(relationship_id) {
            continue;
        }
        let updated = [
            (
                "Type",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
            ),
            ("Target", target),
            ("TargetMode", "External"),
        ]
        .iter()
        .fold(relationship.clone(), |xml, (name, value)| {
            set_xml_attr(&xml, name, value)
        });
        return rels.replacen(&relationship, &updated, 1);
    }
    let relationship = format!(
        r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{}" TargetMode="External"/>"#,
        escape_xml(target)
    );
    append_before_or_end(rels, "</Relationships>", &relationship)
}
