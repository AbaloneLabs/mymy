use super::*;

pub(in crate::services::document_editor) fn update_sheet_comments_package(
    sheet_path: &str,
    rels_replacement: &mut Option<String>,
    comments: &[SheetComment],
    existing_names: &[String],
    replacements: &mut Vec<(String, Vec<u8>)>,
    comments_content_types: &mut Vec<String>,
    needs_vml_content_type: &mut bool,
) -> Option<String> {
    if comments.is_empty() {
        return None;
    }
    let rels = rels_replacement.get_or_insert_with(xlsx_empty_relationships);
    let comments_path = xlsx_relationship_by_type(sheet_path, rels, "/comments")
        .map(|(_, path)| path)
        .unwrap_or_else(|| next_xlsx_comments_path(existing_names, comments_content_types));
    let vml_path = xlsx_relationship_by_type(sheet_path, rels, "/vmlDrawing")
        .map(|(_, path)| path)
        .unwrap_or_else(|| next_xlsx_vml_path(existing_names, replacements));
    let (updated_rels, _) = ensure_xlsx_sheet_relationship(
        rels,
        sheet_path,
        &comments_path,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
    );
    let (updated_rels, legacy_drawing_id) = ensure_xlsx_sheet_relationship(
        &updated_rels,
        sheet_path,
        &vml_path,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
    );
    *rels = updated_rels;
    replacements.push((
        comments_path.clone(),
        build_xlsx_comments_xml(comments).into_bytes(),
    ));
    replacements.push((vml_path, build_xlsx_comments_vml(comments).into_bytes()));
    if !comments_content_types
        .iter()
        .any(|path| path == &comments_path)
    {
        comments_content_types.push(comments_path);
    }
    *needs_vml_content_type = true;
    Some(legacy_drawing_id)
}

pub(in crate::services::document_editor) fn ensure_xlsx_sheet_relationship(
    rels: &str,
    source_part: &str,
    target_part: &str,
    relationship_type: &str,
) -> (String, String) {
    if let Some((relationship_id, _)) = xlsx_relationship_by_type(
        source_part,
        rels,
        relationship_type.rsplit('/').next().unwrap_or_default(),
    ) {
        return (rels.to_string(), relationship_id);
    }
    let relationship_id = format!("rId{}", next_rid(rels));
    let target = xlsx_part_to_relationship_target_from(source_part, target_part);
    let relationship = format!(
        r#"<Relationship Id="{relationship_id}" Type="{relationship_type}" Target="{}"/>"#,
        escape_xml(&target)
    );
    (
        append_before_or_end(rels, "</Relationships>", &relationship),
        relationship_id,
    )
}

pub(in crate::services::document_editor) fn next_xlsx_comments_path(
    existing_names: &[String],
    allocated_paths: &[String],
) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("xl/comments{index}.xml");
        if !existing_names.iter().any(|name| name == &path)
            && !allocated_paths.iter().any(|name| name == &path)
        {
            return path;
        }
        index += 1;
    }
}

pub(in crate::services::document_editor) fn next_xlsx_vml_path(
    existing_names: &[String],
    replacements: &[(String, Vec<u8>)],
) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("xl/drawings/vmlDrawing{index}.vml");
        if !existing_names.iter().any(|name| name == &path)
            && !replacements.iter().any(|(name, _)| name == &path)
        {
            return path;
        }
        index += 1;
    }
}

pub(in crate::services::document_editor) fn build_xlsx_comments_xml(
    comments: &[SheetComment],
) -> String {
    let mut author_ids = BTreeMap::new();
    for comment in comments {
        let author = comment.author.as_deref().unwrap_or("mymy").to_string();
        if !author_ids.contains_key(&author) {
            author_ids.insert(author, author_ids.len());
        }
    }
    let authors = author_ids
        .keys()
        .map(|author| format!("<author>{}</author>", escape_xml(author)))
        .collect::<String>();
    let comment_list = comments
        .iter()
        .map(|comment| {
            let author = comment.author.as_deref().unwrap_or("mymy");
            let author_id = author_ids.get(author).copied().unwrap_or(0);
            format!(
                r#"<comment ref="{}" authorId="{author_id}"><text><t xml:space="preserve">{}</t></text></comment>"#,
                escape_xml(&comment.reference),
                escape_xml(&comment.text)
            )
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors>{authors}</authors><commentList>{comment_list}</commentList></comments>"#
    )
}

pub(in crate::services::document_editor) fn build_xlsx_comments_vml(
    comments: &[SheetComment],
) -> String {
    let shapes = comments
        .iter()
        .enumerate()
        .filter_map(|(index, comment)| {
            let (column, row) = split_cell_reference(&comment.reference)?;
            let row_index = row.saturating_sub(1);
            let column_index = column.saturating_sub(1);
            let shape_id = 1025 + index;
            Some(format!(
                r##"<v:shape id="_x0000_s{shape_id}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:{index};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>1, 15, 0, 2, 3, 15, 4, 16</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>{row_index}</x:Row><x:Column>{column_index}</x:Column></x:ClientData></v:shape>"##
            ))
        })
        .collect::<String>();
    format!(
        r##"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>{shapes}</xml>"##
    )
}
