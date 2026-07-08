use serde_json::{json, Value};

use super::{
    append_before_or_end, attr_value, docx_hex_color, escape_xml, extract_text_tags,
    find_xml_start, first_tag_text, replace_empty_xml_element, replace_tag_texts,
    replace_xml_element, set_first_xml_tag_attrs, xml_named_empty_elements, xml_named_segments,
};

#[derive(Debug, Clone)]
pub(super) struct OoxmlChartSeriesSpec {
    name: Option<String>,
    name_formula: Option<String>,
    categories: Vec<String>,
    categories_formula: Option<String>,
    values: Vec<String>,
    values_formula: Option<String>,
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

pub(super) fn ooxml_chart_legend_visible(chart_xml: &str) -> bool {
    !xml_named_segments(chart_xml, "c:legend").is_empty()
}

pub(super) fn ooxml_chart_legend_position(chart_xml: &str) -> Option<String> {
    xml_named_segments(chart_xml, "c:legend")
        .into_iter()
        .next()
        .and_then(|legend| {
            xml_named_empty_elements(&legend, "c:legendPos")
                .into_iter()
                .next()
                .and_then(|position| attr_value(&position, "val"))
        })
        .filter(|position| matches!(position.as_str(), "r" | "l" | "t" | "b" | "tr"))
}

pub(super) fn ooxml_chart_axis_title(chart_xml: &str, axis_tag: &str) -> Option<String> {
    xml_named_segments(chart_xml, axis_tag)
        .into_iter()
        .next()
        .and_then(|axis| {
            xml_named_segments(&axis, "c:title")
                .into_iter()
                .next()
                .map(|title| extract_text_tags(&title, "a:t").join(""))
        })
        .filter(|title| !title.trim().is_empty())
}

pub(super) fn ooxml_chart_axis_position(chart_xml: &str, axis_tag: &str) -> Option<String> {
    xml_named_segments(chart_xml, axis_tag)
        .into_iter()
        .next()
        .and_then(|axis| {
            xml_named_empty_elements(&axis, "c:axPos")
                .into_iter()
                .next()
                .and_then(|position| attr_value(&position, "val"))
        })
        .filter(|position| matches!(position.as_str(), "b" | "t" | "l" | "r"))
}

pub(super) fn ooxml_chart_axis_major_gridlines_visible(chart_xml: &str, axis_tag: &str) -> bool {
    xml_named_segments(chart_xml, axis_tag)
        .into_iter()
        .next()
        .is_some_and(|axis| {
            !xml_named_empty_elements(&axis, "c:majorGridlines").is_empty()
                || !xml_named_segments(&axis, "c:majorGridlines").is_empty()
        })
}

pub(super) fn ooxml_chart_axis_tick_label_position(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
    ooxml_chart_axis_empty_value(chart_xml, axis_tag, "c:tickLblPos")
        .filter(|value| matches!(value.as_str(), "nextTo" | "low" | "high" | "none"))
}

pub(super) fn ooxml_chart_axis_major_tick_mark(chart_xml: &str, axis_tag: &str) -> Option<String> {
    ooxml_chart_axis_tick_mark(chart_xml, axis_tag, "c:majorTickMark")
}

pub(super) fn ooxml_chart_axis_minor_tick_mark(chart_xml: &str, axis_tag: &str) -> Option<String> {
    ooxml_chart_axis_tick_mark(chart_xml, axis_tag, "c:minorTickMark")
}

pub(super) fn ooxml_chart_axis_line_color(chart_xml: &str, axis_tag: &str) -> Option<String> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let shape_properties = ooxml_segment_or_empty(&axis, "c:spPr")?;
    let line = ooxml_segment_or_empty(&shape_properties, "a:ln")?;
    ooxml_first_srgb_color(&line)
}

pub(super) fn ooxml_chart_axis_line_width(chart_xml: &str, axis_tag: &str) -> Option<f64> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let shape_properties = ooxml_segment_or_empty(&axis, "c:spPr")?;
    let line = ooxml_segment_or_empty(&shape_properties, "a:ln")?;
    attr_value(&line, "w")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|emu| (emu / 12_700.0).clamp(0.0, 72.0))
}

