use std::collections::BTreeMap;

use base64::Engine as _;
use serde_json::{json, Value};

use super::ooxml_charts::{
    ooxml_chart_axis_label_bold, ooxml_chart_axis_label_font_size, ooxml_chart_axis_label_italic,
    ooxml_chart_axis_label_rotation, ooxml_chart_axis_label_text_color,
    ooxml_chart_axis_line_color, ooxml_chart_axis_line_dash, ooxml_chart_axis_line_width,
    ooxml_chart_axis_major_gridlines_visible, ooxml_chart_axis_major_tick_mark,
    ooxml_chart_axis_minor_tick_mark, ooxml_chart_axis_number_format, ooxml_chart_axis_position,
    ooxml_chart_axis_tick_label_position, ooxml_chart_axis_title, ooxml_chart_legend_position,
    ooxml_chart_legend_visible, ooxml_chart_series, ooxml_chart_series_specs, ooxml_chart_title,
    ooxml_chart_type, update_ooxml_chart_axis_label_rotation, update_ooxml_chart_axis_label_style,
    update_ooxml_chart_axis_line_color, update_ooxml_chart_axis_line_dash,
    update_ooxml_chart_axis_line_width, update_ooxml_chart_axis_major_gridlines,
    update_ooxml_chart_axis_major_tick_mark, update_ooxml_chart_axis_minor_tick_mark,
    update_ooxml_chart_axis_number_format, update_ooxml_chart_axis_position,
    update_ooxml_chart_axis_tick_label_position, update_ooxml_chart_axis_title,
    update_ooxml_chart_legend, update_ooxml_chart_series, update_ooxml_chart_title,
    update_ooxml_chart_type,
};
use super::ooxml_images::image_mime_type_from_path;
use super::xlsx_relationships::{xlsx_part_rels_path, xlsx_relationships_by_id};
use super::xlsx_tables::parse_xlsx_sheet_tables;
use super::{
    append_before_or_end, attr_value, docx_tag_attr, escape_xml, find_xml_start, first_tag_text,
    read_zip_bytes, read_zip_text, remove_xml_named_elements, set_first_xml_tag_attrs,
    xml_named_empty_elements, xml_named_segments, xml_segments,
};

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

#[derive(Debug, Clone, Default)]
pub(super) struct XlsxSheetObjects {
    pub(super) tables: Vec<Value>,
    pub(super) charts: Vec<Value>,
    pub(super) images: Vec<Value>,
    pub(super) pivots: Vec<Value>,
}

pub(super) fn parse_xlsx_sheet_objects(
    bytes: &[u8],
    sheet_path: &str,
    sheet_xml: &str,
    sheet_rels: Option<&str>,
) -> XlsxSheetObjects {
    let Some(sheet_rels) = sheet_rels else {
        return XlsxSheetObjects::default();
    };
    let relationships = xlsx_relationships_by_id(sheet_path, sheet_rels);
    let mut objects = XlsxSheetObjects {
        tables: parse_xlsx_sheet_tables(bytes, sheet_xml, &relationships),
        pivots: parse_xlsx_sheet_pivots(bytes, sheet_xml, &relationships),
        ..XlsxSheetObjects::default()
    };
    for drawing in xml_named_empty_elements(sheet_xml, "drawing") {
        let Some(relationship_id) = attr_value(&drawing, "r:id") else {
            continue;
        };
        let Some((_, drawing_path)) = relationships.get(&relationship_id) else {
            continue;
        };
        let Ok(drawing_xml) = read_zip_text(bytes, drawing_path) else {
            continue;
        };
        let drawing_rels_path = xlsx_part_rels_path(drawing_path);
        let drawing_rels = read_zip_text(bytes, &drawing_rels_path).unwrap_or_default();
        let drawing_relationships = xlsx_relationships_by_id(drawing_path, &drawing_rels);
        let drawing_objects =
            parse_xlsx_drawing_objects(bytes, drawing_path, &drawing_xml, &drawing_relationships);
        objects.charts.extend(drawing_objects.charts);
        objects.images.extend(drawing_objects.images);
    }
    objects
}

