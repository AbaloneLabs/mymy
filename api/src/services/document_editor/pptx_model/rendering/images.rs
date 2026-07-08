use super::*;

pub(in crate::services::document_editor) fn update_pptx_images(
    xml: &str,
    specs: &[PptxImageSpec],
    remove_missing: bool,
    slide_size: PptxSlideSize,
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
            output.push_str(&update_pptx_image_segment(picture, spec, slide_size));
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
        insert_pptx_images(&output, &new_images, slide_size)
    }
}

pub(in crate::services::document_editor) fn update_pptx_image_segment(
    segment: &str,
    spec: &PptxImageSpec,
    slide_size: PptxSlideSize,
) -> String {
    let (x, y, width, height) =
        pptx_percent_geometry_emu_for_size(spec.x, spec.y, spec.width, spec.height, slide_size);
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
    slide_size: PptxSlideSize,
) -> String {
    let first_shape_id = next_pptx_drawing_id(slide_xml);
    let pictures = images
        .iter()
        .enumerate()
        .map(|(index, image)| pptx_image_renderable(first_shape_id + index, image, slide_size))
        .collect::<Vec<_>>();
    let pictures = render_pptx_objects(pictures, first_shape_id + images.len());
    if pictures.is_empty() {
        return slide_xml.to_string();
    }
    insert_pptx_sp_tree_end(slide_xml, &pictures)
}

pub(in crate::services::document_editor) fn build_pptx_image_for_size(
    shape_id: usize,
    spec: &PptxImageSpec,
    slide_size: PptxSlideSize,
) -> String {
    let relationship_id = spec.relationship_id.as_deref().unwrap_or_default();
    let (x, y, width, height) =
        pptx_percent_geometry_emu_for_size(spec.x, spec.y, spec.width, spec.height, slide_size);
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
