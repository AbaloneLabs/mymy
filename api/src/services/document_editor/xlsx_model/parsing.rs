use super::*;

pub(in crate::services::document_editor) fn parse_sheet_rows(
    xml: &str,
    shared_strings: &[String],
    styles: Option<&XlsxParsedStyles>,
) -> Vec<Value> {
    let mut rows = Vec::new();
    for row_xml in xml_segments(xml, "<row", "</row>") {
        let row_ref = attr_value(&row_xml, "r").unwrap_or_default();
        let height = attr_value(&row_xml, "ht").and_then(|value| value.parse::<f64>().ok());
        let hidden = attr_value(&row_xml, "hidden")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let cells = xml_segments(&row_xml, "<c", "</c>")
            .into_iter()
            .map(|cell| {
                let reference = attr_value(&cell, "r").unwrap_or_default();
                let cell_type = attr_value(&cell, "t").unwrap_or_default();
                let style_index =
                    attr_value(&cell, "s").and_then(|value| value.parse::<usize>().ok());
                let formula = first_tag_text(&cell, "f");
                let raw = if cell_type == "inlineStr" {
                    extract_text_tags(&cell, "t").join("")
                } else {
                    first_tag_text(&cell, "v").unwrap_or_default()
                };
                let value = if cell_type == "s" {
                    raw.parse::<usize>()
                        .ok()
                        .and_then(|idx| shared_strings.get(idx).cloned())
                        .unwrap_or(raw)
                } else {
                    raw
                };
                let mut cell_json = json!({ "ref": reference, "value": value });
                if let Some(formula) = formula {
                    cell_json["formula"] = json!(formula);
                }
                if let Some(style) = style_index
                    .and_then(|index| styles.and_then(|styles| styles.cell_styles.get(index)))
                {
                    append_xlsx_style_to_cell_json(&mut cell_json, style);
                }
                cell_json
            })
            .collect::<Vec<_>>();
        let mut row = json!({ "index": row_ref, "cells": cells });
        if let Some(height) = height {
            row["height"] = json!(height);
        }
        if hidden {
            row["hidden"] = json!(true);
        }
        rows.push(row);
    }
    rows
}

pub(in crate::services::document_editor) fn parse_sheet_columns(xml: &str) -> Vec<Value> {
    let mut columns = Vec::new();
    for column_xml in xml_empty_elements(xml, "<col ") {
        let Some(min) = attr_value(&column_xml, "min").and_then(|value| value.parse::<u32>().ok())
        else {
            continue;
        };
        let max = attr_value(&column_xml, "max")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(min);
        let width = attr_value(&column_xml, "width").and_then(|value| value.parse::<f64>().ok());
        let hidden = attr_value(&column_xml, "hidden")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        for index in min..=max {
            let mut column = json!({ "index": index.saturating_sub(1) });
            if let Some(width) = width {
                column["width"] = json!(width);
            }
            if hidden {
                column["hidden"] = json!(true);
            }
            columns.push(column);
        }
    }
    columns
}

pub(in crate::services::document_editor) fn parse_sheet_tab_color(
    xml: &str,
) -> Option<XlsxTabColor> {
    let sheet_pr = xml_named_segments(xml, "sheetPr")
        .into_iter()
        .next()
        .or_else(|| xml_named_empty_elements(xml, "sheetPr").into_iter().next())?;
    let source_xml = xml_named_empty_elements(&sheet_pr, "tabColor")
        .into_iter()
        .chain(xml_named_segments(&sheet_pr, "tabColor"))
        .next()?;
    let color = attr_value(&source_xml, "rgb").and_then(|value| xlsx_hex_color(&value));
    Some(XlsxTabColor { color, source_xml })
}

pub(in crate::services::document_editor) fn parse_sheet_merged_ranges(xml: &str) -> Vec<Value> {
    xml_empty_elements(xml, "<mergeCell ")
        .into_iter()
        .filter_map(|merge| attr_value(&merge, "ref"))
        .map(|reference| json!({ "ref": reference }))
        .collect()
}

