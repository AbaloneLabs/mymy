use super::*;

pub(in crate::services::document_editor) fn build_pptx_slide(
    texts: &[PptxTextSpec],
    basic_shapes: &[PptxShapeSpec],
    tables: &[PptxTableSpec],
    images: &[PptxImageSpec],
    charts: &[PptxChartSpec],
    background: Option<&PptxBackgroundSpec>,
) -> String {
    let mut objects = Vec::new();
    objects.extend(
        basic_shapes
            .iter()
            .enumerate()
            .map(|(index, shape)| pptx_basic_shape_renderable(index + 2, shape)),
    );
    objects.extend(
        texts
            .iter()
            .enumerate()
            .map(|(index, text)| pptx_text_renderable(basic_shapes.len() + index + 2, text)),
    );
    objects.extend(
        tables
            .iter()
            .enumerate()
            .map(|(index, table)| pptx_table_renderable(10_000 + index, table)),
    );
    objects.extend(
        images
            .iter()
            .filter(|image| image.relationship_id.is_some())
            .enumerate()
            .map(|(index, image)| pptx_image_renderable(20_000 + index, image)),
    );
    objects.extend(
        charts
            .iter()
            .filter(|chart| chart.relationship_id.is_some())
            .enumerate()
            .map(|(index, chart)| pptx_chart_renderable(30_000 + index, chart)),
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
) -> PptxRenderableObject {
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height),
        xml: build_pptx_basic_shape(shape_id, spec),
    }
}

pub(in crate::services::document_editor) fn pptx_text_renderable(
    shape_id: usize,
    spec: &PptxTextSpec,
) -> PptxRenderableObject {
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height),
        xml: build_pptx_text_shape(shape_id, spec),
    }
}

pub(in crate::services::document_editor) fn pptx_table_renderable(
    shape_id: usize,
    spec: &PptxTableSpec,
) -> PptxRenderableObject {
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height),
        xml: build_pptx_table(shape_id, spec),
    }
}

pub(in crate::services::document_editor) fn pptx_image_renderable(
    shape_id: usize,
    spec: &PptxImageSpec,
) -> PptxRenderableObject {
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height),
        xml: build_pptx_image(shape_id, spec),
    }
}

