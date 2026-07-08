use serde_json::{json, Value};

use super::super::{
    escape_xml, extract_text_tags, find_xml_start, first_tag_text, replace_tag_texts,
    xml_named_segments,
};
use super::ooxml_primary_chart_segment;

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct OoxmlChartSeriesSpec {
    name: Option<String>,
    name_formula: Option<String>,
    categories: Vec<String>,
    categories_formula: Option<String>,
    values: Vec<String>,
    values_formula: Option<String>,
}

pub(in crate::services::document_editor) fn ooxml_chart_series(chart_xml: &str) -> Vec<Value> {
    xml_named_segments(chart_xml, "c:ser")
        .into_iter()
        .map(|series| {
            let mut value = json!({
                "categories": ooxml_chart_points(&series, "c:cat"),
                "categoriesFormula": ooxml_chart_reference_formula(&series, "c:cat"),
                "values": ooxml_chart_points(&series, "c:val")
                ,
                "valuesFormula": ooxml_chart_reference_formula(&series, "c:val")
            });
            if let Some(name) = ooxml_chart_series_name(&series) {
                value["name"] = json!(name);
            }
            if let Some(formula) = ooxml_chart_series_name_formula(&series) {
                value["nameFormula"] = json!(formula);
            }
            value
        })
        .collect()
}

pub(in crate::services::document_editor) fn ooxml_chart_series_specs(
    chart: &Value,
) -> Vec<OoxmlChartSeriesSpec> {
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
            name_formula: series
                .get("nameFormula")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string),
            categories: series
                .get("categories")
                .and_then(Value::as_array)
                .map(|values| json_values_to_strings(values))
                .unwrap_or_default(),
            categories_formula: series
                .get("categoriesFormula")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string),
            values: series
                .get("values")
                .and_then(Value::as_array)
                .map(|values| json_values_to_strings(values))
                .unwrap_or_default(),
            values_formula: series
                .get("valuesFormula")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string),
        })
        .collect()
}

