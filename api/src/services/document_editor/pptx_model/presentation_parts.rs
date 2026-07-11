use super::*;

pub(in crate::services::document_editor) fn pptx_theme_models(
    bytes: &[u8],
) -> AppResult<Vec<Value>> {
    let mut themes = Vec::new();
    for name in zip_entry_names(bytes)? {
        if !(name.starts_with("ppt/theme/theme") && name.ends_with(".xml")) {
            continue;
        }
        let xml = read_zip_text(bytes, &name)?;
        themes.push(json!({
            "path": name,
            "name": docx_tag_attr(&xml, "<a:theme", "name").unwrap_or_else(|| "Theme".to_string()),
            "colors": pptx_theme_colors(&xml),
            "majorFont": pptx_theme_font(&xml, "a:majorFont"),
            "minorFont": pptx_theme_font(&xml, "a:minorFont")
        }));
    }
    Ok(themes)
}

pub(in crate::services::document_editor) fn pptx_presentation_slide_size_model(
    bytes: &[u8],
) -> Option<Value> {
    let xml = read_zip_text(bytes, "ppt/presentation.xml").ok()?;
    let size = pptx_slide_size_spec_from_xml(&xml)?;
    let mut model = serde_json::Map::new();
    model.insert("slideWidthEmu".to_string(), json!(size.width_emu));
    model.insert("slideHeightEmu".to_string(), json!(size.height_emu));
    if let Some(size_type) = pptx_slide_size_type_from_xml(&xml) {
        model.insert("slideSizeType".to_string(), json!(size_type));
    }
    Some(Value::Object(model))
}

pub(in crate::services::document_editor) fn pptx_slide_size_from_model_or_package(
    model: &Value,
    original: &[u8],
) -> PptxSlideSize {
    pptx_slide_size_from_model(model)
        .or_else(|| {
            read_zip_text(original, "ppt/presentation.xml")
                .ok()
                .and_then(|xml| pptx_slide_size_spec_from_xml(&xml))
        })
        .unwrap_or_default()
}

pub(in crate::services::document_editor) fn pptx_slide_size_from_model(
    model: &Value,
) -> Option<PptxSlideSize> {
    let width = model.get("slideWidthEmu")?.as_f64()?;
    let height = model.get("slideHeightEmu")?.as_f64()?;
    (width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0)
        .then(|| PptxSlideSize::new(width, height))
}

pub(in crate::services::document_editor) fn pptx_slide_size_spec_from_xml(
    xml: &str,
) -> Option<PptxSlideSize> {
    let tag = xml_named_empty_elements(xml, "p:sldSz")
        .into_iter()
        .next()
        .or_else(|| xml_named_segments(xml, "p:sldSz").into_iter().next())?;
    let width = attr_value(&tag, "cx")?.parse::<f64>().ok()?;
    let height = attr_value(&tag, "cy")?.parse::<f64>().ok()?;
    (width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0)
        .then(|| PptxSlideSize::new(width, height))
}

pub(in crate::services::document_editor) fn pptx_slide_size_type_from_xml(
    xml: &str,
) -> Option<String> {
    let tag = xml_named_empty_elements(xml, "p:sldSz")
        .into_iter()
        .next()
        .or_else(|| xml_named_segments(xml, "p:sldSz").into_iter().next())?;
    attr_value(&tag, "type").filter(|value| !value.trim().is_empty())
}

