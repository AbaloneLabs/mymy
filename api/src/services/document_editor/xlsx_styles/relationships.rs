use super::super::{append_before_or_end, ensure_content_type_default, next_rid};

pub(in crate::services::document_editor) fn ensure_xlsx_styles_relationship(rels: &str) -> String {
    if rels.contains("/relationships/styles") {
        return rels.to_string();
    }
    let rel_id = format!("rId{}", next_rid(rels));
    let rel = format!(
        r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#
    );
    append_before_or_end(rels, "</Relationships>", &rel)
}

pub(in crate::services::document_editor) fn ensure_xlsx_styles_content_type(
    content_types: &str,
) -> String {
    if content_types.contains(r#"PartName="/xl/styles.xml""#) {
        return content_types.to_string();
    }
    let override_xml = r#"<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>"#;
    append_before_or_end(content_types, "</Types>", override_xml)
}

pub(in crate::services::document_editor) fn ensure_xlsx_comments_content_types(
    content_types: &str,
    comments_paths: &[String],
    needs_vml: bool,
) -> String {
    let mut output = content_types.to_string();
    for path in comments_paths {
        let part_name = format!("/{path}");
        if output.contains(&format!(r#"PartName="{part_name}""#)) {
            continue;
        }
        let override_xml = format!(
            r#"<Override PartName="{part_name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>"#
        );
        output = append_before_or_end(&output, "</Types>", &override_xml);
    }
    if needs_vml {
        output = ensure_content_type_default(
            &output,
            "vml",
            "application/vnd.openxmlformats-officedocument.vmlDrawing",
        );
    }
    output
}
