use super::super::{
    append_before_or_end, attr_value, docx_hex_color, escape_xml, extract_text_tags,
    find_xml_start, xml_named_empty_elements, xml_named_segments,
};
use super::build_ooxml_chart_title;

mod label;

pub(in crate::services::document_editor) use label::*;

pub(in crate::services::document_editor) fn ooxml_chart_axis_title(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
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

pub(in crate::services::document_editor) fn ooxml_chart_axis_position(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
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

pub(in crate::services::document_editor) fn ooxml_chart_axis_major_gridlines_visible(
    chart_xml: &str,
    axis_tag: &str,
) -> bool {
    xml_named_segments(chart_xml, axis_tag)
        .into_iter()
        .next()
        .is_some_and(|axis| {
            !xml_named_empty_elements(&axis, "c:majorGridlines").is_empty()
                || !xml_named_segments(&axis, "c:majorGridlines").is_empty()
        })
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_tick_label_position(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
    ooxml_chart_axis_empty_value(chart_xml, axis_tag, "c:tickLblPos")
        .filter(|value| matches!(value.as_str(), "nextTo" | "low" | "high" | "none"))
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_major_tick_mark(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
    ooxml_chart_axis_tick_mark(chart_xml, axis_tag, "c:majorTickMark")
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_minor_tick_mark(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
    ooxml_chart_axis_tick_mark(chart_xml, axis_tag, "c:minorTickMark")
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_line_color(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let shape_properties = ooxml_segment_or_empty(&axis, "c:spPr")?;
    let line = ooxml_segment_or_empty(&shape_properties, "a:ln")?;
    ooxml_first_srgb_color(&line)
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_line_width(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<f64> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let shape_properties = ooxml_segment_or_empty(&axis, "c:spPr")?;
    let line = ooxml_segment_or_empty(&shape_properties, "a:ln")?;
    attr_value(&line, "w")
        .and_then(|value| value.parse::<f64>().ok())
        .map(|emu| (emu / 12_700.0).clamp(0.0, 72.0))
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_line_dash(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    let shape_properties = ooxml_segment_or_empty(&axis, "c:spPr")?;
    let line = ooxml_segment_or_empty(&shape_properties, "a:ln")?;
    ooxml_segment_or_empty(&line, "a:prstDash")
        .and_then(|dash| attr_value(&dash, "val"))
        .filter(|value| ooxml_valid_chart_axis_dash(value))
        .or_else(|| Some("solid".to_string()))
}

pub(in crate::services::document_editor) fn ooxml_chart_axis_number_format(
    chart_xml: &str,
    axis_tag: &str,
) -> Option<String> {
    let axis = ooxml_chart_axis(chart_xml, axis_tag)?;
    xml_named_empty_elements(&axis, "c:numFmt")
        .into_iter()
        .next()
        .and_then(|format| attr_value(&format, "formatCode"))
        .filter(|format| !format.trim().is_empty())
}

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_title(
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

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_position(
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

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_major_gridlines(
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

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_tick_label_position(
    xml: &str,
    axis_tag: &str,
    position: &str,
) -> String {
    update_ooxml_chart_axis_empty_value(xml, axis_tag, "c:tickLblPos", position)
}

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_major_tick_mark(
    xml: &str,
    axis_tag: &str,
    mark: &str,
) -> String {
    update_ooxml_chart_axis_empty_value(xml, axis_tag, "c:majorTickMark", mark)
}

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_minor_tick_mark(
    xml: &str,
    axis_tag: &str,
    mark: &str,
) -> String {
    update_ooxml_chart_axis_empty_value(xml, axis_tag, "c:minorTickMark", mark)
}

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_line_color(
    xml: &str,
    axis_tag: &str,
    color: &str,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_line_style(&axis, axis_tag, Some(color), None, None);
    xml.replacen(&axis, &updated_axis, 1)
}

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_line_width(
    xml: &str,
    axis_tag: &str,
    width: f64,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_line_style(&axis, axis_tag, None, Some(width), None);
    xml.replacen(&axis, &updated_axis, 1)
}

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_line_dash(
    xml: &str,
    axis_tag: &str,
    dash: &str,
) -> String {
    let Some(axis) = xml_named_segments(xml, axis_tag).into_iter().next() else {
        return xml.to_string();
    };
    let updated_axis = update_ooxml_axis_line_style(&axis, axis_tag, None, None, Some(dash));
    xml.replacen(&axis, &updated_axis, 1)
}

pub(in crate::services::document_editor) fn update_ooxml_chart_axis_number_format(
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

fn ooxml_valid_chart_axis_dash(value: &str) -> bool {
    matches!(value, "solid" | "dash" | "dot" | "dashDot")
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
