//! Text-oriented document model conversion.
//!
//! These helpers own the preservation rules that are easy to lose when plain
//! text formats are treated as simple strings. The editor normalizes content for
//! the UI, but save paths must restore UTF-8 BOMs, line endings, trailing
//! newlines, and delimited-file quoting policy so files remain compatible with
//! external editors after a round trip through mymy.

use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

pub(super) fn text_model(bytes: &[u8]) -> AppResult<Value> {
    let bom = has_utf8_bom(bytes);
    let body = if bom { &bytes[3..] } else { bytes };
    let content = std::str::from_utf8(body)
        .map_err(|_| AppError::BadRequest("File is not valid UTF-8".into()))?;
    Ok(json!({
        "content": normalize_text_line_endings(content),
        "encoding": "utf-8",
        "bom": bom,
        "lineEnding": detect_text_line_ending(content),
        "trailingNewline": has_text_trailing_newline(content),
    }))
}

pub(super) fn text_bytes(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let content = model
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::BadRequest("Text model requires content".into()))?;
    let bom = model
        .get("bom")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| has_utf8_bom(original));
    let line_ending = model
        .get("lineEnding")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "\n" | "\r\n" | "\r"))
        .unwrap_or_else(|| {
            let original_body = if has_utf8_bom(original) {
                &original[3..]
            } else {
                original
            };
            std::str::from_utf8(original_body)
                .ok()
                .map(detect_text_line_ending)
                .unwrap_or("\n")
        });
    let normalized = normalize_text_line_endings(content);
    let serialized = apply_text_line_ending(&normalized, line_ending);
    let mut bytes = Vec::with_capacity(serialized.len() + if bom { 3 } else { 0 });
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(serialized.as_bytes());
    Ok(bytes)
}

pub(super) fn delimited_model(bytes: &[u8], delimiter: char) -> AppResult<Value> {
    let bom = has_utf8_bom(bytes);
    let body = if bom { &bytes[3..] } else { bytes };
    let content = std::str::from_utf8(body)
        .map_err(|_| AppError::BadRequest("Delimited file is not valid UTF-8".into()))?;
    Ok(json!({
        "rows": parse_delimited(content, delimiter),
        "encoding": "utf-8",
        "bom": bom,
        "quoteStyle": detect_delimited_quote_style(content, delimiter),
        "lineEnding": detect_text_line_ending(content),
        "trailingNewline": has_text_trailing_newline(content)
    }))
}

pub(super) fn delimited_bytes(
    original: &[u8],
    model: &Value,
    delimiter: char,
) -> AppResult<Vec<u8>> {
    let rows = model
        .get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::BadRequest("Delimited model requires rows".into()))?;
    let bom = model
        .get("bom")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| has_utf8_bom(original));
    let line_ending = model
        .get("lineEnding")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "\n" | "\r\n" | "\r"))
        .unwrap_or_else(|| {
            let original_body = if has_utf8_bom(original) {
                &original[3..]
            } else {
                original
            };
            std::str::from_utf8(original_body)
                .ok()
                .map(detect_text_line_ending)
                .unwrap_or("\n")
        });
    let trailing_newline = model
        .get("trailingNewline")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let quote_style = model
        .get("quoteStyle")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "minimal" | "always"))
        .unwrap_or_else(|| {
            let original_body = if has_utf8_bom(original) {
                &original[3..]
            } else {
                original
            };
            std::str::from_utf8(original_body)
                .ok()
                .map(|content| detect_delimited_quote_style(content, delimiter))
                .unwrap_or("minimal")
        });
    let mut content = rows
        .iter()
        .map(|row| {
            row.as_array()
                .map(|cells| {
                    cells
                        .iter()
                        .map(|cell| {
                            escape_delimited_cell(
                                cell.as_str().unwrap_or_default(),
                                delimiter,
                                quote_style,
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(&delimiter.to_string())
                })
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(line_ending);
    if trailing_newline {
        content.push_str(line_ending);
    }
    let mut bytes = Vec::with_capacity(content.len() + if bom { 3 } else { 0 });
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(content.as_bytes());
    Ok(bytes)
}

pub(super) fn has_utf8_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xEF, 0xBB, 0xBF])
}

fn detect_text_line_ending(content: &str) -> &'static str {
    let bytes = content.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => return "\r\n",
            b'\r' => return "\r",
            b'\n' => return "\n",
            _ => index += 1,
        }
    }
    "\n"
}

fn normalize_text_line_endings(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn apply_text_line_ending(content: &str, line_ending: &str) -> String {
    if line_ending == "\n" {
        return content.to_string();
    }
    content.replace('\n', line_ending)
}

fn has_text_trailing_newline(content: &str) -> bool {
    content.ends_with('\n') || content.ends_with('\r')
}

pub(super) fn parse_delimited(content: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut chars = content.chars().peekable();
    let mut quoted = false;
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    cell.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                cell.push(ch);
            }
            continue;
        }
        if ch == '"' && cell.is_empty() {
            quoted = true;
        } else if ch == delimiter {
            row.push(std::mem::take(&mut cell));
        } else if ch == '\n' {
            row.push(std::mem::take(&mut cell));
            rows.push(std::mem::take(&mut row));
        } else if ch == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            row.push(std::mem::take(&mut cell));
            rows.push(std::mem::take(&mut row));
        } else {
            cell.push(ch);
        }
    }
    if quoted || !cell.is_empty() || !row.is_empty() || content.ends_with(delimiter) {
        row.push(cell);
    }
    if !row.is_empty() {
        rows.push(row);
    }
    rows
}

fn detect_delimited_quote_style(content: &str, delimiter: char) -> &'static str {
    if content.is_empty() {
        return "minimal";
    }
    let mut cell_count = 0usize;
    let mut quoted_count = 0usize;
    let mut chars = content.chars().peekable();
    let mut quoted = false;
    let mut cell_start = true;
    while let Some(ch) = chars.next() {
        if cell_start {
            cell_count += 1;
            cell_start = false;
            if ch == '"' {
                quoted_count += 1;
                quoted = true;
                continue;
            }
        }
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                } else {
                    quoted = false;
                }
            }
            continue;
        }
        if ch == delimiter || ch == '\n' {
            cell_start = true;
        } else if ch == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            cell_start = true;
        }
    }
    if cell_count > 0 && cell_count == quoted_count {
        "always"
    } else {
        "minimal"
    }
}

fn escape_delimited_cell(value: &str, delimiter: char, quote_style: &str) -> String {
    let must_quote = quote_style == "always"
        || value.contains(delimiter)
        || value.contains('"')
        || value.contains('\n')
        || value.contains('\r');
    if must_quote {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}