pub(super) fn add_xlsx_chart_replacements(
    original: &[u8],
    sheet: &Value,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(charts) = sheet.get("charts").and_then(Value::as_array) else {
        return;
    };
    for chart in charts {
        let Some(chart_path) = chart
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_xlsx_chart_path(path))
        else {
            continue;
        };
        let Ok(chart_xml) = read_zip_text(original, chart_path) else {
            continue;
        };
        let mut updated = chart_xml;
        if let Some(title) = chart.get("title").and_then(Value::as_str) {
            updated = update_ooxml_chart_title(&updated, title);
        }
        if let Some(chart_type) = chart.get("type").and_then(Value::as_str) {
            updated = update_ooxml_chart_type(&updated, chart_type);
        }
        if chart.get("legendVisible").is_some() || chart.get("legendPosition").is_some() {
            updated = update_ooxml_chart_legend(
                &updated,
                chart
                    .get("legendVisible")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                chart.get("legendPosition").and_then(Value::as_str),
            );
        }
        updated = update_xlsx_chart_axis(&updated, chart, "category", "c:catAx");
        updated = update_xlsx_chart_axis(&updated, chart, "value", "c:valAx");
        updated = update_ooxml_chart_series(&updated, &ooxml_chart_series_specs(chart));
        replacements.push((chart_path.to_string(), updated.into_bytes()));
    }
}

