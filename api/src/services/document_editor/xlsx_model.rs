//! XLSX model conversion and worksheet XML updates.
//!
//! Kept separate from the document editor service entrypoint so the
//! package-level read/write flow stays readable while worksheet parsing,
//! style assignment, relationships, comments, and sheet XML rebuilding can
//! evolve together.

use super::*;

mod comments;
mod parsing;
mod sheet_update;
mod types;
mod worksheet_features;
mod worksheet_xml;

pub(super) use comments::*;
pub(super) use parsing::*;
pub(super) use sheet_update::*;
pub(super) use types::*;
pub(super) use worksheet_features::*;
pub(super) use worksheet_xml::*;

pub(super) fn xlsx_model(bytes: &[u8]) -> AppResult<Value> {
    let strings = read_shared_strings(bytes).unwrap_or_default();
    let styles = read_zip_text(bytes, "xl/styles.xml")
        .ok()
        .map(|xml| xlsx_styles_from_xml(&xml));
    let workbook_xml = read_zip_text(bytes, "xl/workbook.xml").ok();
    let defined_names = workbook_xml
        .as_deref()
        .map(parse_xlsx_defined_names)
        .unwrap_or_default();
    let workbook_sheets = xlsx_workbook_sheets(bytes).unwrap_or_default();
    if !workbook_sheets.is_empty() {
        let sheets = workbook_sheets
            .into_iter()
            .filter_map(|sheet| {
                let xml = read_zip_text(bytes, &sheet.path).ok()?;
                let tab_color = parse_sheet_tab_color(&xml);
                let sheet_rels = read_zip_text(bytes, &xlsx_worksheet_rels_path(&sheet.path)).ok();
                let hyperlink_targets = sheet_rels
                    .as_deref()
                    .map(xlsx_hyperlink_relationship_targets)
                    .unwrap_or_default();
                let comments = sheet_rels
                    .as_deref()
                    .and_then(|rels| xlsx_relationship_target_by_type(&sheet.path, rels, "/comments"))
                    .and_then(|path| read_zip_text(bytes, &path).ok())
                    .map(|comments_xml| parse_sheet_comments(&comments_xml))
                    .unwrap_or_default();
                let objects = parse_xlsx_sheet_objects(bytes, &sheet.path, &xml, sheet_rels.as_deref());
                let mut item = json!({
                    "id": sheet.path,
                    "name": sheet.name,
                    "state": sheet.state.unwrap_or_else(|| "visible".to_string()),
                    "columns": parse_sheet_columns(&xml),
                    "mergedRanges": parse_sheet_merged_ranges(&xml),
                    "dataValidations": parse_sheet_data_validations(&xml),
                    "conditionalFormattings": parse_sheet_conditional_formattings(&xml, styles.as_ref()),
                    "protection": parse_sheet_protection(&xml),
                    "pageMargins": parse_sheet_page_margins(&xml),
                    "pageSetup": parse_sheet_page_setup(&xml),
                    "hyperlinks": parse_sheet_hyperlinks(&xml, &hyperlink_targets),
                    "comments": comments,
                    "tables": objects.tables,
                    "charts": objects.charts,
                    "images": objects.images,
                    "pivots": objects.pivots,
                    "autoFilter": parse_sheet_auto_filter(&xml),
                    "frozenRows": parse_sheet_frozen_pane(&xml).0,
                    "frozenColumns": parse_sheet_frozen_pane(&xml).1,
                    "rows": parse_sheet_rows(&xml, &strings, styles.as_ref())
                });
                if let Some(tab_color) = tab_color {
                    if let Some(color) = tab_color.color {
                        item["tabColor"] = json!(format!("#{color}"));
                    }
                    item["tabColorSourceXml"] = json!(tab_color.source_xml);
                }
                Some(item)
            })
            .collect::<Vec<_>>();
        return Ok(json!({ "sheets": sheets, "definedNames": defined_names }));
    }

    let mut sheets = Vec::new();
    for name in zip_entry_names(bytes)? {
        if !(name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml")) {
            continue;
        }
        let xml = read_zip_text(bytes, &name)?;
        let tab_color = parse_sheet_tab_color(&xml);
        let sheet_rels = read_zip_text(bytes, &xlsx_worksheet_rels_path(&name)).ok();
        let hyperlink_targets = sheet_rels
            .as_deref()
            .map(xlsx_hyperlink_relationship_targets)
            .unwrap_or_default();
        let comments = sheet_rels
            .as_deref()
            .and_then(|rels| xlsx_relationship_target_by_type(&name, rels, "/comments"))
            .and_then(|path| read_zip_text(bytes, &path).ok())
            .map(|comments_xml| parse_sheet_comments(&comments_xml))
            .unwrap_or_default();
        let objects = parse_xlsx_sheet_objects(bytes, &name, &xml, sheet_rels.as_deref());
        let mut item = json!({
            "id": name,
            "name": name.rsplit('/').next().unwrap_or(&name),
            "state": "visible",
            "columns": parse_sheet_columns(&xml),
            "mergedRanges": parse_sheet_merged_ranges(&xml),
            "dataValidations": parse_sheet_data_validations(&xml),
            "conditionalFormattings": parse_sheet_conditional_formattings(&xml, styles.as_ref()),
            "protection": parse_sheet_protection(&xml),
            "pageMargins": parse_sheet_page_margins(&xml),
            "pageSetup": parse_sheet_page_setup(&xml),
            "hyperlinks": parse_sheet_hyperlinks(&xml, &hyperlink_targets),
            "comments": comments,
            "tables": objects.tables,
            "charts": objects.charts,
            "images": objects.images,
            "pivots": objects.pivots,
            "autoFilter": parse_sheet_auto_filter(&xml),
            "frozenRows": parse_sheet_frozen_pane(&xml).0,
            "frozenColumns": parse_sheet_frozen_pane(&xml).1,
            "rows": parse_sheet_rows(&xml, &strings, styles.as_ref())
        });
        if let Some(tab_color) = tab_color {
            if let Some(color) = tab_color.color {
                item["tabColor"] = json!(format!("#{color}"));
            }
            item["tabColorSourceXml"] = json!(tab_color.source_xml);
        }
        sheets.push(item);
    }
    Ok(json!({ "sheets": sheets, "definedNames": defined_names }))
}

