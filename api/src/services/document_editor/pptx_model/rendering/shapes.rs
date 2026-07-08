use super::*;

pub(in crate::services::document_editor) fn build_pptx_basic_shape_for_size(
    shape_id: usize,
    spec: &PptxShapeSpec,
    slide_size: PptxSlideSize,
) -> String {
    let (x, y, width, height) = pptx_shape_geometry_emu_for_size(spec, slide_size);
    let rotation = pptx_rotation_unit(spec.rotation);
    let fill = if spec.kind.is_line_like() {
        "<a:noFill/>".to_string()
    } else {
        pptx_shape_fill_xml(spec.fill_color.as_deref())
    };
    let line = pptx_line_xml(
        spec.stroke_color.as_deref(),
        spec.stroke_width,
        if spec.kind.is_line_like() {
            spec.line_start_arrow
        } else {
            None
        },
        if spec.kind.is_line_like() {
            spec.line_end_arrow
        } else {
            None
        },
    );
    let preset = spec.kind.as_value();
    if spec.kind.is_connector() {
        return format!(
            r#"<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="{shape_id}" name="Connector {shape_id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="{preset}"><a:avLst/></a:prstGeom>{fill}{line}</p:spPr></p:cxnSp>"#
        );
    }
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="Shape {shape_id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="{preset}"><a:avLst/></a:prstGeom>{fill}{line}</p:spPr></p:sp>"#
    )
}