pub(super) fn ooxml_chart_axis_line_dash(chart_xml: &str, axis_tag: &str) -> Option<String> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let shape_properties = ooxml_segment_or_empty(&axis, "c:spPr")?;
    let line = ooxml_segment_or_empty(&shape_properties, "a:ln")?;
    ooxml_segment_or_empty(&line, "a:prstDash")
        .and_then(|dash| attr_value(&dash, "val"))
        .filter(|value| ooxml_valid_chart_axis_dash(value))
        .or_else(|| Some("solid".to_string()))
}

pub(super) fn ooxml_chart_axis_number_format(chart_xml: &str, axis_tag: &str) -> Option<String> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    xml_named_empty_elements(&axis, "c:numFmt")
        .into_iter()
        .next()
        .and_then(|format| attr_value(&format, "formatCode"))
        .filter(|format| !format.trim().is_empty())
}

pub(super) fn ooxml_chart_axis_label_text_color(chart_xml: &str, axis_tag: &str) -> Option<String> {
    let run_properties = ooxml_chart_axis_label_run_properties(chart_xml, axis_tag)?;
    ooxml_first_srgb_color(&run_properties)
}

pub(super) fn ooxml_chart_axis_label_rotation(chart_xml: &str, axis_tag: &str) -> Option<f64> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let text_properties = ooxml_segment_or_empty(&axis, "c:txPr")?;
    let body_properties = ooxml_segment_or_empty(&text_properties, "a:bodyPr")?;
    attr_value(&body_properties, "rot")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / 60_000.0).clamp(-90.0, 90.0))
}

pub(super) fn ooxml_chart_axis_label_font_size(chart_xml: &str, axis_tag: &str) -> Option<u32> {
    let run_properties = ooxml_chart_axis_label_run_properties(chart_xml, axis_tag)?;
    attr_value(&run_properties, "sz")
        .and_then(|value| value.parse::<u32>().ok())
        .map(|centipoints| centipoints / 100)
        .filter(|points| *points > 0)
}

pub(super) fn ooxml_chart_axis_label_bold(chart_xml: &str, axis_tag: &str) -> Option<bool> {
    ooxml_chart_axis_label_bool_attr(chart_xml, axis_tag, "b")
}

pub(super) fn ooxml_chart_axis_label_italic(chart_xml: &str, axis_tag: &str) -> Option<bool> {
    ooxml_chart_axis_label_bool_attr(chart_xml, axis_tag, "i")
}

pub(super) fn ooxml_chart_series(chart_xml: &str) -> Vec<Value> {
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
    if specs.len() > index {
        insert_ooxml_chart_series(&output, &specs[index..], index)
    } else {
        output
    }
}

pub(super) fn update_ooxml_chart_type(xml: &str, chart_type: &str) -> String {
    let Some(target_tag) = ooxml_chart_tag_for_type(chart_type) else {
        return xml.to_string();
    };
    let Some((current_type, _, current_chart)) = ooxml_primary_chart_segment(xml) else {
        return xml.to_string();
    };
    if current_type == chart_type {
        return xml.to_string();
    }
    let series = xml_named_segments(&current_chart, "c:ser").join("");
    if series.is_empty() {
        return xml.to_string();
    }
    let axis_ids = ooxml_chart_axis_ids(&current_chart);
    let replacement = build_ooxml_chart_type_segment(target_tag, &series, &axis_ids);
    xml.replacen(&current_chart, &replacement, 1)
}

pub(super) fn update_ooxml_chart_legend(
    xml: &str,
    visible: bool,
    position: Option<&str>,
) -> String {
    let stripped = remove_ooxml_chart_legend(xml);
    if !visible {
        return stripped;
    }
    let position = position
        .filter(|value| matches!(*value, "r" | "l" | "t" | "b" | "tr"))
        .unwrap_or("r");
    let legend = format!(
        r#"<c:legend><c:legendPos val="{}"/><c:layout/><c:overlay val="0"/></c:legend>"#,
        escape_xml(position)
    );
    if let Some(index) = stripped.find("<c:plotVisOnly") {
        let mut output = String::new();
        output.push_str(&stripped[..index]);
        output.push_str(&legend);
        output.push_str(&stripped[index..]);
        return output;
    }
    append_before_or_end(&stripped, "</c:chart>", &legend)
}

