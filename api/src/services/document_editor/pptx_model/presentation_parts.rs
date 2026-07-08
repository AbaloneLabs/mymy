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
            let style_id = docx_tag_attr(&style, "<a:tblStyle ", "styleId")?;
            let name = docx_tag_attr(&style, "<a:tblStyle ", "styleName")
                .or_else(|| docx_tag_attr(&style, "<a:tblStyle ", "name"));
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
        let theme_path = pptx_layout_theme_path(bytes, &name);
        let theme_name = theme_path
            .as_ref()
            .and_then(|path| theme_names.get(path))
            .cloned();
        layouts.push(json!({
            "path": name,
            "name": layout_name,
            "type": layout_type,
            "themePath": theme_path,
            "themeName": theme_name,
            "placeholderTexts": pptx_layout_placeholder_texts(&xml)
        }));
    }
    Ok(layouts)
}

pub(in crate::services::document_editor) fn pptx_layout_placeholder_texts(xml: &str) -> Vec<Value> {
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
            let (x, y, width, height, rotation) = pptx_shape_geometry(&shape);
            let run = pptx_run_properties_segment(&shape).unwrap_or_default();
            Some(json!({
                "id": format!("layout-placeholder-{}", index + 1),
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

pub(in crate::services::document_editor) fn pptx_layout_theme_path(
    bytes: &[u8],
    layout_path: &str,
) -> Option<String> {
    let layout_rels = read_zip_text(bytes, &xlsx_part_rels_path(layout_path)).ok()?;
    let master_path = xlsx_relationship_target_by_type(layout_path, &layout_rels, "/slideMaster")?;
    let master_rels = read_zip_text(bytes, &xlsx_part_rels_path(&master_path)).ok()?;
    xlsx_relationship_target_by_type(&master_path, &master_rels, "/theme")
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
        for key in ["name", "type", "themePath", "themeName"] {
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
