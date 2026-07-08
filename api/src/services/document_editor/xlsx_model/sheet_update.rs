use super::*;

pub(in crate::services::document_editor) fn sheet_update_from_model(
    sheet: &Value,
    rows: &[Value],
) -> SheetUpdate {
    SheetUpdate {
        cells: sheet_cell_writes(rows),
        rows: sheet_row_writes(rows),
        columns: sheet_column_writes(sheet),
        tab_color_xml: sheet_tab_color_xml(sheet),
        merged_ranges: sheet_merged_ranges(sheet),
        data_validations: sheet_data_validations(sheet),
        conditional_formattings: sheet_conditional_formattings(sheet),
        protection: sheet_protection(sheet),
        page_margins: sheet_page_margins(sheet),
        page_setup: sheet_page_setup(sheet),
        hyperlinks: sheet_hyperlinks(sheet),
        comments: sheet_comments(sheet),
        auto_filter: sheet
            .get("autoFilter")
            .and_then(Value::as_str)
            .filter(|reference| valid_xlsx_range_reference(reference))
            .map(str::to_string),
        frozen_rows: sheet
            .get("frozenRows")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(1_048_575) as u32,
        frozen_columns: sheet
            .get("frozenColumns")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(16_383) as u32,
    }
}

pub(in crate::services::document_editor) fn sheet_cell_writes(
    rows: &[Value],
) -> BTreeMap<String, SheetCellWrite> {
    let mut writes = BTreeMap::new();
    for row in rows {
        let Some(row_cells) = row.get("cells").and_then(Value::as_array) else {
            continue;
        };
        for cell in row_cells {
            if cell
                .get("generated")
                .and_then(Value::as_str)
                .is_some_and(|value| value == "spill")
            {
                continue;
            }
            let Some(reference) = cell.get("ref").and_then(Value::as_str) else {
                continue;
            };
            let mut value = cell
                .get("value")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let mut formula = cell
                .get("formula")
                .and_then(Value::as_str)
                .map(str::to_string);
            if formula.is_none() && value.starts_with('=') {
                formula = Some(value.trim_start_matches('=').to_string());
                value.clear();
            }
            writes.insert(
                reference.to_string(),
                SheetCellWrite {
                    value,
                    formula,
                    style: xlsx_cell_style_from_model(cell),
                    style_index: None,
                },
            );
        }
    }
    writes
}

pub(in crate::services::document_editor) fn sheet_row_writes(
    rows: &[Value],
) -> BTreeMap<u32, SheetRowWrite> {
    let mut row_writes = BTreeMap::new();
    for (index, row) in rows.iter().enumerate() {
        let row_index = row
            .get("index")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or((index + 1) as u32);
        let height = row.get("height").and_then(Value::as_f64);
        let hidden = row.get("hidden").and_then(Value::as_bool).unwrap_or(false);
        if height.is_some() || hidden {
            row_writes.insert(row_index, SheetRowWrite { height, hidden });
        }
    }
    row_writes
}