pub(in crate::services::document_editor) fn update_pptx_presentation_slide_size(
    presentation: &str,
    model: &Value,
    slide_size: PptxSlideSize,
) -> String {
    if pptx_slide_size_from_model(model).is_none() && !presentation.contains("<p:sldSz") {
        return presentation.to_string();
    }
    let mut attrs = vec![
        ("cx", format!("{}", slide_size.width_emu.round() as i64)),
        ("cy", format!("{}", slide_size.height_emu.round() as i64)),
    ];
    if let Some(size_type) = model.get("slideSizeType").and_then(Value::as_str) {
        let size_type = size_type.trim();
        if !size_type.is_empty() {
            attrs.push(("type", size_type.to_string()));
        }
    } else if let Some(size_type) = pptx_slide_size_type_from_xml(presentation) {
        attrs.push(("type", size_type));
    }
    let replacement = format!(
        r#"<p:sldSz {}/>"#,
        attrs
            .iter()
            .map(|(key, value)| format!(r#"{key}="{}""#, escape_xml(value)))
            .collect::<Vec<_>>()
            .join(" ")
    );
    if let Some(existing) = xml_named_empty_elements(presentation, "p:sldSz")
        .into_iter()
        .next()
        .or_else(|| {
            xml_named_segments(presentation, "p:sldSz")
                .into_iter()
                .next()
        })
    {
        return presentation.replacen(&existing, &replacement, 1);
    }
    append_before_or_end(presentation, "</p:presentation>", &replacement)
}

pub(in crate::services::document_editor) fn pptx_theme_colors(xml: &str) -> Value {
    let mut colors = serde_json::Map::new();
    for key in PPTX_THEME_COLOR_KEYS {
        if let Some(color) = pptx_theme_color(xml, key) {
            colors.insert(key.to_string(), json!(format!("#{color}")));
        }
    }
    Value::Object(colors)
}

const PPTX_THEME_COLOR_KEYS: &[&str] = &[
    "dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
    "hlink", "folHlink",
];

pub(in crate::services::document_editor) fn pptx_theme_color(
    xml: &str,
    key: &str,
) -> Option<String> {
    let segment = xml_named_segments(xml, &format!("a:{key}"))
        .into_iter()
        .next()?;
    xml_named_empty_elements(&segment, "a:srgbClr")
        .into_iter()
        .next()
        .and_then(|color| attr_value(&color, "val"))
        .or_else(|| {
            xml_named_empty_elements(&segment, "a:sysClr")
                .into_iter()
                .next()
                .and_then(|color| attr_value(&color, "lastClr"))
        })
        .and_then(|color| docx_hex_color(&color))
}

pub(in crate::services::document_editor) fn pptx_theme_font(
    xml: &str,
    font_tag: &str,
) -> Option<String> {
    xml_named_segments(xml, font_tag)
        .into_iter()
        .next()
        .and_then(|font| {
            xml_named_empty_elements(&font, "a:latin")
                .into_iter()
                .next()
                .and_then(|latin| attr_value(&latin, "typeface"))
        })
        .filter(|font| !font.trim().is_empty())
}

pub(in crate::services::document_editor) fn pptx_table_style_models(
    bytes: &[u8],
) -> AppResult<Vec<Value>> {
    let Ok(xml) = read_zip_text(bytes, "ppt/tableStyles.xml") else {
        return Ok(Vec::new());
    };
    let default_style_id = docx_tag_attr(&xml, "<a:tblStyleLst", "def");
    Ok(xml_segments(&xml, "<a:tblStyle ", "</a:tblStyle>")
        .into_iter()
        .filter_map(|style| {
            let style_id = docx_tag_attr(&style, "<a:tblStyle", "styleId")?;
            let name = docx_tag_attr(&style, "<a:tblStyle", "styleName")
                .or_else(|| docx_tag_attr(&style, "<a:tblStyle", "name"));
            Some(json!({
                "id": style_id,
                "name": name,
                "default": default_style_id.as_deref() == Some(style_id.as_str())
            }))
        })
        .collect())
}

pub(in crate::services::document_editor) fn pptx_layout_models(
    bytes: &[u8],
    theme_names: &BTreeMap<String, String>,
    slide_size: PptxSlideSize,
) -> AppResult<Vec<Value>> {
    let mut layouts = Vec::new();
    for name in zip_entry_names(bytes)? {
        if !(name.starts_with("ppt/slideLayouts/slideLayout") && name.ends_with(".xml")) {
            continue;
        }
        let xml = read_zip_text(bytes, &name)?;
        let layout_type = docx_tag_attr(&xml, "<p:sldLayout", "type");
        let layout_name = docx_tag_attr(&xml, "<p:cSld", "name")
            .or_else(|| layout_type.clone())
            .unwrap_or_else(|| name.rsplit('/').next().unwrap_or(&name).to_string());
        let master_path = pptx_layout_master_path(bytes, &name);
        let master_name = master_path
            .as_ref()
            .and_then(|path| pptx_master_name(bytes, path));
        let theme_path = pptx_layout_theme_path(bytes, &name);
        let theme_name = theme_path
            .as_ref()
            .and_then(|path| theme_names.get(path))
            .cloned();
        layouts.push(json!({
            "path": name,
            "name": layout_name,
            "type": layout_type,
            "masterPath": master_path,
            "masterName": master_name,
            "themePath": theme_path,
            "themeName": theme_name,
            "placeholderTexts": pptx_layout_placeholder_texts(&xml, slide_size)
        }));
    }
    Ok(layouts)
}

pub(in crate::services::document_editor) fn pptx_master_models(
    bytes: &[u8],
    theme_names: &BTreeMap<String, String>,
    slide_size: PptxSlideSize,
) -> AppResult<Vec<Value>> {
    let mut masters = Vec::new();
    for name in zip_entry_names(bytes)? {
        if !(name.starts_with("ppt/slideMasters/slideMaster") && name.ends_with(".xml")) {
            continue;
        }
        let xml = read_zip_text(bytes, &name)?;
        let theme_path = pptx_master_theme_path(bytes, &name);
        let theme_name = theme_path
            .as_ref()
            .and_then(|path| theme_names.get(path))
            .cloned();
        masters.push(json!({
            "path": name,
            "name": docx_tag_attr(&xml, "<p:cSld", "name")
                .unwrap_or_else(|| "Slide Master".to_string()),
            "themePath": theme_path,
            "themeName": theme_name,
            "placeholderTexts": pptx_layout_placeholder_texts(&xml, slide_size)
        }));
    }
    Ok(masters)
}

pub(in crate::services::document_editor) fn pptx_layout_placeholder_texts(
    xml: &str,
    slide_size: PptxSlideSize,
) -> Vec<Value> {
    pptx_shape_segments(xml)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (_, shape))| {
            if !shape.contains("<p:ph") {
                return None;
            }
            let placeholder_kind =
                docx_tag_attr(&shape, "<p:ph", "type").unwrap_or_else(|| "body".to_string());
            let text = extract_text_tags(&shape, "a:t").join("");
            let text = if text.trim().is_empty() {
                pptx_placeholder_default_text(&placeholder_kind).to_string()
            } else {
                text
            };
            let (x, y, width, height, rotation) = pptx_shape_geometry_for_size(&shape, slide_size);
            let run = pptx_run_properties_segment(&shape).unwrap_or_default();
            Some(json!({
                "id": format!("layout-placeholder-{}", index + 1),
                "shapeId": docx_tag_attr(&shape, "<p:cNvPr", "id"),
                "text": text,
                "placeholderType": placeholder_kind,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": rotation,
                "fontSize": pptx_run_font_size(&run).map(|size| size.to_string()),
                "fontFamily": docx_tag_attr(&run, "<a:latin", "typeface"),
                "color": pptx_run_color(&run).map(|color| format!("#{color}")),
                "fillColor": pptx_shape_fill_color(&shape).map(|color| format!("#{color}")),
                "bold": docx_tag_attr(&run, "<a:rPr", "b").is_some_and(|value| value == "1"),
                "italic": docx_tag_attr(&run, "<a:rPr", "i").is_some_and(|value| value == "1"),
                "underline": docx_tag_attr(&run, "<a:rPr", "u").is_some_and(|value| value == "sng"),
                "strikethrough": docx_tag_attr(&run, "<a:rPr", "strike").is_some_and(|value| value == "sngStrike"),
                "align": pptx_paragraph_alignment(&shape)
            }))
        })
        .collect()
}

