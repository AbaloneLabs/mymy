use super::*;

mod charts;
mod images;
mod shapes;
mod tables;
mod timing;

pub(in crate::services::document_editor) use charts::*;
pub(in crate::services::document_editor) use images::*;
pub(in crate::services::document_editor) use shapes::*;
pub(in crate::services::document_editor) use tables::*;
pub(in crate::services::document_editor) use timing::*;

pub(in crate::services::document_editor) fn build_pptx_slide_for_size(
    texts: &[PptxTextSpec],
    basic_shapes: &[PptxShapeSpec],
    tables: &[PptxTableSpec],
    images: &[PptxImageSpec],
    charts: &[PptxChartSpec],
    background: Option<&PptxBackgroundSpec>,
    slide_size: PptxSlideSize,
) -> String {
    let mut objects = Vec::new();
    objects.extend(
        basic_shapes
            .iter()
            .enumerate()
            .map(|(index, shape)| pptx_basic_shape_renderable(index + 2, shape, slide_size)),
    );
    objects.extend(texts.iter().enumerate().map(|(index, text)| {
        pptx_text_renderable(basic_shapes.len() + index + 2, text, slide_size)
    }));
    objects.extend(
        tables
            .iter()
            .enumerate()
            .map(|(index, table)| pptx_table_renderable(10_000 + index, table, slide_size)),
    );
    objects.extend(
        images
            .iter()
            .filter(|image| image.relationship_id.is_some())
            .enumerate()
            .map(|(index, image)| pptx_image_renderable(20_000 + index, image, slide_size)),
    );
    objects.extend(
        charts
            .iter()
            .filter(|chart| chart.relationship_id.is_some())
            .enumerate()
            .map(|(index, chart)| pptx_chart_renderable(30_000 + index, chart, slide_size)),
    );
    let drawing_xml = render_pptx_objects(objects, 40_000);
    let background = pptx_slide_background_xml(background);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>{background}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{drawing_xml}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#
    )
}

pub(in crate::services::document_editor) fn pptx_basic_shape_renderable(
    shape_id: usize,
    spec: &PptxShapeSpec,
    slide_size: PptxSlideSize,
) -> PptxRenderableObject {
    let shape_id = spec.shape_id.unwrap_or(shape_id);
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        group_shape_id: spec.group_shape_id,
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height, slide_size),
        xml: build_pptx_basic_shape_for_size(shape_id, spec, slide_size),
    }
}

pub(in crate::services::document_editor) fn pptx_text_renderable(
    shape_id: usize,
    spec: &PptxTextSpec,
    slide_size: PptxSlideSize,
) -> PptxRenderableObject {
    let shape_id = spec.shape_id.unwrap_or(shape_id);
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        group_shape_id: spec.group_shape_id,
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height, slide_size),
        xml: build_pptx_text_shape_for_size(shape_id, spec, slide_size),
    }
}

pub(in crate::services::document_editor) fn pptx_table_renderable(
    shape_id: usize,
    spec: &PptxTableSpec,
    slide_size: PptxSlideSize,
) -> PptxRenderableObject {
    let shape_id = spec.shape_id.unwrap_or(shape_id);
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        group_shape_id: spec.group_shape_id,
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height, slide_size),
        xml: build_pptx_table_for_size(shape_id, spec, slide_size),
    }
}

pub(in crate::services::document_editor) fn pptx_image_renderable(
    shape_id: usize,
    spec: &PptxImageSpec,
    slide_size: PptxSlideSize,
) -> PptxRenderableObject {
    let shape_id = spec.shape_id.unwrap_or(shape_id);
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        group_shape_id: spec.group_shape_id,
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height, slide_size),
        xml: build_pptx_image_for_size(shape_id, spec, slide_size),
    }
}

pub(in crate::services::document_editor) fn pptx_chart_renderable(
    shape_id: usize,
    spec: &PptxChartSpec,
    slide_size: PptxSlideSize,
) -> PptxRenderableObject {
    let shape_id = spec.shape_id.unwrap_or(shape_id);
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        group_shape_id: spec.group_shape_id,
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height, slide_size),
        xml: build_pptx_chart_frame_for_size(shape_id, spec, slide_size),
    }
}

