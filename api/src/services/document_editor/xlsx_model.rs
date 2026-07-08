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

pub(super) use comments::*;
pub(super) use parsing::*;
pub(super) use sheet_update::*;
pub(super) use types::*;

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

pub(super) fn build_sheet_views(frozen_rows: u32, frozen_columns: u32) -> String {
    if frozen_rows == 0 && frozen_columns == 0 {
        return String::new();
    }
    let top_left_cell = format!(
        "{}{}",
        column_letters(frozen_columns.saturating_add(1)),
        frozen_rows.saturating_add(1)
    );
    let active_pane = match (frozen_rows > 0, frozen_columns > 0) {
        (true, true) => "bottomRight",
        (true, false) => "bottomLeft",
        (false, true) => "topRight",
        (false, false) => "topLeft",
    };
    let x_split = if frozen_columns > 0 {
        format!(r#" xSplit="{frozen_columns}""#)
    } else {
        String::new()
    };
    let y_split = if frozen_rows > 0 {
        format!(r#" ySplit="{frozen_rows}""#)
    } else {
        String::new()
    };
    format!(
        r#"<sheetViews><sheetView workbookViewId="0"><pane{x_split}{y_split} topLeftCell="{top_left_cell}" activePane="{active_pane}" state="frozen"/><selection pane="{active_pane}"/></sheetView></sheetViews>"#
    )
}

pub(super) fn update_sheet_views(xml: &str, frozen_rows: u32, frozen_columns: u32) -> String {
    let sheet_views = build_sheet_views(frozen_rows, frozen_columns);
    if let Some(replaced) = replace_xml_element(xml, "sheetViews", &sheet_views) {
        return replaced;
    }
    if sheet_views.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("<sheetFormatPr") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_views);
        output.push_str(&xml[index..]);
        return output;
    }
    if let Some(index) = xml.find("<cols") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_views);
        output.push_str(&xml[index..]);
        return output;
    }
    if let Some(index) = xml.find("<sheetData") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_views);
        output.push_str(&xml[index..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &sheet_views)
}

pub(super) fn build_xlsx_worksheet(update: &SheetUpdate) -> String {
    let sheet_pr = build_sheet_pr(update.tab_color_xml.as_deref());
    let columns = build_sheet_columns(&update.columns);
    let sheet_data = build_sheet_data(update, &BTreeMap::new());
    let protection = build_sheet_protection(update.protection.as_ref());
    let auto_filter = build_sheet_auto_filter(update.auto_filter.as_deref());
    let merge_cells = build_sheet_merge_cells(&update.merged_ranges);
    let conditional_formattings =
        build_sheet_conditional_formattings(&update.conditional_formattings);
    let data_validations = build_sheet_data_validations(&update.data_validations);
    let hyperlinks = build_sheet_hyperlinks(&update.hyperlinks);
    let page_margins = build_sheet_page_margins(update.page_margins.as_ref());
    let page_setup = build_sheet_page_setup(update.page_setup.as_ref());
    let sheet_views = build_sheet_views(update.frozen_rows, update.frozen_columns);
    let worksheet = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{sheet_pr}<dimension ref="A1"/>{sheet_views}{columns}{sheet_data}{protection}{auto_filter}{merge_cells}{conditional_formattings}{data_validations}{hyperlinks}{page_margins}{page_setup}</worksheet>"#
    );
    let worksheet = ensure_xlsx_relationship_namespace(&worksheet, &update.hyperlinks);
    update_sheet_dimension(&worksheet, update.cells.keys())
}

