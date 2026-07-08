use super::*;

pub(in crate::services::document_editor) fn pptx_chart_specs(slide: &Value) -> Vec<PptxChartSpec> {
    slide
        .get("charts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|chart| PptxChartSpec {
            relationship_id: chart
                .get("relationshipId")
                .and_then(Value::as_str)
                .map(str::to_string),
            path: chart
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_string),
            group_id: pptx_group_id_from_model(chart),
            chart_type: chart
                .get("type")
                .and_then(Value::as_str)
                .and_then(pptx_chart_type_from_model)
                .map(str::to_string),
            title: chart
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_string),
            legend_visible: chart.get("legendVisible").and_then(Value::as_bool),
            legend_position: chart
                .get("legendPosition")
                .and_then(Value::as_str)
                .and_then(pptx_chart_legend_position_from_model)
                .map(str::to_string),
            category_axis: pptx_chart_axis_spec(
                chart,
                &PPTX_CATEGORY_AXIS_MODEL_KEYS,
                pptx_chart_category_axis_position_from_model,
            ),
            value_axis: pptx_chart_axis_spec(
                chart,
                &PPTX_VALUE_AXIS_MODEL_KEYS,
                pptx_chart_value_axis_position_from_model,
            ),
            series: ooxml_chart_series_specs(chart),
            x: chart
                .get("x")
                .and_then(Value::as_f64)
                .unwrap_or(18.0)
                .clamp(0.0, 100.0),
            y: chart
                .get("y")
                .and_then(Value::as_f64)
                .unwrap_or(18.0)
                .clamp(0.0, 100.0),
            width: chart
                .get("width")
                .and_then(Value::as_f64)
                .unwrap_or(58.0)
                .clamp(1.0, 100.0),
            height: chart
                .get("height")
                .and_then(Value::as_f64)
                .unwrap_or(44.0)
                .clamp(1.0, 100.0),
            rotation: normalize_degrees(
                chart.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
            ),
        })
        .collect()
}

pub(super) struct PptxChartAxisModelKeys {
    pub(super) title: &'static str,
    pub(super) position: &'static str,
    pub(super) major_gridlines: &'static str,
    pub(super) tick_label_position: &'static str,
    pub(super) major_tick_mark: &'static str,
    pub(super) minor_tick_mark: &'static str,
    pub(super) number_format: &'static str,
    pub(super) line_color: &'static str,
    pub(super) line_width: &'static str,
    pub(super) line_dash: &'static str,
    pub(super) label_text_color: &'static str,
    pub(super) label_font_size: &'static str,
    pub(super) label_rotation: &'static str,
    pub(super) label_bold: &'static str,
    pub(super) label_italic: &'static str,
}

const PPTX_CATEGORY_AXIS_MODEL_KEYS: PptxChartAxisModelKeys = PptxChartAxisModelKeys {
    title: "categoryAxisTitle",
    position: "categoryAxisPosition",
    major_gridlines: "categoryMajorGridlines",
    tick_label_position: "categoryAxisTickLabelPosition",
    major_tick_mark: "categoryAxisMajorTickMark",
    minor_tick_mark: "categoryAxisMinorTickMark",
    number_format: "categoryAxisNumberFormat",
    line_color: "categoryAxisLineColor",
    line_width: "categoryAxisLineWidth",
    line_dash: "categoryAxisLineDash",
    label_text_color: "categoryAxisLabelTextColor",
    label_font_size: "categoryAxisLabelFontSize",
    label_rotation: "categoryAxisLabelRotation",
    label_bold: "categoryAxisLabelBold",
    label_italic: "categoryAxisLabelItalic",
};

const PPTX_VALUE_AXIS_MODEL_KEYS: PptxChartAxisModelKeys = PptxChartAxisModelKeys {
    title: "valueAxisTitle",
    position: "valueAxisPosition",
    major_gridlines: "valueMajorGridlines",
    tick_label_position: "valueAxisTickLabelPosition",
    major_tick_mark: "valueAxisMajorTickMark",
    minor_tick_mark: "valueAxisMinorTickMark",
    number_format: "valueAxisNumberFormat",
    line_color: "valueAxisLineColor",
    line_width: "valueAxisLineWidth",
    line_dash: "valueAxisLineDash",
    label_text_color: "valueAxisLabelTextColor",
    label_font_size: "valueAxisLabelFontSize",
    label_rotation: "valueAxisLabelRotation",
    label_bold: "valueAxisLabelBold",
    label_italic: "valueAxisLabelItalic",
};

