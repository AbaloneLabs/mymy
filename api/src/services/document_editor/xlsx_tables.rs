use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::ooxml_package::read_zip_text;
use super::xml_utils::{
    append_before_or_end, attr_value, escape_xml, replace_empty_xml_element, replace_xml_element,
    set_first_xml_tag_attrs, xml_named_empty_elements, xml_named_segments, xml_named_start_tag,
};

pub(super) fn parse_xlsx_sheet_tables(
    bytes: &[u8],
    sheet_xml: &str,
    relationships: &BTreeMap<String, (String, String)>,
) -> Vec<Value> {
    xml_named_empty_elements(sheet_xml, "tablePart")
        .into_iter()
        .filter_map(|table_part| {
            let relationship_id = attr_value(&table_part, "r:id")?;
            let (relationship_type, table_path) = relationships.get(&relationship_id)?;
            if !relationship_type.ends_with("/table") {
                return None;
            }
            let table_xml = read_zip_text(bytes, table_path).unwrap_or_default();
            let table_start = xml_named_start_tag(&table_xml, "table").unwrap_or_default();
            let table_style = xml_named_empty_elements(&table_xml, "tableStyleInfo")
                .into_iter()
                .next()
                .unwrap_or_default();
            let columns = xml_named_empty_elements(&table_xml, "tableColumn")
                .into_iter()
                .chain(xml_named_segments(&table_xml, "tableColumn"))
                .map(|column| {
                    json!({
                        "id": attr_value(&column, "id"),
                        "name": attr_value(&column, "name"),
                        "totalsRowFunction": attr_value(&column, "totalsRowFunction")
                    })
                })
                .collect::<Vec<_>>();
            Some(json!({
                "id": relationship_id,
                "path": table_path,
                "name": attr_value(&table_start, "name"),
                "displayName": attr_value(&table_start, "displayName"),
                "ref": attr_value(&table_start, "ref"),
                "autoFilterRef": super::parse_sheet_auto_filter(&table_xml),
                "totalsRowShown": attr_value(&table_start, "totalsRowShown")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "tableStyleName": attr_value(&table_style, "name"),
                "showFirstColumn": attr_value(&table_style, "showFirstColumn")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "showLastColumn": attr_value(&table_style, "showLastColumn")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "showRowStripes": attr_value(&table_style, "showRowStripes")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "showColumnStripes": attr_value(&table_style, "showColumnStripes")
                    .map(|value| value == "1" || value.eq_ignore_ascii_case("true")),
                "columns": columns
            }))
        })
        .collect()
}

pub(super) fn add_xlsx_table_replacements(
    original: &[u8],
    sheet: &Value,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(tables) = sheet.get("tables").and_then(Value::as_array) else {
        return;
    };
    for table in tables {
        let Some(table_path) = table
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_xlsx_table_path(path))
        else {
            continue;
        };
        let Ok(table_xml) = read_zip_text(original, table_path) else {
            continue;
        };
        let updated = update_xlsx_table_xml(&table_xml, table);
        replacements.push((table_path.to_string(), updated.into_bytes()));
    }
}

pub(super) fn update_xlsx_table_xml(table_xml: &str, table: &Value) -> String {
    let mut updated = update_xlsx_table_root_attrs(table_xml, table);
    updated = update_xlsx_table_auto_filter(&updated, table);
    updated = update_xlsx_table_columns(&updated, table);
    update_xlsx_table_style_info(&updated, table)
}

fn update_xlsx_table_root_attrs(table_xml: &str, table: &Value) -> String {
    let mut attrs = Vec::new();
    if let Some(name) = super::xlsx_validation_string(table, "name") {
        attrs.push(("name", name));
    }
    if let Some(display_name) = super::xlsx_validation_string(table, "displayName") {
        attrs.push(("displayName", display_name));
    }
    if let Some(reference) = super::xlsx_validation_string(table, "ref")
        .filter(|reference| super::valid_xlsx_range_reference(reference))
    {
        attrs.push(("ref", reference));
    }
    if let Some(totals_row_shown) = table.get("totalsRowShown").and_then(Value::as_bool) {
        attrs.push((
            "totalsRowShown",
            if totals_row_shown { "1" } else { "0" }.to_string(),
        ));
    }
    if attrs.is_empty() {
        return table_xml.to_string();
    }
    set_first_xml_tag_attrs(table_xml, "<table", &attrs)
}

