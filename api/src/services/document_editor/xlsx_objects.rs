use std::collections::BTreeMap;

use base64::Engine as _;
use serde_json::{json, Value};

mod pivots;

pub(super) use pivots::add_xlsx_pivot_replacements;
use pivots::parse_xlsx_sheet_pivots;

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
    attr_value, docx_tag_attr, first_tag_text, read_zip_bytes, read_zip_text,
    xml_named_empty_elements, xml_named_segments, xml_segments,
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