pub(in crate::services::document_editor) fn update_ooxml_chart_series(
    xml: &str,
    specs: &[OoxmlChartSeriesSpec],
) -> String {
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
    if specs.len() > index {
        insert_ooxml_chart_series(&output, &specs[index..], index)
    } else {
        output
    }
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

fn ooxml_chart_series_name_formula(series: &str) -> Option<String> {
    xml_named_segments(series, "c:tx")
        .into_iter()
        .next()
        .and_then(|text| ooxml_reference_formula(&text))
}

fn ooxml_chart_reference_formula(series: &str, container_tag: &str) -> Option<String> {
    xml_named_segments(series, container_tag)
        .into_iter()
        .next()
        .and_then(|container| ooxml_reference_formula(&container))
}

fn ooxml_reference_formula(container: &str) -> Option<String> {
    ["c:strRef", "c:numRef"].into_iter().find_map(|tag| {
        xml_named_segments(container, tag)
            .into_iter()
            .next()
            .and_then(|reference| first_tag_text(&reference, "c:f"))
            .map(|formula| formula.trim().to_string())
            .filter(|formula| !formula.is_empty())
    })
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

fn update_ooxml_chart_series_segment(segment: &str, spec: &OoxmlChartSeriesSpec) -> String {
    let mut output = if let Some(name) = spec.name.as_deref() {
        update_ooxml_chart_series_name(segment, name)
    } else {
        segment.to_string()
    };
    if let Some(formula) = spec.name_formula.as_deref() {
        output = update_ooxml_chart_series_name_formula(&output, formula);
    }
    output = update_ooxml_chart_point_values(&output, "c:cat", &spec.categories);
    output = update_ooxml_chart_point_values(&output, "c:val", &spec.values);
    if let Some(formula) = spec.categories_formula.as_deref() {
        output = update_ooxml_chart_point_formula(&output, "c:cat", "c:strRef", formula);
    }
    if let Some(formula) = spec.values_formula.as_deref() {
        output = update_ooxml_chart_point_formula(&output, "c:val", "c:numRef", formula);
    }
    output
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
    let updated_container = update_ooxml_chart_point_cache(&container, values);
    segment.replacen(&container, &updated_container, 1)
}

fn update_ooxml_chart_point_cache(container: &str, values: &[String]) -> String {
    for tag in ["c:strCache", "c:numCache", "c:strLit", "c:numLit"] {
        if let Some(cache) = xml_named_segments(container, tag).into_iter().next() {
            let updated_cache = build_ooxml_chart_point_cache(tag, values);
            return container.replacen(&cache, &updated_cache, 1);
        }
    }
    replace_tag_texts(container, "c:v", values)
}

fn update_ooxml_chart_series_name_formula(segment: &str, formula: &str) -> String {
    let replacement = build_ooxml_chart_series_name_formula(formula);
    let Some(tx) = xml_named_segments(segment, "c:tx").into_iter().next() else {
        return insert_ooxml_series_child(segment, &replacement);
    };
    if tx.contains("<c:strRef") || tx.contains("<c:numRef") {
        let updated_tx = update_ooxml_reference_formula_in_container(&tx, "c:strRef", formula);
        return segment.replacen(&tx, &updated_tx, 1);
    }
    segment.replacen(&tx, &replacement, 1)
}

fn update_ooxml_chart_point_formula(
    segment: &str,
    container_tag: &str,
    reference_tag: &str,
    formula: &str,
) -> String {
    let Some(container) = xml_named_segments(segment, container_tag)
        .into_iter()
        .next()
    else {
        let replacement = build_ooxml_chart_point_container(container_tag, reference_tag, formula);
        return insert_ooxml_series_child(segment, &replacement);
    };
    let updated_container =
        update_ooxml_reference_formula_in_container(&container, reference_tag, formula);
    segment.replacen(&container, &updated_container, 1)
}

fn update_ooxml_reference_formula_in_container(
    container: &str,
    reference_tag: &str,
    formula: &str,
) -> String {
    for tag in ["c:strRef", "c:numRef"] {
        if let Some(reference) = xml_named_segments(container, tag).into_iter().next() {
            let updated_reference = update_ooxml_reference_formula(&reference, formula);
            return container.replacen(&reference, &updated_reference, 1);
        }
    }
    let reference = format!(
        r#"<{reference_tag}><c:f>{}</c:f></{reference_tag}>"#,
        escape_xml(formula)
    );
    let container_tag = if container.starts_with("<c:cat") {
        "c:cat"
    } else if container.starts_with("<c:val") {
        "c:val"
    } else {
        "c:tx"
    };
    format!(r#"<{container_tag}>{reference}</{container_tag}>"#)
}

fn update_ooxml_reference_formula(reference: &str, formula: &str) -> String {
    if reference.contains("<c:f") {
        return replace_tag_texts(reference, "c:f", &[formula.to_string()]);
    }
    insert_after_ooxml_start_tag(
        reference,
        &format!(
            "<{}",
            reference_start_tag_name(reference).unwrap_or("c:strRef")
        ),
        &format!("<c:f>{}</c:f>", escape_xml(formula)),
    )
}

fn reference_start_tag_name(reference: &str) -> Option<&'static str> {
    if reference.starts_with("<c:numRef") {
        Some("c:numRef")
    } else if reference.starts_with("<c:strRef") {
        Some("c:strRef")
    } else {
        None
    }
}

fn insert_after_ooxml_start_tag(xml: &str, marker: &str, insertion: &str) -> String {
    let Some(start) = find_xml_start(xml, marker) else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find('>') else {
        return xml.to_string();
    };
    let insert_at = start + end + 1;
    format!("{}{}{}", &xml[..insert_at], insertion, &xml[insert_at..])
}

fn insert_ooxml_chart_series(
    xml: &str,
    specs: &[OoxmlChartSeriesSpec],
    start_index: usize,
) -> String {
    let Some((_, tag, chart)) = ooxml_primary_chart_segment(xml) else {
        return xml.to_string();
    };
    let insertion = specs
        .iter()
        .enumerate()
        .map(|(offset, spec)| build_ooxml_chart_series(start_index + offset, spec))
        .collect::<String>();
    let updated_chart = insert_ooxml_chart_type_child(&chart, tag, &insertion);
    xml.replacen(&chart, &updated_chart, 1)
}

fn insert_ooxml_chart_type_child(chart: &str, tag: &str, insertion: &str) -> String {
    let insert_at = chart
        .find("<c:axId")
        .or_else(|| chart.find("<c:holeSize"))
        .or_else(|| chart.find(&format!("</{tag}>")));
    let Some(insert_at) = insert_at else {
        return chart.to_string();
    };
    format!(
        "{}{}{}",
        &chart[..insert_at],
        insertion,
        &chart[insert_at..]
    )
}

fn insert_ooxml_series_child(series: &str, child: &str) -> String {
    let insert_at = series
        .find("<c:cat")
        .or_else(|| series.find("<c:val"))
        .or_else(|| series.find("</c:ser>"));
    let Some(insert_at) = insert_at else {
        return series.to_string();
    };
    format!("{}{}{}", &series[..insert_at], child, &series[insert_at..])
}

fn build_ooxml_chart_series(index: usize, spec: &OoxmlChartSeriesSpec) -> String {
    let name = if let Some(formula) = spec.name_formula.as_deref() {
        build_ooxml_chart_series_name_formula(formula)
    } else {
        spec.name
            .as_deref()
            .map(build_ooxml_chart_series_name_literal)
            .unwrap_or_default()
    };
    let categories = if let Some(formula) = spec.categories_formula.as_deref() {
        build_ooxml_chart_point_container("c:cat", "c:strRef", formula)
    } else {
        build_ooxml_chart_literal_container("c:cat", "c:strLit", &spec.categories)
    };
    let values = if let Some(formula) = spec.values_formula.as_deref() {
        build_ooxml_chart_point_container("c:val", "c:numRef", formula)
    } else {
        build_ooxml_chart_literal_container("c:val", "c:numLit", &spec.values)
    };
    format!(
        r#"<c:ser><c:idx val="{index}"/><c:order val="{index}"/>{name}{categories}{values}</c:ser>"#
    )
}

fn build_ooxml_chart_series_name_formula(formula: &str) -> String {
    format!(
        r#"<c:tx><c:strRef><c:f>{}</c:f></c:strRef></c:tx>"#,
        escape_xml(formula)
    )
}

fn build_ooxml_chart_series_name_literal(name: &str) -> String {
    format!(r#"<c:tx><c:v>{}</c:v></c:tx>"#, escape_xml(name))
}

fn build_ooxml_chart_point_container(
    container_tag: &str,
    reference_tag: &str,
    formula: &str,
) -> String {
    format!(
        r#"<{container_tag}><{reference_tag}><c:f>{}</c:f></{reference_tag}></{container_tag}>"#,
        escape_xml(formula)
    )
}

fn build_ooxml_chart_literal_container(
    container_tag: &str,
    literal_tag: &str,
    values: &[String],
) -> String {
    if values.is_empty() {
        return String::new();
    }
    let points = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            format!(
                r#"<c:pt idx="{index}"><c:v>{}</c:v></c:pt>"#,
                escape_xml(value)
            )
        })
        .collect::<String>();
    format!(
        r#"<{container_tag}><{literal_tag}><c:ptCount val="{}"/>{points}</{literal_tag}></{container_tag}>"#,
        values.len()
    )
}

fn build_ooxml_chart_point_cache(tag: &str, values: &[String]) -> String {
    let points = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            format!(
                r#"<c:pt idx="{index}"><c:v>{}</c:v></c:pt>"#,
                escape_xml(value)
            )
        })
        .collect::<String>();
    format!(
        r#"<{tag}><c:ptCount val="{}"/>{points}</{tag}>"#,
        values.len()
    )
}