pub(in crate::services::document_editor) fn pptx_line_xml(
    stroke_color: Option<&str>,
    stroke_width: f64,
    start_arrow: Option<PptxLineArrowKind>,
    end_arrow: Option<PptxLineArrowKind>,
) -> String {
    let width = (stroke_width.clamp(0.0, 72.0) * 12_700.0).round() as i64;
    let fill = stroke_color
        .map(|color| format!(r#"<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>"#))
        .unwrap_or_else(|| "<a:noFill/>".to_string());
    let tail_end = start_arrow
        .map(|kind| format!(r#"<a:tailEnd type="{}"/>"#, kind.as_value()))
        .unwrap_or_default();
    let head_end = end_arrow
        .map(|kind| format!(r#"<a:headEnd type="{}"/>"#, kind.as_value()))
        .unwrap_or_default();
    format!(r#"<a:ln w="{width}">{fill}{tail_end}{head_end}</a:ln>"#)
}

pub(in crate::services::document_editor) fn build_pptx_text_shape_for_size(
    shape_id: usize,
    spec: &PptxTextSpec,
    slide_size: PptxSlideSize,
) -> String {
    let (x, y, width, height) = pptx_geometry_emu_for_size(spec, slide_size);
    let rotation = pptx_rotation_unit(spec.rotation);
    let shape_fill = pptx_shape_fill_xml(spec.fill_color.as_deref());
    let run_properties = pptx_run_properties_xml("a:rPr", spec);
    let end_properties = pptx_run_properties_xml("a:endParaRPr", spec);
    let paragraph_properties = spec
        .align
        .as_deref()
        .map(|align| format!(r#"<a:pPr algn="{align}"/>"#))
        .unwrap_or_default();
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="TextBox {shape_id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{shape_fill}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/><a:p>{paragraph_properties}<a:r>{run_properties}<a:t>{}</a:t></a:r>{end_properties}</a:p></p:txBody></p:sp>"#,
        escape_xml(&spec.text)
    )
}

pub(in crate::services::document_editor) fn pptx_run_properties_xml(
    tag: &str,
    spec: &PptxTextSpec,
) -> String {
    let size = spec.font_size * 100;
    let bold = if spec.bold { r#" b="1""# } else { "" };
    let italic = if spec.italic { r#" i="1""# } else { "" };
    let underline = if spec.underline { r#" u="sng""# } else { "" };
    let strikethrough = if spec.strikethrough {
        r#" strike="sngStrike""#
    } else {
        ""
    };
    let latin_font = spec
        .font_family
        .as_deref()
        .map(escape_xml)
        .map(|font| format!(r#"<a:latin typeface="{font}"/>"#))
        .unwrap_or_default();
    let color = spec
        .color
        .as_deref()
        .map(|color| format!(r#"<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>"#))
        .unwrap_or_default();
    format!(
        r#"<{tag} lang="en-US" sz="{size}"{bold}{italic}{underline}{strikethrough}>{latin_font}{color}</{tag}>"#
    )
}

pub(in crate::services::document_editor) fn pptx_alignment_value(
    value: &str,
) -> Option<&'static str> {
    match value {
        "left" => Some("l"),
        "center" => Some("ctr"),
        "right" => Some("r"),
        _ => None,
    }
}

pub(in crate::services::document_editor) fn pptx_shape_fill_xml(
    fill_color: Option<&str>,
) -> String {
    fill_color
        .map(|color| format!(r#"<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>"#))
        .unwrap_or_else(|| "<a:noFill/>".to_string())
}

pub(in crate::services::document_editor) fn update_pptx_shape_geometries_for_size(
    xml: &str,
    specs: &[PptxTextSpec],
    slide_size: PptxSlideSize,
) -> String {
    let mut output = String::new();
    let mut rest = xml;
    let mut text_shape_index = 0usize;
    while let Some(start) = rest.find("<p:sp") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:sp>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:sp>".len();
        let shape = &after_start[..end_index];
        if shape.contains("<a:t") {
            if let Some(spec) = specs.get(text_shape_index) {
                output.push_str(&replace_pptx_shape_geometry(shape, spec, slide_size));
            } else {
                output.push_str(shape);
            }
            text_shape_index += 1;
        } else {
            output.push_str(shape);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn replace_pptx_shape_geometry(
    shape: &str,
    spec: &PptxTextSpec,
    slide_size: PptxSlideSize,
) -> String {
    let (x, y, width, height) = pptx_geometry_emu_for_size(spec, slide_size);
    let shape = replace_empty_xml_element(shape, "<a:off", &format!(r#"<a:off x="{x}" y="{y}"/>"#));
    let shape = replace_empty_xml_element(
        &shape,
        "<a:ext",
        &format!(r#"<a:ext cx="{width}" cy="{height}"/>"#),
    );
    let shape = set_xml_start_attr(
        &shape,
        "<a:xfrm",
        "rot",
        &pptx_rotation_unit(spec.rotation).to_string(),
    );
    let shape = replace_pptx_run_properties(&shape, spec);
    replace_pptx_shape_fill(&shape, spec)
}

pub(in crate::services::document_editor) fn replace_pptx_run_properties(
    shape: &str,
    spec: &PptxTextSpec,
) -> String {
    let run_properties = pptx_run_properties_xml("a:rPr", spec);
    let end_properties = pptx_run_properties_xml("a:endParaRPr", spec);
    let shape = replace_xml_element(shape, "a:rPr", &run_properties)
        .unwrap_or_else(|| replace_empty_xml_element(shape, "<a:rPr", &run_properties));
    replace_xml_element(&shape, "a:endParaRPr", &end_properties)
        .unwrap_or_else(|| replace_empty_xml_element(&shape, "<a:endParaRPr", &end_properties))
}

pub(in crate::services::document_editor) fn replace_pptx_shape_fill(
    shape: &str,
    spec: &PptxTextSpec,
) -> String {
    let fill = pptx_shape_fill_xml(spec.fill_color.as_deref());
    if let Some(start) = shape.find("<p:spPr") {
        let after_start = &shape[start..];
        if let Some(end) = after_start.find("</p:spPr>") {
            let sppr_end = start + end + "</p:spPr>".len();
            let sppr = &shape[start..sppr_end];
            let updated_sppr = replace_xml_element(sppr, "a:solidFill", &fill)
                .unwrap_or_else(|| replace_empty_xml_element(sppr, "<a:noFill", &fill));
            let mut output = String::new();
            output.push_str(&shape[..start]);
            output.push_str(&updated_sppr);
            output.push_str(&shape[sppr_end..]);
            return output;
        }
    }
    shape.to_string()
}

pub(in crate::services::document_editor) fn set_xml_start_attr(
    xml: &str,
    marker: &str,
    attr: &str,
    value: &str,
) -> String {
    let Some(start) = xml.find(marker) else {
        return xml.to_string();
    };
    let after_start = &xml[start..];
    let Some(end) = after_start.find('>') else {
        return xml.to_string();
    };
    let tag_end = start + end;
    let start_tag = &xml[start..tag_end];
    let attr_prefix = format!("{attr}=");
    let next_tag = if let Some(attr_start) = start_tag.find(&attr_prefix) {
        let absolute_attr_start = start + attr_start;
        let quote_index = absolute_attr_start + attr_prefix.len();
        let Some(quote) = xml[quote_index..].chars().next() else {
            return xml.to_string();
        };
        if quote != '"' && quote != '\'' {
            return xml.to_string();
        }
        let value_start = quote_index + quote.len_utf8();
        let Some(value_end_offset) = xml[value_start..tag_end].find(quote) else {
            return xml.to_string();
        };
        let value_end = value_start + value_end_offset;
        format!(
            "{}{}{}",
            &xml[start..value_start],
            escape_xml(value),
            &xml[value_end..tag_end]
        )
    } else {
        format!("{start_tag} {attr}=\"{}\"", escape_xml(value))
    };
    format!("{}{}{}", &xml[..start], next_tag, &xml[tag_end..])
}
