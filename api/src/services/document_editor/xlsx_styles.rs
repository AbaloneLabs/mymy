//! XLSX style parsing and writing.
//!
//! Spreadsheet cell styling touches both the read model and the save path. This
//! module keeps style-table parsing, style JSON projection, and new style
//! allocation together while the worksheet code remains responsible for cell
//! placement and sheet XML structure.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{
    append_before_or_end, attr_value, ensure_content_type_default, escape_xml, find_xml_tag_start,
    next_rid, set_xml_attr, unescape_xml, xml_empty_elements, xml_first_empty_tag_attr,
    xml_has_named_empty_tag, xml_named_empty_elements, xml_named_segments, SheetUpdate,
};

#[derive(Debug, Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
pub(super) struct XlsxCellStyle {
    pub(super) number_format: Option<String>,
    pub(super) font_family: Option<String>,
    pub(super) font_size: Option<String>,
    pub(super) bold: bool,
    pub(super) italic: bool,
    pub(super) underline: bool,
    pub(super) strikethrough: bool,
    pub(super) color: Option<String>,
    pub(super) fill_color: Option<String>,
    pub(super) align: Option<String>,
    pub(super) vertical_align: Option<String>,
    pub(super) wrap_text: bool,
}

#[derive(Debug, Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
struct XlsxFontStyle {
    family: Option<String>,
    size: Option<String>,
    bold: bool,
    italic: bool,
    underline: bool,
    strikethrough: bool,
    color: Option<String>,
}

#[derive(Debug, Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
struct XlsxCellXf {
    num_fmt_id: u32,
    font_id: usize,
    fill_id: usize,
    align: Option<String>,
    vertical_align: Option<String>,
    wrap_text: bool,
}

