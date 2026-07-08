use super::*;

pub(in crate::services::document_editor) fn build_sheet_views(
    frozen_rows: u32,
    frozen_columns: u32,
) -> String {
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

pub(in crate::services::document_editor) fn update_sheet_views(
    xml: &str,
    frozen_rows: u32,
    frozen_columns: u32,
) -> String {
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

pub(in crate::services::document_editor) fn build_xlsx_worksheet(update: &SheetUpdate) -> String {
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

pub(in crate::services::document_editor) fn update_xlsx_worksheet(
    xml: &str,
    update: &SheetUpdate,
) -> String {
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

pub(in crate::services::document_editor) fn build_sheet_pr(tab_color_xml: Option<&str>) -> String {
    tab_color_xml
        .filter(|xml| !xml.trim().is_empty())
        .map(|xml| format!("<sheetPr>{xml}</sheetPr>"))
        .unwrap_or_default()
}

pub(in crate::services::document_editor) fn update_sheet_pr(
    xml: &str,
    tab_color_xml: Option<&str>,
) -> String {
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

pub(in crate::services::document_editor) fn update_sheet_pr_tab_color(
    sheet_pr: &str,
    tab_color_xml: Option<&str>,
) -> String {
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

pub(in crate::services::document_editor) fn build_sheet_cell(
    original: &str,
    reference: &str,
    cell: &SheetCellWrite,
) -> String {
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

pub(in crate::services::document_editor) fn original_sheet_cells(
    xml: &str,
) -> BTreeMap<String, String> {
    let mut cells = BTreeMap::new();
    for cell in xml_segments(xml, "<c", "</c>") {
        if let Some(reference) = attr_value(&cell, "r") {
            cells.insert(reference, cell);
        }
    }
    cells
}

pub(in crate::services::document_editor) fn build_sheet_data(
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

pub(in crate::services::document_editor) fn build_sheet_row_start(
    row_index: u32,
    row: Option<&SheetRowWrite>,
) -> String {
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

pub(in crate::services::document_editor) fn build_sheet_columns(
    columns: &[SheetColumnWrite],
) -> String {
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

pub(in crate::services::document_editor) fn update_sheet_columns(
    xml: &str,
    columns: &[SheetColumnWrite],
) -> String {
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

pub(in crate::services::document_editor) fn build_sheet_merge_cells(ranges: &[String]) -> String {
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

pub(in crate::services::document_editor) fn update_sheet_merge_cells(
    xml: &str,
    ranges: &[String],
) -> String {
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

pub(in crate::services::document_editor) fn build_sheet_auto_filter(
    reference: Option<&str>,
) -> String {
    reference
        .filter(|reference| valid_xlsx_range_reference(reference))
        .map(|reference| format!(r#"<autoFilter ref="{}"/>"#, escape_xml(reference)))
        .unwrap_or_default()
}

pub(in crate::services::document_editor) fn update_sheet_auto_filter(
    xml: &str,
    reference: Option<&str>,
) -> String {
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

pub(in crate::services::document_editor) fn insert_sheet_data(
    xml: &str,
    sheet_data: &str,
) -> String {
    if let Some(index) = xml.find("</worksheet>") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(sheet_data);
        output.push_str(&xml[index..]);
        return output;
    }
    format!("{xml}{sheet_data}")
}

pub(in crate::services::document_editor) fn update_sheet_dimension<'a>(
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

pub(in crate::services::document_editor) fn max_cell_reference<'a>(
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

pub(in crate::services::document_editor) fn split_cell_reference(
    reference: &str,
) -> Option<(u32, u32)> {
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

pub(in crate::services::document_editor) fn valid_xlsx_range_reference(reference: &str) -> bool {
    let Some((start, end)) = reference.split_once(':') else {
        return false;
    };
    split_cell_reference(start).is_some() && split_cell_reference(end).is_some()
}

pub(in crate::services::document_editor) fn valid_xlsx_sqref(reference: &str) -> bool {
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

pub(in crate::services::document_editor) fn trim_float(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}