pub(in crate::services::document_editor) fn pptx_placeholder_default_text(
    placeholder_kind: &str,
) -> &'static str {
    match placeholder_kind {
        "title" | "ctrTitle" => "Title",
        "subTitle" => "Subtitle",
        "body" => "Body",
        "dt" => "Date",
        "ftr" => "Footer",
        "sldNum" => "Slide number",
        "obj" => "Content",
        _ => "Placeholder",
    }
}

pub(in crate::services::document_editor) fn pptx_master_name(
    bytes: &[u8],
    master_path: &str,
) -> Option<String> {
    let xml = read_zip_text(bytes, master_path).ok()?;
    docx_tag_attr(&xml, "<p:cSld", "name").or_else(|| {
        master_path
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    })
}

pub(in crate::services::document_editor) fn pptx_layout_theme_path(
    bytes: &[u8],
    layout_path: &str,
) -> Option<String> {
    let master_path = pptx_layout_master_path(bytes, layout_path)?;
    pptx_master_theme_path(bytes, &master_path)
}

pub(in crate::services::document_editor) fn pptx_layout_master_path(
    bytes: &[u8],
    layout_path: &str,
) -> Option<String> {
    let layout_rels = read_zip_text(bytes, &xlsx_part_rels_path(layout_path)).ok()?;
    xlsx_relationship_target_by_type(layout_path, &layout_rels, "/slideMaster")
}

pub(in crate::services::document_editor) fn pptx_master_theme_path(
    bytes: &[u8],
    master_path: &str,
) -> Option<String> {
    let master_rels = read_zip_text(bytes, &xlsx_part_rels_path(master_path)).ok()?;
    xlsx_relationship_target_by_type(master_path, &master_rels, "/theme")
}