pub(super) fn update_ooxml_chart_axis_title(
    xml: &str,
    axis_tag: &str,
    title: Option<&str>,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let stripped_axis = remove_ooxml_axis_title(&axis);
    let updated_axis = match title.map(str::trim).filter(|value| !value.is_empty()) {
        Some(title) => insert_ooxml_axis_title(&stripped_axis, axis_tag, title),
        None => stripped_axis,
    };
    xml.replacen(&axis, &updated_axis, 1)
}

pub(super) fn update_ooxml_chart_axis_position(
    xml: &str,
    axis_tag: &str,
    position: &str,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_position(&axis, axis_tag, position);
    xml.replacen(&axis, &updated_axis, 1)
}

pub(super) fn update_ooxml_chart_axis_major_gridlines(
    xml: &str,
    axis_tag: &str,
    visible: bool,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let stripped_axis = remove_ooxml_axis_major_gridlines(&axis);
    let updated_axis = if visible {
        insert_ooxml_axis_major_gridlines(&stripped_axis, axis_tag)
    } else {
        stripped_axis
    };
    xml.replacen(&axis, &updated_axis, 1)
}

pub(super) fn update_ooxml_chart_axis_tick_label_position(
    xml: &str,
    axis_tag: &str,
    position: &str,
) -> String {
    update_ooxml_chart_axis_empty_value(xml, axis_tag, "c:tickLblPos", position)
}

pub(super) fn update_ooxml_chart_axis_major_tick_mark(
    xml: &str,
    axis_tag: &str,
    mark: &str,
) -> String {
    update_ooxml_chart_axis_empty_value(xml, axis_tag, "c:majorTickMark", mark)
}

pub(super) fn update_ooxml_chart_axis_minor_tick_mark(
    xml: &str,
    axis_tag: &str,
    mark: &str,
) -> String {
    update_ooxml_chart_axis_empty_value(xml, axis_tag, "c:minorTickMark", mark)
}

pub(super) fn update_ooxml_chart_axis_line_color(xml: &str, axis_tag: &str, color: &str) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_line_style(&axis, axis_tag, Some(color), None, None);
    xml.replacen(&axis, &updated_axis, 1)
}

pub(super) fn update_ooxml_chart_axis_line_width(xml: &str, axis_tag: &str, width: f64) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_line_style(&axis, axis_tag, None, Some(width), None);
    xml.replacen(&axis, &updated_axis, 1)
}

pub(super) fn update_ooxml_chart_axis_line_dash(xml: &str, axis_tag: &str, dash: &str) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_line_style(&axis, axis_tag, None, None, Some(dash));
    xml.replacen(&axis, &updated_axis, 1)
}

pub(super) fn update_ooxml_chart_axis_number_format(
    xml: &str,
    axis_tag: &str,
    format_code: &str,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_number_format(&axis, axis_tag, format_code);
    xml.replacen(&axis, &updated_axis, 1)
}

pub(super) fn update_ooxml_chart_axis_label_rotation(
    xml: &str,
    axis_tag: &str,
    rotation: f64,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_label_rotation(&axis, axis_tag, rotation);
    xml.replacen(&axis, &updated_axis, 1)
}

pub(super) fn update_ooxml_chart_axis_label_style(
    xml: &str,
    axis_tag: &str,
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis =
        update_ooxml_axis_label_style(&axis, axis_tag, text_color, font_size, bold, italic);
    xml.replacen(&axis, &updated_axis, 1)
}

fn ooxml_primary_chart_segment(xml: &str) -> Option<(&'static str, &'static str, String)> {
    [
        ("bar", "c:barChart"),
        ("line", "c:lineChart"),
        ("area", "c:areaChart"),
        ("pie", "c:pieChart"),
        ("doughnut", "c:doughnutChart"),
    ]
    .into_iter()
    .find_map(|(kind, tag)| {
        xml_named_segments(xml, tag)
            .into_iter()
            .next()
            .map(|segment| (kind, tag, segment))
    })
}

fn remove_ooxml_chart_legend(xml: &str) -> String {
    let mut output = xml.to_string();
    for legend in xml_named_segments(xml, "c:legend") {
        output = output.replacen(&legend, "", 1);
    }
    output
}

fn ooxml_chart_axis(chart_xml: &str, axis_tag: &str) -> Option<String> {
    xml_named_segments(chart_xml, axis_tag).into_iter().next()
}