pub(super) fn update_xlsx_worksheet(xml: &str, update: &SheetUpdate) -> String {
    let original_cells = original_sheet_cells(xml);
    let sheet_data = build_sheet_data(update, &original_cells);
    let replaced = replace_xml_element(xml, "sheetData", &sheet_data)
        .unwrap_or_else(|| insert_sheet_data(xml, &sheet_data));
    let replaced = update_sheet_pr(&replaced, update.tab_color_xml.as_deref());
    let replaced = update_sheet_views(&replaced, update.frozen_rows, update.frozen_columns);
    let replaced = update_sheet_columns(&replaced, &update.columns);
    let replaced = update_sheet_protection(&replaced, update.protection.as_ref());
    let replaced = update_sheet_auto_filter(&replaced, update.auto_filter.as_deref());
    let replaced = update_sheet_merge_cells(&replaced, &update.merged_ranges);
    let replaced = update_sheet_conditional_formattings(&replaced, &update.conditional_formattings);
    let replaced = update_sheet_data_validations(&replaced, &update.data_validations);
    let replaced = update_sheet_hyperlinks(&replaced, &update.hyperlinks);
    let replaced = update_sheet_page_margins(&replaced, update.page_margins.as_ref());
    let replaced = update_sheet_page_setup(&replaced, update.page_setup.as_ref());
    let replaced = ensure_xlsx_relationship_namespace(&replaced, &update.hyperlinks);
    update_sheet_dimension(&replaced, update.cells.keys())
}

pub(super) fn build_sheet_pr(tab_color_xml: Option<&str>) -> String {
    tab_color_xml
        .filter(|xml| !xml.trim().is_empty())
        .map(|xml| format!("<sheetPr>{xml}</sheetPr>"))
        .unwrap_or_default()
}

pub(super) fn update_sheet_pr(xml: &str, tab_color_xml: Option<&str>) -> String {
    let tab_color_xml = tab_color_xml.filter(|value| !value.trim().is_empty());
    if let Some(sheet_pr) = xml_named_segments(xml, "sheetPr").into_iter().next() {
        let updated = update_sheet_pr_tab_color(&sheet_pr, tab_color_xml);
        return replace_xml_element(xml, "sheetPr", &updated).unwrap_or_else(|| xml.to_string());
    }
    if let Some(sheet_pr) = xml_named_empty_elements(xml, "sheetPr").into_iter().next() {
        let replacement = tab_color_xml
            .map(|tab_color| {
                let opening = sheet_pr.trim_end_matches("/>").trim_end();
                format!("{opening}>{tab_color}</sheetPr>")
            })
            .unwrap_or_else(|| sheet_pr.clone());
        return replace_empty_xml_element(xml, "<sheetPr", &replacement);
    }
    let Some(tab_color_xml) = tab_color_xml else {
        return xml.to_string();
    };
    let sheet_pr = build_sheet_pr(Some(tab_color_xml));
    if let Some(index) = xml.find("<dimension") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_pr);
        output.push_str(&xml[index..]);
        return output;
    }
    if let Some(index) = xml.find("<sheetViews") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_pr);
        output.push_str(&xml[index..]);
        return output;
    }
    if let Some(index) = xml.find("<sheetData") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&sheet_pr);
        output.push_str(&xml[index..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &sheet_pr)
}

pub(super) fn update_sheet_pr_tab_color(sheet_pr: &str, tab_color_xml: Option<&str>) -> String {
    let stripped = remove_xml_named_elements(sheet_pr, "tabColor");
    let Some(tab_color_xml) = tab_color_xml else {
        return stripped;
    };
    let Some(open_end) = stripped.find('>') else {
        return stripped;
    };
    let mut output = String::new();
    output.push_str(&stripped[..=open_end]);
    output.push_str(tab_color_xml);
    output.push_str(&stripped[open_end + 1..]);
    output
}