pub(in crate::services::document_editor) fn pptx_slide_layout_model(
    bytes: &[u8],
    slide_path: &str,
    layouts_by_path: &BTreeMap<String, Value>,
) -> BTreeMap<String, Value> {
    let mut model = BTreeMap::new();
    let Some(rels) = read_zip_text(bytes, &xlsx_part_rels_path(slide_path)).ok() else {
        return model;
    };
    let Some((relationship_id, layout_path)) =
        xlsx_relationship_by_type(slide_path, &rels, "/slideLayout")
    else {
        return model;
    };
    model.insert("layoutRelationshipId".to_string(), json!(relationship_id));
    model.insert("layoutPath".to_string(), json!(layout_path));
    if let Some(layout) = model
        .get("layoutPath")
        .and_then(Value::as_str)
        .and_then(|path| layouts_by_path.get(path))
    {
        for key in [
            "name",
            "type",
            "masterPath",
            "masterName",
            "themePath",
            "themeName",
        ] {
            if let Some(value) = layout.get(key).cloned() {
                model.insert(format!("layout{}", uppercase_first(key)), value);
            }
        }
    }
    model
}

pub(in crate::services::document_editor) fn uppercase_first(value: &str) -> String {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return String::new();
    };
    format!("{}{}", first.to_uppercase(), chars.as_str())
}

pub(in crate::services::document_editor) fn add_pptx_theme_replacements(
    original: &[u8],
    model: &Value,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(themes) = model.get("themes").and_then(Value::as_array) else {
        return;
    };
    for theme in themes {
        let Some(path) = theme
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_pptx_theme_path(path))
        else {
            continue;
        };
        let Ok(original_xml) = read_zip_text(original, path) else {
            continue;
        };
        let updated = update_pptx_theme_xml(&original_xml, theme);
        if updated != original_xml {
            upsert_zip_replacement(replacements, path.to_string(), updated.into_bytes());
        }
    }
}

pub(in crate::services::document_editor) fn add_pptx_master_replacements(
    original: &[u8],
    model: &Value,
    slide_size: PptxSlideSize,
    replacements: &mut Vec<(String, Vec<u8>)>,
) {
    let Some(masters) = model.get("masters").and_then(Value::as_array) else {
        return;
    };
    for master in masters {
        let Some(path) = master
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| valid_pptx_master_path(path))
        else {
            continue;
        };
        let Ok(original_xml) = read_zip_text(original, path) else {
            continue;
        };
        let updated = update_pptx_master_xml(&original_xml, master, slide_size);
        if updated != original_xml {
            upsert_zip_replacement(replacements, path.to_string(), updated.into_bytes());
        }
    }
}

pub(in crate::services::document_editor) fn valid_pptx_master_path(path: &str) -> bool {
    path.starts_with("ppt/slideMasters/") && path.ends_with(".xml") && !path.contains("..")
}

pub(in crate::services::document_editor) fn update_pptx_master_xml(
    xml: &str,
    master: &Value,
    slide_size: PptxSlideSize,
) -> String {
    let mut updated = xml.to_string();
    if let Some(name) = master.get("name").and_then(Value::as_str) {
        updated = set_first_xml_tag_attrs(&updated, "<p:cSld", &[("name", name.to_string())]);
    }
    let specs = pptx_master_placeholder_specs(master);
    if !specs.is_empty() {
        updated = update_pptx_placeholder_shapes(&updated, &specs, slide_size);
    }
    updated
}

pub(in crate::services::document_editor) fn pptx_master_placeholder_specs(
    master: &Value,
) -> Vec<PptxTextSpec> {
    let Some(placeholders) = master.get("placeholderTexts").and_then(Value::as_array) else {
        return Vec::new();
    };
    pptx_text_specs(&json!({ "texts": placeholders }))
}

pub(in crate::services::document_editor) fn update_pptx_placeholder_shapes(
    xml: &str,
    specs: &[PptxTextSpec],
    slide_size: PptxSlideSize,
) -> String {
    let mut output = String::new();
    let mut rest = xml;
    let mut spec_index = 0usize;
    while let Some(start) = find_xml_start(rest, "<p:sp") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let Some(end) = after_start.find("</p:sp>") else {
            output.push_str(after_start);
            return output;
        };
        let end_index = end + "</p:sp>".len();
        let shape = &after_start[..end_index];
        if shape.contains("<p:ph") {
            if let Some(spec) = specs.get(spec_index) {
                let shape = replace_or_insert_pptx_shape_text(shape, &spec.text);
                output.push_str(&replace_pptx_shape_geometry(&shape, spec, slide_size));
            } else {
                output.push_str(shape);
            }
            spec_index += 1;
        } else {
            output.push_str(shape);
        }
        rest = &after_start[end_index..];
    }
    output.push_str(rest);
    output
}