pub(in crate::services::document_editor) fn render_pptx_objects(
    objects: Vec<PptxRenderableObject>,
    first_group_shape_id: usize,
) -> String {
    let mut grouped = BTreeMap::<String, Vec<PptxRenderableObject>>::new();
    for object in &objects {
        if let Some(group_id) = object.group_id.as_deref() {
            grouped
                .entry(group_id.to_string())
                .or_default()
                .push(object.clone());
        }
    }

    let mut output = String::new();
    let mut emitted_groups = BTreeSet::new();
    let mut next_group_shape_id = first_group_shape_id;
    for object in objects {
        let Some(group_id) = object.group_id.as_deref() else {
            output.push_str(&object.xml);
            continue;
        };
        let Some(group_objects) = grouped.get(group_id) else {
            output.push_str(&object.xml);
            continue;
        };
        if group_objects.len() < 2 {
            output.push_str(&object.xml);
            continue;
        }
        if emitted_groups.insert(group_id.to_string()) {
            let preserved_group_shape_id = group_objects
                .iter()
                .filter_map(|object| object.group_shape_id)
                .next();
            let group_shape_id = preserved_group_shape_id.unwrap_or(next_group_shape_id);
            output.push_str(&build_pptx_group_shape(
                group_shape_id,
                group_id,
                group_objects,
            ));
            if preserved_group_shape_id.is_none() {
                next_group_shape_id += 1;
            }
        }
    }
    output
}

pub(in crate::services::document_editor) fn build_pptx_group_shape(
    shape_id: usize,
    group_id: &str,
    objects: &[PptxRenderableObject],
) -> String {
    let bounds = pptx_group_bounds(objects);
    let children = objects
        .iter()
        .map(|object| object.xml.as_str())
        .collect::<Vec<_>>()
        .join("");
    let name = escape_xml(&format!("Group {group_id}"));
    format!(
        r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="{shape_id}" name="{name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/><a:chOff x="{}" y="{}"/><a:chExt cx="{}" cy="{}"/></a:xfrm></p:grpSpPr>{children}</p:grpSp>"#,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height
    )
}

pub(in crate::services::document_editor) fn pptx_group_bounds(
    objects: &[PptxRenderableObject],
) -> PptxObjectBounds {
    let left = objects
        .iter()
        .map(|object| object.bounds.x)
        .min()
        .unwrap_or(0);
    let top = objects
        .iter()
        .map(|object| object.bounds.y)
        .min()
        .unwrap_or(0);
    let right = objects
        .iter()
        .map(|object| object.bounds.x + object.bounds.width)
        .max()
        .unwrap_or(left + 1);
    let bottom = objects
        .iter()
        .map(|object| object.bounds.y + object.bounds.height)
        .max()
        .unwrap_or(top + 1);
    PptxObjectBounds {
        x: left,
        y: top,
        width: (right - left).max(1),
        height: (bottom - top).max(1),
    }
}

pub(in crate::services::document_editor) fn pptx_bounds_from_percent(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    slide_size: PptxSlideSize,
) -> PptxObjectBounds {
    let (x, y, width, height) = pptx_percent_geometry_emu_for_size(x, y, width, height, slide_size);
    PptxObjectBounds {
        x,
        y,
        width,
        height,
    }
}

pub(in crate::services::document_editor) fn pptx_slide_background_xml(
    background: Option<&PptxBackgroundSpec>,
) -> String {
    match background {
        Some(PptxBackgroundSpec::Solid(color)) => {
            format!(
                r#"<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></p:bgPr></p:bg>"#
            )
        }
        Some(PptxBackgroundSpec::Gradient {
            start_color,
            end_color,
            angle,
        }) => {
            let angle = (normalize_degrees(*angle) * 60_000.0).round() as u32;
            format!(
                r#"<p:bg><p:bgPr><a:gradFill flip="none"><a:gsLst><a:gs pos="0"><a:srgbClr val="{start_color}"/></a:gs><a:gs pos="100000"><a:srgbClr val="{end_color}"/></a:gs></a:gsLst><a:lin ang="{angle}" scaled="1"/></a:gradFill></p:bgPr></p:bg>"#
            )
        }
        Some(PptxBackgroundSpec::Image { relationship_id }) => {
            format!(
                r#"<p:bg><p:bgPr><a:blipFill><a:blip r:embed="{}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:bgPr></p:bg>"#,
                escape_xml(relationship_id)
            )
        }
        None => String::new(),
    }
}