fn ooxml_chart_axis_empty_value(
    chart_xml: &str,
    axis_tag: &str,
    child_tag: &str,
) -> Option<String> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    xml_named_empty_elements(&axis, child_tag)
        .into_iter()
        .next()
        .and_then(|element| attr_value(&element, "val"))
}

fn ooxml_chart_axis_tick_mark(chart_xml: &str, axis_tag: &str, child_tag: &str) -> Option<String> {
    ooxml_chart_axis_empty_value(chart_xml, axis_tag, child_tag)
        .filter(|value| matches!(value.as_str(), "cross" | "in" | "out" | "none"))
}

fn ooxml_chart_axis_label_run_properties(chart_xml: &str, axis_tag: &str) -> Option<String> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let text_properties = ooxml_segment_or_empty(&axis, "c:txPr")?;
    ooxml_segment_or_empty(&text_properties, "a:defRPr")
}

fn ooxml_chart_axis_label_bool_attr(chart_xml: &str, axis_tag: &str, attr: &str) -> Option<bool> {
    let run_properties = ooxml_chart_axis_label_run_properties(chart_xml, axis_tag)?;
    attr_value(&run_properties, attr)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

fn ooxml_segment_or_empty(xml: &str, tag: &str) -> Option<String> {
    xml_named_segments(xml, tag)
        .into_iter()
        .next()
        .or_else(|| xml_named_empty_elements(xml, tag).into_iter().next())
}

fn ooxml_first_srgb_color(xml: &str) -> Option<String> {
    xml_named_empty_elements(xml, "a:srgbClr")
        .into_iter()
        .next()
        .and_then(|color| attr_value(&color, "val"))
        .and_then(|color| docx_hex_color(&color))
}

fn remove_ooxml_axis_major_gridlines(axis: &str) -> String {
    let mut output = axis.to_string();
    for gridlines in xml_named_segments(axis, "c:majorGridlines") {
        output = output.replacen(&gridlines, "", 1);
    }
    for gridlines in xml_named_empty_elements(axis, "c:majorGridlines") {
        output = output.replacen(&gridlines, "", 1);
    }
    output
}

fn update_ooxml_axis_position(axis: &str, axis_tag: &str, position: &str) -> String {
    let position_xml = format!(r#"<c:axPos val="{}"/>"#, escape_xml(position));
    if let Some(existing) = xml_named_empty_elements(axis, "c:axPos").into_iter().next() {
        return axis.replacen(&existing, &position_xml, 1);
    }
    for tag in ["c:scaling", "c:axId"] {
        if let Some(segment) = xml_named_empty_elements(axis, tag).into_iter().last() {
            return insert_after_segment(axis, &segment, &position_xml);
        }
        if let Some(segment) = xml_named_segments(axis, tag).into_iter().last() {
            return insert_after_segment(axis, &segment, &position_xml);
        }
    }
    append_before_or_end(axis, &format!("</{axis_tag}>"), &position_xml)
}

fn insert_ooxml_axis_major_gridlines(axis: &str, axis_tag: &str) -> String {
    let gridlines_xml = "<c:majorGridlines/>";
    for tag in ["c:axPos", "c:scaling", "c:axId"] {
        if let Some(segment) = xml_named_empty_elements(axis, tag).into_iter().last() {
            return insert_after_segment(axis, &segment, gridlines_xml);
        }
        if let Some(segment) = xml_named_segments(axis, tag).into_iter().last() {
            return insert_after_segment(axis, &segment, gridlines_xml);
        }
    }
    append_before_or_end(axis, &format!("</{axis_tag}>"), gridlines_xml)
}

fn update_ooxml_chart_axis_empty_value(
    xml: &str,
    axis_tag: &str,
    child_tag: &str,
    value: &str,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let child_xml = format!(r#"<{child_tag} val="{}"/>"#, escape_xml(value));
    let updated_axis = if let Some(existing) = xml_named_empty_elements(&axis, child_tag)
        .into_iter()
        .next()
    {
        axis.replacen(&existing, &child_xml, 1)
    } else if let Some(existing) = xml_named_segments(&axis, child_tag).into_iter().next() {
        axis.replacen(&existing, &child_xml, 1)
    } else {
        insert_ooxml_axis_child(&axis, axis_tag, &child_xml)
    };
    xml.replacen(&axis, &updated_axis, 1)
}

fn update_ooxml_axis_line_style(
    axis: &str,
    axis_tag: &str,
    color: Option<&str>,
    width: Option<f64>,
    dash: Option<&str>,
) -> String {
    let line_xml = build_ooxml_axis_line_xml(color, width, dash, None);
    let shape_xml = format!("<c:spPr>{line_xml}</c:spPr>");
    if let Some(shape_properties) = xml_named_empty_elements(axis, "c:spPr").into_iter().next() {
        return axis.replacen(&shape_properties, &shape_xml, 1);
    }
    if let Some(shape_properties) = xml_named_segments(axis, "c:spPr").into_iter().next() {
        let updated_shape_properties = if let Some(line) =
            xml_named_empty_elements(&shape_properties, "a:ln")
                .into_iter()
                .next()
        {
            let updated_line = build_ooxml_axis_line_xml(color, width, dash, Some(&line));
            shape_properties.replacen(&line, &updated_line, 1)
        } else if let Some(line) = xml_named_segments(&shape_properties, "a:ln")
            .into_iter()
            .next()
        {
            let updated_line = build_ooxml_axis_line_xml(color, width, dash, Some(&line));
            shape_properties.replacen(&line, &updated_line, 1)
        } else {
            append_before_or_end(&shape_properties, "</c:spPr>", &line_xml)
        };
        return axis.replacen(&shape_properties, &updated_shape_properties, 1);
    }
    insert_ooxml_axis_child(axis, axis_tag, &shape_xml)
}

fn build_ooxml_axis_line_xml(
    color: Option<&str>,
    width: Option<f64>,
    dash: Option<&str>,
    existing_line: Option<&str>,
) -> String {
    let width = width
        .map(|value| (value.clamp(0.0, 72.0) * 12_700.0).round() as i64)
        .or_else(|| existing_line.and_then(|line| attr_value(line, "w")?.parse::<i64>().ok()));
    let color = color
        .map(str::to_string)
        .or_else(|| existing_line.and_then(ooxml_first_srgb_color));
    let dash = dash
        .filter(|value| ooxml_valid_chart_axis_dash(value))
        .map(str::to_string)
        .or_else(|| {
            existing_line
                .and_then(|line| ooxml_segment_or_empty(line, "a:prstDash"))
                .and_then(|dash| attr_value(&dash, "val"))
                .filter(|value| ooxml_valid_chart_axis_dash(value))
        });

    let width_attr = width
        .map(|value| format!(r#" w="{value}""#))
        .unwrap_or_default();
    let fill = color
        .map(|color| {
            format!(
                r#"<a:solidFill><a:srgbClr val="{}"/></a:solidFill>"#,
                escape_xml(&color)
            )
        })
        .unwrap_or_else(|| "<a:noFill/>".to_string());
    let dash = dash
        .filter(|value| value != "solid")
        .map(|value| format!(r#"<a:prstDash val="{}"/>"#, escape_xml(&value)))
        .unwrap_or_default();
    format!(r#"<a:ln{width_attr}>{fill}{dash}</a:ln>"#)
}

fn update_ooxml_axis_number_format(axis: &str, axis_tag: &str, format_code: &str) -> String {
    let format_code = format_code.trim();
    if format_code.is_empty() || format_code.len() > 128 {
        return axis.to_string();
    }
    let number_format_xml = format!(
        r#"<c:numFmt formatCode="{}" sourceLinked="0"/>"#,
        escape_xml(format_code)
    );
    if let Some(existing) = xml_named_empty_elements(axis, "c:numFmt")
        .into_iter()
        .next()
    {
        return axis.replacen(&existing, &number_format_xml, 1);
    }
    if let Some(existing) = xml_named_segments(axis, "c:numFmt").into_iter().next() {
        return axis.replacen(&existing, &number_format_xml, 1);
    }
    for tag in ["c:majorUnit", "c:minorUnit", "c:delete", "c:axPos"] {
        if let Some(segment) = xml_named_empty_elements(axis, tag).into_iter().last() {
            return insert_after_segment(axis, &segment, &number_format_xml);
        }
        if let Some(segment) = xml_named_segments(axis, tag).into_iter().last() {
            return insert_after_segment(axis, &segment, &number_format_xml);
        }
    }
    insert_ooxml_axis_child(axis, axis_tag, &number_format_xml)
}

fn update_ooxml_axis_label_rotation(axis: &str, axis_tag: &str, rotation: f64) -> String {
    let rotation = (rotation.clamp(-90.0, 90.0) * 60_000.0).round() as i64;
    if let Some(text_properties) = xml_named_empty_elements(axis, "c:txPr").into_iter().next() {
        let replacement =
            format!(r#"<c:txPr><a:bodyPr rot="{rotation}"/><a:lstStyle/><a:p/></c:txPr>"#);
        return axis.replacen(&text_properties, &replacement, 1);
    }
    if let Some(text_properties) = xml_named_segments(axis, "c:txPr").into_iter().next() {
        let updated_text_properties =
            update_ooxml_axis_text_properties_rotation(&text_properties, rotation);
        return axis.replacen(&text_properties, &updated_text_properties, 1);
    }
    let text_properties =
        format!(r#"<c:txPr><a:bodyPr rot="{rotation}"/><a:lstStyle/><a:p/></c:txPr>"#);
    insert_ooxml_axis_late_child(axis, axis_tag, &text_properties)
}

fn update_ooxml_axis_text_properties_rotation(text_properties: &str, rotation: i64) -> String {
    if let Some(body_properties) = xml_named_empty_elements(text_properties, "a:bodyPr")
        .into_iter()
        .next()
    {
        let updated_body_properties = set_first_xml_tag_attrs(
            &body_properties,
            "<a:bodyPr",
            &[("rot", rotation.to_string())],
        );
        return text_properties.replacen(&body_properties, &updated_body_properties, 1);
    }
    if let Some(body_properties) = xml_named_segments(text_properties, "a:bodyPr")
        .into_iter()
        .next()
    {
        let updated_body_properties = set_first_xml_tag_attrs(
            &body_properties,
            "<a:bodyPr",
            &[("rot", rotation.to_string())],
        );
        return text_properties.replacen(&body_properties, &updated_body_properties, 1);
    }
    insert_after_start_tag(
        text_properties,
        "<c:txPr",
        &format!(r#"<a:bodyPr rot="{rotation}"/>"#),
    )
}

fn ooxml_valid_chart_axis_dash(value: &str) -> bool {
    matches!(value, "solid" | "dash" | "dot" | "dashDot")
}

fn update_ooxml_axis_label_style(
    axis: &str,
    axis_tag: &str,
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    if let Some(text_properties) = xml_named_empty_elements(axis, "c:txPr").into_iter().next() {
        let run_properties =
            build_ooxml_chart_axis_label_run_properties(text_color, font_size, bold, italic);
        let replacement = build_ooxml_chart_axis_text_properties(&run_properties);
        return axis.replacen(&text_properties, &replacement, 1);
    }
    if let Some(text_properties) = xml_named_segments(axis, "c:txPr").into_iter().next() {
        let updated_text_properties = update_ooxml_chart_axis_text_properties(
            &text_properties,
            text_color,
            font_size,
            bold,
            italic,
        );
        return axis.replacen(&text_properties, &updated_text_properties, 1);
    }
    let run_properties =
        build_ooxml_chart_axis_label_run_properties(text_color, font_size, bold, italic);
    let text_properties = build_ooxml_chart_axis_text_properties(&run_properties);
    insert_ooxml_axis_late_child(axis, axis_tag, &text_properties)
}

fn update_ooxml_chart_axis_text_properties(
    text_properties: &str,
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    if let Some(existing) = xml_named_empty_elements(text_properties, "a:defRPr")
        .into_iter()
        .next()
    {
        let updated_run_properties = update_ooxml_chart_axis_label_run_properties(
            &existing, text_color, font_size, bold, italic,
        );
        return text_properties.replacen(&existing, &updated_run_properties, 1);
    }
    if let Some(existing) = xml_named_segments(text_properties, "a:defRPr")
        .into_iter()
        .next()
    {
        let updated_run_properties = update_ooxml_chart_axis_label_run_properties(
            &existing, text_color, font_size, bold, italic,
        );
        return text_properties.replacen(&existing, &updated_run_properties, 1);
    }
    let run_properties =
        build_ooxml_chart_axis_label_run_properties(text_color, font_size, bold, italic);
    if let Some(paragraph_properties) = xml_named_empty_elements(text_properties, "a:pPr")
        .into_iter()
        .next()
    {
        let replacement = format!("<a:pPr>{run_properties}</a:pPr>");
        return text_properties.replacen(&paragraph_properties, &replacement, 1);
    }
    if let Some(paragraph_properties) = xml_named_segments(text_properties, "a:pPr")
        .into_iter()
        .next()
    {
        let updated_paragraph_properties =
            append_before_or_end(&paragraph_properties, "</a:pPr>", &run_properties);
        return text_properties.replacen(&paragraph_properties, &updated_paragraph_properties, 1);
    }
    if let Some(paragraph) = xml_named_segments(text_properties, "a:p")
        .into_iter()
        .next()
    {
        let replacement = insert_after_start_tag(
            &paragraph,
            "<a:p",
            &format!("<a:pPr>{run_properties}</a:pPr>"),
        );
        return text_properties.replacen(&paragraph, &replacement, 1);
    }
    append_before_or_end(
        text_properties,
        "</c:txPr>",
        &format!("<a:p><a:pPr>{run_properties}</a:pPr></a:p>"),
    )
}

fn build_ooxml_chart_axis_text_properties(run_properties: &str) -> String {
    format!("<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>{run_properties}</a:pPr></a:p></c:txPr>")
}

fn build_ooxml_chart_axis_label_run_properties(
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    update_ooxml_chart_axis_label_run_properties("<a:defRPr/>", text_color, font_size, bold, italic)
}

fn update_ooxml_chart_axis_label_run_properties(
    run_properties: &str,
    text_color: Option<&str>,
    font_size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    let mut updated = expand_ooxml_empty_def_rpr(run_properties);
    let mut attrs = Vec::new();
    if let Some(font_size) = font_size {
        attrs.push(("sz", (font_size * 100).to_string()));
    }
    if let Some(bold) = bold {
        attrs.push(("b", if bold { "1" } else { "0" }.to_string()));
    }
    if let Some(italic) = italic {
        attrs.push(("i", if italic { "1" } else { "0" }.to_string()));
    }
    if !attrs.is_empty() {
        updated = set_first_xml_tag_attrs(&updated, "<a:defRPr", &attrs);
    }
    if let Some(text_color) = text_color {
        let fill_xml = format!(
            r#"<a:solidFill><a:srgbClr val="{}"/></a:solidFill>"#,
            escape_xml(text_color)
        );
        updated = replace_ooxml_run_properties_fill(&updated, &fill_xml);
    }
    updated
}

fn expand_ooxml_empty_def_rpr(run_properties: &str) -> String {
    if !run_properties.trim_end().ends_with("/>") {
        return run_properties.to_string();
    }
    let trimmed = run_properties.trim_end();
    let prefix_len = trimmed.len().saturating_sub(2);
    let mut output = String::new();
    output.push_str(&trimmed[..prefix_len]);
    output.push('>');
    output.push_str("</a:defRPr>");
    output
}

fn replace_ooxml_run_properties_fill(run_properties: &str, fill_xml: &str) -> String {
    if run_properties.trim_end().ends_with("/>") {
        let trimmed = run_properties.trim_end();
        let prefix_len = trimmed.len().saturating_sub(2);
        let mut output = String::new();
        output.push_str(&trimmed[..prefix_len]);
        output.push('>');
        output.push_str(fill_xml);
        output.push_str("</a:defRPr>");
        return output;
    }
    if let Some(updated) = replace_xml_element(run_properties, "a:solidFill", fill_xml) {
        return updated;
    }
    let updated = replace_empty_xml_element(run_properties, "<a:solidFill", fill_xml);
    if updated == run_properties {
        append_before_or_end(run_properties, "</a:defRPr>", fill_xml)
    } else {
        updated
    }
}

fn insert_ooxml_axis_child(axis: &str, axis_tag: &str, child_xml: &str) -> String {
    for tag in ["c:spPr", "c:txPr", "c:crossAx", "c:crosses", "c:crossesAt"] {
        let marker = format!("<{tag}");
        if let Some(index) = find_xml_start(axis, &marker) {
            let mut output = String::new();
            output.push_str(&axis[..index]);
            output.push_str(child_xml);
            output.push_str(&axis[index..]);
            return output;
        }
    }
    append_before_or_end(axis, &format!("</{axis_tag}>"), child_xml)
}

fn insert_ooxml_axis_late_child(axis: &str, axis_tag: &str, child_xml: &str) -> String {
    for tag in ["c:crossAx", "c:crosses", "c:crossesAt"] {
        let marker = format!("<{tag}");
        if let Some(index) = find_xml_start(axis, &marker) {
            let mut output = String::new();
            output.push_str(&axis[..index]);
            output.push_str(child_xml);
            output.push_str(&axis[index..]);
            return output;
        }
    }
    append_before_or_end(axis, &format!("</{axis_tag}>"), child_xml)
}

fn insert_after_start_tag(xml: &str, marker: &str, insertion: &str) -> String {
    let Some(start) = find_xml_start(xml, marker) else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find('>') else {
        return xml.to_string();
    };
    let insert_at = start + end + 1;
    let mut output = String::new();
    output.push_str(&xml[..insert_at]);
    output.push_str(insertion);
    output.push_str(&xml[insert_at..]);
    output
}

fn remove_ooxml_axis_title(axis: &str) -> String {
    let mut output = axis.to_string();
    for title in xml_named_segments(axis, "c:title") {
        output = output.replacen(&title, "", 1);
    }
    output
}

fn insert_ooxml_axis_title(axis: &str, axis_tag: &str, title: &str) -> String {
    let title_xml = build_ooxml_chart_title(title);
    for tag in ["c:majorGridlines", "c:axPos", "c:scaling", "c:axId"] {
        if let Some(segment) = xml_named_empty_elements(axis, tag).into_iter().last() {
            return insert_after_segment(axis, &segment, &title_xml);
        }
        if let Some(segment) = xml_named_segments(axis, tag).into_iter().last() {
            return insert_after_segment(axis, &segment, &title_xml);
        }
    }
    append_before_or_end(axis, &format!("</{axis_tag}>"), &title_xml)
}

fn insert_after_segment(xml: &str, segment: &str, insertion: &str) -> String {
    let Some(index) = xml.find(segment) else {
        return xml.to_string();
    };
    let insert_at = index + segment.len();
    let mut output = String::new();
    output.push_str(&xml[..insert_at]);
    output.push_str(insertion);
    output.push_str(&xml[insert_at..]);
    output
}

fn ooxml_chart_tag_for_type(chart_type: &str) -> Option<&'static str> {
    match chart_type {
        "bar" => Some("c:barChart"),
        "line" => Some("c:lineChart"),
        "area" => Some("c:areaChart"),
        "pie" => Some("c:pieChart"),
        "doughnut" => Some("c:doughnutChart"),
        _ => None,
    }
}

fn ooxml_chart_axis_ids(chart: &str) -> Vec<String> {
    let mut ids = xml_named_empty_elements(chart, "c:axId")
        .into_iter()
        .filter_map(|axis| super::attr_value(&axis, "val"))
        .collect::<Vec<_>>();
    ids.dedup();
    if ids.len() < 2 {
        ids = vec!["123456".to_string(), "123457".to_string()];
    }
    ids
}

fn build_ooxml_chart_type_segment(tag: &str, series: &str, axis_ids: &[String]) -> String {
    match tag {
        "c:barChart" => format!(
            r#"<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>{series}<c:axId val="{}"/><c:axId val="{}"/></c:barChart>"#,
            escape_xml(&axis_ids[0]),
            escape_xml(&axis_ids[1])
        ),
        "c:lineChart" => format!(
            r#"<c:lineChart><c:grouping val="standard"/>{series}<c:axId val="{}"/><c:axId val="{}"/></c:lineChart>"#,
            escape_xml(&axis_ids[0]),
            escape_xml(&axis_ids[1])
        ),
        "c:areaChart" => format!(
            r#"<c:areaChart><c:grouping val="standard"/>{series}<c:axId val="{}"/><c:axId val="{}"/></c:areaChart>"#,
            escape_xml(&axis_ids[0]),
            escape_xml(&axis_ids[1])
        ),
        "c:doughnutChart" => {
            format!(r#"<c:doughnutChart>{series}<c:holeSize val="50"/></c:doughnutChart>"#)
        }
        _ => format!(r#"<c:pieChart>{series}</c:pieChart>"#),
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
