//! PPTX model conversion and slide XML updates.
//!
//! This module owns presentation-specific parsing and rendering so the
//! top-level service can stay focused on routing editor models to the right
//! document format. It still uses shared OOXML helpers from the parent module
//! to avoid duplicating low-level zip and XML utilities.

mod extractors;
mod geometry;
mod presentation_parts;
mod rendering;
mod specs;
mod types;

use super::*;
pub(super) use extractors::*;
pub(super) use geometry::*;
pub(super) use presentation_parts::*;
pub(super) use rendering::*;
pub(super) use specs::*;
pub(super) use types::*;

pub(super) fn pptx_model(bytes: &[u8]) -> AppResult<Value> {
    let mut slides = Vec::new();
    let slide_size_model = pptx_presentation_slide_size_model(bytes);
    let slide_size = slide_size_model
        .as_ref()
        .and_then(pptx_slide_size_from_model)
        .unwrap_or_default();
    let themes = pptx_theme_models(bytes)?;
    let theme_names = themes
        .iter()
        .filter_map(|theme| {
            Some((
                theme.get("path")?.as_str()?.to_string(),
                theme.get("name").and_then(Value::as_str)?.to_string(),
            ))
        })
        .collect::<BTreeMap<_, _>>();
    let layouts = pptx_layout_models(bytes, &theme_names, slide_size)?;
    let masters = pptx_master_models(bytes, &theme_names, slide_size)?;
    let layouts_by_path = layouts
        .iter()
        .filter_map(|layout| Some((layout.get("path")?.as_str()?.to_string(), layout.clone())))
        .collect::<BTreeMap<_, _>>();
    let table_styles = pptx_table_style_models(bytes).unwrap_or_default();
    for name in zip_entry_names(bytes)? {
        if !(name.starts_with("ppt/slides/slide") && name.ends_with(".xml")) {
            continue;
        }
        let xml = read_zip_text(bytes, &name)?;
        let mut texts = pptx_shape_texts_for_size(&xml, slide_size);
        if texts.is_empty() {
            texts = extract_text_tags(&xml, "a:t")
                .into_iter()
                .enumerate()
                .map(|(text_index, text)| {
                    json!({
                        "id": format!("t{}", text_index + 1),
                        "text": text
                    })
                })
                .collect::<Vec<_>>();
        }
        let mut slide = json!({
            "id": name,
            "name": name.rsplit('/').next().unwrap_or(&name),
            "notes": pptx_slide_notes(bytes, &name).unwrap_or_default(),
            "texts": texts,
            "shapes": pptx_slide_shapes_for_size(&xml, slide_size),
            "tables": pptx_slide_tables(&xml, slide_size),
            "images": pptx_slide_images(bytes, &name, &xml, slide_size),
            "media": pptx_slide_media(bytes, &name, &xml, slide_size),
            "charts": pptx_slide_charts(bytes, &name, &xml, slide_size),
            "transition": pptx_slide_transition(&xml),
            "animations": pptx_slide_animations(&xml),
            "animationTimingSourceXml": pptx_slide_timing(&xml),
            "hidden": pptx_slide_hidden(&xml)
        });
        if let Some(slide) = slide.as_object_mut() {
            slide.extend(pptx_slide_background_model(bytes, &name, &xml));
            slide.extend(pptx_slide_layout_model(bytes, &name, &layouts_by_path));
        }
        slides.push(slide);
    }
    let mut model = json!({
        "slides": slides,
        "layouts": layouts,
        "masters": masters,
        "themes": themes,
        "tableStyles": table_styles
    });
    if let (Some(model_object), Some(slide_size)) = (model.as_object_mut(), slide_size_model) {
        if let Some(slide_size) = slide_size.as_object() {
            model_object.extend(slide_size.clone());
        }
    }
    Ok(model)
}