pub(in crate::services::document_editor) fn update_pptx_slide_background(
    xml: &str,
    background_spec: Option<&PptxBackgroundSpec>,
) -> String {
    let Some(background_spec) = background_spec else {
        return xml.to_string();
    };
    let background = pptx_slide_background_xml(Some(background_spec));
    if let Some(replaced) = replace_xml_element(xml, "p:bg", &background) {
        return replaced;
    }
    if let Some(index) = xml.find("<p:spTree") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&background);
        output.push_str(&xml[index..]);
        return output;
    }
    xml.to_string()
}

pub(in crate::services::document_editor) fn update_pptx_slide_visibility(
    xml: &str,
    hidden: Option<bool>,
) -> String {
    let Some(hidden) = hidden else {
        return xml.to_string();
    };
    set_first_xml_tag_attrs(
        xml,
        "<p:sld",
        &[("show", if hidden { "0" } else { "1" }.to_string())],
    )
}

pub(in crate::services::document_editor) fn regroup_pptx_slide_objects_for_size(
    slide_xml: &str,
    texts: &[PptxTextSpec],
    shapes: &[PptxShapeSpec],
    tables: &[PptxTableSpec],
    images: &[PptxImageSpec],
    charts: &[PptxChartSpec],
    slide_size: PptxSlideSize,
) -> String {
    if tables.iter().any(|table| table.preservation_only) {
        return slide_xml.to_string();
    }
    if !pptx_specs_have_groups(texts, shapes, tables, images, charts) {
        return slide_xml.to_string();
    }

    let mut objects = Vec::new();
    let mut next_shape_id = next_pptx_drawing_id(slide_xml).max(50_000);
    objects.extend(shapes.iter().enumerate().map(|(index, shape)| {
        pptx_basic_shape_renderable(next_shape_id + index, shape, slide_size)
    }));
    next_shape_id += shapes.len();
    objects.extend(
        texts
            .iter()
            .enumerate()
            .map(|(index, text)| pptx_text_renderable(next_shape_id + index, text, slide_size)),
    );
    next_shape_id += texts.len();
    objects.extend(
        tables
            .iter()
            .enumerate()
            .map(|(index, table)| pptx_table_renderable(next_shape_id + index, table, slide_size)),
    );
    next_shape_id += tables.len();
    objects.extend(
        images
            .iter()
            .filter(|image| image.relationship_id.is_some())
            .enumerate()
            .map(|(index, image)| pptx_image_renderable(next_shape_id + index, image, slide_size)),
    );
    next_shape_id += images
        .iter()
        .filter(|image| image.relationship_id.is_some())
        .count();
    objects.extend(
        charts
            .iter()
            .filter(|chart| chart.relationship_id.is_some())
            .enumerate()
            .map(|(index, chart)| pptx_chart_renderable(next_shape_id + index, chart, slide_size)),
    );
    next_shape_id += charts
        .iter()
        .filter(|chart| chart.relationship_id.is_some())
        .count();
    let drawing_xml = render_pptx_objects(objects, next_shape_id);
    let stripped = remove_empty_pptx_group_shapes(&remove_pptx_managed_drawing_objects(slide_xml));
    insert_pptx_after_root_group_properties(&stripped, &drawing_xml)
}

pub(in crate::services::document_editor) fn pptx_specs_have_groups(
    texts: &[PptxTextSpec],
    shapes: &[PptxShapeSpec],
    tables: &[PptxTableSpec],
    images: &[PptxImageSpec],
    charts: &[PptxChartSpec],
) -> bool {
    texts.iter().any(|spec| spec.group_id.is_some())
        || shapes.iter().any(|spec| spec.group_id.is_some())
        || tables.iter().any(|spec| spec.group_id.is_some())
        || images.iter().any(|spec| spec.group_id.is_some())
        || charts.iter().any(|spec| spec.group_id.is_some())
}

