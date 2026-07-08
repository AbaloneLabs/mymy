use std::collections::BTreeMap;

use super::super::{
    attr_value, unescape_xml, xml_empty_elements, xml_first_empty_tag_attr,
    xml_has_named_empty_tag, xml_named_empty_elements, xml_named_segments,
};
use super::*;

pub(in crate::services::document_editor) fn xlsx_styles_from_xml(xml: &str) -> XlsxParsedStyles {
    let num_formats = xlsx_num_formats(xml);
    let fonts = xlsx_fonts(xml);
    let fills = xlsx_fills(xml);
    let dxfs = xlsx_dxfs(xml);
    let cell_xfs = xlsx_cell_xfs(xml);
    let cell_styles = cell_xfs
        .iter()
        .map(|xf| xlsx_cell_style_from_xf(xf, &fonts, &fills, &num_formats))
        .collect::<Vec<_>>();
    XlsxParsedStyles {
        num_formats,
        fonts,
        fills,
        dxfs,
        cell_xfs,
        cell_styles,
    }
}

pub(super) fn xlsx_num_formats(xml: &str) -> BTreeMap<u32, String> {
    let mut formats = BTreeMap::new();
    for item in xml_empty_elements(xml, "<numFmt ") {
        let Some(id) = attr_value(&item, "numFmtId").and_then(|value| value.parse::<u32>().ok())
        else {
            continue;
        };
        if let Some(format_code) = attr_value(&item, "formatCode") {
            formats.insert(id, unescape_xml(&format_code));
        }
    }
    formats
}

fn xlsx_fonts(xml: &str) -> Vec<XlsxFontStyle> {
    let Some(fonts_xml) = xml_named_segments(xml, "fonts").into_iter().next() else {
        return vec![XlsxFontStyle::default()];
    };
    let fonts = xml_named_segments(&fonts_xml, "font")
        .into_iter()
        .map(|font| XlsxFontStyle {
            family: xml_first_empty_tag_attr(&font, "name", "val")
                .map(|value| unescape_xml(&value)),
            size: xml_first_empty_tag_attr(&font, "sz", "val"),
            bold: xml_has_named_empty_tag(&font, "b"),
            italic: xml_has_named_empty_tag(&font, "i"),
            underline: xml_has_named_empty_tag(&font, "u"),
            strikethrough: xml_has_named_empty_tag(&font, "strike"),
            color: xlsx_color_from_tag(&font, "color"),
        })
        .collect::<Vec<_>>();
    if fonts.is_empty() {
        vec![XlsxFontStyle::default()]
    } else {
        fonts
    }
}

fn xlsx_fills(xml: &str) -> Vec<Option<String>> {
    let Some(fills_xml) = xml_named_segments(xml, "fills").into_iter().next() else {
        return vec![None, None];
    };
    let fills = xml_named_segments(&fills_xml, "fill")
        .into_iter()
        .map(|fill| xlsx_color_from_tag(&fill, "fgColor"))
        .collect::<Vec<_>>();
    if fills.is_empty() {
        vec![None, None]
    } else {
        fills
    }
}

fn xlsx_cell_xfs(xml: &str) -> Vec<XlsxCellXf> {
    let Some(cell_xfs_xml) = xml_named_segments(xml, "cellXfs").into_iter().next() else {
        return vec![XlsxCellXf::default()];
    };
    let mut xfs = xml_named_empty_elements(&cell_xfs_xml, "xf")
        .into_iter()
        .chain(xml_named_segments(&cell_xfs_xml, "xf"))
        .map(|xf| xlsx_cell_xf_from_xml(&xf))
        .collect::<Vec<_>>();
    if xfs.is_empty() {
        xfs.push(XlsxCellXf::default());
    }
    xfs
}