pub(super) fn update_pptx(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let slides = model
        .get("slides")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("PPTX model requires slides".into()))?;
    let original_refs = pptx_presentation_slides(original).unwrap_or_default();
    let slide_writes = pptx_slide_writes(slides, &original_refs);
    let slide_size = pptx_slide_size_from_model_or_package(model, original);
    let mut replacements = Vec::new();
    let mut existing_names = zip_entry_names(original).unwrap_or_default();
    let mut added_note_paths = Vec::new();
    let mut content_types = if slide_writes.is_empty() {
        None
    } else {
        Some(read_zip_text(original, "[Content_Types].xml")?)
    };
    for (slide, slide_write) in slides.iter().zip(slide_writes.iter()) {
        let text_specs = pptx_text_specs(slide);
        let shape_specs = pptx_shape_specs(slide);
        let table_specs = pptx_table_specs(slide);
        let mut image_specs = pptx_image_specs(slide);
        let mut background_image_specs = pptx_background_image_specs(slide);
        let mut chart_specs = pptx_chart_specs(slide);
        let media_specs = pptx_media_specs(slide);
        let animation_specs = pptx_animation_specs(slide);
        let image_model_controls_slide = slide.get("images").is_some();
        let chart_model_controls_slide = slide.get("charts").is_some();
        let animation_model_controls_slide =
            slide.get("animations").is_some() || slide.get("animationTimingSourceXml").is_some();
        let transition_spec = pptx_transition_spec(slide);
        let hidden = slide.get("hidden").and_then(Value::as_bool);
        if let Some(content_types) = content_types.as_mut() {
            add_pptx_image_replacements(
                original,
                &slide_write.path,
                &mut image_specs,
                &mut existing_names,
                content_types,
                &mut replacements,
            )?;
            add_pptx_image_replacements(
                original,
                &slide_write.path,
                &mut background_image_specs,
                &mut existing_names,
                content_types,
                &mut replacements,
            )?;
            add_pptx_chart_clone_replacements(
                original,
                &slide_write.path,
                &mut chart_specs,
                &mut existing_names,
                content_types,
                &mut replacements,
            )?;
        }
        let background = pptx_background_spec(slide, background_image_specs.first());
        let Ok(original_xml) = read_zip_text(original, &slide_write.path) else {
            let slide_xml = build_pptx_slide_for_size(
                &text_specs,
                &shape_specs,
                &table_specs,
                &image_specs,
                &chart_specs,
                background.as_ref(),
                slide_size,
            );
            replacements.push((slide_write.path.clone(), slide_xml.into_bytes()));
            add_pptx_chart_replacements(
                original,
                &slide_write.path,
                &chart_specs,
                &mut replacements,
            );
            add_pptx_notes_replacement(
                original,
                slide,
                &slide_write.path,
                &mut existing_names,
                &mut added_note_paths,
                &mut replacements,
            )?;
            add_pptx_slide_layout_relationship_replacement(
                original,
                slide,
                &slide_write.path,
                &mut replacements,
            )?;
            continue;
        };
        let original_text_count = pptx_shape_texts_for_size(&original_xml, slide_size).len();
        let mut texts = extract_text_tags(&original_xml, "a:t");
        apply_pptx_text_replacements(&mut texts, &text_specs)?;
        apply_pptx_table_replacements(&mut texts, &table_specs);
        let mut updated = replace_tag_texts(&original_xml, "a:t", &texts);
        updated = update_pptx_shape_geometries_for_size(&updated, &text_specs, slide_size);
        if text_specs.len() > original_text_count {
            updated =
                insert_pptx_text_shapes(&updated, &text_specs[original_text_count..], slide_size);
        }
        updated = replace_pptx_basic_shapes_for_size(&updated, &shape_specs, slide_size);
        updated = update_pptx_tables(
            &updated,
            &table_specs,
            slide.get("tables").is_some(),
            slide_size,
        );
        updated = update_pptx_images(
            &updated,
            &image_specs,
            image_model_controls_slide,
            slide_size,
        );
        updated = update_pptx_charts(
            &updated,
            &chart_specs,
            chart_model_controls_slide,
            slide_size,
        );
        updated = regroup_pptx_slide_objects_for_size(
            &updated,
            &text_specs,
            &shape_specs,
            &table_specs,
            &image_specs,
            &chart_specs,
            slide_size,
        );
        updated = update_pptx_transition(&updated, transition_spec.as_ref());
        updated = update_pptx_animations(
            &updated,
            &animation_specs,
            slide
                .get("animationTimingSourceXml")
                .and_then(Value::as_str),
            animation_model_controls_slide,
        );
        updated = update_pptx_media_timing(&updated, &media_specs, slide.get("media").is_some());
        updated = update_pptx_slide_visibility(&updated, hidden);
        updated = update_pptx_slide_background(&updated, background.as_ref());
        replacements.push((slide_write.path.clone(), updated.into_bytes()));
        add_pptx_chart_replacements(original, &slide_write.path, &chart_specs, &mut replacements);
        add_pptx_notes_replacement(
            original,
            slide,
            &slide_write.path,
            &mut existing_names,
            &mut added_note_paths,
            &mut replacements,
        )?;
        add_pptx_slide_layout_relationship_replacement(
            original,
            slide,
            &slide_write.path,
            &mut replacements,
        )?;
    }
    if !slide_writes.is_empty() {
        let presentation = read_zip_text(original, "ppt/presentation.xml")?;
        let rels = read_zip_text(original, "ppt/_rels/presentation.xml.rels")?;
        let content_types = content_types.unwrap_or_default();
        let (presentation, rels) =
            update_pptx_presentation_manifest(&presentation, &rels, &slide_writes);
        let presentation = update_pptx_presentation_slide_size(&presentation, model, slide_size);
        let content_types =
            append_pptx_slide_content_types_for_writes(&content_types, &slide_writes);
        let content_types = append_pptx_notes_content_types(&content_types, &added_note_paths);
        replacements.push((
            "ppt/presentation.xml".to_string(),
            presentation.into_bytes(),
        ));
        replacements.push((
            "ppt/_rels/presentation.xml.rels".to_string(),
            rels.into_bytes(),
        ));
        replacements.push((
            "[Content_Types].xml".to_string(),
            content_types.into_bytes(),
        ));
    }
    add_pptx_theme_replacements(original, model, &mut replacements);
    add_pptx_master_replacements(original, model, slide_size, &mut replacements);
    let replacement_refs = replacements
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.clone()))
        .collect::<Vec<_>>();
    replace_zip_entries(original, &replacement_refs)
}