pub(in crate::services::document_editor) fn parse_sheet_data_validations(xml: &str) -> Vec<Value> {
    xml_named_segments(xml, "dataValidation")
        .into_iter()
        .chain(xml_named_empty_elements(xml, "dataValidation"))
        .filter_map(|validation| {
            let sqref = attr_value(&validation, "sqref")?;
            let mut item = json!({ "sqref": sqref });
            if let Some(validation_type) = attr_value(&validation, "type") {
                item["type"] = json!(validation_type);
            }
            if let Some(operator) = attr_value(&validation, "operator") {
                item["operator"] = json!(operator);
            }
            if let Some(formula1) = first_tag_text(&validation, "formula1") {
                item["formula1"] = json!(formula1);
            }
            if let Some(formula2) = first_tag_text(&validation, "formula2") {
                item["formula2"] = json!(formula2);
            }
            if xml_bool_attr(&validation, "allowBlank") {
                item["allowBlank"] = json!(true);
            }
            if xml_bool_attr(&validation, "showInputMessage") {
                item["showInputMessage"] = json!(true);
            }
            if xml_bool_attr(&validation, "showErrorMessage") {
                item["showErrorMessage"] = json!(true);
            }
            if let Some(prompt_title) = attr_value(&validation, "promptTitle") {
                item["promptTitle"] = json!(unescape_xml(&prompt_title));
            }
            if let Some(prompt) = attr_value(&validation, "prompt") {
                item["prompt"] = json!(unescape_xml(&prompt));
            }
            if let Some(error_title) = attr_value(&validation, "errorTitle") {
                item["errorTitle"] = json!(unescape_xml(&error_title));
            }
            if let Some(error) = attr_value(&validation, "error") {
                item["error"] = json!(unescape_xml(&error));
            }
            Some(item)
        })
        .collect()
}

pub(in crate::services::document_editor) fn parse_sheet_conditional_formattings(
    xml: &str,
    styles: Option<&XlsxParsedStyles>,
) -> Vec<Value> {
    xml_named_segments(xml, "conditionalFormatting")
        .into_iter()
        .filter_map(|formatting| {
            let sqref = attr_value(&formatting, "sqref")?;
            let rules = xml_named_segments(&formatting, "cfRule")
                .into_iter()
                .chain(xml_named_empty_elements(&formatting, "cfRule"))
                .filter_map(|rule| parse_sheet_conditional_rule(&rule, styles))
                .collect::<Vec<_>>();
            if rules.is_empty() {
                return None;
            }
            Some(json!({
                "sqref": sqref,
                "rules": rules
            }))
        })
        .collect()
}

pub(in crate::services::document_editor) fn parse_sheet_conditional_rule(
    rule: &str,
    styles: Option<&XlsxParsedStyles>,
) -> Option<Value> {
    let mut item = json!({ "sourceXml": rule });
    if let Some(rule_type) = attr_value(rule, "type") {
        item["type"] = json!(rule_type);
    }
    if let Some(operator) = attr_value(rule, "operator") {
        item["operator"] = json!(operator);
    }
    if let Some(priority) = attr_value(rule, "priority").and_then(|value| value.parse::<u32>().ok())
    {
        item["priority"] = json!(priority);
    }
    if let Some(dxf_id) = attr_value(rule, "dxfId").and_then(|value| value.parse::<usize>().ok()) {
        item["dxfId"] = json!(dxf_id);
        if let Some(fill_color) = styles
            .and_then(|styles| styles.dxfs.get(dxf_id))
            .and_then(|dxf| dxf.fill_color.as_ref())
        {
            item["fillColor"] = json!(format!("#{fill_color}"));
        }
    }
    if let Some(text) = attr_value(rule, "text") {
        item["text"] = json!(unescape_xml(&text));
    }
    if let Some(time_period) = attr_value(rule, "timePeriod") {
        item["timePeriod"] = json!(time_period);
    }
    let formulas = extract_text_tags(rule, "formula");
    if !formulas.is_empty() {
        item["formulas"] = json!(formulas);
    }
    Some(item)
}

pub(in crate::services::document_editor) fn parse_sheet_protection(xml: &str) -> Option<Value> {
    let protection = xml_named_empty_elements(xml, "sheetProtection")
        .into_iter()
        .chain(xml_named_segments(xml, "sheetProtection"))
        .next()?;
    let mut item = json!({
        "enabled": attr_value(&protection, "sheet")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(true)
    });
    if let Some(password) = attr_value(&protection, "password") {
        item["password"] = json!(password);
    }
    for (json_key, xml_key) in [
        ("objects", "objects"),
        ("scenarios", "scenarios"),
        ("formatCells", "formatCells"),
        ("formatColumns", "formatColumns"),
        ("formatRows", "formatRows"),
        ("insertColumns", "insertColumns"),
        ("insertRows", "insertRows"),
        ("insertHyperlinks", "insertHyperlinks"),
        ("deleteColumns", "deleteColumns"),
        ("deleteRows", "deleteRows"),
        ("sort", "sort"),
        ("autoFilter", "autoFilter"),
        ("pivotTables", "pivotTables"),
    ] {
        if xml_bool_attr(&protection, xml_key) {
            item[json_key] = json!(true);
        }
    }
    Some(item)
}

