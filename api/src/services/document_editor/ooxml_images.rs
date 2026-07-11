use std::collections::BTreeMap;

use base64::Engine as _;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

use super::{
    append_before_or_end, attr_value, docx_tag_attr, docx_u32_model_attr,
    ensure_content_type_default, escape_xml, next_rid, read_zip_bytes, set_first_xml_tag_attrs,
    xml_named_empty_elements, zip_entry_names,
};

pub(super) struct OoxmlImageData {
    pub(super) bytes: Vec<u8>,
    pub(super) extension: &'static str,
    pub(super) mime_type: &'static str,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum DocxImageWrap {
    Inline,
    Square,
    Behind,
    InFront,
}

impl DocxImageWrap {
    fn from_model(value: Option<&str>) -> Self {
        match value {
            Some("square") => Self::Square,
            Some("behind") => Self::Behind,
            Some("inFront") => Self::InFront,
            _ => Self::Inline,
        }
    }

    fn as_value(self) -> &'static str {
        match self {
            Self::Inline => "inline",
            Self::Square => "square",
            Self::Behind => "behind",
            Self::InFront => "inFront",
        }
    }
}

pub(super) fn image_mime_type_from_path(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

/// Return browser-renderable image data only for inert raster formats.
///
/// SVG parts remain preserved in the OOXML package, but exposing attacker-
/// controlled SVG as a data URL would move active XML into the web origin's
/// rendering surface. The editor therefore represents SVG metadata without a
/// preview payload and never rewrites the preserved part unless explicitly
/// replaced by a supported raster image.
pub(super) fn safe_ooxml_image_data_url(path: &str, bytes: &[u8]) -> Option<String> {
    let mime_type = match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return None,
    };
    Some(format!(
        "data:{mime_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub(super) fn add_docx_image_replacements(
    original: &[u8],
    blocks: &mut [Value],
    relationships: &mut String,
    content_types: &mut String,
    replacements: &mut Vec<(String, Vec<u8>)>,
) -> AppResult<bool> {
    let mut changed = false;
    let mut names = zip_entry_names(original).unwrap_or_default();
    let mut next_relationship_id = next_rid(relationships);
    for block in blocks.iter_mut() {
        if block.get("type").and_then(Value::as_str) != Some("image") {
            continue;
        }
        let has_relationship = block
            .get("relationshipId")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        if has_relationship {
            continue;
        }
        let Some(data_url) = block.get("dataUrl").and_then(Value::as_str) else {
            return Err(AppError::BadRequest(
                "Inserted DOCX image requires a data URL".into(),
            ));
        };
        let image = decode_docx_image_data_url(data_url)?;
        let media_path = next_docx_media_path(&names, image.extension);
        names.push(media_path.clone());
        let target = media_path
            .strip_prefix("word/")
            .unwrap_or(media_path.as_str())
            .to_string();
        let relationship_id = format!("rId{next_relationship_id}");
        next_relationship_id += 1;
        let relationship = format!(
            r#"<Relationship Id="{relationship_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{}"/>"#,
            escape_xml(&target)
        );
        *relationships = append_before_or_end(relationships, "</Relationships>", &relationship);
        *content_types =
            ensure_content_type_default(content_types, image.extension, image.mime_type);
        block["relationshipId"] = json!(relationship_id);
        block["target"] = json!(target);
        block["mediaPath"] = json!(media_path.clone());
        block["mimeType"] = json!(image.mime_type);
        if block.get("width").and_then(Value::as_u64).is_none() {
            block["width"] = json!(320);
        }
        if block.get("height").and_then(Value::as_u64).is_none() {
            block["height"] = json!(180);
        }
        replacements.push((media_path, image.bytes));
        changed = true;
    }
    Ok(changed)
}

pub(super) fn decode_pptx_image_data_url(data_url: &str) -> AppResult<OoxmlImageData> {
    decode_ooxml_image_data_url(data_url, "PPTX")
}

pub(super) fn next_pptx_media_path(existing_names: &[String], extension: &str) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("ppt/media/mymy-image-{index}.{extension}");
        if !existing_names.iter().any(|name| name == &path) {
            return path;
        }
        index += 1;
    }
}

