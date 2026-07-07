use std::collections::BTreeMap;

use base64::Engine as _;
use serde_json::{json, Value};

use super::ooxml_charts::{
    ooxml_chart_series, ooxml_chart_series_specs, ooxml_chart_title, ooxml_chart_type,
    update_ooxml_chart_series, update_ooxml_chart_title,
};
use super::ooxml_images::image_mime_type_from_path;
use super::xlsx_relationships::{xlsx_part_rels_path, xlsx_relationships_by_id};
use super::xlsx_tables::parse_xlsx_sheet_tables;
use super::{
    attr_value, docx_tag_attr, first_tag_text, read_zip_bytes, read_zip_text,
    set_first_xml_tag_attrs, xml_named_empty_elements, xml_named_segments, xml_segments,
};

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
        let Some(name) = pivot.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Ok(pivot_xml) = read_zip_text(original, pivot_path) else {
            continue;
        };
        let updated = set_first_xml_tag_attrs(
            &pivot_xml,
            "<pivotTableDefinition",
            &[("name", name.to_string())],
        );
        replacements.push((pivot_path.to_string(), updated.into_bytes()));
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
                "cacheId": attr_value(&pivot_xml, "cacheId")
            }))
        })
        .collect()
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
    Some(json!({
        "id": relationship_id,
        "path": chart_path,
        "type": ooxml_chart_type(&chart_xml),
        "title": ooxml_chart_title(&chart_xml),
        "categories": ooxml_chart_series(&chart_xml)
            .first()
            .and_then(|item| item.get("categories"))
            .cloned()
            .unwrap_or_else(|| json!([])),
        "series": ooxml_chart_series(&chart_xml),
        "anchor": anchor_json
    }))
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