pub(super) fn build_sheet_cell(original: &str, reference: &str, cell: &SheetCellWrite) -> String {
    let style = cell
        .style_index
        .map(|style| style.to_string())
        .or_else(|| attr_value(original, "s"))
        .map(|style| format!(r#" s="{}""#, escape_xml(&style)))
        .unwrap_or_default();
    let formula_attrs = sheet_cell_formula_attrs(cell);
    if let Some(formula) = cell
        .formula
        .as_deref()
        .filter(|formula| !formula.is_empty())
    {
        let value = if cell.value.is_empty() {
            String::new()
        } else {
            format!("<v>{}</v>", escape_xml(&cell.value))
        };
        return format!(
            r#"<c r="{reference}"{style}><f{formula_attrs}>{}</f>{value}</c>"#,
            escape_xml(formula),
        );
    }
    if !formula_attrs.is_empty() {
        let value = if cell.value.is_empty() {
            String::new()
        } else {
            format!("<v>{}</v>", escape_xml(&cell.value))
        };
        return format!(r#"<c r="{reference}"{style}><f{formula_attrs}/>{value}</c>"#);
    }
    format!(
        r#"<c r="{reference}"{style} t="inlineStr"><is><t>{}</t></is></c>"#,
        escape_xml(&cell.value)
    )
}

fn sheet_cell_formula_attrs(cell: &SheetCellWrite) -> String {
    let mut attrs = Vec::new();
    if let Some(formula_type) = cell
        .formula_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        attrs.push(format!(r#"t="{}""#, escape_xml(formula_type)));
    }
    if let Some(formula_ref) = cell
        .formula_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        attrs.push(format!(r#"ref="{}""#, escape_xml(formula_ref)));
    }
    if let Some(shared_index) = cell
        .formula_shared_index
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        attrs.push(format!(r#"si="{}""#, escape_xml(shared_index)));
    }
    if attrs.is_empty() {
        String::new()
    } else {
        format!(" {}", attrs.join(" "))
    }
}

pub(super) fn original_sheet_cells(xml: &str) -> BTreeMap<String, String> {
    let mut cells = BTreeMap::new();
    for cell in xml_segments(xml, "<c", "</c>") {
        if let Some(reference) = attr_value(&cell, "r") {
            cells.insert(reference, cell);
        }
    }
    cells
}

pub(super) fn build_sheet_data(
    update: &SheetUpdate,
    original_cells: &BTreeMap<String, String>,
) -> String {
    let mut rows: BTreeMap<u32, Vec<(u32, String, SheetCellWrite)>> = BTreeMap::new();
    for (reference, value) in &update.cells {
        if let Some((column, row)) = split_cell_reference(reference) {
            rows.entry(row)
                .or_default()
                .push((column, reference.clone(), value.clone()));
        }
    }
    for row in update.rows.keys() {
        rows.entry(*row).or_default();
    }
    let mut output = String::from("<sheetData>");
    for (row_index, mut cells) in rows {
        cells.sort_by_key(|(column, _, _)| *column);
        output.push_str(&build_sheet_row_start(
            row_index,
            update.rows.get(&row_index),
        ));
        for (_, reference, value) in cells {
            let original = original_cells
                .get(&reference)
                .map(String::as_str)
                .unwrap_or_default();
            output.push_str(&build_sheet_cell(original, &reference, &value));
        }
        output.push_str("</row>");
    }
    output.push_str("</sheetData>");
    output
}

pub(super) fn build_sheet_row_start(row_index: u32, row: Option<&SheetRowWrite>) -> String {
    let mut attrs = format!(r#" r="{row_index}""#);
    if let Some(row) = row {
        if let Some(height) = row.height {
            attrs.push_str(&format!(r#" ht="{}" customHeight="1""#, trim_float(height)));
        }
        if row.hidden {
            attrs.push_str(r#" hidden="1""#);
        }
    }
    format!("<row{attrs}>")
}

pub(super) fn build_sheet_columns(columns: &[SheetColumnWrite]) -> String {
    if columns.is_empty() {
        return String::new();
    }
    let mut output = String::from("<cols>");
    for column in columns {
        let mut attrs = format!(r#" min="{0}" max="{0}""#, column.index);
        if let Some(width) = column.width {
            attrs.push_str(&format!(
                r#" width="{}" customWidth="1""#,
                trim_float(width)
            ));
        }
        if column.hidden {
            attrs.push_str(r#" hidden="1""#);
        }
        output.push_str(&format!("<col{attrs}/>"));
    }
    output.push_str("</cols>");
    output
}

pub(super) fn update_sheet_columns(xml: &str, columns: &[SheetColumnWrite]) -> String {
    let columns_xml = build_sheet_columns(columns);
    if let Some(replaced) = replace_xml_element(xml, "cols", &columns_xml) {
        return replaced;
    }
    if columns_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("<sheetData") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&columns_xml);
        output.push_str(&xml[index..]);
        return output;
    }
    xml.to_string()
}

pub(super) fn build_sheet_merge_cells(ranges: &[String]) -> String {
    if ranges.is_empty() {
        return String::new();
    }
    let cells = ranges
        .iter()
        .map(|range| format!(r#"<mergeCell ref="{}"/>"#, escape_xml(range)))
        .collect::<String>();
    format!(
        r#"<mergeCells count="{}">{cells}</mergeCells>"#,
        ranges.len()
    )
}

pub(super) fn update_sheet_merge_cells(xml: &str, ranges: &[String]) -> String {
    let merge_xml = build_sheet_merge_cells(ranges);
    if let Some(replaced) = replace_xml_element(xml, "mergeCells", &merge_xml) {
        return replaced;
    }
    if merge_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&merge_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &merge_xml)
}

pub(super) fn build_sheet_auto_filter(reference: Option<&str>) -> String {
    reference
        .filter(|reference| valid_xlsx_range_reference(reference))
        .map(|reference| format!(r#"<autoFilter ref="{}"/>"#, escape_xml(reference)))
        .unwrap_or_default()
}

pub(super) fn update_sheet_auto_filter(xml: &str, reference: Option<&str>) -> String {
    let auto_filter_xml = build_sheet_auto_filter(reference);
    if let Some(replaced) = replace_xml_element(xml, "autoFilter", &auto_filter_xml) {
        return replaced;
    }
    if xml.contains("<autoFilter") {
        return replace_empty_xml_element(xml, "<autoFilter", &auto_filter_xml);
    }
    if auto_filter_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&auto_filter_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &auto_filter_xml)
}

pub(super) fn build_sheet_data_validations(validations: &[SheetDataValidation]) -> String {
    if validations.is_empty() {
        return String::new();
    }
    let children = validations
        .iter()
        .map(build_sheet_data_validation)
        .collect::<String>();
    format!(
        r#"<dataValidations count="{}">{children}</dataValidations>"#,
        validations.len()
    )
}

pub(super) fn build_sheet_data_validation(validation: &SheetDataValidation) -> String {
    let mut attrs = vec![format!(r#"sqref="{}""#, escape_xml(&validation.sqref))];
    if let Some(validation_type) = &validation.validation_type {
        attrs.push(format!(r#"type="{}""#, escape_xml(validation_type)));
    }
    if let Some(operator) = &validation.operator {
        attrs.push(format!(r#"operator="{}""#, escape_xml(operator)));
    }
    if validation.allow_blank {
        attrs.push(r#"allowBlank="1""#.to_string());
    }
    if validation.show_input_message {
        attrs.push(r#"showInputMessage="1""#.to_string());
    }
    if validation.show_error_message {
        attrs.push(r#"showErrorMessage="1""#.to_string());
    }
    if let Some(prompt_title) = &validation.prompt_title {
        attrs.push(format!(r#"promptTitle="{}""#, escape_xml(prompt_title)));
    }
    if let Some(prompt) = &validation.prompt {
        attrs.push(format!(r#"prompt="{}""#, escape_xml(prompt)));
    }
    if let Some(error_title) = &validation.error_title {
        attrs.push(format!(r#"errorTitle="{}""#, escape_xml(error_title)));
    }
    if let Some(error) = &validation.error {
        attrs.push(format!(r#"error="{}""#, escape_xml(error)));
    }
    let formula1 = validation
        .formula1
        .as_deref()
        .map(|formula| format!("<formula1>{}</formula1>", escape_xml(formula)))
        .unwrap_or_default();
    let formula2 = validation
        .formula2
        .as_deref()
        .map(|formula| format!("<formula2>{}</formula2>", escape_xml(formula)))
        .unwrap_or_default();
    if formula1.is_empty() && formula2.is_empty() {
        format!("<dataValidation {}/>", attrs.join(" "))
    } else {
        format!(
            "<dataValidation {}>{formula1}{formula2}</dataValidation>",
            attrs.join(" ")
        )
    }
}

pub(super) fn update_sheet_data_validations(
    xml: &str,
    validations: &[SheetDataValidation],
) -> String {
    let validations_xml = build_sheet_data_validations(validations);
    if let Some(replaced) = replace_xml_element(xml, "dataValidations", &validations_xml) {
        return replaced;
    }
    if xml.contains("<dataValidations") {
        return replace_empty_xml_element(xml, "<dataValidations", &validations_xml);
    }
    if validations_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</mergeCells>") {
        let insert_at = index + "</mergeCells>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&validations_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&validations_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &validations_xml)
}

pub(super) fn build_sheet_conditional_formattings(
    formatings: &[SheetConditionalFormatting],
) -> String {
    formatings
        .iter()
        .filter(|formatting| valid_xlsx_sqref(&formatting.sqref))
        .filter_map(|formatting| {
            let rules = formatting
                .rules
                .iter()
                .enumerate()
                .filter_map(|(index, rule)| build_sheet_conditional_rule(rule, index + 1))
                .collect::<String>();
            if rules.is_empty() {
                return None;
            }
            Some(format!(
                r#"<conditionalFormatting sqref="{}">{rules}</conditionalFormatting>"#,
                escape_xml(&formatting.sqref)
            ))
        })
        .collect::<String>()
}

pub(super) fn build_sheet_conditional_rule(
    rule: &SheetConditionalRule,
    fallback_priority: usize,
) -> Option<String> {
    if let Some(source_xml) = rule.source_xml.as_deref() {
        return Some(source_xml.to_string());
    }
    let rule_type = rule.rule_type.as_deref()?;
    if !valid_xlsx_conditional_rule_type(rule_type) {
        return None;
    }
    let priority = rule.priority.unwrap_or(fallback_priority as u32);
    let mut attrs = vec![
        format!(r#"type="{}""#, escape_xml(rule_type)),
        format!(r#"priority="{priority}""#),
    ];
    if let Some(operator) = &rule.operator {
        attrs.push(format!(r#"operator="{}""#, escape_xml(operator)));
    }
    if let Some(dxf_id) = rule.dxf_id {
        attrs.push(format!(r#"dxfId="{dxf_id}""#));
    }
    if let Some(text) = &rule.text {
        attrs.push(format!(r#"text="{}""#, escape_xml(text)));
    }
    if let Some(time_period) = &rule.time_period {
        attrs.push(format!(r#"timePeriod="{}""#, escape_xml(time_period)));
    }
    let formulas = rule
        .formulas
        .iter()
        .map(|formula| format!("<formula>{}</formula>", escape_xml(formula)))
        .collect::<String>();
    if formulas.is_empty() {
        Some(format!("<cfRule {}/>", attrs.join(" ")))
    } else {
        Some(format!("<cfRule {}>{formulas}</cfRule>", attrs.join(" ")))
    }
}

pub(super) fn update_sheet_conditional_formattings(
    xml: &str,
    formatings: &[SheetConditionalFormatting],
) -> String {
    let formattings_xml = build_sheet_conditional_formattings(formatings);
    let stripped = remove_xml_named_elements(xml, "conditionalFormatting");
    if formattings_xml.is_empty() {
        return stripped;
    }
    if let Some(index) = stripped.find("</mergeCells>") {
        let insert_at = index + "</mergeCells>".len();
        let mut output = String::new();
        output.push_str(&stripped[..insert_at]);
        output.push_str(&formattings_xml);
        output.push_str(&stripped[insert_at..]);
        return output;
    }
    if let Some(index) = stripped.find("<dataValidations") {
        let mut output = String::new();
        output.push_str(&stripped[..index]);
        output.push_str(&formattings_xml);
        output.push_str(&stripped[index..]);
        return output;
    }
    if let Some(index) = stripped.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&stripped[..insert_at]);
        output.push_str(&formattings_xml);
        output.push_str(&stripped[insert_at..]);
        return output;
    }
    append_before_or_end(&stripped, "</worksheet>", &formattings_xml)
}

pub(super) fn build_sheet_protection(protection: Option<&SheetProtection>) -> String {
    let Some(protection) = protection.filter(|protection| protection.enabled) else {
        return String::new();
    };
    let mut attrs = vec![r#"sheet="1""#.to_string()];
    if let Some(password) = &protection.password {
        attrs.push(format!(r#"password="{}""#, escape_xml(password)));
    }
    for (enabled, xml_key) in [
        (protection.objects, "objects"),
        (protection.scenarios, "scenarios"),
        (protection.format_cells, "formatCells"),
        (protection.format_columns, "formatColumns"),
        (protection.format_rows, "formatRows"),
        (protection.insert_columns, "insertColumns"),
        (protection.insert_rows, "insertRows"),
        (protection.insert_hyperlinks, "insertHyperlinks"),
        (protection.delete_columns, "deleteColumns"),
        (protection.delete_rows, "deleteRows"),
        (protection.sort, "sort"),
        (protection.auto_filter, "autoFilter"),
        (protection.pivot_tables, "pivotTables"),
    ] {
        if enabled {
            attrs.push(format!(r#"{xml_key}="1""#));
        }
    }
    format!("<sheetProtection {}/>", attrs.join(" "))
}

pub(super) fn update_sheet_protection(xml: &str, protection: Option<&SheetProtection>) -> String {
    let protection_xml = build_sheet_protection(protection);
    if let Some(replaced) = replace_xml_element(xml, "sheetProtection", &protection_xml) {
        return replaced;
    }
    if xml.contains("<sheetProtection") {
        return replace_empty_xml_element(xml, "<sheetProtection", &protection_xml);
    }
    if protection_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&protection_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &protection_xml)
}

pub(super) fn build_sheet_page_margins(margins: Option<&SheetPageMargins>) -> String {
    let Some(margins) = margins else {
        return String::new();
    };
    let mut attrs = Vec::new();
    for (value, key) in [
        (margins.left, "left"),
        (margins.right, "right"),
        (margins.top, "top"),
        (margins.bottom, "bottom"),
        (margins.header, "header"),
        (margins.footer, "footer"),
    ] {
        if let Some(value) = value {
            attrs.push(format!(r#"{key}="{}""#, trim_float(value)));
        }
    }
    if attrs.is_empty() {
        String::new()
    } else {
        format!("<pageMargins {}/>", attrs.join(" "))
    }
}

pub(super) fn update_sheet_page_margins(xml: &str, margins: Option<&SheetPageMargins>) -> String {
    let margins_xml = build_sheet_page_margins(margins);
    if let Some(replaced) = replace_xml_element(xml, "pageMargins", &margins_xml) {
        return replaced;
    }
    if xml.contains("<pageMargins") {
        return replace_empty_xml_element(xml, "<pageMargins", &margins_xml);
    }
    if margins_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("<pageSetup") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&margins_xml);
        output.push_str(&xml[index..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &margins_xml)
}

pub(super) fn build_sheet_page_setup(setup: Option<&SheetPageSetup>) -> String {
    let Some(setup) = setup else {
        return String::new();
    };
    let mut attrs = Vec::new();
    if let Some(orientation) = &setup.orientation {
        attrs.push(format!(r#"orientation="{}""#, escape_xml(orientation)));
    }
    for (value, key) in [
        (setup.paper_size, "paperSize"),
        (setup.scale, "scale"),
        (setup.fit_to_width, "fitToWidth"),
        (setup.fit_to_height, "fitToHeight"),
    ] {
        if let Some(value) = value {
            attrs.push(format!(r#"{key}="{value}""#));
        }
    }
    if attrs.is_empty() {
        String::new()
    } else {
        format!("<pageSetup {}/>", attrs.join(" "))
    }
}

pub(super) fn update_sheet_page_setup(xml: &str, setup: Option<&SheetPageSetup>) -> String {
    let setup_xml = build_sheet_page_setup(setup);
    if let Some(replaced) = replace_xml_element(xml, "pageSetup", &setup_xml) {
        return replaced;
    }
    if xml.contains("<pageSetup") {
        return replace_empty_xml_element(xml, "<pageSetup", &setup_xml);
    }
    if setup_xml.is_empty() {
        return xml.to_string();
    }
    append_before_or_end(xml, "</worksheet>", &setup_xml)
}

pub(super) fn build_sheet_hyperlinks(hyperlinks: &[SheetHyperlink]) -> String {
    if hyperlinks.is_empty() {
        return String::new();
    }
    let links = hyperlinks
        .iter()
        .filter(|hyperlink| valid_xlsx_sqref(&hyperlink.reference))
        .filter_map(|hyperlink| {
            if hyperlink.relationship_id.is_none() && hyperlink.location.is_none() {
                return None;
            }
            let mut attrs = vec![format!(r#"ref="{}""#, escape_xml(&hyperlink.reference))];
            if let Some(relationship_id) = &hyperlink.relationship_id {
                attrs.push(format!(r#"r:id="{}""#, escape_xml(relationship_id)));
            }
            if let Some(location) = &hyperlink.location {
                attrs.push(format!(r#"location="{}""#, escape_xml(location)));
            }
            if let Some(display) = &hyperlink.display {
                attrs.push(format!(r#"display="{}""#, escape_xml(display)));
            }
            if let Some(tooltip) = &hyperlink.tooltip {
                attrs.push(format!(r#"tooltip="{}""#, escape_xml(tooltip)));
            }
            Some(format!("<hyperlink {}/>", attrs.join(" ")))
        })
        .collect::<String>();
    if links.is_empty() {
        String::new()
    } else {
        format!("<hyperlinks>{links}</hyperlinks>")
    }
}

pub(super) fn update_sheet_hyperlinks(xml: &str, hyperlinks: &[SheetHyperlink]) -> String {
    let hyperlinks_xml = build_sheet_hyperlinks(hyperlinks);
    if let Some(replaced) = replace_xml_element(xml, "hyperlinks", &hyperlinks_xml) {
        return replaced;
    }
    if xml.contains("<hyperlinks") {
        return replace_empty_xml_element(xml, "<hyperlinks", &hyperlinks_xml);
    }
    if hyperlinks_xml.is_empty() {
        return xml.to_string();
    }
    if let Some(index) = xml.find("</dataValidations>") {
        let insert_at = index + "</dataValidations>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&hyperlinks_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    if let Some(index) = xml.find("</conditionalFormatting>") {
        let insert_at = index + "</conditionalFormatting>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&hyperlinks_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    if let Some(index) = xml.find("</sheetData>") {
        let insert_at = index + "</sheetData>".len();
        let mut output = String::new();
        output.push_str(&xml[..insert_at]);
        output.push_str(&hyperlinks_xml);
        output.push_str(&xml[insert_at..]);
        return output;
    }
    append_before_or_end(xml, "</worksheet>", &hyperlinks_xml)
}

pub(super) fn update_sheet_legacy_drawing(xml: &str, relationship_id: Option<&str>) -> String {
    let Some(relationship_id) = relationship_id else {
        return xml.to_string();
    };
    let legacy_xml = format!(r#"<legacyDrawing r:id="{}"/>"#, escape_xml(relationship_id));
    let updated = if let Some(replaced) = replace_xml_element(xml, "legacyDrawing", &legacy_xml) {
        replaced
    } else if xml.contains("<legacyDrawing") {
        replace_empty_xml_element(xml, "<legacyDrawing", &legacy_xml)
    } else if let Some(index) = xml.find("<pageMargins") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&legacy_xml);
        output.push_str(&xml[index..]);
        output
    } else if let Some(index) = xml.find("<pageSetup") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&legacy_xml);
        output.push_str(&xml[index..]);
        output
    } else {
        append_before_or_end(xml, "</worksheet>", &legacy_xml)
    };
    ensure_xlsx_relationship_namespace_for_r_id(&updated)
}

pub(super) fn ensure_xlsx_relationship_namespace(
    xml: &str,
    hyperlinks: &[SheetHyperlink],
) -> String {
    if !hyperlinks
        .iter()
        .any(|hyperlink| hyperlink.relationship_id.is_some())
        || xml.contains("xmlns:r=")
    {
        return xml.to_string();
    }
    ensure_xlsx_relationship_namespace_for_r_id(xml)
}

pub(super) fn ensure_xlsx_relationship_namespace_for_r_id(xml: &str) -> String {
    if xml.contains("xmlns:r=") {
        return xml.to_string();
    }
    let Some(start) = xml.find("<worksheet") else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find('>') else {
        return xml.to_string();
    };
    let original = &after_start[..=end];
    let updated = set_xml_attr(
        original,
        "xmlns:r",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );
    let mut output = String::new();
    output.push_str(&xml[..start]);
    output.push_str(&updated);
    output.push_str(&after_start[end + 1..]);
    output
}

pub(super) fn update_sheet_hyperlink_relationships(
    original_rels: Option<&str>,
    update: &mut SheetUpdate,
) -> Option<String> {
    let has_external_hyperlinks = update.hyperlinks.iter().any(|link| link.target.is_some());
    if original_rels.is_none() && !has_external_hyperlinks {
        return None;
    }
    let mut rels = original_rels
        .map(str::to_string)
        .unwrap_or_else(xlsx_empty_relationships);
    rels = remove_relationships_by_type(&rels, "/hyperlink");
    let mut next_id = next_rid(&rels);
    for hyperlink in &mut update.hyperlinks {
        let Some(target) = hyperlink.target.as_deref() else {
            hyperlink.relationship_id = None;
            continue;
        };
        let relationship_id = format!("rId{next_id}");
        next_id += 1;
        let relationship = format!(
            r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{}" TargetMode="External"/>"#,
            escape_xml(target)
        );
        rels = append_before_or_end(&rels, "</Relationships>", &relationship);
        hyperlink.relationship_id = Some(relationship_id);
    }
    Some(rels)
}

pub(super) fn insert_sheet_data(xml: &str, sheet_data: &str) -> String {
    if let Some(index) = xml.find("</worksheet>") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(sheet_data);
        output.push_str(&xml[index..]);
        return output;
    }
    format!("{xml}{sheet_data}")
}

pub(super) fn update_sheet_dimension<'a>(
    xml: &str,
    references: impl Iterator<Item = &'a String>,
) -> String {
    let Some((max_column, max_row)) = max_cell_reference(references) else {
        return xml.to_string();
    };
    let dimension = format!(
        r#"<dimension ref="A1:{}{}"/>"#,
        column_letters(max_column),
        max_row
    );
    if let Some(start) = xml.find("<dimension") {
        let after_start = &xml[start..];
        if let Some(end) = after_start.find("/>") {
            let mut output = String::new();
            output.push_str(&xml[..start]);
            output.push_str(&dimension);
            output.push_str(&after_start[end + 2..]);
            return output;
        }
    }
    if let Some(index) = xml.find("<sheetData") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&dimension);
        output.push_str(&xml[index..]);
        return output;
    }
    xml.to_string()
}

pub(super) fn max_cell_reference<'a>(
    references: impl Iterator<Item = &'a String>,
) -> Option<(u32, u32)> {
    let mut max_column = 0;
    let mut max_row = 0;
    for reference in references {
        if let Some((column, row)) = split_cell_reference(reference) {
            max_column = max_column.max(column);
            max_row = max_row.max(row);
        }
    }
    if max_column == 0 || max_row == 0 {
        None
    } else {
        Some((max_column, max_row))
    }
}

pub(super) fn split_cell_reference(reference: &str) -> Option<(u32, u32)> {
    let mut column = 0u32;
    let mut row = String::new();
    for ch in reference.chars() {
        if ch.is_ascii_alphabetic() {
            column = column * 26 + (ch.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
        } else if ch.is_ascii_digit() {
            row.push(ch);
        }
    }
    let row = row.parse::<u32>().ok()?;
    if column == 0 || row == 0 {
        None
    } else {
        Some((column, row))
    }
}

pub(super) fn valid_xlsx_range_reference(reference: &str) -> bool {
    let Some((start, end)) = reference.split_once(':') else {
        return false;
    };
    split_cell_reference(start).is_some() && split_cell_reference(end).is_some()
}

pub(super) fn valid_xlsx_sqref(reference: &str) -> bool {
    let references = reference.split_whitespace().collect::<Vec<_>>();
    !references.is_empty()
        && references.iter().all(|item| {
            if item.contains(':') {
                valid_xlsx_range_reference(item)
            } else {
                split_cell_reference(item).is_some()
            }
        })
}

pub(super) fn trim_float(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

pub(super) fn read_shared_strings(bytes: &[u8]) -> AppResult<Vec<String>> {
    let xml = read_zip_text(bytes, "xl/sharedStrings.xml")?;
    Ok(xml_segments(&xml, "<si", "</si>")
        .into_iter()
        .map(|item| extract_text_tags(&item, "t").join(""))
        .collect())
}
