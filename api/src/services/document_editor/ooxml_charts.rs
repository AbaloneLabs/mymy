use serde_json::{json, Value};

use super::{
    append_before_or_end, escape_xml, extract_text_tags, find_xml_start, first_tag_text,
    replace_tag_texts, replace_xml_element, xml_named_segments,
};

#[derive(Debug, Clone)]
pub(super) struct OoxmlChartSeriesSpec {
    name: Option<String>,
    categories: Vec<String>,
    values: Vec<String>,
}

pub(super) fn ooxml_chart_type(chart_xml: &str) -> Option<&'static str> {
    [
        ("bar", "<c:barChart"),
        ("line", "<c:lineChart"),
        ("area", "<c:areaChart"),
        ("pie", "<c:pieChart"),
        ("scatter", "<c:scatterChart"),
        ("doughnut", "<c:doughnutChart"),
    ]
    .into_iter()
    .find_map(|(kind, marker)| chart_xml.contains(marker).then_some(kind))
}

pub(super) fn ooxml_chart_title(chart_xml: &str) -> Option<String> {
    xml_named_segments(chart_xml, "c:title")
        .into_iter()
        .next()
        .map(|title| extract_text_tags(&title, "a:t").join(""))
        .filter(|title| !title.is_empty())
}

pub(super) fn ooxml_chart_series(chart_xml: &str) -> Vec<Value> {
    xml_named_segments(chart_xml, "c:ser")
        .into_iter()
        .enumerate()
        .map(|(index, series)| {
            json!({
                "name": ooxml_chart_series_name(&series)
                    .unwrap_or_else(|| format!("Series {}", index + 1)),
                "categories": ooxml_chart_points(&series, "c:cat"),
                "values": ooxml_chart_points(&series, "c:val")
            })
        })
        .collect()
}

pub(super) fn ooxml_chart_series_specs(chart: &Value) -> Vec<OoxmlChartSeriesSpec> {
    chart
        .get("series")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|series| OoxmlChartSeriesSpec {
            name: series
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string),
            categories: series
                .get("categories")
                .and_then(Value::as_array)
                .map(|values| json_values_to_strings(values))
                .unwrap_or_default(),
            values: series
                .get("values")
                .and_then(Value::as_array)
                .map(|values| json_values_to_strings(values))
                .unwrap_or_default(),
        })
        .collect()
}

pub(super) fn update_ooxml_chart_title(xml: &str, title: &str) -> String {
    let title_xml = build_ooxml_chart_title(title);
    if let Some(replaced) = replace_xml_element(xml, "c:title", &title_xml) {
        return replaced;
    }
    if let Some(index) = xml.find("<c:plotArea") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&title_xml);
        output.push_str(&xml[index..]);
        return output;
    }
    append_before_or_end(xml, "</c:chart>", &title_xml)
}

pub(super) fn update_ooxml_chart_series(xml: &str, specs: &[OoxmlChartSeriesSpec]) -> String {
    if specs.is_empty() {
        return xml.to_string();
    }
    let mut output = String::new();
    let mut rest = xml;
    let mut index = 0usize;
    while let Some(start) = find_xml_start(rest, "<c:ser") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</c:ser>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</c:ser>".len();
        let segment = &after_start[..end_index];
        if let Some(spec) = specs.get(index) {
            output.push_str(&update_ooxml_chart_series_segment(segment, spec));
        } else {
            output.push_str(segment);
        }
        index += 1;
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

fn ooxml_chart_series_name(series: &str) -> Option<String> {
    xml_named_segments(series, "c:tx")
        .into_iter()
        .next()
        .and_then(|text| {
            first_tag_text(&text, "c:v")
                .or_else(|| first_tag_text(&text, "a:t"))
                .map(|value| value.trim().to_string())
        })
        .filter(|value| !value.is_empty())
}

fn ooxml_chart_points(series: &str, container_tag: &str) -> Vec<String> {
    xml_named_segments(series, container_tag)
        .into_iter()
        .next()
        .map(|container| {
            extract_text_tags(&container, "c:v")
                .into_iter()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn json_values_to_strings(values: &[Value]) -> Vec<String> {
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string())
        })
        .collect()
}

fn build_ooxml_chart_title(title: &str) -> String {
    format!(
        r#"<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></c:rich></c:tx></c:title>"#,
        escape_xml(title)
    )
}

fn update_ooxml_chart_series_segment(segment: &str, spec: &OoxmlChartSeriesSpec) -> String {
    let mut output = if let Some(name) = spec.name.as_deref() {
        update_ooxml_chart_series_name(segment, name)
    } else {
        segment.to_string()
    };
    output = update_ooxml_chart_point_values(&output, "c:cat", &spec.categories);
    update_ooxml_chart_point_values(&output, "c:val", &spec.values)
}

fn update_ooxml_chart_series_name(segment: &str, name: &str) -> String {
    let Some(tx) = xml_named_segments(segment, "c:tx").into_iter().next() else {
        return segment.to_string();
    };
    let updated_tx = if tx.contains("<c:v") {
        replace_tag_texts(&tx, "c:v", &[name.to_string()])
    } else if tx.contains("<a:t") {
        replace_tag_texts(&tx, "a:t", &[name.to_string()])
    } else {
        tx.clone()
    };
    segment.replacen(&tx, &updated_tx, 1)
}

fn update_ooxml_chart_point_values(segment: &str, tag: &str, values: &[String]) -> String {
    if values.is_empty() {
        return segment.to_string();
    }
    let Some(container) = xml_named_segments(segment, tag).into_iter().next() else {
        return segment.to_string();
    };
    let updated_container = replace_tag_texts(&container, "c:v", values);
    segment.replacen(&container, &updated_container, 1)
}
