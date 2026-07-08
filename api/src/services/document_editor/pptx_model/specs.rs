use super::*;

pub(in crate::services::document_editor) fn pptx_text_specs(slide: &Value) -> Vec<PptxTextSpec> {
    slide
        .get("texts")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, item)| PptxTextSpec {
                    text: item
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    text_index: value_as_usize(item.get("textIndex")),
                    group_id: pptx_group_id_from_model(item),
                    x: item
                        .get("x")
                        .and_then(Value::as_f64)
                        .unwrap_or(10.0)
                        .clamp(0.0, 100.0),
                    y: item
                        .get("y")
                        .and_then(Value::as_f64)
                        .unwrap_or(12.0 + index as f64 * 18.0)
                        .clamp(0.0, 100.0),
                    width: item
                        .get("width")
                        .and_then(Value::as_f64)
                        .unwrap_or(80.0)
                        .clamp(1.0, 100.0),
                    height: item
                        .get("height")
                        .and_then(Value::as_f64)
                        .unwrap_or(10.0)
                        .clamp(1.0, 100.0),
                    rotation: normalize_degrees(
                        item.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
                    ),
                    font_size: item
                        .get("fontSize")
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse::<u32>().ok())
                        .unwrap_or(18)
                        .clamp(6, 96),
                    font_family: item
                        .get("fontFamily")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    color: item
                        .get("color")
                        .and_then(Value::as_str)
                        .and_then(docx_hex_color),
                    fill_color: item
                        .get("fillColor")
                        .and_then(Value::as_str)
                        .and_then(docx_hex_color),
                    bold: item.get("bold").and_then(Value::as_bool).unwrap_or(false),
                    italic: item.get("italic").and_then(Value::as_bool).unwrap_or(false),
                    underline: item
                        .get("underline")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    strikethrough: item
                        .get("strikethrough")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    align: item
                        .get("align")
                        .and_then(Value::as_str)
                        .and_then(pptx_alignment_value)
                        .map(str::to_string),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub(in crate::services::document_editor) fn pptx_table_specs(slide: &Value) -> Vec<PptxTableSpec> {
    slide
        .get("tables")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|table| {
            let rows = table
                .get("rows")
                .and_then(Value::as_array)?
                .iter()
                .map(|row| {
                    row.as_array()
                        .map(|cells| {
                            cells
                                .iter()
                                .map(|cell| {
                                    cell.as_str()
                                        .map(str::to_string)
                                        .unwrap_or_else(|| cell.to_string())
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>();
            if rows.is_empty() || rows.iter().all(Vec::is_empty) {
                return None;
            }
            Some(PptxTableSpec {
                text_index_start: value_as_usize(table.get("textIndexStart")),
                group_id: pptx_group_id_from_model(table),
                rows,
                cell_styles: pptx_table_cell_styles_from_model(table.get("cellStyles")),
                column_widths: pptx_table_dimensions_from_model(table.get("columnWidths")),
                row_heights: pptx_table_dimensions_from_model(table.get("rowHeights")),
                x: table
                    .get("x")
                    .and_then(Value::as_f64)
                    .unwrap_or(14.0)
                    .clamp(0.0, 100.0),
                y: table
                    .get("y")
                    .and_then(Value::as_f64)
                    .unwrap_or(28.0)
                    .clamp(0.0, 100.0),
                width: table
                    .get("width")
                    .and_then(Value::as_f64)
                    .unwrap_or(60.0)
                    .clamp(1.0, 100.0),
                height: table
                    .get("height")
                    .and_then(Value::as_f64)
                    .unwrap_or(28.0)
                    .clamp(1.0, 100.0),
                rotation: normalize_degrees(
                    table.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
                ),
                table_style_id: pptx_table_style_id_from_model(table.get("tableStyleId")),
                first_row: table
                    .get("firstRow")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                first_column: table
                    .get("firstColumn")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                last_row: table
                    .get("lastRow")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                last_column: table
                    .get("lastColumn")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                banded_rows: table
                    .get("bandedRows")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                banded_columns: table
                    .get("bandedColumns")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_table_cell_styles_from_model(
    value: Option<&Value>,
) -> Vec<Vec<PptxTableCellStyle>> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|row| {
            row.as_array()
                .into_iter()
                .flatten()
                .map(pptx_table_cell_style_from_model)
                .collect::<Vec<_>>()
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_table_cell_style_from_model(
    value: &Value,
) -> PptxTableCellStyle {
    PptxTableCellStyle {
        fill_color: value
            .get("fillColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        text_color: value
            .get("textColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color),
        bold: value.get("bold").and_then(Value::as_bool),
        italic: value.get("italic").and_then(Value::as_bool),
        align: value
            .get("align")
            .and_then(Value::as_str)
            .and_then(pptx_alignment_value)
            .map(str::to_string),
    }
}

pub(in crate::services::document_editor) fn pptx_table_dimensions_from_model(
    value: Option<&Value>,
) -> Vec<f64> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(1.0, 100.0))
        .collect()
}

pub(in crate::services::document_editor) fn pptx_table_style_id_from_model(
    value: Option<&Value>,
) -> Option<String> {
    let style_id = value?.as_str()?.trim();
    if style_id.is_empty() || style_id.len() > 128 {
        return None;
    }
    Some(style_id.to_string())
}

pub(in crate::services::document_editor) fn apply_pptx_text_replacements(
    texts: &mut [String],
    specs: &[PptxTextSpec],
) {
    let mut fallback_index = 0usize;
    for spec in specs {
        let text_index = spec.text_index.unwrap_or_else(|| {
            let current = fallback_index;
            fallback_index += 1;
            current
        });
        if let Some(slot) = texts.get_mut(text_index) {
            *slot = spec.text.clone();
        }
    }
}

pub(in crate::services::document_editor) fn apply_pptx_table_replacements(
    texts: &mut [String],
    specs: &[PptxTableSpec],
) {
    for spec in specs {
        let Some(text_index_start) = spec.text_index_start else {
            continue;
        };
        let mut offset = 0usize;
        for row in &spec.rows {
            for cell in row {
                if let Some(slot) = texts.get_mut(text_index_start + offset) {
                    *slot = cell.clone();
                }
                offset += 1;
            }
        }
    }
}

pub(in crate::services::document_editor) fn pptx_image_specs(slide: &Value) -> Vec<PptxImageSpec> {
    slide
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|image| PptxImageSpec {
            relationship_id: image
                .get("relationshipId")
                .and_then(Value::as_str)
                .map(str::to_string),
            data_url: image
                .get("dataUrl")
                .and_then(Value::as_str)
                .map(str::to_string),
            group_id: pptx_group_id_from_model(image),
            x: image
                .get("x")
                .and_then(Value::as_f64)
                .unwrap_or(10.0)
                .clamp(0.0, 100.0),
            y: image
                .get("y")
                .and_then(Value::as_f64)
                .unwrap_or(12.0)
                .clamp(0.0, 100.0),
            width: image
                .get("width")
                .and_then(Value::as_f64)
                .unwrap_or(30.0)
                .clamp(1.0, 100.0),
            height: image
                .get("height")
                .and_then(Value::as_f64)
                .unwrap_or(30.0)
                .clamp(1.0, 100.0),
            rotation: normalize_degrees(
                image.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
            ),
            crop_left: pptx_crop_percent_from_model(image, "imageCropLeft"),
            crop_top: pptx_crop_percent_from_model(image, "imageCropTop"),
            crop_right: pptx_crop_percent_from_model(image, "imageCropRight"),
            crop_bottom: pptx_crop_percent_from_model(image, "imageCropBottom"),
            alt_text: image
                .get("altText")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_background_image_specs(
    slide: &Value,
) -> Vec<PptxImageSpec> {
    if slide.get("backgroundKind").and_then(Value::as_str) != Some("image") {
        return Vec::new();
    }
    vec![PptxImageSpec {
        relationship_id: slide
            .get("backgroundImageRelationshipId")
            .and_then(Value::as_str)
            .map(str::to_string),
        data_url: slide
            .get("backgroundImageDataUrl")
            .and_then(Value::as_str)
            .map(str::to_string),
        group_id: None,
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 100.0,
        rotation: 0.0,
        crop_left: 0.0,
        crop_top: 0.0,
        crop_right: 0.0,
        crop_bottom: 0.0,
        alt_text: None,
    }]
}

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

pub(in crate::services::document_editor) fn pptx_media_specs(slide: &Value) -> Vec<PptxMediaSpec> {
    slide
        .get("media")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|media| PptxMediaSpec {
            timing_index: value_as_usize(media.get("timingIndex")),
            volume_percent: media
                .get("volumePercent")
                .and_then(Value::as_f64)
                .map(|value| value.clamp(0.0, 100.0)),
            muted: media.get("muted").and_then(Value::as_bool),
            show_when_stopped: media.get("showWhenStopped").and_then(Value::as_bool),
            delay_ms: media
                .get("delayMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
            duration_ms: media
                .get("durationMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_background_spec(
    slide: &Value,
    background_image: Option<&PptxImageSpec>,
) -> Option<PptxBackgroundSpec> {
    let kind = slide
        .get("backgroundKind")
        .and_then(Value::as_str)
        .unwrap_or("solid");
    if kind == "gradient" {
        let start_color = slide
            .get("backgroundGradientStart")
            .and_then(Value::as_str)
            .and_then(docx_hex_color)?;
        let end_color = slide
            .get("backgroundGradientEnd")
            .and_then(Value::as_str)
            .and_then(docx_hex_color)?;
        let angle = normalize_degrees(
            slide
                .get("backgroundGradientAngle")
                .and_then(Value::as_f64)
                .unwrap_or(90.0),
        );
        return Some(PptxBackgroundSpec::Gradient {
            start_color,
            end_color,
            angle,
        });
    }
    if kind == "solid" {
        return slide
            .get("backgroundColor")
            .and_then(Value::as_str)
            .and_then(docx_hex_color)
            .map(PptxBackgroundSpec::Solid);
    }
    if kind == "image" {
        return background_image
            .and_then(|image| image.relationship_id.as_deref())
            .filter(|relationship_id| !relationship_id.trim().is_empty())
            .map(|relationship_id| PptxBackgroundSpec::Image {
                relationship_id: relationship_id.to_string(),
            });
    }
    None
}

pub(in crate::services::document_editor) fn pptx_transition_spec(
    slide: &Value,
) -> Option<PptxTransitionSpec> {
    let transition = slide.get("transition")?;
    Some(PptxTransitionSpec {
        kind: transition
            .get("type")
            .and_then(Value::as_str)
            .filter(|value| valid_pptx_transition_kind(value))
            .unwrap_or("none")
            .to_string(),
        speed: transition
            .get("speed")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "fast" | "med" | "slow"))
            .map(str::to_string),
        direction: transition
            .get("direction")
            .and_then(Value::as_str)
            .filter(|value| valid_pptx_transition_direction(value))
            .map(str::to_string),
        advance_on_click: transition
            .get("advanceOnClick")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        advance_after_ms: transition
            .get("advanceAfterMs")
            .and_then(Value::as_u64)
            .map(|value| value.min(600_000) as u32),
    })
}

pub(in crate::services::document_editor) fn pptx_animation_specs(
    slide: &Value,
) -> Vec<PptxAnimationSpec> {
    slide
        .get("animations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|animation| PptxAnimationSpec {
            source_xml: animation
                .get("sourceXml")
                .and_then(Value::as_str)
                .filter(|source| source.starts_with("<p:cTn"))
                .map(str::to_string),
            delay_ms: animation
                .get("delayMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
            duration_ms: animation
                .get("durationMs")
                .and_then(Value::as_u64)
                .map(|value| value.min(600_000) as u32),
        })
        .collect()
}

pub(in crate::services::document_editor) fn valid_pptx_transition_kind(value: &str) -> bool {
    matches!(
        value,
        "none" | "fade" | "push" | "wipe" | "split" | "cut" | "cover" | "uncover" | "zoom"
    )
}

pub(in crate::services::document_editor) fn valid_pptx_transition_direction(value: &str) -> bool {
    matches!(
        value,
        "l" | "r" | "u" | "d" | "lu" | "ru" | "ld" | "rd" | "in" | "out" | "horz" | "vert"
    )
}

pub(in crate::services::document_editor) fn value_as_usize(value: Option<&Value>) -> Option<usize> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

pub(in crate::services::document_editor) fn pptx_group_id_from_model(
    value: &Value,
) -> Option<String> {
    let group_id = value.get("groupId")?.as_str()?.trim();
    if !pptx_valid_group_id(group_id) {
        return None;
    }
    Some(group_id.to_string())
}

pub(in crate::services::document_editor) fn pptx_shape_specs(slide: &Value) -> Vec<PptxShapeSpec> {
    slide
        .get("shapes")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let kind = item
                        .get("kind")
                        .and_then(Value::as_str)
                        .and_then(PptxShapeKind::from_value)?;
                    let default_height = if kind.is_line_like() { 0.0 } else { 20.0 };
                    let min_height = if kind.is_line_like() { 0.0 } else { 1.0 };
                    Some(PptxShapeSpec {
                        kind,
                        group_id: pptx_group_id_from_model(item),
                        x: item
                            .get("x")
                            .and_then(Value::as_f64)
                            .unwrap_or(24.0)
                            .clamp(0.0, 100.0),
                        y: item
                            .get("y")
                            .and_then(Value::as_f64)
                            .unwrap_or(34.0)
                            .clamp(0.0, 100.0),
                        width: item
                            .get("width")
                            .and_then(Value::as_f64)
                            .unwrap_or(26.0)
                            .clamp(1.0, 100.0),
                        height: item
                            .get("height")
                            .and_then(Value::as_f64)
                            .unwrap_or(default_height)
                            .clamp(min_height, 100.0),
                        rotation: normalize_degrees(
                            item.get("rotation").and_then(Value::as_f64).unwrap_or(0.0),
                        ),
                        fill_color: item
                            .get("fillColor")
                            .and_then(Value::as_str)
                            .and_then(docx_hex_color),
                        stroke_color: item
                            .get("strokeColor")
                            .and_then(Value::as_str)
                            .and_then(docx_hex_color),
                        stroke_width: item
                            .get("strokeWidth")
                            .and_then(Value::as_f64)
                            .unwrap_or(2.0)
                            .clamp(0.0, 72.0),
                        line_start_arrow: pptx_line_arrow_from_model(item, "lineStartArrow"),
                        line_end_arrow: pptx_line_arrow_from_model(item, "lineEndArrow"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub(in crate::services::document_editor) fn pptx_line_arrow_from_model(
    value: &Value,
    key: &str,
) -> Option<PptxLineArrowKind> {
    value
        .get(key)
        .and_then(Value::as_str)
        .and_then(PptxLineArrowKind::from_value)
}