pub(in crate::services::document_editor) fn replace_or_insert_pptx_shape_text(
    shape: &str,
    text: &str,
) -> String {
    if shape.contains("<a:t") {
        return replace_tag_texts(shape, "a:t", &[text.to_string()]);
    }
    let text_xml = format!(r#"<a:p><a:r><a:t>{}</a:t></a:r></a:p>"#, escape_xml(text));
    if let Some(index) = shape.find("</p:txBody>") {
        let mut output = String::new();
        output.push_str(&shape[..index]);
        output.push_str(&text_xml);
        output.push_str(&shape[index..]);
        return output;
    }
    let body_xml = format!(r#"<p:txBody><a:bodyPr/><a:lstStyle/>{text_xml}</p:txBody>"#);
    append_before_or_end(shape, "</p:sp>", &body_xml)
}

pub(in crate::services::document_editor) fn valid_pptx_theme_path(path: &str) -> bool {
    path.starts_with("ppt/theme/") && path.ends_with(".xml") && !path.contains("..")
}

pub(in crate::services::document_editor) fn update_pptx_theme_xml(
    xml: &str,
    theme: &Value,
) -> String {
    let mut updated = xml.to_string();
    if let Some(name) = theme.get("name").and_then(Value::as_str) {
        updated = set_first_xml_tag_attrs(&updated, "<a:theme", &[("name", name.to_string())]);
    }
    if let Some(colors) = theme.get("colors").and_then(Value::as_object) {
        for key in PPTX_THEME_COLOR_KEYS {
            if let Some(color) = colors
                .get(*key)
                .and_then(Value::as_str)
                .and_then(docx_hex_color)
            {
                updated = update_pptx_theme_color(&updated, key, &color);
            }
        }
    }
    if let Some(font) = theme
        .get("majorFont")
        .and_then(Value::as_str)
        .filter(|font| !font.trim().is_empty())
    {
        updated = update_pptx_theme_latin_font(&updated, "a:majorFont", font);
    }
    if let Some(font) = theme
        .get("minorFont")
        .and_then(Value::as_str)
        .filter(|font| !font.trim().is_empty())
    {
        updated = update_pptx_theme_latin_font(&updated, "a:minorFont", font);
    }
    updated
}

pub(in crate::services::document_editor) fn update_pptx_theme_color(
    xml: &str,
    key: &str,
    color: &str,
) -> String {
    let tag = format!("a:{key}");
    let Some(segment) = xml_named_segments(xml, &tag).into_iter().next() else {
        return xml.to_string();
    };
    let color_xml = format!(r#"<a:srgbClr val="{}"/>"#, escape_xml(color));
    let updated_segment = if let Some(existing) = xml_named_empty_elements(&segment, "a:srgbClr")
        .into_iter()
        .next()
    {
        segment.replacen(&existing, &color_xml, 1)
    } else if let Some(existing) = xml_named_empty_elements(&segment, "a:sysClr")
        .into_iter()
        .next()
    {
        segment.replacen(&existing, &color_xml, 1)
    } else {
        append_before_or_end(&segment, &format!("</{tag}>"), &color_xml)
    };
    xml.replacen(&segment, &updated_segment, 1)
}

pub(in crate::services::document_editor) fn update_pptx_theme_latin_font(
    xml: &str,
    font_tag: &str,
    font: &str,
) -> String {
    let Some(segment) = xml_named_segments(xml, font_tag).into_iter().next() else {
        return xml.to_string();
    };
    let latin_xml = format!(r#"<a:latin typeface="{}"/>"#, escape_xml(font.trim()));
    let updated_segment = if let Some(existing) = xml_named_empty_elements(&segment, "a:latin")
        .into_iter()
        .next()
    {
        segment.replacen(&existing, &latin_xml, 1)
    } else {
        insert_after_xml_start_tag(&segment, &format!("<{font_tag}"), &latin_xml)
    };
    xml.replacen(&segment, &updated_segment, 1)
}

pub(in crate::services::document_editor) fn insert_after_xml_start_tag(
    xml: &str,
    marker: &str,
    insertion: &str,
) -> String {
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
