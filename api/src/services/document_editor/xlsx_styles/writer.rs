use super::super::{
    append_before_or_end, escape_xml, find_xml_tag_start, set_xml_attr, SheetUpdate,
};
use super::*;

impl XlsxStyleWriter {
    pub(in crate::services::document_editor) fn new(xml: Option<String>) -> Self {
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

    pub(in crate::services::document_editor) fn assign_sheet_styles(
        &mut self,
        update: &mut SheetUpdate,
    ) {
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

fn default_xlsx_styles_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#.to_string()
}