pub(super) fn docx_image_block_from_segment(
    segment: &str,
    relationships: &BTreeMap<String, String>,
    bytes: &[u8],
    index: usize,
) -> Option<Value> {
    let relationship_id = docx_image_relationship_id(segment)?;
    let target = relationships.get(&relationship_id)?.to_string();
    let media_path = docx_relationship_target_path(&target);
    let media = read_zip_bytes(bytes, &media_path).ok()?;
    let mime_type = mime_type_for_path_string(&media_path);
    let data_url = safe_ooxml_image_data_url(&media_path, &media);
    let (width, height) = docx_image_extent(segment);
    let mut block = json!({
        "id": format!("img{}", index + 1),
        "type": "image",
        "text": "",
        "relationshipId": relationship_id,
        "target": target,
        "mediaPath": media_path,
        "mimeType": mime_type,
        "dataUrl": data_url,
        "width": width,
        "height": height,
        "imageWrap": docx_image_wrap(segment).as_value(),
        "altText": docx_image_alt_text(segment),
        "sourceXml": segment
    });
    if let Some(rotation) = docx_image_rotation(segment) {
        block["imageRotation"] = json!(rotation);
    }
    for (attr, key) in [
        ("l", "imageCropLeft"),
        ("t", "imageCropTop"),
        ("r", "imageCropRight"),
        ("b", "imageCropBottom"),
    ] {
        if let Some(value) = docx_image_crop_percent(segment, attr) {
            block[key] = json!(value);
        }
    }
    Some(block)
}

pub(super) fn docx_relationship_targets(rels: &str) -> BTreeMap<String, String> {
    xml_named_empty_elements(rels, "Relationship")
        .into_iter()
        .filter_map(|relationship| {
            let id = attr_value(&relationship, "Id")?;
            let target = attr_value(&relationship, "Target")?;
            Some((id, target))
        })
        .collect()
}

pub(super) fn docx_image_relationship_id(segment: &str) -> Option<String> {
    docx_tag_attr(segment, "<a:blip", "r:embed")
        .or_else(|| docx_tag_attr(segment, "<v:imagedata", "r:id"))
}