pub(super) fn add_pptx_image_replacements(
    original: &[u8],
    slide_path: &str,
    images: &mut [PptxImageSpec],
    existing_names: &mut Vec<String>,
    content_types: &mut String,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> AppResult<()> {
    if images.iter().all(|image| {
        image
            .relationship_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
    }) {
        return Ok(());
    }
    let rels_path = xlsx_part_rels_path(slide_path);
    let mut rels = replacement_zip_text_or_default(
        original,
        replacements,
        &rels_path,
        xlsx_empty_relationships,
    );
    let mut next_relationship_id = next_rid(&rels);
    let mut rels_changed = false;
    for image in images.iter_mut() {
        if image
            .relationship_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
        {
            continue;
        }
        let Some(data_url) = image.data_url.as_deref() else {
            return Err(AppError::BadRequest(
                "Inserted PPTX image requires a data URL".into(),
            ));
        };
        let image_data = decode_pptx_image_data_url(data_url)?;
        let media_path = next_pptx_media_path(existing_names, image_data.extension);
        existing_names.push(media_path.clone());
        let relationship_id = format!("rId{next_relationship_id}");
        next_relationship_id += 1;
        let relationship = format!(
            r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{}"/>"#,
            escape_xml(&pptx_slide_relationship_target(&media_path))
        );
        rels = append_before_or_end(&rels, "</Relationships>", &relationship);
        *content_types =
            ensure_content_type_default(content_types, image_data.extension, image_data.mime_type);
        image.relationship_id = Some(relationship_id);
        replacements.push((media_path, image_data.bytes));
        rels_changed = true;
    }
    if rels_changed {
        upsert_zip_replacement(replacements, rels_path, rels.into_bytes());
    }
    Ok(())
}

pub(super) fn add_pptx_slide_layout_relationship_replacement(
    original: &[u8],
    slide: &Value,
    slide_path: &str,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> AppResult<()> {
    let Some(layout_path) = slide
        .get("layoutPath")
        .and_then(Value::as_str)
        .filter(|path| valid_pptx_layout_path(path))
    else {
        return Ok(());
    };
    let rels_path = xlsx_part_rels_path(slide_path);
    let rels = replacement_zip_text_or_default(
        original,
        replacements,
        &rels_path,
        xlsx_empty_relationships,
    );
    let updated = upsert_pptx_slide_layout_relationship(&rels, layout_path);
    upsert_zip_replacement(replacements, rels_path, updated.into_bytes());
    Ok(())
}

pub(super) fn upsert_pptx_slide_layout_relationship(rels: &str, layout_path: &str) -> String {
    let target = pptx_slide_relationship_target(layout_path);
    for relationship in xml_named_empty_elements(rels, "Relationship") {
        let relationship_type = attr_value(&relationship, "Type").unwrap_or_default();
        if !relationship_type.ends_with("/slideLayout") {
            continue;
        }
        let updated = set_xml_attr(&relationship, "Target", &target);
        return rels.replacen(&relationship, &updated, 1);
    }
    let relationship_id = format!("rId{}", next_rid(rels));
    let relationship = format!(
        r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="{}"/>"#,
        escape_xml(&target)
    );
    append_before_or_end(rels, "</Relationships>", &relationship)
}

pub(super) fn valid_pptx_layout_path(path: &str) -> bool {
    path.starts_with("ppt/slideLayouts/") && path.ends_with(".xml") && !path.contains("..")
}

pub(super) fn add_pptx_chart_clone_replacements(
    original: &[u8],
    slide_path: &str,
    charts: &mut [PptxChartSpec],
    existing_names: &mut Vec<String>,
    content_types: &mut String,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> AppResult<()> {
    if charts.iter().all(|chart| {
        chart
            .relationship_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
    }) {
        return Ok(());
    }
    let rels_path = xlsx_part_rels_path(slide_path);
    let mut rels = replacement_zip_text_or_default(
        original,
        replacements,
        &rels_path,
        xlsx_empty_relationships,
    );
    let mut next_relationship_id = next_rid(&rels);
    let mut rels_changed = false;
    for chart in charts.iter_mut() {
        if chart
            .relationship_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
        {
            continue;
        }
        let Some(source_path) = chart
            .path
            .as_deref()
            .filter(|path| valid_pptx_chart_path(path))
        else {
            continue;
        };
        let chart_xml =
            replacement_zip_text_or_default(original, replacements, source_path, String::new);
        if chart_xml.trim().is_empty() {
            continue;
        }
        let chart_path = next_pptx_chart_path(existing_names);
        existing_names.push(chart_path.clone());
        let relationship_id = format!("rId{next_relationship_id}");
        next_relationship_id += 1;
        let relationship = format!(
            r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="{}"/>"#,
            escape_xml(&pptx_slide_relationship_target(&chart_path))
        );
        rels = append_before_or_end(&rels, "</Relationships>", &relationship);
        *content_types = ensure_content_type_override(
            content_types,
            &format!("/{}", chart_path),
            "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
        );
        chart.relationship_id = Some(relationship_id);
        chart.path = Some(chart_path.clone());
        replacements.push((chart_path, chart_xml.into_bytes()));
        rels_changed = true;
    }
    if rels_changed {
        upsert_zip_replacement(replacements, rels_path, rels.into_bytes());
    }
    Ok(())
}

pub(super) fn next_pptx_chart_path(existing_names: &[String]) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("ppt/charts/mymy-chart-{index}.xml");
        if !existing_names.iter().any(|name| name == &path) {
            return path;
        }
        index += 1;
    }
}

pub(super) fn valid_pptx_chart_path(path: &str) -> bool {
    path.starts_with("ppt/charts/") && path.ends_with(".xml") && !path.contains("..")
}