pub(in crate::services::document_editor) fn sheet_column_writes(
    sheet: &Value,
) -> Vec<SheetColumnWrite> {
    let Some(columns) = sheet.get("columns").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut writes = columns
        .iter()
        .filter_map(|column| {
            let index = column.get("index").and_then(Value::as_u64)?;
            Some(SheetColumnWrite {
                index: (index as u32).saturating_add(1),
                width: column.get("width").and_then(Value::as_f64),
                hidden: column
                    .get("hidden")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect::<Vec<_>>();
    writes.sort_by_key(|column| column.index);
    writes.dedup_by_key(|column| column.index);
    writes
}

pub(in crate::services::document_editor) fn sheet_tab_color_xml(sheet: &Value) -> Option<String> {
    if let Some(color) = sheet
        .get("tabColor")
        .and_then(Value::as_str)
        .and_then(docx_hex_color)
    {
        return Some(format!(r#"<tabColor rgb="FF{color}"/>"#));
    }
    sheet
        .get("tabColorSourceXml")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|source| source.starts_with("<tabColor") && source.ends_with('>'))
        .map(str::to_string)
}

pub(in crate::services::document_editor) fn sheet_merged_ranges(sheet: &Value) -> Vec<String> {
    let Some(ranges) = sheet.get("mergedRanges").and_then(Value::as_array) else {
        return Vec::new();
    };
    ranges
        .iter()
        .filter_map(|range| range.get("ref").and_then(Value::as_str))
        .filter(|reference| valid_xlsx_range_reference(reference))
        .map(str::to_string)
        .collect()
}

pub(in crate::services::document_editor) fn sheet_data_validations(
    sheet: &Value,
) -> Vec<SheetDataValidation> {
    let Some(validations) = sheet.get("dataValidations").and_then(Value::as_array) else {
        return Vec::new();
    };
    validations
        .iter()
        .filter_map(|validation| {
            let sqref = validation.get("sqref").and_then(Value::as_str)?;
            if !valid_xlsx_sqref(sqref) {
                return None;
            }
            Some(SheetDataValidation {
                sqref: sqref.to_string(),
                validation_type: xlsx_validation_string(validation, "type")
                    .filter(|value| valid_xlsx_validation_type(value)),
                operator: xlsx_validation_string(validation, "operator")
                    .filter(|value| valid_xlsx_validation_operator(value)),
                formula1: xlsx_validation_string(validation, "formula1"),
                formula2: xlsx_validation_string(validation, "formula2"),
                allow_blank: validation
                    .get("allowBlank")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                show_input_message: validation
                    .get("showInputMessage")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                show_error_message: validation
                    .get("showErrorMessage")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                prompt_title: xlsx_validation_string(validation, "promptTitle"),
                prompt: xlsx_validation_string(validation, "prompt"),
                error_title: xlsx_validation_string(validation, "errorTitle"),
                error: xlsx_validation_string(validation, "error"),
            })
        })
        .collect()
}

pub(in crate::services::document_editor) fn xlsx_validation_string(
    value: &Value,
    key: &str,
) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(in crate::services::document_editor) fn valid_xlsx_validation_type(value: &str) -> bool {
    matches!(
        value,
        "whole" | "decimal" | "list" | "date" | "time" | "textLength" | "custom"
    )
}

pub(in crate::services::document_editor) fn valid_xlsx_validation_operator(value: &str) -> bool {
    matches!(
        value,
        "between"
            | "notBetween"
            | "equal"
            | "notEqual"
            | "greaterThan"
            | "lessThan"
            | "greaterThanOrEqual"
            | "lessThanOrEqual"
    )
}

pub(in crate::services::document_editor) fn sheet_conditional_formattings(
    sheet: &Value,
) -> Vec<SheetConditionalFormatting> {
    let Some(formatting_groups) = sheet
        .get("conditionalFormattings")
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    formatting_groups
        .iter()
        .filter_map(|formatting| {
            let sqref = formatting.get("sqref").and_then(Value::as_str)?;
            if !valid_xlsx_sqref(sqref) {
                return None;
            }
            let rules = formatting
                .get("rules")
                .and_then(Value::as_array)
                .map(|rules| {
                    rules
                        .iter()
                        .filter_map(sheet_conditional_rule)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if rules.is_empty() {
                return None;
            }
            Some(SheetConditionalFormatting {
                sqref: sqref.to_string(),
                rules,
            })
        })
        .collect()
}

pub(in crate::services::document_editor) fn sheet_conditional_rule(
    rule: &Value,
) -> Option<SheetConditionalRule> {
    let source_xml =
        xlsx_validation_string(rule, "sourceXml").filter(|source| source.starts_with("<cfRule"));
    let rule_type = xlsx_validation_string(rule, "type")
        .filter(|value| valid_xlsx_conditional_rule_type(value));
    if source_xml.is_none() && rule_type.is_none() {
        return None;
    }
    let formulas = rule
        .get("formulas")
        .and_then(Value::as_array)
        .map(|formulas| {
            formulas
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Some(SheetConditionalRule {
        rule_type,
        operator: xlsx_validation_string(rule, "operator")
            .filter(|value| valid_xlsx_conditional_operator(value)),
        priority: rule
            .get("priority")
            .and_then(Value::as_u64)
            .map(|value| value.min(u32::MAX as u64) as u32),
        dxf_id: rule
            .get("dxfId")
            .and_then(Value::as_u64)
            .map(|value| value.min(usize::MAX as u64) as usize),
        fill_color: rule
            .get("fillColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        text: xlsx_validation_string(rule, "text"),
        time_period: xlsx_validation_string(rule, "timePeriod"),
        formulas,
        source_xml,
    })
}

pub(in crate::services::document_editor) fn valid_xlsx_conditional_rule_type(value: &str) -> bool {
    matches!(
        value,
        "cellIs"
            | "expression"
            | "colorScale"
            | "dataBar"
            | "iconSet"
            | "top10"
            | "uniqueValues"
            | "duplicateValues"
            | "containsText"
            | "notContainsText"
            | "beginsWith"
            | "endsWith"
            | "aboveAverage"
            | "timePeriod"
            | "blanks"
            | "notBlanks"
            | "errors"
            | "notErrors"
    )
}

pub(in crate::services::document_editor) fn valid_xlsx_conditional_operator(value: &str) -> bool {
    matches!(
        value,
        "lessThan"
            | "lessThanOrEqual"
            | "equal"
            | "notEqual"
            | "greaterThanOrEqual"
            | "greaterThan"
            | "between"
            | "notBetween"
            | "containsText"
            | "notContains"
            | "beginsWith"
            | "endsWith"
    )
}

pub(in crate::services::document_editor) fn sheet_protection(
    sheet: &Value,
) -> Option<SheetProtection> {
    let protection = sheet.get("protection")?;
    let enabled = protection
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        return None;
    }
    Some(SheetProtection {
        enabled,
        password: xlsx_validation_string(protection, "password")
            .filter(|value| value.chars().all(|ch| ch.is_ascii_hexdigit())),
        objects: protection
            .get("objects")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        scenarios: protection
            .get("scenarios")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        format_cells: protection
            .get("formatCells")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        format_columns: protection
            .get("formatColumns")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        format_rows: protection
            .get("formatRows")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        insert_columns: protection
            .get("insertColumns")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        insert_rows: protection
            .get("insertRows")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        insert_hyperlinks: protection
            .get("insertHyperlinks")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        delete_columns: protection
            .get("deleteColumns")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        delete_rows: protection
            .get("deleteRows")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        sort: protection
            .get("sort")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        auto_filter: protection
            .get("autoFilter")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        pivot_tables: protection
            .get("pivotTables")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

pub(in crate::services::document_editor) fn sheet_page_margins(
    sheet: &Value,
) -> Option<SheetPageMargins> {
    let margins = sheet.get("pageMargins")?;
    Some(SheetPageMargins {
        left: sheet_non_negative_float(margins, "left"),
        right: sheet_non_negative_float(margins, "right"),
        top: sheet_non_negative_float(margins, "top"),
        bottom: sheet_non_negative_float(margins, "bottom"),
        header: sheet_non_negative_float(margins, "header"),
        footer: sheet_non_negative_float(margins, "footer"),
    })
}

pub(in crate::services::document_editor) fn sheet_page_setup(
    sheet: &Value,
) -> Option<SheetPageSetup> {
    let setup = sheet.get("pageSetup")?;
    Some(SheetPageSetup {
        orientation: xlsx_validation_string(setup, "orientation")
            .filter(|value| matches!(value.as_str(), "portrait" | "landscape")),
        paper_size: sheet_u32_in_range(setup, "paperSize", 1, 118),
        scale: sheet_u32_in_range(setup, "scale", 10, 400),
        fit_to_width: sheet_u32_in_range(setup, "fitToWidth", 0, 100),
        fit_to_height: sheet_u32_in_range(setup, "fitToHeight", 0, 100),
    })
}

pub(in crate::services::document_editor) fn sheet_hyperlinks(sheet: &Value) -> Vec<SheetHyperlink> {
    let Some(hyperlinks) = sheet.get("hyperlinks").and_then(Value::as_array) else {
        return Vec::new();
    };
    hyperlinks
        .iter()
        .filter_map(|hyperlink| {
            let reference = hyperlink.get("ref").and_then(Value::as_str)?;
            if !valid_xlsx_sqref(reference) {
                return None;
            }
            let target = xlsx_validation_string(hyperlink, "target");
            let location = xlsx_validation_string(hyperlink, "location");
            if target.is_none() && location.is_none() {
                return None;
            }
            Some(SheetHyperlink {
                reference: reference.to_string(),
                relationship_id: xlsx_validation_string(hyperlink, "relationshipId"),
                target,
                location,
                display: xlsx_validation_string(hyperlink, "display"),
                tooltip: xlsx_validation_string(hyperlink, "tooltip"),
            })
        })
        .collect()
}

pub(in crate::services::document_editor) fn sheet_comments(
    sheet: &Value,
) -> Option<Vec<SheetComment>> {
    let comments = sheet.get("comments")?.as_array()?;
    Some(
        comments
            .iter()
            .filter_map(|comment| {
                let reference = comment.get("ref").and_then(Value::as_str)?;
                split_cell_reference(reference)?;
                let text = xlsx_validation_string(comment, "text")?;
                Some(SheetComment {
                    reference: reference.to_string(),
                    author: xlsx_validation_string(comment, "author"),
                    text,
                })
            })
            .collect(),
    )
}

pub(in crate::services::document_editor) fn sheet_non_negative_float(
    value: &Value,
    key: &str,
) -> Option<f64> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite() && *number >= 0.0)
}

pub(in crate::services::document_editor) fn sheet_u32_in_range(
    value: &Value,
    key: &str,
    min: u32,
    max: u32,
) -> Option<u32> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .map(|number| number.clamp(min as u64, max as u64) as u32)
}
