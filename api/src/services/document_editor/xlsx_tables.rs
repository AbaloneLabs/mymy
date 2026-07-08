use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::ooxml_content_types::ensure_content_type_override;
use super::ooxml_package::read_zip_text;
use super::xlsx_model::{ensure_xlsx_relationship_namespace_for_r_id, split_cell_reference};
use super::xlsx_relationships::{xlsx_empty_relationships, xlsx_part_to_relationship_target_from};
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

pub(super) struct XlsxTableReplacementContext<'a> {
    pub(super) original: &'a [u8],
    pub(super) sheet_path: &'a str,
    pub(super) worksheet_xml: &'a mut String,
    pub(super) rels_replacement: &'a mut Option<String>,
    pub(super) existing_names: &'a [String],
    pub(super) table_content_types: &'a mut Vec<String>,
    pub(super) replacements: &'a mut Vec<(String, Vec<u8>)>,
}

pub(super) fn add_xlsx_table_replacements(
    sheet: &Value,
    context: &mut XlsxTableReplacementContext<'_>,
) {
    let Some(tables) = sheet.get("tables").and_then(Value::as_array) else {
        return;
    };
    let mut used_paths = context
        .existing_names
        .iter()
        .filter(|path| path.starts_with("xl/tables/") && path.ends_with(".xml"))
        .cloned()
        .chain(
            context
                .replacements
                .iter()
                .map(|(path, _)| path.clone())
                .filter(|path| path.starts_with("xl/tables/") && path.ends_with(".xml")),
        )
        .collect::<Vec<_>>();
    for table in tables {
        let table_path = table
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_xlsx_table_path(path))
            .map(str::to_string);
        if let Some(table_path) = table_path {
            if let Ok(table_xml) = read_zip_text(context.original, &table_path) {
                let updated = update_xlsx_table_xml(&table_xml, table);
                context
                    .replacements
                    .push((table_path, updated.into_bytes()));
                continue;
            }
        }
        let Some(reference) = super::xlsx_validation_string(table, "ref")
            .filter(|reference| super::valid_xlsx_range_reference(reference))
        else {
            continue;
        };
        let table_path = next_xlsx_table_path(&used_paths);
        used_paths.push(table_path.clone());
        let relationship_id =
            add_xlsx_table_relationship(context.sheet_path, &table_path, context.rels_replacement);
        *context.worksheet_xml = ensure_xlsx_relationship_namespace_for_r_id(
            &update_xlsx_worksheet_table_parts(context.worksheet_xml, &[relationship_id]),
        );
        let table_xml = build_new_xlsx_table_xml(&table_path, table, &reference);
        context.table_content_types.push(table_path.clone());
        context
            .replacements
            .push((table_path, table_xml.into_bytes()));
    }
}

pub(super) fn ensure_xlsx_table_content_types(
    content_types: &str,
    table_paths: &[String],
) -> String {
    table_paths
        .iter()
        .fold(content_types.to_string(), |current, path| {
            ensure_content_type_override(
                &current,
                &format!("/{path}"),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml",
            )
        })
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

fn add_xlsx_table_relationship(
    sheet_path: &str,
    table_path: &str,
    rels_replacement: &mut Option<String>,
) -> String {
    let rels = rels_replacement
        .clone()
        .unwrap_or_else(xlsx_empty_relationships);
    let relationship_id = format!("rId{}", super::next_rid(&rels));
    let target = xlsx_part_to_relationship_target_from(sheet_path, table_path);
    let relationship = format!(
        r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="{}"/>"#,
        escape_xml(&target)
    );
    *rels_replacement = Some(append_before_or_end(
        &rels,
        "</Relationships>",
        &relationship,
    ));
    relationship_id
}

fn update_xlsx_worksheet_table_parts(sheet_xml: &str, relationship_ids: &[String]) -> String {
    let mut ids = xml_named_empty_elements(sheet_xml, "tablePart")
        .into_iter()
        .filter_map(|part| attr_value(&part, "r:id"))
        .collect::<Vec<_>>();
    for relationship_id in relationship_ids {
        if !ids.iter().any(|id| id == relationship_id) {
            ids.push(relationship_id.clone());
        }
    }
    if ids.is_empty() {
        return sheet_xml.to_string();
    }
    let parts = ids
        .iter()
        .map(|id| format!(r#"<tablePart r:id="{}"/>"#, escape_xml(id)))
        .collect::<String>();
    let table_parts = format!(r#"<tableParts count="{}">{parts}</tableParts>"#, ids.len());
    if let Some(replaced) = replace_xml_element(sheet_xml, "tableParts", &table_parts) {
        return replaced;
    }
    if sheet_xml.contains("<tableParts") {
        return replace_empty_xml_element(sheet_xml, "<tableParts", &table_parts);
    }
    append_before_or_end(sheet_xml, "</worksheet>", &table_parts)
}

fn build_new_xlsx_table_xml(path: &str, table: &Value, reference: &str) -> String {
    let table_id = xlsx_table_id_from_path(path);
    let name = super::xlsx_validation_string(table, "name")
        .or_else(|| super::xlsx_validation_string(table, "displayName"))
        .unwrap_or_else(|| format!("Table{table_id}"));
    let display_name =
        super::xlsx_validation_string(table, "displayName").unwrap_or_else(|| name.clone());
    let columns = table
        .get("columns")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| default_xlsx_table_columns(reference));
    let base = format!(
        r#"<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="{table_id}" name="{}" displayName="{}" ref="{}"></table>"#,
        escape_xml(&name),
        escape_xml(&display_name),
        escape_xml(reference)
    );
    let mut model = table.clone();
    model["ref"] = json!(reference);
    model["autoFilterRef"] = json!(super::xlsx_validation_string(table, "autoFilterRef")
        .unwrap_or_else(|| reference.to_string()));
    model["columns"] = json!(columns);
    update_xlsx_table_xml(&base, &model)
}

fn xlsx_table_id_from_path(path: &str) -> u32 {
    path.trim_start_matches("xl/tables/table")
        .trim_end_matches(".xml")
        .parse::<u32>()
        .unwrap_or(1)
}

fn default_xlsx_table_columns(reference: &str) -> Vec<Value> {
    let Some((start, end)) = reference.split_once(':') else {
        return Vec::new();
    };
    let Some((start_column, _)) = split_cell_reference(start) else {
        return Vec::new();
    };
    let Some((end_column, _)) = split_cell_reference(end) else {
        return Vec::new();
    };
    let count = end_column.abs_diff(start_column) + 1;
    (0..count)
        .map(|index| {
            json!({
                "id": (index + 1).to_string(),
                "name": format!("Column{}", index + 1)
            })
        })
        .collect()
}

fn next_xlsx_table_path(used_paths: &[String]) -> String {
    let mut index = 1;
    loop {
        let candidate = format!("xl/tables/table{index}.xml");
        if !used_paths.iter().any(|path| path == &candidate) {
            return candidate;
        }
        index += 1;
    }
}
