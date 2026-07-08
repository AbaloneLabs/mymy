use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::super::{
    append_before_or_end, attr_value, escape_xml, find_xml_start, read_zip_text,
    remove_xml_named_elements, set_first_xml_tag_attrs, xml_named_empty_elements,
    xml_named_segments,
};
use super::valid_xlsx_pivot_path;

const XLSX_PIVOT_SUBTOTAL_ATTRS: &[(&str, &str)] = &[
    ("sum", "sumSubtotal"),
    ("count", "countSubtotal"),
    ("countA", "countASubtotal"),
    ("average", "avgSubtotal"),
    ("max", "maxSubtotal"),
    ("min", "minSubtotal"),
    ("product", "productSubtotal"),
    ("stdDev", "stdDevSubtotal"),
    ("stdDevP", "stdDevPSubtotal"),
    ("var", "varSubtotal"),
    ("varP", "varPSubtotal"),
];

pub(in crate::services::document_editor) fn add_xlsx_pivot_replacements(
    original: &[u8],
    sheet: &Value,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(pivots) = sheet.get("pivots").and_then(Value::as_array) else {
        return;
    };
    for pivot in pivots {
        let Some(pivot_path) = pivot
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_xlsx_pivot_path(path))
        else {
            continue;
        };
        let Ok(pivot_xml) = read_zip_text(original, pivot_path) else {
            continue;
        };
        let mut updated = pivot_xml.clone();
        if let Some(name) = pivot.get("name").and_then(Value::as_str) {
            updated = set_first_xml_tag_attrs(
                &updated,
                "<pivotTableDefinition",
                &[("name", name.to_string())],
            );
        }
        updated = update_xlsx_pivot_fields(&updated, pivot);
        updated = update_xlsx_pivot_axis_containers(&updated, pivot);
        updated = update_xlsx_pivot_data_fields(&updated, pivot);
        if updated != pivot_xml {
            replacements.push((pivot_path.to_string(), updated.into_bytes()));
        }
    }
}

pub(super) fn parse_xlsx_sheet_pivots(
    bytes: &[u8],
    sheet_xml: &str,
    relationships: &BTreeMap<String, (String, String)>,
) -> Vec<Value> {
    xml_named_empty_elements(sheet_xml, "pivotTableDefinition")
        .into_iter()
        .filter_map(|pivot| {
            let relationship_id = attr_value(&pivot, "r:id")?;
            let (_, pivot_path) = relationships.get(&relationship_id)?;
            let pivot_xml = read_zip_text(bytes, pivot_path).unwrap_or_default();
            Some(json!({
                "id": relationship_id,
                "path": pivot_path,
                "name": attr_value(&pivot_xml, "name"),
                "cacheId": attr_value(&pivot_xml, "cacheId"),
                "fields": parse_xlsx_pivot_fields(&pivot_xml),
                "dataFields": parse_xlsx_pivot_data_fields(&pivot_xml)
            }))
        })
        .collect()
}

fn parse_xlsx_pivot_fields(pivot_xml: &str) -> Vec<Value> {
    let axis_by_index = xlsx_pivot_field_axis_by_index(pivot_xml);
    let data_field_indices = parse_xlsx_pivot_data_fields(pivot_xml)
        .into_iter()
        .filter_map(|field| {
            field
                .get("fieldIndex")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
        })
        .collect::<Vec<_>>();
    xlsx_named_element_segments(pivot_xml, "pivotField")
        .into_iter()
        .enumerate()
        .map(|(index, field)| {
            let data_field = xlsx_bool_attr(&field, "dataField").unwrap_or(false)
                || data_field_indices.contains(&index);
            json!({
                "index": index,
                "name": attr_value(&field, "name"),
                "axis": attr_value(&field, "axis").or_else(|| axis_by_index.get(&index).cloned()),
                "dataField": data_field,
                "showAll": xlsx_bool_attr(&field, "showAll"),
                "defaultSubtotal": xlsx_bool_attr(&field, "defaultSubtotal"),
                "subtotal": xlsx_pivot_field_subtotal(&field)
            })
        })
        .collect()
}