pub(in crate::services::document_editor) fn remove_pptx_managed_drawing_objects(
    slide_xml: &str,
) -> String {
    let without_shapes = remove_pptx_managed_shape_segments(slide_xml);
    let without_frames = remove_pptx_managed_graphic_frames(&without_shapes);
    remove_pptx_managed_picture_segments(&without_frames)
}

pub(in crate::services::document_editor) fn remove_pptx_managed_shape_segments(
    xml: &str,
) -> String {
    let mut output = String::new();
    let mut rest = xml;
    while let Some((start, end_marker)) = next_pptx_basic_shape_segment(rest) {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find(end_marker) else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + end_marker.len();
        let shape = &after_start[..end_index];
        if !(shape.contains("<a:t") || pptx_managed_basic_shape_segment(shape).is_some()) {
            output.push_str(shape);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn remove_pptx_managed_graphic_frames(
    xml: &str,
) -> String {
    let mut output = String::new();
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, "<p:graphicFrame") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:graphicFrame>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:graphicFrame>".len();
        let frame = &after_start[..end_index];
        if !(frame.contains("<a:tbl") || frame.contains("<c:chart")) {
            output.push_str(frame);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn remove_pptx_managed_picture_segments(
    xml: &str,
) -> String {
    let mut output = String::new();
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, "<p:pic") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:pic>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:pic>".len();
        let picture = &after_start[..end_index];
        if pptx_media_relationship_id(picture).is_some() {
            output.push_str(picture);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn remove_empty_pptx_group_shapes(xml: &str) -> String {
    let mut output = String::new();
    let mut rest = xml;
    while let Some(start) = find_xml_start(rest, "<p:grpSp") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:grpSp>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:grpSp>".len();
        let group = &after_start[..end_index];
        if group.contains("<p:sp")
            || group.contains("<p:cxnSp")
            || group.contains("<p:pic")
            || group.contains("<p:graphicFrame")
        {
            output.push_str(group);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn insert_pptx_text_shapes(
    slide_xml: &str,
    texts: &[PptxTextSpec],
    slide_size: PptxSlideSize,
) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let shapes = texts
        .iter()
        .enumerate()
        .map(|(index, text)| pptx_text_renderable(first_shape_id + index, text, slide_size))
        .collect::<Vec<_>>();
    let shapes = render_pptx_objects(shapes, first_shape_id + texts.len());
    insert_pptx_sp_tree_end(slide_xml, &shapes)
}

pub(in crate::services::document_editor) fn insert_pptx_sp_tree_end(
    slide_xml: &str,
    drawing_xml: &str,
) -> String {
    if drawing_xml.is_empty() {
        return slide_xml.to_string();
    }
    append_before_or_end(slide_xml, "</p:spTree>", drawing_xml)
}

pub(in crate::services::document_editor) fn insert_pptx_after_root_group_properties(
    slide_xml: &str,
    drawing_xml: &str,
) -> String {
    if drawing_xml.is_empty() {
        return slide_xml.to_string();
    }
    if let Some(index) = slide_xml.find("</p:grpSpPr>") {
        let insert_at = index + "</p:grpSpPr>".len();
        let mut output = String::new();
        output.push_str(&slide_xml[..insert_at]);
        output.push_str(drawing_xml);
        output.push_str(&slide_xml[insert_at..]);
        return output;
    }
    insert_pptx_sp_tree_end(slide_xml, drawing_xml)
}

pub(in crate::services::document_editor) fn replace_pptx_basic_shapes_for_size(
    xml: &str,
    specs: &[PptxShapeSpec],
    slide_size: PptxSlideSize,
) -> String {
    let mut output = String::new();
    let mut rest = xml;
    let identity_aware = specs.iter().any(|spec| spec.shape_id.is_some());
    let mut used_specs = vec![false; specs.len()];
    let mut legacy_spec_index = 0usize;
    let mut generated_shape_id = next_pptx_drawing_id(xml).max(20_000);
    while let Some((start, end_marker)) = next_pptx_basic_shape_segment(rest) {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find(end_marker) else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + end_marker.len();
        let shape = &after_start[..end_index];
        if pptx_managed_basic_shape_segment(shape).is_some() {
            let existing_shape_id = docx_tag_attr(shape, "<p:cNvPr", "id")
                .and_then(|value| value.parse::<usize>().ok())
                .filter(|id| *id > 0);
            let matching_spec_index = if identity_aware {
                existing_shape_id.and_then(|shape_id| {
                    specs.iter().enumerate().position(|(index, spec)| {
                        !used_specs[index] && spec.shape_id == Some(shape_id)
                    })
                })
            } else {
                let index = legacy_spec_index;
                legacy_spec_index += 1;
                specs.get(index).map(|_| index)
            };
            if let Some(spec_index) = matching_spec_index {
                let spec = &specs[spec_index];
                used_specs[spec_index] = true;
                let shape_id = existing_shape_id.or(spec.shape_id).unwrap_or_else(|| {
                    let allocated = generated_shape_id;
                    generated_shape_id += 1;
                    allocated
                });
                if identity_aware && pptx_basic_shape_spec_matches(shape, spec, slide_size) {
                    output.push_str(shape);
                } else {
                    output.push_str(&build_pptx_basic_shape_for_size(shape_id, spec, slide_size));
                }
            }
        } else {
            output.push_str(shape);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    let remaining = specs
        .iter()
        .zip(used_specs)
        .filter(|(_, used)| !used)
        .map(|(spec, _)| spec.clone())
        .collect::<Vec<_>>();
    if !remaining.is_empty() {
        insert_pptx_basic_shapes(&output, &remaining, generated_shape_id, slide_size)
    } else {
        output
    }
}

fn pptx_basic_shape_spec_matches(
    shape: &str,
    spec: &PptxShapeSpec,
    slide_size: PptxSlideSize,
) -> bool {
    let shape_models = pptx_slide_shapes_for_size(shape, slide_size);
    let parsed_specs = pptx_shape_specs(&json!({ "shapes": shape_models }));
    parsed_specs.first() == Some(spec)
}

pub(in crate::services::document_editor) fn next_pptx_basic_shape_segment(
    xml: &str,
) -> Option<(usize, &'static str)> {
    let shape = find_xml_start(xml, "<p:sp").map(|start| (start, "</p:sp>"));
    let connector = find_xml_start(xml, "<p:cxnSp").map(|start| (start, "</p:cxnSp>"));
    match (shape, connector) {
        (Some(shape), Some(connector)) => Some(if shape.0 <= connector.0 {
            shape
        } else {
            connector
        }),
        (Some(shape), None) => Some(shape),
        (None, Some(connector)) => Some(connector),
        (None, None) => None,
    }
}

pub(in crate::services::document_editor) fn pptx_managed_basic_shape_segment(
    shape: &str,
) -> Option<PptxShapeKind> {
    if shape.starts_with("<p:cxnSp") {
        return pptx_basic_shape_kind(shape);
    }
    pptx_managed_basic_shape_kind(shape)
}

pub(in crate::services::document_editor) fn insert_pptx_basic_shapes(
    slide_xml: &str,
    specs: &[PptxShapeSpec],
    first_shape_id: usize,
    slide_size: PptxSlideSize,
) -> String {
    let shapes = specs
        .iter()
        .enumerate()
        .map(|(index, shape)| {
            pptx_basic_shape_renderable(first_shape_id + index, shape, slide_size)
        })
        .collect::<Vec<_>>();
    let shapes = render_pptx_objects(shapes, first_shape_id + specs.len());
    if shapes.is_empty() {
        return slide_xml.to_string();
    }
    insert_pptx_after_root_group_properties(slide_xml, &shapes)
}

pub(in crate::services::document_editor) fn next_pptx_drawing_id(slide_xml: &str) -> usize {
    xml_named_empty_elements(slide_xml, "p:cNvPr")
        .into_iter()
        .filter_map(|element| attr_value(&element, "id"))
        .filter_map(|value| value.parse::<usize>().ok())
        .max()
        .unwrap_or(1)
        + 1
}