pub(super) fn add_xlsx_pivot_replacements(
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

fn parse_xlsx_sheet_pivots(
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

fn parse_xlsx_drawing_objects(
    bytes: &[u8],
    drawing_path: &str,
    drawing_xml: &str,
    relationships: &BTreeMap<String, (String, String)>,
) -> XlsxSheetObjects {
    let mut objects = XlsxSheetObjects::default();
    let anchors = xml_segments(drawing_xml, "<xdr:twoCellAnchor", "</xdr:twoCellAnchor>")
        .into_iter()
        .chain(xml_segments(
            drawing_xml,
            "<xdr:oneCellAnchor",
            "</xdr:oneCellAnchor>",
        ));
    for anchor in anchors {
        let anchor_json = parse_xlsx_drawing_anchor(&anchor);
        if let Some(chart) = parse_xlsx_chart_object(bytes, &anchor, relationships, &anchor_json) {
            objects.charts.push(chart);
        }
        if let Some(image) =
            parse_xlsx_image_object(bytes, drawing_path, &anchor, relationships, &anchor_json)
        {
            objects.images.push(image);
        }
    }
    objects
}

fn parse_xlsx_chart_object(
    bytes: &[u8],
    anchor: &str,
    relationships: &BTreeMap<String, (String, String)>,
    anchor_json: &Value,
) -> Option<Value> {
    let chart = xml_named_empty_elements(anchor, "c:chart")
        .into_iter()
        .next()?;
    let relationship_id = attr_value(&chart, "r:id")?;
    let (_, chart_path) = relationships.get(&relationship_id)?;
    let chart_xml = read_zip_text(bytes, chart_path).unwrap_or_default();
    let mut value = json!({
        "id": relationship_id,
        "path": chart_path,
        "type": ooxml_chart_type(&chart_xml),
        "title": ooxml_chart_title(&chart_xml),
        "legendVisible": ooxml_chart_legend_visible(&chart_xml),
        "legendPosition": ooxml_chart_legend_position(&chart_xml),
        "categories": ooxml_chart_series(&chart_xml)
            .first()
            .and_then(|item| item.get("categories"))
            .cloned()
            .unwrap_or_else(|| json!([])),
        "series": ooxml_chart_series(&chart_xml),
        "anchor": anchor_json
    });
    extend_xlsx_chart_axis_model(&mut value, &chart_xml, "category", "c:catAx");
    extend_xlsx_chart_axis_model(&mut value, &chart_xml, "value", "c:valAx");
    Some(value)
}

fn extend_xlsx_chart_axis_model(value: &mut Value, chart_xml: &str, prefix: &str, axis_tag: &str) {
    value[&format!("{prefix}AxisTitle")] = json!(ooxml_chart_axis_title(chart_xml, axis_tag));
    value[&format!("{prefix}AxisPosition")] = json!(ooxml_chart_axis_position(chart_xml, axis_tag));
    value[&format!("{prefix}MajorGridlines")] = json!(ooxml_chart_axis_major_gridlines_visible(
        chart_xml, axis_tag
    ));
    value[&format!("{prefix}AxisTickLabelPosition")] =
        json!(ooxml_chart_axis_tick_label_position(chart_xml, axis_tag));
    value[&format!("{prefix}AxisMajorTickMark")] =
        json!(ooxml_chart_axis_major_tick_mark(chart_xml, axis_tag));
    value[&format!("{prefix}AxisMinorTickMark")] =
        json!(ooxml_chart_axis_minor_tick_mark(chart_xml, axis_tag));
    value[&format!("{prefix}AxisNumberFormat")] =
        json!(ooxml_chart_axis_number_format(chart_xml, axis_tag));
    value[&format!("{prefix}AxisLineColor")] =
        json!(ooxml_chart_axis_line_color(chart_xml, axis_tag));
    value[&format!("{prefix}AxisLineWidth")] =
        json!(ooxml_chart_axis_line_width(chart_xml, axis_tag));
    value[&format!("{prefix}AxisLineDash")] =
        json!(ooxml_chart_axis_line_dash(chart_xml, axis_tag));
    value[&format!("{prefix}AxisLabelTextColor")] =
        json!(ooxml_chart_axis_label_text_color(chart_xml, axis_tag));
    value[&format!("{prefix}AxisLabelFontSize")] =
        json!(ooxml_chart_axis_label_font_size(chart_xml, axis_tag));
    value[&format!("{prefix}AxisLabelRotation")] =
        json!(ooxml_chart_axis_label_rotation(chart_xml, axis_tag));
    value[&format!("{prefix}AxisLabelBold")] =
        json!(ooxml_chart_axis_label_bold(chart_xml, axis_tag));
    value[&format!("{prefix}AxisLabelItalic")] =
        json!(ooxml_chart_axis_label_italic(chart_xml, axis_tag));
}

fn update_xlsx_chart_axis(xml: &str, chart: &Value, prefix: &str, axis_tag: &str) -> String {
    let mut updated = xml.to_string();
    if let Some(title) = chart
        .get(format!("{prefix}AxisTitle"))
        .and_then(Value::as_str)
    {
        updated = update_ooxml_chart_axis_title(&updated, axis_tag, Some(title));
    }
    if let Some(position) = chart
        .get(format!("{prefix}AxisPosition"))
        .and_then(Value::as_str)
        .filter(|value| match prefix {
            "category" => matches!(*value, "b" | "t"),
            "value" => matches!(*value, "l" | "r"),
            _ => false,
        })
    {
        updated = update_ooxml_chart_axis_position(&updated, axis_tag, position);
    }
    if let Some(visible) = chart
        .get(format!("{prefix}MajorGridlines"))
        .and_then(Value::as_bool)
    {
        updated = update_ooxml_chart_axis_major_gridlines(&updated, axis_tag, visible);
    }
    if let Some(position) = chart
        .get(format!("{prefix}AxisTickLabelPosition"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "nextTo" | "low" | "high" | "none"))
    {
        updated = update_ooxml_chart_axis_tick_label_position(&updated, axis_tag, position);
    }
    if let Some(mark) = chart
        .get(format!("{prefix}AxisMajorTickMark"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "cross" | "in" | "out" | "none"))
    {
        updated = update_ooxml_chart_axis_major_tick_mark(&updated, axis_tag, mark);
    }
    if let Some(mark) = chart
        .get(format!("{prefix}AxisMinorTickMark"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "cross" | "in" | "out" | "none"))
    {
        updated = update_ooxml_chart_axis_minor_tick_mark(&updated, axis_tag, mark);
    }
    if let Some(format_code) = chart
        .get(format!("{prefix}AxisNumberFormat"))
        .and_then(Value::as_str)
    {
        updated = update_ooxml_chart_axis_number_format(&updated, axis_tag, format_code);
    }
    if let Some(color) = chart
        .get(format!("{prefix}AxisLineColor"))
        .and_then(Value::as_str)
    {
        updated = update_ooxml_chart_axis_line_color(&updated, axis_tag, color);
    }
    if let Some(width) = chart
        .get(format!("{prefix}AxisLineWidth"))
        .and_then(Value::as_f64)
    {
        updated = update_ooxml_chart_axis_line_width(&updated, axis_tag, width);
    }
    if let Some(dash) = chart
        .get(format!("{prefix}AxisLineDash"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "solid" | "dash" | "dot" | "dashDot"))
    {
        updated = update_ooxml_chart_axis_line_dash(&updated, axis_tag, dash);
    }
    if let Some(rotation) = chart
        .get(format!("{prefix}AxisLabelRotation"))
        .and_then(Value::as_f64)
    {
        updated = update_ooxml_chart_axis_label_rotation(&updated, axis_tag, rotation);
    }

    let text_color_key = format!("{prefix}AxisLabelTextColor");
    let font_size_key = format!("{prefix}AxisLabelFontSize");
    let bold_key = format!("{prefix}AxisLabelBold");
    let italic_key = format!("{prefix}AxisLabelItalic");
    let text_color = chart.get(&text_color_key).and_then(Value::as_str);
    let font_size = chart
        .get(&font_size_key)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    let bold = chart.get(&bold_key).and_then(Value::as_bool);
    let italic = chart.get(&italic_key).and_then(Value::as_bool);
    if text_color.is_some() || font_size.is_some() || bold.is_some() || italic.is_some() {
        updated = update_ooxml_chart_axis_label_style(
            &updated, axis_tag, text_color, font_size, bold, italic,
        );
    }
    updated
}

fn parse_xlsx_image_object(
    bytes: &[u8],
    drawing_path: &str,
    anchor: &str,
    relationships: &BTreeMap<String, (String, String)>,
    anchor_json: &Value,
) -> Option<Value> {
    let relationship_id = docx_tag_attr(anchor, "<a:blip", "r:embed")
        .or_else(|| docx_tag_attr(anchor, "<a:blip", "r:link"))?;
    let (_, image_path) = relationships.get(&relationship_id)?;
    let mime_type = image_mime_type_from_path(image_path);
    let media = read_zip_bytes(bytes, image_path).ok();
    let data_url = media.as_ref().map(|bytes| {
        format!(
            "data:{mime_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    });
    Some(json!({
        "id": relationship_id,
        "drawingPath": drawing_path,
        "mediaPath": image_path,
        "mimeType": mime_type,
        "dataUrl": data_url,
        "anchor": anchor_json
    }))
}

fn parse_xlsx_drawing_anchor(anchor: &str) -> Value {
    let from = xml_named_segments(anchor, "xdr:from")
        .into_iter()
        .next()
        .unwrap_or_default();
    let to = xml_named_segments(anchor, "xdr:to")
        .into_iter()
        .next()
        .unwrap_or_default();
    json!({
        "from": xlsx_marker_position(&from),
        "to": xlsx_marker_position(&to)
    })
}

fn xlsx_marker_position(marker: &str) -> Value {
    json!({
        "column": first_tag_text(marker, "xdr:col").and_then(|value| value.parse::<u32>().ok()).unwrap_or(0),
        "columnOffset": first_tag_text(marker, "xdr:colOff").and_then(|value| value.parse::<u32>().ok()).unwrap_or(0),
        "row": first_tag_text(marker, "xdr:row").and_then(|value| value.parse::<u32>().ok()).unwrap_or(0),
        "rowOffset": first_tag_text(marker, "xdr:rowOff").and_then(|value| value.parse::<u32>().ok()).unwrap_or(0)
    })
}

fn valid_xlsx_chart_path(path: &str) -> bool {
    path.starts_with("xl/charts/") && path.ends_with(".xml") && !path.contains("..")
}

fn valid_xlsx_pivot_path(path: &str) -> bool {
    path.starts_with("xl/pivotTables/") && path.ends_with(".xml") && !path.contains("..")
}
