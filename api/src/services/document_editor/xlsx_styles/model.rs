use serde_json::{json, Value};

use super::*;

pub(in crate::services::document_editor) fn append_xlsx_style_to_cell_json(
    cell: &mut Value,
    style: &XlsxCellStyle,
) {
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

pub(in crate::services::document_editor) fn xlsx_cell_style_from_model(
    cell: &Value,
) -> Option<XlsxCellStyle> {
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

pub(super) fn xlsx_cell_style_is_empty(style: &XlsxCellStyle) -> bool {
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
