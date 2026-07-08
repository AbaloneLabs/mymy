use super::{
    append_before_or_end, attr_value, escape_xml, extract_text_tags, replace_xml_element,
    xml_named_empty_elements, xml_named_segments,
};

mod axis;
mod series;

pub(in crate::services::document_editor) use axis::*;
pub(in crate::services::document_editor) use series::*;

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

fn build_ooxml_chart_title(title: &str) -> String {
    format!(
        r#"<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></c:rich></c:tx></c:title>"#,
        escape_xml(title)
    )
}