fn parse_xlsx_pivot_data_fields(pivot_xml: &str) -> Vec<Value> {
    let Some(data_fields) = xml_named_segments(pivot_xml, "dataFields")
        .into_iter()
        .next()
    else {
        return Vec::new();
    };
    xml_named_empty_elements(&data_fields, "dataField")
        .into_iter()
        .enumerate()
        .map(|(index, field)| {
            let field_index = attr_value(&field, "fld")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(index);
            json!({
                "fieldIndex": field_index,
                "name": attr_value(&field, "name"),
                "subtotal": attr_value(&field, "subtotal")
            })
        })
        .collect()
}

fn xlsx_pivot_field_axis_by_index(pivot_xml: &str) -> BTreeMap<usize, String> {
    let mut axes = BTreeMap::new();
    for (container, axis) in [
        ("rowFields", "axisRow"),
        ("colFields", "axisCol"),
        ("pageFields", "axisPage"),
    ] {
        let Some(segment) = xml_named_segments(pivot_xml, container).into_iter().next() else {
            continue;
        };
        for field in xml_named_empty_elements(&segment, "field") {
            if let Some(index) =
                attr_value(&field, "x").and_then(|value| value.parse::<usize>().ok())
            {
                axes.insert(index, axis.to_string());
            }
        }
    }
    if let Some(data_fields) = xml_named_segments(pivot_xml, "dataFields")
        .into_iter()
        .next()
    {
        for field in xml_named_empty_elements(&data_fields, "dataField") {
            if let Some(index) =
                attr_value(&field, "fld").and_then(|value| value.parse::<usize>().ok())
            {
                axes.entry(index)
                    .or_insert_with(|| "axisValues".to_string());
            }
        }
    }
    axes
}

fn xlsx_pivot_field_subtotal(field_xml: &str) -> Option<String> {
    XLSX_PIVOT_SUBTOTAL_ATTRS.iter().find_map(|(value, attr)| {
        xlsx_bool_attr(field_xml, attr)
            .filter(|enabled| *enabled)
            .map(|_| (*value).to_string())
    })
}

fn xlsx_bool_attr(xml: &str, attr: &str) -> Option<bool> {
    attr_value(xml, attr).and_then(|value| match value.as_str() {
        "1" | "true" | "TRUE" => Some(true),
        "0" | "false" | "FALSE" => Some(false),
        _ => None,
    })
}

fn update_xlsx_pivot_fields(xml: &str, pivot: &Value) -> String {
    let Some(fields) = pivot.get("fields").and_then(Value::as_array) else {
        return xml.to_string();
    };
    let ranges = xlsx_named_element_ranges(xml, "pivotField");
    let mut updated = xml.to_string();
    for (array_index, field) in fields.iter().enumerate().rev() {
        let field_index = field
            .get("index")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(array_index);
        let Some((start, end)) = ranges.get(field_index).copied() else {
            continue;
        };
        let segment = &updated[start..end];
        let mut next_segment = segment.to_string();
        if let Some(name) = field.get("name").and_then(Value::as_str) {
            next_segment = set_xml_start_attr(&next_segment, "pivotField", "name", Some(name));
        }
        let axis = field
            .get("axis")
            .and_then(Value::as_str)
            .filter(|axis| xlsx_valid_pivot_axis(axis));
        next_segment = set_xml_start_attr(&next_segment, "pivotField", "axis", axis);
        if let Some(data_field) = field.get("dataField").and_then(Value::as_bool) {
            next_segment = set_xml_start_attr(
                &next_segment,
                "pivotField",
                "dataField",
                Some(xlsx_bool_value(data_field)),
            );
        }
        if let Some(show_all) = field.get("showAll").and_then(Value::as_bool) {
            next_segment = set_xml_start_attr(
                &next_segment,
                "pivotField",
                "showAll",
                Some(xlsx_bool_value(show_all)),
            );
        }
        if let Some(default_subtotal) = field.get("defaultSubtotal").and_then(Value::as_bool) {
            next_segment = set_xml_start_attr(
                &next_segment,
                "pivotField",
                "defaultSubtotal",
                Some(xlsx_bool_value(default_subtotal)),
            );
        }
        if field.get("subtotal").is_some() {
            let subtotal = field
                .get("subtotal")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty());
            next_segment = update_xlsx_pivot_subtotal_attrs(&next_segment, subtotal);
        }
        updated.replace_range(start..end, &next_segment);
    }
    updated
}