pub(in crate::services::document_editor) fn pptx_chart_renderable(
    shape_id: usize,
    spec: &PptxChartSpec,
) -> PptxRenderableObject {
    PptxRenderableObject {
        group_id: spec.group_id.clone(),
        bounds: pptx_bounds_from_percent(spec.x, spec.y, spec.width, spec.height),
        xml: build_pptx_chart_frame(shape_id, spec),
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
            output.push_str(&build_pptx_group_shape(
                next_group_shape_id,
                group_id,
                group_objects,
            ));
            next_group_shape_id += 1;
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
) -> PptxObjectBounds {
    let (x, y, width, height) = pptx_percent_geometry_emu(x, y, width, height);
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

pub(in crate::services::document_editor) fn regroup_pptx_slide_objects(
    slide_xml: &str,
    texts: &[PptxTextSpec],
    shapes: &[PptxShapeSpec],
    tables: &[PptxTableSpec],
    images: &[PptxImageSpec],
    charts: &[PptxChartSpec],
) -> String {
    if !pptx_specs_have_groups(texts, shapes, tables, images, charts) {
        return slide_xml.to_string();
    }

    let mut objects = Vec::new();
    let mut next_shape_id = next_pptx_drawing_id(slide_xml).max(50_000);
    objects.extend(
        shapes
            .iter()
            .enumerate()
            .map(|(index, shape)| pptx_basic_shape_renderable(next_shape_id + index, shape)),
    );
    next_shape_id += shapes.len();
    objects.extend(
        texts
            .iter()
            .enumerate()
            .map(|(index, text)| pptx_text_renderable(next_shape_id + index, text)),
    );
    next_shape_id += texts.len();
    objects.extend(
        tables
            .iter()
            .enumerate()
            .map(|(index, table)| pptx_table_renderable(next_shape_id + index, table)),
    );
    next_shape_id += tables.len();
    objects.extend(
        images
            .iter()
            .filter(|image| image.relationship_id.is_some())
            .enumerate()
            .map(|(index, image)| pptx_image_renderable(next_shape_id + index, image)),
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
            .map(|(index, chart)| pptx_chart_renderable(next_shape_id + index, chart)),
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
) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let shapes = texts
        .iter()
        .enumerate()
        .map(|(index, text)| pptx_text_renderable(first_shape_id + index, text))
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

pub(in crate::services::document_editor) fn replace_pptx_basic_shapes(
    xml: &str,
    specs: &[PptxShapeSpec],
) -> String {
    let mut output = String::new();
    let mut rest = xml;
    let mut spec_index = 0usize;
    let mut shape_id = 20_000usize;
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
            if let Some(spec) = specs.get(spec_index) {
                output.push_str(&build_pptx_basic_shape(shape_id, spec));
                shape_id += 1;
            }
            spec_index += 1;
        } else {
            output.push_str(shape);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    if spec_index < specs.len() {
        insert_pptx_basic_shapes(&output, &specs[spec_index..], shape_id)
    } else {
        output
    }
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
) -> String {
    let shapes = specs
        .iter()
        .enumerate()
        .map(|(index, shape)| pptx_basic_shape_renderable(first_shape_id + index, shape))
        .collect::<Vec<_>>();
    let shapes = render_pptx_objects(shapes, first_shape_id + specs.len());
    if shapes.is_empty() {
        return slide_xml.to_string();
    }
    insert_pptx_after_root_group_properties(slide_xml, &shapes)
}

pub(in crate::services::document_editor) fn update_pptx_tables(
    xml: &str,
    specs: &[PptxTableSpec],
    remove_missing: bool,
) -> String {
    if specs.is_empty() && !remove_missing {
        return xml.to_string();
    }
    let mut output = String::new();
    let mut rest = xml;
    let mut spec_index = 0usize;
    while let Some(start) = find_xml_start(rest, "<p:graphicFrame") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:graphicFrame>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:graphicFrame>".len();
        let frame = &after_start[..end_index];
        if frame.contains("<a:tbl") {
            if let Some(spec) = specs.get(spec_index) {
                output.push_str(&build_pptx_table(
                    next_pptx_drawing_id(xml) + spec_index,
                    spec,
                ));
            } else if !remove_missing {
                output.push_str(frame);
            }
            spec_index += 1;
        } else {
            output.push_str(frame);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    if spec_index < specs.len() {
        insert_pptx_tables(&output, &specs[spec_index..])
    } else {
        output
    }
}

pub(in crate::services::document_editor) fn insert_pptx_tables(
    slide_xml: &str,
    tables: &[PptxTableSpec],
) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let table_xml = tables
        .iter()
        .enumerate()
        .map(|(index, table)| pptx_table_renderable(first_shape_id + index, table))
        .collect::<Vec<_>>();
    let table_xml = render_pptx_objects(table_xml, first_shape_id + tables.len());
    if table_xml.is_empty() {
        return slide_xml.to_string();
    }
    insert_pptx_sp_tree_end(slide_xml, &table_xml)
}

pub(in crate::services::document_editor) fn build_pptx_table(
    shape_id: usize,
    spec: &PptxTableSpec,
) -> String {
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    let column_count = spec.rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let row_count = spec.rows.len().max(1);
    let column_widths = pptx_table_dimension_units(column_count, width, &spec.column_widths);
    let row_heights = pptx_table_dimension_units(row_count, height, &spec.row_heights);
    let grid = column_widths
        .iter()
        .map(|column_width| format!(r#"<a:gridCol w="{column_width}"/>"#))
        .collect::<Vec<_>>()
        .join("");
    let rows = spec
        .rows
        .iter()
        .enumerate()
        .map(|(row_index, row)| {
            let row_height = row_heights.get(row_index).copied().unwrap_or(1);
            let cells = (0..column_count)
                .map(|column| {
                    let value = row.get(column).map(String::as_str).unwrap_or_default();
                    let style = spec
                        .cell_styles
                        .get(row_index)
                        .and_then(|row| row.get(column));
                    build_pptx_table_cell(value, style)
                })
                .collect::<Vec<_>>()
                .join("");
            format!(r#"<a:tr h="{row_height}">{cells}</a:tr>"#)
        })
        .collect::<Vec<_>>()
        .join("");
    let table_style_id = escape_xml(
        spec.table_style_id
            .as_deref()
            .unwrap_or(PPTX_DEFAULT_TABLE_STYLE_ID),
    );
    let first_row = pptx_bool_attr_value(spec.first_row);
    let first_column = pptx_bool_attr_value(spec.first_column);
    let last_row = pptx_bool_attr_value(spec.last_row);
    let last_column = pptx_bool_attr_value(spec.last_column);
    let banded_rows = pptx_bool_attr_value(spec.banded_rows);
    let banded_columns = pptx_bool_attr_value(spec.banded_columns);
    format!(
        r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{shape_id}" name="Table {shape_id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="{first_row}" firstCol="{first_column}" lastRow="{last_row}" lastCol="{last_column}" bandRow="{banded_rows}" bandCol="{banded_columns}"><a:tableStyleId>{table_style_id}</a:tableStyleId></a:tblPr><a:tblGrid>{grid}</a:tblGrid>{rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#
    )
}

pub(in crate::services::document_editor) fn build_pptx_table_cell(
    value: &str,
    style: Option<&PptxTableCellStyle>,
) -> String {
    let paragraph_properties = style
        .and_then(|style| style.align.as_deref())
        .map(|align| format!(r#"<a:pPr algn="{}"/>"#, escape_xml(align)))
        .unwrap_or_default();
    let run_properties = pptx_table_cell_run_properties_xml(style);
    let cell_properties = pptx_table_cell_properties_xml(style);
    format!(
        r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>{paragraph_properties}<a:r>{run_properties}<a:t>{}</a:t></a:r></a:p></a:txBody>{cell_properties}</a:tc>"#,
        escape_xml(value)
    )
}

pub(in crate::services::document_editor) fn pptx_table_cell_run_properties_xml(
    style: Option<&PptxTableCellStyle>,
) -> String {
    let Some(style) = style else {
        return String::new();
    };
    let mut attrs = Vec::new();
    if style.bold == Some(true) {
        attrs.push(r#" b="1""#);
    }
    if style.italic == Some(true) {
        attrs.push(r#" i="1""#);
    }
    let color = style
        .text_color
        .as_deref()
        .map(|color| format!(r#"<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>"#));
    if attrs.is_empty() && color.is_none() {
        return String::new();
    }
    format!(
        r#"<a:rPr{}>{}</a:rPr>"#,
        attrs.join(""),
        color.unwrap_or_default()
    )
}

pub(in crate::services::document_editor) fn pptx_table_cell_properties_xml(
    style: Option<&PptxTableCellStyle>,
) -> String {
    let Some(fill_color) = style.and_then(|style| style.fill_color.as_deref()) else {
        return "<a:tcPr/>".to_string();
    };
    format!(r#"<a:tcPr><a:solidFill><a:srgbClr val="{fill_color}"/></a:solidFill></a:tcPr>"#)
}

pub(in crate::services::document_editor) fn pptx_table_dimension_units(
    count: usize,
    total: i64,
    values: &[f64],
) -> Vec<i64> {
    if count == 0 {
        return Vec::new();
    }
    let usable_values = values
        .iter()
        .copied()
        .take(count)
        .filter(|value| value.is_finite() && *value > 0.0)
        .collect::<Vec<_>>();
    if usable_values.len() != count {
        let unit = (total / count as i64).max(1);
        return vec![unit; count];
    }
    let sum = usable_values.iter().sum::<f64>();
    if sum <= 0.0 {
        let unit = (total / count as i64).max(1);
        return vec![unit; count];
    }
    usable_values
        .iter()
        .map(|value| (((value / sum) * total as f64).round() as i64).max(1))
        .collect()
}

pub(in crate::services::document_editor) fn pptx_bool_attr_value(value: bool) -> &'static str {
    if value {
        "1"
    } else {
        "0"
    }
}

pub(in crate::services::document_editor) fn update_pptx_images(
    xml: &str,
    specs: &[PptxImageSpec],
    remove_missing: bool,
) -> String {
    if specs.is_empty() && !remove_missing {
        return xml.to_string();
    }
    let mut output = String::new();
    let mut rest = xml;
    let mut matched = vec![false; specs.len()];
    while let Some(start) = find_xml_start(rest, "<p:pic") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:pic>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:pic>".len();
        let picture = &after_start[..end_index];
        let relationship_id = docx_tag_attr(picture, "<a:blip", "r:embed")
            .or_else(|| docx_tag_attr(picture, "<a:blip", "r:link"));
        let spec_index = relationship_id
            .as_deref()
            .and_then(|id| {
                specs
                    .iter()
                    .position(|spec| spec.relationship_id.as_deref() == Some(id))
            })
            .or_else(|| {
                specs
                    .iter()
                    .enumerate()
                    .find(|(index, spec)| !matched[*index] && spec.relationship_id.is_none())
                    .map(|(index, _)| index)
            });
        if let Some(spec_index) = spec_index {
            matched[spec_index] = true;
            let spec = &specs[spec_index];
            output.push_str(&update_pptx_image_segment(picture, spec));
        } else if !remove_missing {
            output.push_str(picture);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    let new_images = specs
        .iter()
        .enumerate()
        .filter(|(index, spec)| !matched[*index] && spec.relationship_id.is_some())
        .map(|(_, spec)| spec)
        .collect::<Vec<_>>();
    if new_images.is_empty() {
        output
    } else {
        insert_pptx_images(&output, &new_images)
    }
}

pub(in crate::services::document_editor) fn update_pptx_image_segment(
    segment: &str,
    spec: &PptxImageSpec,
) -> String {
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    let mut output = set_first_xml_tag_attrs(
        segment,
        "<a:off",
        &[("x", x.to_string()), ("y", y.to_string())],
    );
    output = set_first_xml_tag_attrs(
        &output,
        "<a:ext",
        &[("cx", width.to_string()), ("cy", height.to_string())],
    );
    output = set_first_xml_tag_attrs(&output, "<a:xfrm", &[("rot", rotation.to_string())]);
    if let Some(alt_text) = &spec.alt_text {
        output = set_first_xml_tag_attrs(
            &output,
            "<p:cNvPr",
            &[
                ("descr", alt_text.to_string()),
                ("title", alt_text.to_string()),
            ],
        );
    }
    output = update_pptx_image_crop(&output, spec);
    output
}

pub(in crate::services::document_editor) fn insert_pptx_images(
    slide_xml: &str,
    images: &[&PptxImageSpec],
) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let pictures = images
        .iter()
        .enumerate()
        .map(|(index, image)| pptx_image_renderable(first_shape_id + index, image))
        .collect::<Vec<_>>();
    let pictures = render_pptx_objects(pictures, first_shape_id + images.len());
    if pictures.is_empty() {
        return slide_xml.to_string();
    }
    insert_pptx_sp_tree_end(slide_xml, &pictures)
}

pub(in crate::services::document_editor) fn build_pptx_image(
    shape_id: usize,
    spec: &PptxImageSpec,
) -> String {
    let relationship_id = spec.relationship_id.as_deref().unwrap_or_default();
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    let alt_text = spec
        .alt_text
        .as_deref()
        .map(escape_xml)
        .unwrap_or_else(|| format!("Picture {shape_id}"));
    let crop = pptx_image_crop_xml(spec);
    format!(
        r#"<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="Picture {shape_id}" descr="{alt_text}" title="{alt_text}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{}"/>{crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#,
        escape_xml(relationship_id)
    )
}

pub(in crate::services::document_editor) fn update_pptx_image_crop(
    segment: &str,
    spec: &PptxImageSpec,
) -> String {
    let crop = pptx_image_crop_xml(spec);
    let without_crop = replace_empty_xml_element(segment, "<a:srcRect", "");
    if crop.is_empty() {
        return without_crop;
    }
    for marker in ["<a:stretch", "</p:blipFill>", "</a:blipFill>"] {
        if let Some(index) = without_crop.find(marker) {
            let mut output = String::new();
            output.push_str(&without_crop[..index]);
            output.push_str(&crop);
            output.push_str(&without_crop[index..]);
            return output;
        }
    }
    without_crop
}

pub(in crate::services::document_editor) fn pptx_image_crop_xml(spec: &PptxImageSpec) -> String {
    if [
        spec.crop_left,
        spec.crop_top,
        spec.crop_right,
        spec.crop_bottom,
    ]
    .iter()
    .all(|value| *value <= 0.0)
    {
        return String::new();
    }
    format!(
        r#"<a:srcRect l="{}" t="{}" r="{}" b="{}"/>"#,
        pptx_crop_unit(spec.crop_left),
        pptx_crop_unit(spec.crop_top),
        pptx_crop_unit(spec.crop_right),
        pptx_crop_unit(spec.crop_bottom),
    )
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

pub(in crate::services::document_editor) fn update_pptx_charts(
    xml: &str,
    specs: &[PptxChartSpec],
    remove_missing: bool,
) -> String {
    if specs.is_empty() && !remove_missing {
        return xml.to_string();
    }
    let mut output = String::new();
    let mut rest = xml;
    let mut matched = vec![false; specs.len()];
    while let Some(start) = find_xml_start(rest, "<p:graphicFrame") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:graphicFrame>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:graphicFrame>".len();
        let frame = &after_start[..end_index];
        let relationship_id = xml_named_empty_elements(frame, "c:chart")
            .into_iter()
            .next()
            .and_then(|chart| attr_value(&chart, "r:id"));
        if let Some(relationship_id) = relationship_id {
            let spec_index = specs
                .iter()
                .enumerate()
                .find(|(index, spec)| {
                    !matched[*index]
                        && spec.relationship_id.as_deref() == Some(relationship_id.as_str())
                })
                .map(|(index, _)| index)
                .or_else(|| {
                    specs
                        .iter()
                        .enumerate()
                        .find(|(index, _)| !matched[*index])
                        .map(|(index, _)| index)
                });
            if let Some(spec_index) = spec_index {
                matched[spec_index] = true;
                let spec = &specs[spec_index];
                output.push_str(&update_pptx_chart_frame(frame, spec));
            } else if !remove_missing {
                output.push_str(frame);
            }
        } else {
            output.push_str(frame);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    let inserted = specs
        .iter()
        .enumerate()
        .filter(|(index, spec)| !matched[*index] && spec.relationship_id.is_some())
        .map(|(_, spec)| spec)
        .collect::<Vec<_>>();
    if inserted.is_empty() {
        output
    } else {
        insert_pptx_charts(&output, &inserted)
    }
}

pub(in crate::services::document_editor) fn update_pptx_chart_frame(
    frame: &str,
    spec: &PptxChartSpec,
) -> String {
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    let mut output = set_first_xml_tag_attrs(
        frame,
        "<a:off",
        &[("x", x.to_string()), ("y", y.to_string())],
    );
    output = set_first_xml_tag_attrs(
        &output,
        "<a:ext",
        &[("cx", width.to_string()), ("cy", height.to_string())],
    );
    set_first_xml_tag_attrs(&output, "<p:xfrm", &[("rot", rotation.to_string())])
}

pub(in crate::services::document_editor) fn insert_pptx_charts(
    slide_xml: &str,
    charts: &[&PptxChartSpec],
) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let frames = charts
        .iter()
        .enumerate()
        .map(|(index, chart)| pptx_chart_renderable(first_shape_id + index, chart))
        .collect::<Vec<_>>();
    let frames = render_pptx_objects(frames, first_shape_id + charts.len());
    if frames.is_empty() {
        return slide_xml.to_string();
    }
    insert_pptx_sp_tree_end(slide_xml, &frames)
}

pub(in crate::services::document_editor) fn build_pptx_chart_frame(
    shape_id: usize,
    spec: &PptxChartSpec,
) -> String {
    let relationship_id = spec.relationship_id.as_deref().unwrap_or_default();
    let (x, y, width, height) = pptx_percent_geometry_emu(spec.x, spec.y, spec.width, spec.height);
    let rotation = pptx_rotation_unit(spec.rotation);
    format!(
        r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{shape_id}" name="Chart {shape_id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm rot="{rotation}"><a:off x="{x}" y="{y}"/><a:ext cx="{width}" cy="{height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="{}"/></a:graphicData></a:graphic></p:graphicFrame>"#,
        escape_xml(relationship_id)
    )
}

pub(in crate::services::document_editor) fn add_pptx_chart_replacements(
    original: &[u8],
    slide_path: &str,
    specs: &[PptxChartSpec],
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    if specs.is_empty() {
        return;
    }
    let rels = read_zip_text(original, &xlsx_part_rels_path(slide_path)).unwrap_or_default();
    let relationships = xlsx_relationships_by_id(slide_path, &rels);
    for spec in specs {
        let chart_path = spec
            .relationship_id
            .as_deref()
            .and_then(|id| relationships.get(id))
            .filter(|(relationship_type, _)| relationship_type.ends_with("/chart"))
            .map(|(_, path)| path.clone())
            .or_else(|| spec.path.clone());
        let Some(chart_path) = chart_path else {
            continue;
        };
        let chart_xml =
            replacement_zip_text_or_default(original, replacements, &chart_path, String::new);
        if chart_xml.is_empty() {
            continue;
        }
        let mut updated = chart_xml;
        if let Some(title) = spec.title.as_deref() {
            updated = update_ooxml_chart_title(&updated, title);
        }
        if let Some(chart_type) = spec.chart_type.as_deref() {
            updated = update_ooxml_chart_type(&updated, chart_type);
        }
        if let Some(legend_visible) = spec.legend_visible {
            updated = update_ooxml_chart_legend(
                &updated,
                legend_visible,
                spec.legend_position.as_deref(),
            );
        }
        updated = update_pptx_chart_axis(updated, "c:catAx", &spec.category_axis);
        updated = update_pptx_chart_axis(updated, "c:valAx", &spec.value_axis);
        updated = update_ooxml_chart_series(&updated, &spec.series);
        replacements.push((chart_path, updated.into_bytes()));
    }
}

pub(in crate::services::document_editor) fn update_pptx_chart_axis(
    mut xml: String,
    axis_tag: &str,
    spec: &PptxChartAxisSpec,
) -> String {
    if let Some(position) = spec.position.as_deref() {
        xml = update_ooxml_chart_axis_position(&xml, axis_tag, position);
    }
    if let Some(visible) = spec.major_gridlines {
        xml = update_ooxml_chart_axis_major_gridlines(&xml, axis_tag, visible);
    }
    if let Some(position) = spec.tick_label_position.as_deref() {
        xml = update_ooxml_chart_axis_tick_label_position(&xml, axis_tag, position);
    }
    if let Some(mark) = spec.major_tick_mark.as_deref() {
        xml = update_ooxml_chart_axis_major_tick_mark(&xml, axis_tag, mark);
    }
    if let Some(mark) = spec.minor_tick_mark.as_deref() {
        xml = update_ooxml_chart_axis_minor_tick_mark(&xml, axis_tag, mark);
    }
    if let Some(format_code) = spec.number_format.as_deref() {
        xml = update_ooxml_chart_axis_number_format(&xml, axis_tag, format_code);
    }
    if let Some(color) = spec.line_color.as_deref() {
        xml = update_ooxml_chart_axis_line_color(&xml, axis_tag, color);
    }
    if let Some(width) = spec.line_width {
        xml = update_ooxml_chart_axis_line_width(&xml, axis_tag, width);
    }
    if let Some(dash) = spec.line_dash.as_deref() {
        xml = update_ooxml_chart_axis_line_dash(&xml, axis_tag, dash);
    }
    if spec.label_text_color.is_some()
        || spec.label_font_size.is_some()
        || spec.label_bold.is_some()
        || spec.label_italic.is_some()
    {
        xml = update_ooxml_chart_axis_label_style(
            &xml,
            axis_tag,
            spec.label_text_color.as_deref(),
            spec.label_font_size,
            spec.label_bold,
            spec.label_italic,
        );
    }
    if let Some(rotation) = spec.label_rotation {
        xml = update_ooxml_chart_axis_label_rotation(&xml, axis_tag, rotation);
    }
    if spec.title.is_some() {
        xml = update_ooxml_chart_axis_title(&xml, axis_tag, spec.title.as_deref());
    }
    xml
}

pub(in crate::services::document_editor) fn update_pptx_transition(
    xml: &str,
    spec: Option<&PptxTransitionSpec>,
) -> String {
    let Some(spec) = spec else {
        return xml.to_string();
    };
    let stripped = remove_pptx_transition(xml);
    if spec.kind == "none" {
        return stripped;
    }
    let transition = build_pptx_transition(spec);
    if let Some(index) = stripped.find("<p:timing") {
        let mut output = String::new();
        output.push_str(&stripped[..index]);
        output.push_str(&transition);
        output.push_str(&stripped[index..]);
        return output;
    }
    if let Some(index) = stripped.find("</p:cSld>") {
        let insert_at = index + "</p:cSld>".len();
        let mut output = String::new();
        output.push_str(&stripped[..insert_at]);
        output.push_str(&transition);
        output.push_str(&stripped[insert_at..]);
        return output;
    }
    append_before_or_end(&stripped, "</p:sld>", &transition)
}

pub(in crate::services::document_editor) fn update_pptx_animations(
    xml: &str,
    specs: &[PptxAnimationSpec],
    timing_source_xml: Option<&str>,
    model_controls_slide: bool,
) -> String {
    if !model_controls_slide {
        return xml.to_string();
    }
    let timing = timing_source_xml
        .filter(|source| source.starts_with("<p:timing"))
        .map(str::to_string)
        .or_else(|| pptx_slide_timing(xml));
    let Some(timing) = timing else {
        return xml.to_string();
    };
    let timing = update_pptx_timing_ctn_attrs(&timing, specs);
    if let Some(replaced) = replace_xml_element(xml, "p:timing", &timing) {
        return replaced;
    }
    if xml.contains("<p:timing") {
        return replace_empty_xml_element(xml, "<p:timing", &timing);
    }
    append_before_or_end(xml, "</p:sld>", &timing)
}

pub(in crate::services::document_editor) fn update_pptx_media_timing(
    xml: &str,
    specs: &[PptxMediaSpec],
    model_controls_slide: bool,
) -> String {
    if !model_controls_slide || specs.is_empty() {
        return xml.to_string();
    }
    let Some(timing) = pptx_slide_timing(xml) else {
        return xml.to_string();
    };
    let timing = update_pptx_media_timing_nodes(&timing, specs);
    if let Some(replaced) = replace_xml_element(xml, "p:timing", &timing) {
        return replaced;
    }
    if xml.contains("<p:timing") {
        return replace_empty_xml_element(xml, "<p:timing", &timing);
    }
    append_before_or_end(xml, "</p:sld>", &timing)
}

pub(in crate::services::document_editor) fn update_pptx_media_timing_nodes(
    timing: &str,
    specs: &[PptxMediaSpec],
) -> String {
    let mut output = String::new();
    let mut rest = timing;
    let mut timing_index = 0usize;
    while let Some(start) = find_xml_start(rest, "<p:cMediaNode") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:cMediaNode>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:cMediaNode>".len();
        let node = &after_start[..end_index];
        let updated = specs
            .iter()
            .find(|spec| spec.timing_index == Some(timing_index))
            .map(|spec| update_pptx_media_timing_node(node, spec))
            .unwrap_or_else(|| node.to_string());
        output.push_str(&updated);
        rest = &after_start[end_index..];
        timing_index += 1;
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn update_pptx_media_timing_node(
    node: &str,
    spec: &PptxMediaSpec,
) -> String {
    let mut output = node.to_string();
    let mut attrs = Vec::new();
    if let Some(volume_percent) = spec.volume_percent {
        attrs.push((
            "vol",
            ((volume_percent.clamp(0.0, 100.0) * 1000.0).round() as u32).to_string(),
        ));
    }
    if let Some(muted) = spec.muted {
        attrs.push(("mute", pptx_bool_attr_value(muted).to_string()));
    }
    if let Some(show_when_stopped) = spec.show_when_stopped {
        attrs.push((
            "showWhenStopped",
            pptx_bool_attr_value(show_when_stopped).to_string(),
        ));
    }
    if !attrs.is_empty() {
        output = set_first_xml_tag_attrs(&output, "<p:cMediaNode", &attrs);
    }
    let mut timing_attrs = Vec::new();
    if let Some(delay_ms) = spec.delay_ms {
        timing_attrs.push(("delay", delay_ms.to_string()));
    }
    if let Some(duration_ms) = spec.duration_ms {
        timing_attrs.push(("dur", duration_ms.to_string()));
    }
    if !timing_attrs.is_empty() {
        output = set_first_xml_tag_attrs(&output, "<p:cTn", &timing_attrs);
    }
    output
}

pub(in crate::services::document_editor) fn update_pptx_timing_ctn_attrs(
    timing: &str,
    specs: &[PptxAnimationSpec],
) -> String {
    if specs.is_empty() {
        return timing.to_string();
    }
    let mut output = String::new();
    let mut rest = timing;
    let mut index = 0usize;
    while let Some(start) = find_xml_tag_start(rest, "p:cTn") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(open_end) = after_start.find('>') else {
            output.push_str(after_start);
            return output;
        };
        let (segment, next_rest) = if after_start[..=open_end].ends_with("/>") {
            (&after_start[..=open_end], &after_start[open_end + 1..])
        } else {
            let end_marker = "</p:cTn>";
            let Some(close_start) = after_start.find(end_marker) else {
                output.push_str(after_start);
                return output;
            };
            let end = close_start + end_marker.len();
            (&after_start[..end], &after_start[end..])
        };
        let updated_segment = if let Some(spec) = specs.get(index) {
            update_pptx_animation_segment(segment, spec)
        } else {
            segment.to_string()
        };
        output.push_str(&updated_segment);
        rest = next_rest;
        index += 1;
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn update_pptx_animation_segment(
    segment: &str,
    spec: &PptxAnimationSpec,
) -> String {
    let source = spec.source_xml.as_deref().unwrap_or(segment);
    let Some(open_end) = source.find('>') else {
        return source.to_string();
    };
    let original_tag = &source[..=open_end];
    let mut updated_tag = original_tag.to_string();
    if let Some(delay_ms) = spec.delay_ms {
        updated_tag = set_xml_attr(&updated_tag, "delay", &delay_ms.to_string());
    }
    if let Some(duration_ms) = spec.duration_ms {
        updated_tag = set_xml_attr(&updated_tag, "dur", &duration_ms.to_string());
    }
    let mut output = String::new();
    output.push_str(&updated_tag);
    output.push_str(&source[open_end + 1..]);
    output
}

pub(in crate::services::document_editor) fn remove_pptx_transition(xml: &str) -> String {
    let removed_segments = remove_xml_named_elements(xml, "p:transition");
    replace_empty_xml_element(&removed_segments, "<p:transition", "")
}

pub(in crate::services::document_editor) fn build_pptx_transition(
    spec: &PptxTransitionSpec,
) -> String {
    let mut attrs = Vec::new();
    if let Some(speed) = spec.speed.as_deref() {
        attrs.push(format!(r#"spd="{}""#, escape_xml(speed)));
    }
    if !spec.advance_on_click {
        attrs.push(r#"advClick="0""#.to_string());
    }
    if let Some(advance_after_ms) = spec.advance_after_ms {
        attrs.push(format!(r#"advTm="{advance_after_ms}""#));
    }
    let attrs = if attrs.is_empty() {
        String::new()
    } else {
        format!(" {}", attrs.join(" "))
    };
    let child = build_pptx_transition_child(spec);
    format!(r#"<p:transition{attrs}>{child}</p:transition>"#)
}

pub(in crate::services::document_editor) fn build_pptx_transition_child(
    spec: &PptxTransitionSpec,
) -> String {
    let direction = spec
        .direction
        .as_deref()
        .filter(|direction| valid_pptx_transition_direction(direction))
        .map(|direction| format!(r#" dir="{}""#, escape_xml(direction)))
        .unwrap_or_default();
    match spec.kind.as_str() {
        "push" | "wipe" | "split" | "cover" | "uncover" | "zoom" => {
            format!(r#"<p:{}{direction}/>"#, spec.kind)
        }
        "cut" => "<p:cut/>".to_string(),
        _ => "<p:fade/>".to_string(),
    }
}

pub(in crate::services::document_editor) fn build_pptx_basic_shape(
    shape_id: usize,
    spec: &PptxShapeSpec,
) -> String {
    let (x, y, width, height) = pptx_shape_geometry_emu(spec);
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

pub(in crate::services::document_editor) fn build_pptx_text_shape(
    shape_id: usize,
    spec: &PptxTextSpec,
) -> String {
    let (x, y, width, height) = pptx_geometry_emu(spec);
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

pub(in crate::services::document_editor) fn update_pptx_shape_geometries(
    xml: &str,
    specs: &[PptxTextSpec],
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
                output.push_str(&replace_pptx_shape_geometry(shape, spec));
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
) -> String {
    let (x, y, width, height) = pptx_geometry_emu(spec);
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