pub(super) fn update_xlsx(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let sheets = model
        .get("sheets")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("XLSX model requires sheets".into()))?;
    let original_refs = xlsx_workbook_sheets(original).unwrap_or_default();
    let sheet_writes = xlsx_sheet_writes(sheets, &original_refs);
    let mut style_writer = XlsxStyleWriter::new(read_zip_text(original, "xl/styles.xml").ok());
    let mut replacements = Vec::new();
    let existing_names = zip_entry_names(original).unwrap_or_default();
    let mut comments_content_types = Vec::new();
    let mut table_content_types = Vec::new();
    let mut needs_vml_content_type = false;
    let workbook_has_formulas = xlsx_model_has_formulas(sheets);
    for (sheet, sheet_write) in sheets.iter().zip(sheet_writes.iter()) {
        let Some(rows) = sheet.get("rows").and_then(Value::as_array) else {
            continue;
        };
        let original_xml = read_zip_text(original, &sheet_write.path).unwrap_or_default();
        let rels_path = xlsx_worksheet_rels_path(&sheet_write.path);
        let original_rels = read_zip_text(original, &rels_path).ok();
        let mut update = sheet_update_from_model(sheet, rows);
        style_writer.assign_sheet_styles(&mut update);
        let mut rels_replacement = original_rels.clone();
        if let Some(updated_rels) =
            update_sheet_hyperlink_relationships(rels_replacement.as_deref(), &mut update)
        {
            rels_replacement = Some(updated_rels);
        }
        let mut updated_xml = if original_xml.is_empty() {
            build_xlsx_worksheet(&update)
        } else {
            update_xlsx_worksheet(&original_xml, &update)
        };
        if let Some(comments) = update.comments.as_ref() {
            if let Some(legacy_drawing_id) = update_sheet_comments_package(
                &sheet_write.path,
                &mut rels_replacement,
                comments,
                &existing_names,
                &mut replacements,
                &mut comments_content_types,
                &mut needs_vml_content_type,
            ) {
                updated_xml =
                    update_sheet_legacy_drawing(&updated_xml, Some(legacy_drawing_id.as_str()));
            } else if comments.is_empty() {
                updated_xml = update_sheet_legacy_drawing(&updated_xml, None);
            }
        }
        add_xlsx_table_replacements(
            sheet,
            &mut XlsxTableReplacementContext {
                original,
                sheet_path: &sheet_write.path,
                worksheet_xml: &mut updated_xml,
                rels_replacement: &mut rels_replacement,
                existing_names: &existing_names,
                table_content_types: &mut table_content_types,
                replacements: &mut replacements,
            },
        );
        add_xlsx_chart_replacements(original, sheet, &mut replacements);
        add_xlsx_pivot_replacements(original, sheet, &mut replacements);
        if rels_replacement != original_rels {
            if let Some(updated_rels) = rels_replacement {
                replacements.push((rels_path, updated_rels.into_bytes()));
            }
        }
        replacements.push((sheet_write.path.clone(), updated_xml.into_bytes()));
    }
    if style_writer.changed {
        replacements.push((
            "xl/styles.xml".to_string(),
            style_writer.xml.clone().into_bytes(),
        ));
    }
    if let (Ok(workbook), Ok(rels), Ok(content_types)) = (
        read_zip_text(original, "xl/workbook.xml"),
        read_zip_text(original, "xl/_rels/workbook.xml.rels"),
        read_zip_text(original, "[Content_Types].xml"),
    ) {
        let rels = if style_writer.changed {
            ensure_xlsx_styles_relationship(&rels)
        } else {
            rels
        };
        let content_types = if style_writer.changed {
            ensure_xlsx_styles_content_type(&content_types)
        } else {
            content_types
        };
        let content_types = ensure_xlsx_comments_content_types(
            &content_types,
            &comments_content_types,
            needs_vml_content_type,
        );
        let content_types = ensure_xlsx_table_content_types(&content_types, &table_content_types);
        let (workbook, rels) = update_xlsx_workbook_manifest(&workbook, &rels, &sheet_writes);
        let workbook = update_xlsx_defined_names(
            &workbook,
            model.get("definedNames").and_then(Value::as_array),
        );
        let workbook = if workbook_has_formulas {
            update_xlsx_workbook_calc_properties(&workbook)
        } else {
            workbook
        };
        let content_types = append_xlsx_sheet_content_types(&content_types, &sheet_writes);
        replacements.push(("xl/workbook.xml".to_string(), workbook.into_bytes()));
        replacements.push(("xl/_rels/workbook.xml.rels".to_string(), rels.into_bytes()));
        replacements.push((
            "[Content_Types].xml".to_string(),
            content_types.into_bytes(),
        ));
    }
    let replacement_refs = replacements
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.clone()))
        .collect::<Vec<_>>();
    replace_zip_entries(original, &replacement_refs)
}

pub(super) fn read_shared_strings(bytes: &[u8]) -> AppResult<Vec<String>> {
    let xml = read_zip_text(bytes, "xl/sharedStrings.xml")?;
    Ok(xml_segments(&xml, "<si", "</si>")
        .into_iter()
        .map(|item| extract_text_tags(&item, "t").join(""))
        .collect())
}