#[derive(Debug, Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
pub(super) struct XlsxDxfStyle {
    pub(super) fill_color: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(super) struct XlsxParsedStyles {
    num_formats: BTreeMap<u32, String>,
    fonts: Vec<XlsxFontStyle>,
    fills: Vec<Option<String>>,
    pub(super) dxfs: Vec<XlsxDxfStyle>,
    cell_xfs: Vec<XlsxCellXf>,
    pub(super) cell_styles: Vec<XlsxCellStyle>,
}

#[derive(Debug, Clone)]
pub(super) struct XlsxStyleWriter {
    pub(super) xml: String,
    parsed: XlsxParsedStyles,
    font_keys: BTreeMap<XlsxFontStyle, usize>,
    fill_keys: BTreeMap<Option<String>, usize>,
    dxf_keys: BTreeMap<XlsxDxfStyle, usize>,
    num_format_keys: BTreeMap<String, u32>,
    cell_xf_keys: BTreeMap<XlsxCellXf, usize>,
    pub(super) changed: bool,
}

pub(super) fn append_xlsx_style_to_cell_json(cell: &mut Value, style: &XlsxCellStyle) {
    if let Some(number_format) = &style.number_format {
        cell["numberFormat"] = json!(number_format);
    }
    if let Some(font_family) = &style.font_family {
        cell["fontFamily"] = json!(font_family);
    }
    if let Some(font_size) = &style.font_size {
        cell["fontSize"] = json!(font_size);
    }
    if style.bold {
        cell["bold"] = json!(true);
    }
    if style.italic {
        cell["italic"] = json!(true);
    }
    if style.underline {
        cell["underline"] = json!(true);
    }
    if style.strikethrough {
        cell["strikethrough"] = json!(true);
    }
    if let Some(color) = &style.color {
        cell["color"] = json!(format!("#{color}"));
    }
    if let Some(fill_color) = &style.fill_color {
        cell["fillColor"] = json!(format!("#{fill_color}"));
    }
    if let Some(align) = &style.align {
        cell["align"] = json!(align);
    }
    if let Some(vertical_align) = &style.vertical_align {
        cell["verticalAlign"] = json!(vertical_align);
    }
    if style.wrap_text {
        cell["wrapText"] = json!(true);
    }
}

pub(super) fn xlsx_cell_style_from_model(cell: &Value) -> Option<XlsxCellStyle> {
    let style = XlsxCellStyle {
        number_format: xlsx_model_string(cell, "numberFormat"),
        font_family: xlsx_model_string(cell, "fontFamily"),
        font_size: xlsx_model_string(cell, "fontSize")
            .filter(|value| value.parse::<f64>().map(|size| size > 0.0).unwrap_or(false)),
        bold: cell.get("bold").and_then(Value::as_bool).unwrap_or(false),
        italic: cell.get("italic").and_then(Value::as_bool).unwrap_or(false),
        underline: cell
            .get("underline")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        strikethrough: cell
            .get("strikethrough")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        color: cell
            .get("color")
            .and_then(Value::as_str)
            .and_then(xlsx_model_hex_color),
        fill_color: cell
            .get("fillColor")
            .and_then(Value::as_str)
            .and_then(xlsx_model_hex_color),
        align: xlsx_model_string(cell, "align")
            .filter(|value| matches!(value.as_str(), "left" | "center" | "right")),
        vertical_align: xlsx_model_string(cell, "verticalAlign")
            .filter(|value| matches!(value.as_str(), "top" | "middle" | "bottom")),
        wrap_text: cell
            .get("wrapText")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    };
    if xlsx_cell_style_is_empty(&style) {
        None
    } else {
        Some(style)
    }
}

fn xlsx_model_string(cell: &Value, key: &str) -> Option<String> {
    cell.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn xlsx_model_hex_color(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('#');
    if value.len() == 6 && value.chars().all(|character| character.is_ascii_hexdigit()) {
        Some(value.to_ascii_uppercase())
    } else {
        None
    }
}

fn xlsx_cell_style_is_empty(style: &XlsxCellStyle) -> bool {
    style.number_format.is_none()
        && style.font_family.is_none()
        && style.font_size.is_none()
        && !style.bold
        && !style.italic
        && !style.underline
        && !style.strikethrough
        && style.color.is_none()
        && style.fill_color.is_none()
        && style.align.is_none()
        && style.vertical_align.is_none()
        && !style.wrap_text
}

pub(super) fn xlsx_styles_from_xml(xml: &str) -> XlsxParsedStyles {
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

fn xlsx_num_formats(xml: &str) -> BTreeMap<u32, String> {
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

fn xlsx_builtin_num_format_id(format: &str) -> Option<u32> {
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

pub(super) fn xlsx_hex_color(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('#');
    let value = if value.len() == 8 { &value[2..] } else { value };
    if value.len() == 6 && value.chars().all(|character| character.is_ascii_hexdigit()) {
        Some(value.to_ascii_uppercase())
    } else {
        None
    }
}

impl XlsxStyleWriter {
    pub(super) fn new(xml: Option<String>) -> Self {
        let xml = xml.unwrap_or_else(default_xlsx_styles_xml);
        let parsed = xlsx_styles_from_xml(&xml);
        let mut font_keys = BTreeMap::new();
        for (index, font) in parsed.fonts.iter().cloned().enumerate() {
            font_keys.entry(font).or_insert(index);
        }
        let mut fill_keys = BTreeMap::new();
        for (index, fill) in parsed.fills.iter().cloned().enumerate() {
            fill_keys.entry(fill).or_insert(index);
        }
        let mut dxf_keys = BTreeMap::new();
        for (index, dxf) in parsed.dxfs.iter().cloned().enumerate() {
            dxf_keys.entry(dxf).or_insert(index);
        }
        let num_format_keys = parsed
            .num_formats
            .iter()
            .map(|(id, format)| (format.clone(), *id))
            .collect::<BTreeMap<_, _>>();
        let mut cell_xf_keys = BTreeMap::new();
        for (index, xf) in parsed.cell_xfs.iter().cloned().enumerate() {
            cell_xf_keys.entry(xf).or_insert(index);
        }
        Self {
            xml,
            parsed,
            font_keys,
            fill_keys,
            dxf_keys,
            num_format_keys,
            cell_xf_keys,
            changed: false,
        }
    }

    pub(super) fn assign_sheet_styles(&mut self, update: &mut SheetUpdate) {
        for cell in update.cells.values_mut() {
            if let Some(style) = cell.style.clone() {
                cell.style_index = Some(self.ensure_cell_style(&style));
            }
        }
        for formatting in &mut update.conditional_formattings {
            for rule in &mut formatting.rules {
                if let Some(fill_color) = rule.fill_color.clone() {
                    rule.dxf_id = Some(self.ensure_dxf_style(&XlsxDxfStyle {
                        fill_color: Some(fill_color),
                    }));
                }
            }
        }
    }

    fn ensure_cell_style(&mut self, style: &XlsxCellStyle) -> usize {
        if xlsx_cell_style_is_empty(style) {
            return 0;
        }
        let font_id = self.ensure_font(&xlsx_font_style_from_cell_style(style));
        let fill_id = self.ensure_fill(style.fill_color.clone());
        let num_fmt_id = self.ensure_num_format(style.number_format.as_deref());
        let xf = XlsxCellXf {
            num_fmt_id,
            font_id,
            fill_id,
            align: style.align.clone(),
            vertical_align: style.vertical_align.clone(),
            wrap_text: style.wrap_text,
        };
        if let Some(index) = self.cell_xf_keys.get(&xf) {
            return *index;
        }
        let index = self.parsed.cell_xfs.len();
        self.xml = append_to_xlsx_style_collection(
            &self.xml,
            "cellXfs",
            &xlsx_cell_xf_xml(&xf),
            index + 1,
        );
        self.parsed.cell_xfs.push(xf.clone());
        self.parsed.cell_styles.push(style.clone());
        self.cell_xf_keys.insert(xf, index);
        self.changed = true;
        index
    }

    fn ensure_font(&mut self, font: &XlsxFontStyle) -> usize {
        if xlsx_font_style_is_empty(font) {
            return 0;
        }
        if let Some(index) = self.font_keys.get(font) {
            return *index;
        }
        let index = self.parsed.fonts.len();
        self.xml =
            append_to_xlsx_style_collection(&self.xml, "fonts", &xlsx_font_xml(font), index + 1);
        self.parsed.fonts.push(font.clone());
        self.font_keys.insert(font.clone(), index);
        self.changed = true;
        index
    }

    fn ensure_fill(&mut self, fill_color: Option<String>) -> usize {
        if fill_color.is_none() {
            return 0;
        }
        if let Some(index) = self.fill_keys.get(&fill_color) {
            return *index;
        }
        let index = self.parsed.fills.len();
        self.xml = append_to_xlsx_style_collection(
            &self.xml,
            "fills",
            &xlsx_fill_xml(fill_color.as_deref().unwrap_or_default()),
            index + 1,
        );
        self.parsed.fills.push(fill_color.clone());
        self.fill_keys.insert(fill_color, index);
        self.changed = true;
        index
    }

    fn ensure_num_format(&mut self, format: Option<&str>) -> u32 {
        let Some(format) = format.map(str::trim).filter(|value| !value.is_empty()) else {
            return 0;
        };
        if let Some(id) = xlsx_builtin_num_format_id(format) {
            return id;
        }
        if let Some(id) = self.num_format_keys.get(format) {
            return *id;
        }
        let id = self
            .parsed
            .num_formats
            .keys()
            .filter(|id| **id >= 164)
            .max()
            .copied()
            .unwrap_or(163)
            + 1;
        self.xml = append_xlsx_num_format(&self.xml, id, format);
        self.parsed.num_formats.insert(id, format.to_string());
        self.num_format_keys.insert(format.to_string(), id);
        self.changed = true;
        id
    }

    fn ensure_dxf_style(&mut self, style: &XlsxDxfStyle) -> usize {
        if let Some(index) = self.dxf_keys.get(style) {
            return *index;
        }
        let index = self.parsed.dxfs.len();
        self.xml =
            append_to_xlsx_style_collection(&self.xml, "dxfs", &xlsx_dxf_xml(style), index + 1);
        self.parsed.dxfs.push(style.clone());
        self.dxf_keys.insert(style.clone(), index);
        self.changed = true;
        index
    }
}

fn xlsx_font_style_from_cell_style(style: &XlsxCellStyle) -> XlsxFontStyle {
    XlsxFontStyle {
        family: style.font_family.clone(),
        size: style.font_size.clone(),
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        strikethrough: style.strikethrough,
        color: style.color.clone(),
    }
}

fn xlsx_font_style_is_empty(font: &XlsxFontStyle) -> bool {
    font.family.is_none()
        && font.size.is_none()
        && !font.bold
        && !font.italic
        && !font.underline
        && !font.strikethrough
        && font.color.is_none()
}

fn xlsx_font_xml(font: &XlsxFontStyle) -> String {
    let mut output = String::from("<font>");
    if font.bold {
        output.push_str("<b/>");
    }
    if font.italic {
        output.push_str("<i/>");
    }
    if font.underline {
        output.push_str("<u/>");
    }
    if font.strikethrough {
        output.push_str("<strike/>");
    }
    if let Some(size) = &font.size {
        output.push_str(&format!(r#"<sz val="{}"/>"#, escape_xml(size)));
    }
    if let Some(color) = &font.color {
        output.push_str(&format!(r#"<color rgb="FF{color}"/>"#));
    }
    if let Some(family) = &font.family {
        output.push_str(&format!(r#"<name val="{}"/>"#, escape_xml(family)));
    }
    output.push_str("</font>");
    output
}

fn xlsx_fill_xml(color: &str) -> String {
    format!(
        r#"<fill><patternFill patternType="solid"><fgColor rgb="FF{color}"/><bgColor indexed="64"/></patternFill></fill>"#
    )
}

fn xlsx_dxf_xml(style: &XlsxDxfStyle) -> String {
    let Some(fill_color) = style.fill_color.as_deref() else {
        return "<dxf/>".to_string();
    };
    format!(
        r#"<dxf><fill><patternFill patternType="solid"><fgColor rgb="FF{fill_color}"/><bgColor indexed="64"/></patternFill></fill></dxf>"#
    )
}

fn xlsx_cell_xf_xml(xf: &XlsxCellXf) -> String {
    let mut attrs = format!(
        r#"numFmtId="{}" fontId="{}" fillId="{}" borderId="0" xfId="0""#,
        xf.num_fmt_id, xf.font_id, xf.fill_id
    );
    if xf.num_fmt_id != 0 {
        attrs.push_str(r#" applyNumberFormat="1""#);
    }
    if xf.font_id != 0 {
        attrs.push_str(r#" applyFont="1""#);
    }
    if xf.fill_id != 0 {
        attrs.push_str(r#" applyFill="1""#);
    }
    if xf.align.is_some() || xf.vertical_align.is_some() || xf.wrap_text {
        attrs.push_str(r#" applyAlignment="1""#);
        let mut alignment_attrs = Vec::new();
        if let Some(align) = &xf.align {
            alignment_attrs.push(format!(r#"horizontal="{align}""#));
        }
        if let Some(vertical) = &xf.vertical_align {
            let vertical = if vertical == "middle" {
                "center"
            } else {
                vertical
            };
            alignment_attrs.push(format!(r#"vertical="{vertical}""#));
        }
        if xf.wrap_text {
            alignment_attrs.push(r#"wrapText="1""#.to_string());
        }
        format!(
            "<xf {attrs}><alignment {}/></xf>",
            alignment_attrs.join(" ")
        )
    } else {
        format!("<xf {attrs}/>")
    }
}

fn append_to_xlsx_style_collection(xml: &str, tag: &str, child: &str, count: usize) -> String {
    let Some(start) = find_xml_tag_start(xml, tag) else {
        let collection = format!(r#"<{tag} count="{count}">{child}</{tag}>"#);
        return append_before_or_end(xml, "</styleSheet>", &collection);
    };
    let after_start = &xml[start..];
    let Some(open_end) = after_start.find('>') else {
        return xml.to_string();
    };
    let end_marker = format!("</{tag}>");
    let Some(close_start) = after_start.find(&end_marker) else {
        return xml.to_string();
    };
    let opening = set_xml_attr(&after_start[..=open_end], "count", &count.to_string());
    let mut output = String::new();
    output.push_str(&xml[..start]);
    output.push_str(&opening);
    output.push_str(&after_start[open_end + 1..close_start]);
    output.push_str(child);
    output.push_str(&after_start[close_start..]);
    output
}

fn append_xlsx_num_format(xml: &str, id: u32, format: &str) -> String {
    let child = format!(
        r#"<numFmt numFmtId="{id}" formatCode="{}"/>"#,
        escape_xml(format)
    );
    if find_xml_tag_start(xml, "numFmts").is_some() {
        let custom_count = xlsx_num_formats(xml).len() + 1;
        return append_to_xlsx_style_collection(xml, "numFmts", &child, custom_count);
    }
    let collection = format!(r#"<numFmts count="1">{child}</numFmts>"#);
    if let Some(index) = find_xml_tag_start(xml, "fonts") {
        let mut output = String::new();
        output.push_str(&xml[..index]);
        output.push_str(&collection);
        output.push_str(&xml[index..]);
        output
    } else {
        append_before_or_end(xml, "</styleSheet>", &collection)
    }
}

pub(super) fn ensure_xlsx_styles_relationship(rels: &str) -> String {
    if rels.contains("/relationships/styles") {
        return rels.to_string();
    }
    let rel_id = format!("rId{}", next_rid(rels));
    let rel = format!(
        r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#
    );
    append_before_or_end(rels, "</Relationships>", &rel)
}

pub(super) fn ensure_xlsx_styles_content_type(content_types: &str) -> String {
    if content_types.contains(r#"PartName="/xl/styles.xml""#) {
        return content_types.to_string();
    }
    let override_xml = r#"<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>"#;
    append_before_or_end(content_types, "</Types>", override_xml)
}

pub(super) fn ensure_xlsx_comments_content_types(
    content_types: &str,
    comments_paths: &[String],
    needs_vml: bool,
) -> String {
    let mut output = content_types.to_string();
    for path in comments_paths {
        let part_name = format!("/{path}");
        if output.contains(&format!(r#"PartName="{part_name}""#)) {
            continue;
        }
        let override_xml = format!(
            r#"<Override PartName="{part_name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>"#
        );
        output = append_before_or_end(&output, "</Types>", &override_xml);
    }
    if needs_vml {
        output = ensure_content_type_default(
            &output,
            "vml",
            "application/vnd.openxmlformats-officedocument.vmlDrawing",
        );
    }
    output
}

fn default_xlsx_styles_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#.to_string()
}