pub(super) fn build_docx_image_paragraph(block: &Value) -> String {
    let wrap = DocxImageWrap::from_model(block.get("imageWrap").and_then(Value::as_str));
    if let Some(source_xml) = block.get("sourceXml").and_then(Value::as_str) {
        if docx_image_wrap(source_xml) == wrap {
            return update_docx_image_source_xml(source_xml, block);
        }
    }
    let relationship_id = block
        .get("relationshipId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let width = docx_u32_model_attr(block, "width", 10_000)
        .map(u64::from)
        .map(css_pixels_to_emu)
        .unwrap_or(1_905_000);
    let height = docx_u32_model_attr(block, "height", 10_000)
        .map(u64::from)
        .map(css_pixels_to_emu)
        .unwrap_or(1_905_000);
    let alt = block
        .get("altText")
        .and_then(Value::as_str)
        .map(escape_xml)
        .unwrap_or_default();
    let rotation = docx_image_rotation_units(block)
        .map(|value| format!(r#" rot="{value}""#))
        .unwrap_or_default();
    let src_rect = docx_image_src_rect_xml(block).unwrap_or_default();
    let graphic = docx_image_graphic_xml(relationship_id, width, height, &rotation, &src_rect);
    let body = match wrap {
        DocxImageWrap::Inline => {
            format!(
                r#"<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{width}" cy="{height}"/><wp:docPr id="1" name="Picture" descr="{alt}"/>{graphic}</wp:inline>"#
            )
        }
        DocxImageWrap::Square | DocxImageWrap::Behind | DocxImageWrap::InFront => {
            let behind_doc = if wrap == DocxImageWrap::Behind {
                "1"
            } else {
                "0"
            };
            let wrap_xml = match wrap {
                DocxImageWrap::Square => r#"<wp:wrapSquare wrapText="bothSides"/>"#,
                DocxImageWrap::Behind | DocxImageWrap::InFront => "<wp:wrapNone/>",
                DocxImageWrap::Inline => "",
            };
            format!(
                r#"<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="{behind_doc}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="{width}" cy="{height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>{wrap_xml}<wp:docPr id="1" name="Picture" descr="{alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>{graphic}</wp:anchor>"#
            )
        }
    };
    format!(
        r#"<w:p><w:r><w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">{body}</w:drawing></w:r></w:p>"#
    )
}

fn docx_image_graphic_xml(
    relationship_id: &str,
    width: u64,
    height: u64,
    rotation: &str,
    src_rect: &str,
) -> String {
    format!(
        r#"<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{relationship_id}"/>{src_rect}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm{rotation}><a:off x="0" y="0"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>"#
    )
}

fn decode_docx_image_data_url(data_url: &str) -> AppResult<OoxmlImageData> {
    decode_ooxml_image_data_url(data_url, "DOCX")
}

fn decode_ooxml_image_data_url(data_url: &str, package_kind: &str) -> AppResult<OoxmlImageData> {
    let Some((header, encoded)) = data_url.split_once(',') else {
        return Err(AppError::BadRequest(format!(
            "Invalid {package_kind} image data URL"
        )));
    };
    if !header.contains(";base64") {
        return Err(AppError::BadRequest(format!(
            "{package_kind} image data URL must be base64 encoded"
        )));
    }
    let mime = header
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .unwrap_or_default();
    let Some((mime_type, extension)) = ooxml_image_mime_extension(mime) else {
        return Err(AppError::BadRequest(format!(
            "Unsupported {package_kind} image type: {mime}"
        )));
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| {
            AppError::BadRequest(format!("Invalid {package_kind} image data: {error}"))
        })?;
    if bytes.is_empty() {
        return Err(AppError::BadRequest(format!(
            "{package_kind} image data is empty"
        )));
    }
    Ok(OoxmlImageData {
        bytes,
        extension,
        mime_type,
    })
}

fn ooxml_image_mime_extension(mime: &str) -> Option<(&'static str, &'static str)> {
    match mime.to_ascii_lowercase().as_str() {
        "image/png" => Some(("image/png", "png")),
        "image/jpeg" | "image/jpg" => Some(("image/jpeg", "jpg")),
        "image/gif" => Some(("image/gif", "gif")),
        "image/webp" => Some(("image/webp", "webp")),
        _ => None,
    }
}

fn next_docx_media_path(existing_names: &[String], extension: &str) -> String {
    let mut index = 1usize;
    loop {
        let path = format!("word/media/mymy-image-{index}.{extension}");
        if !existing_names.iter().any(|name| name == &path) {
            return path;
        }
        index += 1;
    }
}

fn docx_relationship_target_path(target: &str) -> String {
    let clean = target.trim_start_matches('/');
    if clean.starts_with("word/") {
        clean.to_string()
    } else if let Some(stripped) = clean.strip_prefix("../") {
        stripped.to_string()
    } else {
        format!("word/{clean}")
    }
}

fn docx_image_extent(segment: &str) -> (Option<u32>, Option<u32>) {
    (
        docx_tag_attr(segment, "<wp:extent", "cx")
            .and_then(|value| value.parse::<u64>().ok())
            .map(emu_to_css_pixels),
        docx_tag_attr(segment, "<wp:extent", "cy")
            .and_then(|value| value.parse::<u64>().ok())
            .map(emu_to_css_pixels),
    )
}

fn docx_image_alt_text(segment: &str) -> Option<String> {
    docx_tag_attr(segment, "<wp:docPr", "descr")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| docx_tag_attr(segment, "<wp:docPr", "title"))
        .or_else(|| docx_tag_attr(segment, "<wp:docPr", "name"))
}

fn docx_image_rotation(segment: &str) -> Option<i32> {
    docx_tag_attr(segment, "<a:xfrm", "rot")
        .and_then(|value| value.parse::<i64>().ok())
        .map(|value| ((value as f64 / 60_000.0).round() as i32).clamp(-360, 360))
        .filter(|value| *value != 0)
}

fn docx_image_wrap(segment: &str) -> DocxImageWrap {
    if segment.contains("<wp:inline") {
        return DocxImageWrap::Inline;
    }
    if !segment.contains("<wp:anchor") {
        return DocxImageWrap::Inline;
    }
    if matches!(
        docx_tag_attr(segment, "<wp:anchor", "behindDoc").as_deref(),
        Some("1") | Some("true")
    ) {
        return DocxImageWrap::Behind;
    }
    if segment.contains("<wp:wrapNone") {
        return DocxImageWrap::InFront;
    }
    DocxImageWrap::Square
}

fn docx_image_crop_percent(segment: &str, attr: &str) -> Option<f64> {
    docx_tag_attr(segment, "<a:srcRect", attr)
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| (value / 1000.0).clamp(0.0, 100.0))
        .filter(|value| *value > 0.0)
}

fn emu_to_css_pixels(value: u64) -> u32 {
    ((value as f64 / 9_525.0).round() as u32).clamp(1, 10_000)
}

fn css_pixels_to_emu(value: u64) -> u64 {
    value.clamp(1, 10_000) * 9_525
}

fn mime_type_for_path_string(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

fn update_docx_image_source_xml(source_xml: &str, block: &Value) -> String {
    let mut output = source_xml.to_string();
    let width = docx_u32_model_attr(block, "width", 10_000)
        .map(u64::from)
        .map(css_pixels_to_emu);
    let height = docx_u32_model_attr(block, "height", 10_000)
        .map(u64::from)
        .map(css_pixels_to_emu);
    if let (Some(cx), Some(cy)) = (width, height) {
        output = set_first_xml_tag_attrs(
            &output,
            "<wp:extent",
            &[("cx", cx.to_string()), ("cy", cy.to_string())],
        );
        output = set_first_xml_tag_attrs(
            &output,
            "<a:ext",
            &[("cx", cx.to_string()), ("cy", cy.to_string())],
        );
    }
    if let Some(alt) = block.get("altText").and_then(Value::as_str) {
        output = set_first_xml_tag_attrs(
            &output,
            "<wp:docPr",
            &[("descr", alt.to_string()), ("title", alt.to_string())],
        );
    }
    if let Some(rotation) = docx_image_rotation_units(block) {
        output = set_first_xml_tag_attrs(&output, "<a:xfrm", &[("rot", rotation.to_string())]);
    }
    if let Some(src_rect) = docx_image_src_rect_xml(block) {
        output = replace_or_insert_docx_image_src_rect(&output, &src_rect);
    }
    output
}

fn docx_image_rotation_units(block: &Value) -> Option<i64> {
    block
        .get("imageRotation")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value.round().clamp(-360.0, 360.0) as i64 * 60_000)
}

fn docx_image_src_rect_xml(block: &Value) -> Option<String> {
    let crops = [
        ("imageCropLeft", "l"),
        ("imageCropTop", "t"),
        ("imageCropRight", "r"),
        ("imageCropBottom", "b"),
    ]
    .into_iter()
    .filter_map(|(key, attr)| {
        block.get(key)?;
        let value = block
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .unwrap_or(0.0)
            .clamp(0.0, 100.0);
        Some(format!(r#"{attr}="{}""#, (value * 1000.0).round() as u32))
    })
    .collect::<Vec<_>>();
    (!crops.is_empty()).then(|| format!("<a:srcRect {}/>", crops.join(" ")))
}

fn replace_or_insert_docx_image_src_rect(xml: &str, src_rect: &str) -> String {
    if let Some(start) = xml.find("<a:srcRect") {
        let after_start = &xml[start..];
        if let Some(end) = after_start.find("/>") {
            let mut output = String::new();
            output.push_str(&xml[..start]);
            output.push_str(src_rect);
            output.push_str(&after_start[end + 2..]);
            return output;
        }
    }
    if let Some(stretch_start) = xml.find("<a:stretch") {
        let mut output = String::new();
        output.push_str(&xml[..stretch_start]);
        output.push_str(src_rect);
        output.push_str(&xml[stretch_start..]);
        return output;
    }
    if let Some(blip_start) = xml.find("<a:blip") {
        let after_blip = &xml[blip_start..];
        if let Some(blip_end) = after_blip.find("/>") {
            let insert_at = blip_start + blip_end + 2;
            let mut output = String::new();
            output.push_str(&xml[..insert_at]);
            output.push_str(src_rect);
            output.push_str(&xml[insert_at..]);
            return output;
        }
    }
    xml.to_string()
}

#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn svg_is_preserved_without_a_browser_data_url_and_cannot_be_inserted() {
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert!(safe_ooxml_image_data_url("word/media/image.svg", svg).is_none());
        let encoded = base64::engine::general_purpose::STANDARD.encode(svg);
        assert!(matches!(
            decode_docx_image_data_url(&format!("data:image/svg+xml;base64,{encoded}")),
            Err(AppError::BadRequest(_))
        ));
    }
}