fn update_xlsx_pivot_axis_containers(xml: &str, pivot: &Value) -> String {
    let Some(fields) = pivot.get("fields").and_then(Value::as_array) else {
        return xml.to_string();
    };
    let mut row_fields = Vec::new();
    let mut col_fields = Vec::new();
    let mut page_fields = Vec::new();
    for (array_index, field) in fields.iter().enumerate() {
        let field_index = field
            .get("index")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(array_index);
        match field.get("axis").and_then(Value::as_str) {
            Some("axisRow") => row_fields.push(field_index),
            Some("axisCol") => col_fields.push(field_index),
            Some("axisPage") => page_fields.push(field_index),
            _ => {}
        }
    }
    let updated = replace_xlsx_pivot_field_container(
        xml,
        "rowFields",
        xlsx_pivot_field_container_xml("rowFields", &row_fields),
    );
    let updated = replace_xlsx_pivot_field_container(
        &updated,
        "colFields",
        xlsx_pivot_field_container_xml("colFields", &col_fields),
    );
    replace_xlsx_pivot_field_container(
        &updated,
        "pageFields",
        xlsx_pivot_field_container_xml("pageFields", &page_fields),
    )
}

fn update_xlsx_pivot_data_fields(xml: &str, pivot: &Value) -> String {
    let specs = xlsx_pivot_data_field_specs(pivot);
    if specs.is_none() {
        return xml.to_string();
    }
    let replacement = specs.and_then(|specs| {
        if specs.is_empty() {
            None
        } else {
            Some(xlsx_pivot_data_fields_xml(&specs))
        }
    });
    replace_xlsx_pivot_field_container(xml, "dataFields", replacement)
}

#[derive(Debug, Clone)]
struct XlsxPivotDataFieldSpec {
    field_index: usize,
    name: Option<String>,
    subtotal: Option<String>,
}