pub(super) fn pptx_chart_axis_spec(
    chart: &Value,
    keys: &PptxChartAxisModelKeys,
    position_from_model: fn(&str) -> Option<&'static str>,
) -> PptxChartAxisSpec {
    PptxChartAxisSpec {
        title: chart
            .get(keys.title)
            .and_then(Value::as_str)
            .map(str::to_string),
        position: chart
            .get(keys.position)
            .and_then(Value::as_str)
            .and_then(position_from_model)
            .map(str::to_string),
        major_gridlines: chart.get(keys.major_gridlines).and_then(Value::as_bool),
        tick_label_position: chart
            .get(keys.tick_label_position)
            .and_then(Value::as_str)
            .and_then(pptx_chart_axis_tick_label_position_from_model)
            .map(str::to_string),
        major_tick_mark: chart
            .get(keys.major_tick_mark)
            .and_then(Value::as_str)
            .and_then(pptx_chart_axis_tick_mark_from_model)
            .map(str::to_string),
        minor_tick_mark: chart
            .get(keys.minor_tick_mark)
            .and_then(Value::as_str)
            .and_then(pptx_chart_axis_tick_mark_from_model)
            .map(str::to_string),
        number_format: chart
            .get(keys.number_format)
            .and_then(Value::as_str)
            .and_then(pptx_chart_axis_number_format_from_model),
        line_color: chart
            .get(keys.line_color)
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        line_width: chart
            .get(keys.line_width)
            .and_then(Value::as_f64)
            .map(|value| value.clamp(0.0, 72.0)),
        line_dash: chart
            .get(keys.line_dash)
            .and_then(Value::as_str)
            .and_then(pptx_chart_axis_line_dash_from_model)
            .map(str::to_string),
        label_text_color: chart
            .get(keys.label_text_color)
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        label_font_size: chart
            .get(keys.label_font_size)
            .and_then(Value::as_u64)
            .map(|value| value.clamp(6, 72) as u32),
        label_rotation: chart
            .get(keys.label_rotation)
            .and_then(Value::as_f64)
            .map(|value| value.clamp(-90.0, 90.0)),
        label_bold: chart.get(keys.label_bold).and_then(Value::as_bool),
        label_italic: chart.get(keys.label_italic).and_then(Value::as_bool),
    }
}

pub(in crate::services::document_editor) fn pptx_chart_type_from_model(
    value: &str,
) -> Option<&'static str> {
    match value {
        "bar" => Some("bar"),
        "line" => Some("line"),
        "area" => Some("area"),
        "pie" => Some("pie"),
        "doughnut" => Some("doughnut"),
        _ => None,
    }
}

pub(in crate::services::document_editor) fn pptx_chart_legend_position_from_model(
    value: &str,
) -> Option<&'static str> {
    match value {
        "r" => Some("r"),
        "l" => Some("l"),
        "t" => Some("t"),
        "b" => Some("b"),
        "tr" => Some("tr"),
        _ => None,
    }
}

pub(in crate::services::document_editor) fn pptx_chart_category_axis_position_from_model(
    value: &str,
) -> Option<&'static str> {
    match value {
        "b" => Some("b"),
        "t" => Some("t"),
        _ => None,
    }
}

pub(in crate::services::document_editor) fn pptx_chart_value_axis_position_from_model(
    value: &str,
) -> Option<&'static str> {
    match value {
        "l" => Some("l"),
        "r" => Some("r"),
        _ => None,
    }
}

pub(in crate::services::document_editor) fn pptx_chart_axis_tick_label_position_from_model(
    value: &str,
) -> Option<&'static str> {
    match value {
        "nextTo" => Some("nextTo"),
        "low" => Some("low"),
        "high" => Some("high"),
        "none" => Some("none"),
        _ => None,
    }
}

pub(in crate::services::document_editor) fn pptx_chart_axis_tick_mark_from_model(
    value: &str,
) -> Option<&'static str> {
    match value {
        "cross" => Some("cross"),
        "in" => Some("in"),
        "out" => Some("out"),
        "none" => Some("none"),
        _ => None,
    }
}

pub(in crate::services::document_editor) fn pptx_chart_axis_line_dash_from_model(
    value: &str,
) -> Option<&'static str> {
    match value {
        "solid" => Some("solid"),
        "dash" => Some("dash"),
        "dot" => Some("dot"),
        "dashDot" => Some("dashDot"),
        _ => None,
    }
}

pub(in crate::services::document_editor) fn pptx_chart_axis_number_format_from_model(
    value: &str,
) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || value.chars().any(|ch| ch.is_control()) {
        return None;
    }
    Some(value.to_string())
}
