use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::error::AppResult;

use super::ooxml_package::read_zip_text;
use super::xlsx_relationships::xlsx_relationship_target_to_part;
use super::xml_utils::{
    append_before_or_end, attr_value, escape_xml, replace_xml_element, set_first_xml_tag_attrs,
    unescape_xml, xml_empty_elements, xml_named_segments,
};

#[derive(Debug, Clone)]
pub(super) struct XlsxWorkbookSheetRef {
    pub(super) path: String,
    pub(super) name: String,
    pub(super) sheet_id: u32,
    pub(super) rel_id: String,
    pub(super) state: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct XlsxWorkbookSheetWrite {
    pub(super) path: String,
    pub(super) name: String,
    pub(super) state: Option<String>,
}

pub(super) fn xlsx_workbook_sheets(bytes: &[u8]) -> AppResult<Vec<XlsxWorkbookSheetRef>> {
    let workbook = read_zip_text(bytes, "xl/workbook.xml")?;
    let rels = read_zip_text(bytes, "xl/_rels/workbook.xml.rels")?;
    Ok(xlsx_workbook_sheets_from_xml(&workbook, &rels))
}

pub(super) fn xlsx_workbook_sheets_from_xml(
    workbook: &str,
    rels: &str,
) -> Vec<XlsxWorkbookSheetRef> {
    let targets = xlsx_relationship_targets(rels);
    xml_empty_elements(workbook, "<sheet ")
        .into_iter()
        .filter_map(|sheet| {
            let rel_id = attr_value(&sheet, "r:id")?;
            let path = targets.get(&rel_id)?.clone();
            Some(XlsxWorkbookSheetRef {
                path,
                name: attr_value(&sheet, "name")
                    .map(|name| unescape_xml(&name))
                    .unwrap_or_else(|| "Sheet".to_string()),
                sheet_id: attr_value(&sheet, "sheetId")
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(1),
                rel_id,
                state: attr_value(&sheet, "state")
                    .filter(|value| matches!(value.as_str(), "hidden" | "veryHidden")),
            })
        })
        .collect()
}

fn xlsx_relationship_targets(rels: &str) -> BTreeMap<String, String> {
    xml_empty_elements(rels, "<Relationship ")
        .into_iter()
        .filter_map(|relationship| {
            let rel_id = attr_value(&relationship, "Id")?;
            let rel_type = attr_value(&relationship, "Type").unwrap_or_default();
            if !rel_type.ends_with("/worksheet") {
                return None;
            }
            let target = attr_value(&relationship, "Target")?;
            Some((rel_id, xlsx_relationship_target_to_part(&target)))
        })
        .collect()
}

pub(super) fn xlsx_sheet_writes(
    sheets: &[Value],
    original_refs: &[XlsxWorkbookSheetRef],
) -> Vec<XlsxWorkbookSheetWrite> {
    let mut used_paths = original_refs
        .iter()
        .map(|sheet| sheet.path.clone())
        .collect::<Vec<_>>();
    let mut writes = Vec::new();
    for (index, sheet) in sheets.iter().enumerate() {
        let requested = sheet
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let existing = original_refs
            .iter()
            .any(|sheet_ref| sheet_ref.path == requested);
        let path = if existing || valid_xlsx_sheet_path(&requested) {
            requested
        } else {
            next_xlsx_sheet_path(&used_paths)
        };
        if !used_paths.iter().any(|used| used == &path) {
            used_paths.push(path.clone());
        }
        let name = sheet
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Sheet {}", index + 1));
        let state = super::xlsx_validation_string(sheet, "state")
            .filter(|value| matches!(value.as_str(), "hidden" | "veryHidden"));
        writes.push(XlsxWorkbookSheetWrite { path, name, state });
    }
    writes
}

fn valid_xlsx_sheet_path(path: &str) -> bool {
    path.starts_with("xl/worksheets/") && path.ends_with(".xml") && !path.contains("..")
}

fn next_xlsx_sheet_path(used_paths: &[String]) -> String {
    let mut index = used_paths
        .iter()
        .filter_map(|path| {
            path.rsplit('/')
                .next()
                .and_then(|name| name.strip_prefix("sheet"))
                .and_then(|name| name.strip_suffix(".xml"))
                .and_then(|value| value.parse::<usize>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;
    loop {
        let path = format!("xl/worksheets/sheet{index}.xml");
        if !used_paths.iter().any(|used| used == &path) {
            return path;
        }
        index += 1;
    }
}

pub(super) fn update_xlsx_workbook_manifest(
    workbook: &str,
    rels: &str,
    sheets: &[XlsxWorkbookSheetWrite],
) -> (String, String) {
    let existing_refs = xlsx_workbook_sheets_from_xml(workbook, rels);
    let existing_by_path = existing_refs
        .iter()
        .map(|sheet| (sheet.path.clone(), sheet.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut rels_out = rels.to_string();
    let mut next_rel = super::next_rid(rels);
    let mut next_sheet_id = next_xlsx_sheet_id(workbook);
    let mut sheet_tags = Vec::new();
    for sheet in sheets {
        let (rel_id, sheet_id) = if let Some(existing) = existing_by_path.get(&sheet.path) {
            (existing.rel_id.clone(), existing.sheet_id)
        } else {
            let rel_id = format!("rId{next_rel}");
            next_rel += 1;
            let rel = format!(
                r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="{}"/>"#,
                xlsx_part_to_relationship_target(&sheet.path)
            );
            rels_out = append_before_or_end(&rels_out, "</Relationships>", &rel);
            let sheet_id = next_sheet_id;
            next_sheet_id += 1;
            (rel_id, sheet_id)
        };
        let state = sheet
            .state
            .as_deref()
            .map(|state| format!(r#" state="{state}""#))
            .unwrap_or_default();
        sheet_tags.push(format!(
            r#"<sheet name="{}" sheetId="{sheet_id}" r:id="{rel_id}"{state}/>"#,
            escape_xml(&sheet.name)
        ));
    }
    let sheets_xml = format!("<sheets>{}</sheets>", sheet_tags.join(""));
    let workbook_out = replace_xml_element(workbook, "sheets", &sheets_xml)
        .unwrap_or_else(|| append_before_or_end(workbook, "</workbook>", &sheets_xml));
    (workbook_out, rels_out)
}

pub(super) fn xlsx_model_has_formulas(sheets: &[Value]) -> bool {
    sheets.iter().any(|sheet| {
        sheet
            .get("rows")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|row| {
                row.get("cells")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .any(|cell| {
                        cell.get("formula")
                            .and_then(Value::as_str)
                            .map(|formula| !formula.trim().is_empty())
                            .unwrap_or(false)
                            || cell
                                .get("value")
                                .and_then(Value::as_str)
                                .map(|value| value.trim_start().starts_with('='))
                                .unwrap_or(false)
                    })
            })
    })
}

pub(super) fn update_xlsx_workbook_calc_properties(workbook: &str) -> String {
    let attrs = [
        ("calcMode", "auto".to_string()),
        ("fullCalcOnLoad", "1".to_string()),
        ("forceFullCalc", "1".to_string()),
    ];
    if workbook.contains("<calcPr") {
        return set_first_xml_tag_attrs(workbook, "<calcPr", &attrs);
    }
    append_before_or_end(
        workbook,
        "</workbook>",
        r#"<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>"#,
    )
}

pub(super) fn parse_xlsx_defined_names(workbook: &str) -> Vec<Value> {
    xml_named_segments(workbook, "definedName")
        .into_iter()
        .filter_map(|defined_name| {
            let name = attr_value(&defined_name, "name").map(|name| unescape_xml(&name))?;
            let mut item = json!({
                "name": name,
                "value": xlsx_defined_name_text(&defined_name),
                "sourceXml": defined_name
            });
            let source_xml = item["sourceXml"].as_str().unwrap_or_default().to_string();
            if let Some(local_sheet_id) =
                attr_value(&source_xml, "localSheetId").and_then(|value| value.parse::<u32>().ok())
            {
                item["localSheetId"] = json!(local_sheet_id);
            }
            if super::xml_bool_attr(&source_xml, "hidden") {
                item["hidden"] = json!(true);
            }
            if let Some(comment) = attr_value(&source_xml, "comment") {
                item["comment"] = json!(unescape_xml(&comment));
            }
            Some(item)
        })
        .collect()
}

fn xlsx_defined_name_text(defined_name: &str) -> String {
    let Some(open_end) = defined_name.find('>') else {
        return String::new();
    };
    let end_marker = "</definedName>";
    let Some(close_start) = defined_name.rfind(end_marker) else {
        return String::new();
    };
    unescape_xml(&defined_name[open_end + 1..close_start])
}

pub(super) fn update_xlsx_defined_names(
    workbook: &str,
    defined_names: Option<&Vec<Value>>,
) -> String {
    let Some(defined_names) = defined_names else {
        return workbook.to_string();
    };
    let items = defined_names
        .iter()
        .filter_map(build_xlsx_defined_name)
        .collect::<String>();
    let replacement = if items.is_empty() {
        String::new()
    } else {
        format!("<definedNames>{items}</definedNames>")
    };
    if let Some(replaced) = replace_xml_element(workbook, "definedNames", &replacement) {
        return replaced;
    }
    if replacement.is_empty() {
        return workbook.to_string();
    }
    if let Some(index) = workbook.find("<calcPr") {
        let mut output = String::new();
        output.push_str(&workbook[..index]);
        output.push_str(&replacement);
        output.push_str(&workbook[index..]);
        return output;
    }
    append_before_or_end(workbook, "</workbook>", &replacement)
}

fn build_xlsx_defined_name(value: &Value) -> Option<String> {
    let name = super::xlsx_validation_string(value, "name")?;
    let text = super::xlsx_validation_string(value, "value").unwrap_or_default();
    if let Some(source_xml) = value
        .get("sourceXml")
        .and_then(Value::as_str)
        .filter(|source| source.starts_with("<definedName"))
    {
        let mut updated = set_first_xml_tag_attrs(source_xml, "<definedName", &[("name", name)]);
        if let Some(local_sheet_id) = value
            .get("localSheetId")
            .and_then(Value::as_u64)
            .map(|number| number.min(u32::MAX as u64) as u32)
        {
            updated = set_first_xml_tag_attrs(
                &updated,
                "<definedName",
                &[("localSheetId", local_sheet_id.to_string())],
            );
        }
        if value
            .get("hidden")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            updated =
                set_first_xml_tag_attrs(&updated, "<definedName", &[("hidden", "1".to_string())]);
        }
        if let Some(comment) = super::xlsx_validation_string(value, "comment") {
            updated = set_first_xml_tag_attrs(&updated, "<definedName", &[("comment", comment)]);
        }
        return Some(replace_xlsx_defined_name_text(&updated, &text));
    }
    let mut attrs = vec![format!(r#"name="{}""#, escape_xml(&name))];
    if let Some(local_sheet_id) = value
        .get("localSheetId")
        .and_then(Value::as_u64)
        .map(|number| number.min(u32::MAX as u64) as u32)
    {
        attrs.push(format!(r#"localSheetId="{local_sheet_id}""#));
    }
    if value
        .get("hidden")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        attrs.push(r#"hidden="1""#.to_string());
    }
    if let Some(comment) = super::xlsx_validation_string(value, "comment") {
        attrs.push(format!(r#"comment="{}""#, escape_xml(&comment)));
    }
    Some(format!(
        "<definedName {}>{}</definedName>",
        attrs.join(" "),
        escape_xml(&text)
    ))
}

fn replace_xlsx_defined_name_text(source_xml: &str, text: &str) -> String {
    let Some(open_end) = source_xml.find('>') else {
        return source_xml.to_string();
    };
    let end_marker = "</definedName>";
    let Some(close_start) = source_xml.rfind(end_marker) else {
        return source_xml.to_string();
    };
    let mut output = String::new();
    output.push_str(&source_xml[..=open_end]);
    output.push_str(&escape_xml(text));
    output.push_str(&source_xml[close_start..]);
    output
}

fn xlsx_part_to_relationship_target(path: &str) -> String {
    path.strip_prefix("xl/").unwrap_or(path).to_string()
}

fn next_xlsx_sheet_id(workbook: &str) -> u32 {
    xml_empty_elements(workbook, "<sheet ")
        .iter()
        .filter_map(|sheet| attr_value(sheet, "sheetId"))
        .filter_map(|value| value.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        + 1
}

pub(super) fn append_xlsx_sheet_content_types(
    content_types: &str,
    sheets: &[XlsxWorkbookSheetWrite],
) -> String {
    let mut output = content_types.to_string();
    for sheet in sheets {
        let part_name = format!("/{}", sheet.path);
        if output.contains(&part_name) {
            continue;
        }
        let override_xml = format!(
            r#"<Override PartName="{part_name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#
        );
        output = append_before_or_end(&output, "</Types>", &override_xml);
    }
    output
}