fn xlsx_pivot_data_field_specs(pivot: &Value) -> Option<Vec<XlsxPivotDataFieldSpec>> {
    let has_data_fields = pivot.get("dataFields").and_then(Value::as_array).is_some();
    let has_fields = pivot.get("fields").and_then(Value::as_array).is_some();
    if !has_data_fields && !has_fields {
        return None;
    }
    let mut specs = pivot
        .get("dataFields")
        .and_then(Value::as_array)
        .map(|data_fields| {
            data_fields
                .iter()
                .filter_map(|field| {
                    Some(XlsxPivotDataFieldSpec {
                        field_index: field.get("fieldIndex").and_then(Value::as_u64)? as usize,
                        name: field
                            .get("name")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        subtotal: field
                            .get("subtotal")
                            .and_then(Value::as_str)
                            .filter(|value| xlsx_valid_pivot_subtotal(value))
                            .map(str::to_string),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(fields) = pivot.get("fields").and_then(Value::as_array) {
        for (array_index, field) in fields.iter().enumerate() {
            if field.get("axis").and_then(Value::as_str) != Some("axisValues") {
                continue;
            }
            let field_index = field
                .get("index")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(array_index);
            if specs.iter().any(|spec| spec.field_index == field_index) {
                continue;
            }
            specs.push(XlsxPivotDataFieldSpec {
                field_index,
                name: field
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                subtotal: field
                    .get("subtotal")
                    .and_then(Value::as_str)
                    .filter(|value| xlsx_valid_pivot_subtotal(value))
                    .map(str::to_string),
            });
        }
    }
    Some(specs)
}

fn xlsx_pivot_field_container_xml(tag: &str, field_indexes: &[usize]) -> Option<String> {
    if field_indexes.is_empty() {
        return None;
    }
    let fields = field_indexes
        .iter()
        .map(|index| format!(r#"<field x="{index}"/>"#))
        .collect::<String>();
    Some(format!(
        r#"<{tag} count="{}">{fields}</{tag}>"#,
        field_indexes.len()
    ))
}

fn xlsx_pivot_data_fields_xml(specs: &[XlsxPivotDataFieldSpec]) -> String {
    let fields = specs
        .iter()
        .map(|spec| {
            let mut attrs = format!(r#" fld="{}""#, spec.field_index);
            if let Some(name) = &spec.name {
                attrs.push_str(&format!(r#" name="{}""#, escape_xml(name)));
            }
            if let Some(subtotal) = spec
                .subtotal
                .as_deref()
                .filter(|value| xlsx_valid_pivot_subtotal(value))
            {
                attrs.push_str(&format!(r#" subtotal="{subtotal}""#));
            }
            format!("<dataField{attrs}/>")
        })
        .collect::<String>();
    format!(
        r#"<dataFields count="{}">{fields}</dataFields>"#,
        specs.len()
    )
}

fn replace_xlsx_pivot_field_container(xml: &str, tag: &str, replacement: Option<String>) -> String {
    let without_existing = remove_xml_named_elements(xml, tag);
    match replacement {
        Some(replacement) => {
            append_before_or_end(&without_existing, "</pivotTableDefinition>", &replacement)
        }
        None => without_existing,
    }
}

fn update_xlsx_pivot_subtotal_attrs(segment: &str, subtotal: Option<&str>) -> String {
    XLSX_PIVOT_SUBTOTAL_ATTRS
        .iter()
        .fold(segment.to_string(), |updated, (value, attr)| {
            set_xml_start_attr(
                &updated,
                "pivotField",
                attr,
                Some(xlsx_bool_value(subtotal == Some(*value))),
            )
        })
}

fn xlsx_named_element_segments(xml: &str, tag: &str) -> Vec<String> {
    xlsx_named_element_ranges(xml, tag)
        .into_iter()
        .map(|(start, end)| xml[start..end].to_string())
        .collect()
}

fn xlsx_named_element_ranges(xml: &str, tag: &str) -> Vec<(usize, usize)> {
    let marker = format!("<{tag}");
    let close_marker = format!("</{tag}>");
    let mut ranges = Vec::new();
    let mut offset = 0usize;
    let mut rest = xml;
    while let Some(relative_start) = find_xml_start(rest, &marker) {
        let start = offset + relative_start;
        let after_start = &xml[start..];
        let Some(open_end) = after_start.find('>') else {
            break;
        };
        if after_start[..=open_end].ends_with("/>") {
            let end = start + open_end + 1;
            ranges.push((start, end));
            offset = end;
            rest = &xml[end..];
            continue;
        }
        let Some(close_start) = after_start.find(&close_marker) else {
            break;
        };
        let end = start + close_start + close_marker.len();
        ranges.push((start, end));
        offset = end;
        rest = &xml[end..];
    }
    ranges
}

fn set_xml_start_attr(xml: &str, tag: &str, attr: &str, value: Option<&str>) -> String {
    let Some(value) = value else {
        return remove_xml_start_attr(xml, tag, attr);
    };
    set_first_xml_tag_attrs(xml, &format!("<{tag}"), &[(attr, value.to_string())])
}

fn remove_xml_start_attr(xml: &str, tag: &str, attr: &str) -> String {
    let Some(start) = find_xml_start(xml, &format!("<{tag}")) else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(tag_end_offset) = after_start.find('>') else {
        return xml.to_string();
    };
    let tag_end = start + tag_end_offset;
    let start_tag = &xml[start..tag_end];
    for quote in ['"', '\''] {
        let marker = format!("{attr}={quote}");
        let Some(attr_start_relative) = start_tag.find(&marker) else {
            continue;
        };
        let attr_start = start + attr_start_relative;
        let value_start = attr_start + marker.len();
        let Some(value_end_offset) = xml[value_start..tag_end].find(quote) else {
            return xml.to_string();
        };
        let value_end = value_start + value_end_offset + quote.len_utf8();
        let remove_start = xml[..attr_start]
            .char_indices()
            .rev()
            .find_map(|(index, ch)| {
                if ch.is_whitespace() {
                    None
                } else {
                    Some(index + ch.len_utf8())
                }
            })
            .unwrap_or(attr_start);
        let mut output = String::new();
        output.push_str(&xml[..remove_start]);
        output.push_str(&xml[value_end..]);
        return output;
    }
    xml.to_string()
}

fn xlsx_valid_pivot_axis(value: &str) -> bool {
    matches!(value, "axisRow" | "axisCol" | "axisPage" | "axisValues")
}

fn xlsx_valid_pivot_subtotal(value: &str) -> bool {
    XLSX_PIVOT_SUBTOTAL_ATTRS
        .iter()
        .any(|(candidate, _)| *candidate == value)
}

fn xlsx_bool_value(value: bool) -> &'static str {
    if value {
        "1"
    } else {
        "0"
    }
}