fn update_xlsx_table_auto_filter(table_xml: &str, table: &Value) -> String {
    let reference = super::xlsx_validation_string(table, "autoFilterRef")
        .or_else(|| super::xlsx_validation_string(table, "ref"))
        .filter(|reference| super::valid_xlsx_range_reference(reference));
    let auto_filter_xml = reference
        .as_deref()
        .map(|reference| format!(r#"<autoFilter ref="{}"/>"#, escape_xml(reference)))
        .unwrap_or_default();
    if let Some(replaced) = replace_xml_element(table_xml, "autoFilter", &auto_filter_xml) {
        return replaced;
    }
    if table_xml.contains("<autoFilter") {
        return replace_empty_xml_element(table_xml, "<autoFilter", &auto_filter_xml);
    }
    if auto_filter_xml.is_empty() {
        return table_xml.to_string();
    }
    if let Some(index) = table_xml.find("<tableColumns") {
        let mut output = String::new();
        output.push_str(&table_xml[..index]);
        output.push_str(&auto_filter_xml);
        output.push_str(&table_xml[index..]);
        return output;
    }
    append_before_or_end(table_xml, "</table>", &auto_filter_xml)
}

fn update_xlsx_table_columns(table_xml: &str, table: &Value) -> String {
    let Some(columns) = table.get("columns").and_then(Value::as_array) else {
        return table_xml.to_string();
    };
    let columns_xml = build_xlsx_table_columns(columns);
    if let Some(replaced) = replace_xml_element(table_xml, "tableColumns", &columns_xml) {
        return replaced;
    }
    if table_xml.contains("<tableColumns") {
        return replace_empty_xml_element(table_xml, "<tableColumns", &columns_xml);
    }
    if let Some(index) = table_xml.find("<tableStyleInfo") {
        let mut output = String::new();
        output.push_str(&table_xml[..index]);
        output.push_str(&columns_xml);
        output.push_str(&table_xml[index..]);
        return output;
    }
    append_before_or_end(table_xml, "</table>", &columns_xml)
}

fn build_xlsx_table_columns(columns: &[Value]) -> String {
    let items = columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let id = super::xlsx_validation_string(column, "id")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or((index + 1) as u32);
            let name = super::xlsx_validation_string(column, "name")
                .unwrap_or_else(|| format!("Column{}", index + 1));
            let mut attrs = vec![
                format!(r#"id="{id}""#),
                format!(r#"name="{}""#, escape_xml(&name)),
            ];
            if let Some(function) = super::xlsx_validation_string(column, "totalsRowFunction")
                .filter(|value| valid_xlsx_table_totals_function(value))
            {
                attrs.push(format!(r#"totalsRowFunction="{}""#, escape_xml(&function)));
            }
            format!("<tableColumn {}/>", attrs.join(" "))
        })
        .collect::<String>();
    format!(
        r#"<tableColumns count="{}">{items}</tableColumns>"#,
        columns.len()
    )
}

fn valid_xlsx_table_totals_function(value: &str) -> bool {
    matches!(
        value,
        "sum"
            | "min"
            | "max"
            | "average"
            | "count"
            | "countNums"
            | "stdDev"
            | "var"
            | "custom"
            | "none"
    )
}

fn update_xlsx_table_style_info(table_xml: &str, table: &Value) -> String {
    let Some(style_xml) = build_xlsx_table_style_info(table) else {
        return table_xml.to_string();
    };
    if let Some(replaced) = replace_xml_element(table_xml, "tableStyleInfo", &style_xml) {
        return replaced;
    }
    if table_xml.contains("<tableStyleInfo") {
        return replace_empty_xml_element(table_xml, "<tableStyleInfo", &style_xml);
    }
    append_before_or_end(table_xml, "</table>", &style_xml)
}

fn build_xlsx_table_style_info(table: &Value) -> Option<String> {
    let mut attrs = Vec::new();
    if let Some(name) = super::xlsx_validation_string(table, "tableStyleName") {
        attrs.push(format!(r#"name="{}""#, escape_xml(&name)));
    }
    for (key, attr_name) in [
        ("showFirstColumn", "showFirstColumn"),
        ("showLastColumn", "showLastColumn"),
        ("showRowStripes", "showRowStripes"),
        ("showColumnStripes", "showColumnStripes"),
    ] {
        if let Some(value) = table.get(key).and_then(Value::as_bool) {
            attrs.push(format!(
                r#"{attr_name}="{}""#,
                if value { "1" } else { "0" }
            ));
        }
    }
    if attrs.is_empty() {
        None
    } else {
        Some(format!("<tableStyleInfo {}/>", attrs.join(" ")))
    }
}

fn valid_xlsx_table_path(path: &str) -> bool {
    path.starts_with("xl/tables/") && path.ends_with(".xml") && !path.contains("..")
}