fn xlsx_dxfs(xml: &str) -> Vec<XlsxDxfStyle> {
    let Some(dxfs_xml) = xml_named_segments(xml, "dxfs").into_iter().next() else {
        return Vec::new();
    };
    xml_named_segments(&dxfs_xml, "dxf")
        .into_iter()
        .map(|dxf| XlsxDxfStyle {
            fill_color: xlsx_color_from_tag(&dxf, "fgColor"),
        })
        .collect()
}

fn xlsx_cell_xf_from_xml(xf: &str) -> XlsxCellXf {
    let alignment = xml_named_empty_elements(xf, "alignment")
        .into_iter()
        .chain(xml_named_segments(xf, "alignment"))
        .next();
    XlsxCellXf {
        num_fmt_id: attr_value(xf, "numFmtId")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0),
        font_id: attr_value(xf, "fontId")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0),
        fill_id: attr_value(xf, "fillId")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0),
        align: alignment
            .as_deref()
            .and_then(|xml| attr_value(xml, "horizontal"))
            .filter(|value| matches!(value.as_str(), "left" | "center" | "right")),
        vertical_align: alignment
            .as_deref()
            .and_then(|xml| attr_value(xml, "vertical"))
            .filter(|value| matches!(value.as_str(), "top" | "center" | "bottom"))
            .map(|value| {
                if value == "center" {
                    "middle".to_string()
                } else {
                    value
                }
            }),
        wrap_text: alignment
            .as_deref()
            .and_then(|xml| attr_value(xml, "wrapText"))
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
    }
}

fn xlsx_cell_style_from_xf(
    xf: &XlsxCellXf,
    fonts: &[XlsxFontStyle],
    fills: &[Option<String>],
    num_formats: &BTreeMap<u32, String>,
) -> XlsxCellStyle {
    let font = fonts.get(xf.font_id).cloned().unwrap_or_default();
    let number_format = xlsx_num_format_code(xf.num_fmt_id, num_formats)
        .filter(|format| !format.eq_ignore_ascii_case("general"));
    XlsxCellStyle {
        number_format,
        font_family: font.family,
        font_size: font.size,
        bold: font.bold,
        italic: font.italic,
        underline: font.underline,
        strikethrough: font.strikethrough,
        color: font.color,
        fill_color: fills.get(xf.fill_id).cloned().flatten(),
        align: xf.align.clone(),
        vertical_align: xf.vertical_align.clone(),
        wrap_text: xf.wrap_text,
    }
}

fn xlsx_num_format_code(id: u32, formats: &BTreeMap<u32, String>) -> Option<String> {
    formats
        .get(&id)
        .cloned()
        .or_else(|| xlsx_builtin_num_format(id).map(str::to_string))
}

fn xlsx_builtin_num_format(id: u32) -> Option<&'static str> {
    match id {
        0 => Some("General"),
        1 => Some("0"),
        2 => Some("0.00"),
        3 => Some("#,##0"),
        4 => Some("#,##0.00"),
        9 => Some("0%"),
        10 => Some("0.00%"),
        14 => Some("m/d/yy"),
        18 => Some("h:mm AM/PM"),
        22 => Some("m/d/yy h:mm"),
        49 => Some("@"),
        _ => None,
    }
}

pub(super) fn xlsx_builtin_num_format_id(format: &str) -> Option<u32> {
    let normalized = format.trim();
    (0..=49).find(|id| {
        xlsx_builtin_num_format(*id)
            .map(|candidate| candidate.eq_ignore_ascii_case(normalized))
            .unwrap_or(false)
    })
}

fn xlsx_color_from_tag(xml: &str, tag: &str) -> Option<String> {
    let color = xml_first_empty_tag_attr(xml, tag, "rgb")?;
    xlsx_hex_color(&color)
}

pub(in crate::services::document_editor) fn xlsx_hex_color(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('#');
    let value = if value.len() == 8 { &value[2..] } else { value };
    if value.len() == 6 && value.chars().all(|character| character.is_ascii_hexdigit()) {
        Some(value.to_ascii_uppercase())
    } else {
        None
    }
}
