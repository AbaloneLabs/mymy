//! OOXML `[Content_Types].xml` mutation helpers.
//!
//! DOCX, XLSX, and PPTX writers all add package parts during editing. These
//! helpers keep the common default/override insertion rules in one place so
//! format modules can focus on which parts they own.

use super::append_before_or_end;

pub(super) fn ensure_content_type_default(
    content_types: &str,
    extension: &str,
    content_type: &str,
) -> String {
    if content_types.contains(&format!(r#"Extension="{extension}""#)) {
        return content_types.to_string();
    }
    append_before_or_end(
        content_types,
        "</Types>",
        &format!(r#"<Default Extension="{extension}" ContentType="{content_type}"/>"#),
    )
}

pub(super) fn ensure_content_type_override(
    content_types: &str,
    part_name: &str,
    content_type: &str,
) -> String {
    if content_types.contains(&format!(r#"PartName="{part_name}""#)) {
        return content_types.to_string();
    }
    append_before_or_end(
        content_types,
        "</Types>",
        &format!(r#"<Override PartName="{part_name}" ContentType="{content_type}"/>"#),
    )
}