pub(in crate::services::document_editor) fn parse_sheet_page_margins(xml: &str) -> Option<Value> {
    let margins = xml_named_empty_elements(xml, "pageMargins")
        .into_iter()
        .next()?;
    let mut item = json!({});
    for key in ["left", "right", "top", "bottom", "header", "footer"] {
        if let Some(value) = attr_value(&margins, key).and_then(|value| value.parse::<f64>().ok()) {
            item[key] = json!(value);
        }
    }
    Some(item)
}

pub(in crate::services::document_editor) fn parse_sheet_page_setup(xml: &str) -> Option<Value> {
    let setup = xml_named_empty_elements(xml, "pageSetup")
        .into_iter()
        .next()?;
    let mut item = json!({});
    if let Some(orientation) = attr_value(&setup, "orientation") {
        item["orientation"] = json!(orientation);
    }
    for (json_key, xml_key) in [
        ("paperSize", "paperSize"),
        ("scale", "scale"),
        ("fitToWidth", "fitToWidth"),
        ("fitToHeight", "fitToHeight"),
    ] {
        if let Some(value) = attr_value(&setup, xml_key).and_then(|value| value.parse::<u32>().ok())
        {
            item[json_key] = json!(value);
        }
    }
    Some(item)
}

pub(in crate::services::document_editor) fn parse_sheet_hyperlinks(
    xml: &str,
    hyperlink_targets: &BTreeMap<String, String>,
) -> Vec<Value> {
    xml_named_empty_elements(xml, "hyperlink")
        .into_iter()
        .chain(xml_named_segments(xml, "hyperlink"))
        .filter_map(|hyperlink| {
            let reference = attr_value(&hyperlink, "ref")?;
            let mut item = json!({ "ref": reference });
            if let Some(relationship_id) = attr_value(&hyperlink, "r:id") {
                item["relationshipId"] = json!(relationship_id);
                if let Some(target) = item["relationshipId"]
                    .as_str()
                    .and_then(|id| hyperlink_targets.get(id))
                {
                    item["target"] = json!(target);
                }
            }
            if let Some(location) = attr_value(&hyperlink, "location") {
                item["location"] = json!(unescape_xml(&location));
            }
            if let Some(display) = attr_value(&hyperlink, "display") {
                item["display"] = json!(unescape_xml(&display));
            }
            if let Some(tooltip) = attr_value(&hyperlink, "tooltip") {
                item["tooltip"] = json!(unescape_xml(&tooltip));
            }
            Some(item)
        })
        .collect()
}

pub(in crate::services::document_editor) fn parse_sheet_auto_filter(xml: &str) -> Option<String> {
    xml_named_empty_elements(xml, "autoFilter")
        .into_iter()
        .chain(xml_named_segments(xml, "autoFilter"))
        .find_map(|auto_filter| attr_value(&auto_filter, "ref"))
}

pub(in crate::services::document_editor) fn xml_bool_attr(xml: &str, attr: &str) -> bool {
    attr_value(xml, attr)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub(in crate::services::document_editor) fn xlsx_hyperlink_relationship_targets(
    rels: &str,
) -> BTreeMap<String, String> {
    xml_named_empty_elements(rels, "Relationship")
        .into_iter()
        .filter_map(|relationship| {
            let relationship_id = attr_value(&relationship, "Id")?;
            let relationship_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !relationship_type.ends_with("/hyperlink") {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some((relationship_id, unescape_xml(&target)))
        })
        .collect()
}

pub(in crate::services::document_editor) fn parse_sheet_comments(xml: &str) -> Vec<Value> {
    let authors = xml_named_segments(xml, "authors")
        .into_iter()
        .next()
        .map(|authors_xml| extract_text_tags(&authors_xml, "author"))
        .unwrap_or_default();
    xml_segments(xml, "<comment ", "</comment>")
        .into_iter()
        .filter_map(|comment| {
            let reference = attr_value(&comment, "ref")?;
            let author_id = attr_value(&comment, "authorId")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            let text = extract_text_tags(&comment, "t").join("\n");
            let mut item = json!({
                "ref": reference,
                "text": text,
                "authorId": author_id
            });
            if let Some(author) = authors.get(author_id) {
                item["author"] = json!(author);
            }
            Some(item)
        })
        .collect()
}

pub(in crate::services::document_editor) fn parse_sheet_frozen_pane(xml: &str) -> (u32, u32) {
    let Some(pane) = xml_empty_elements(xml, "<pane ")
        .into_iter()
        .find(|pane| attr_value(pane, "state").as_deref() == Some("frozen"))
    else {
        return (0, 0);
    };
    let rows = attr_value(&pane, "ySplit")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| value.max(0.0).floor() as u32)
        .unwrap_or(0);
    let columns = attr_value(&pane, "xSplit")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| value.max(0.0).floor() as u32)
        .unwrap_or(0);
    (rows, columns)
}
