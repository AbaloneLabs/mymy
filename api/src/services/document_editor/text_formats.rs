//! Text-oriented document model conversion.
//!
//! These helpers own the preservation rules that are easy to lose when plain
//! text formats are treated as simple strings. The editor normalizes content for
//! the UI, but save paths must restore UTF-8 BOMs, line endings, trailing
//! newlines, and delimited-file quoting policy so files remain compatible with
//! external editors after a round trip through mymy.

use encoding_rs::{Encoding, WINDOWS_1252};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

pub(super) fn text_model(bytes: &[u8]) -> AppResult<Value> {
    let decoded = decode_text_bytes(bytes, "File")?;
    Ok(json!({
        "content": normalize_text_line_endings(&decoded.content),
        "encoding": decoded.encoding,
        "bom": decoded.bom,
        "lineEnding": detect_text_line_ending(&decoded.content),
        "trailingNewline": has_text_trailing_newline(&decoded.content),
    }))
}

pub(super) fn text_bytes(original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
    let content = model
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::BadRequest("Text model requires content".into()))?;
    let original_decoded = decode_text_bytes(original, "Original file").ok();
    let bom = model
        .get("bom")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| original_decoded.as_ref().is_some_and(|decoded| decoded.bom));
    let encoding = model
        .get("encoding")
        .and_then(Value::as_str)
        .and_then(normalize_text_encoding_label)
        .or_else(|| original_decoded.as_ref().map(|decoded| decoded.encoding))
        .unwrap_or("utf-8");
    let line_ending = model
        .get("lineEnding")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "\n" | "\r\n" | "\r"))
        .unwrap_or_else(|| {
            original_decoded
                .as_ref()
                .map_or("\n", |decoded| detect_text_line_ending(&decoded.content))
        });
    let normalized = normalize_text_line_endings(content);
    let serialized = apply_text_line_ending(&normalized, line_ending);
    encode_text_bytes(&serialized, encoding, bom)
}

pub(super) fn delimited_model(bytes: &[u8], delimiter: char) -> AppResult<Value> {
    let decoded = decode_text_bytes(bytes, "Delimited file")?;
    let delimiter = detect_delimited_delimiter(&decoded.content, delimiter);
    let quote_character = detect_delimited_quote_character(&decoded.content, delimiter);
    let escape_policy =
        detect_delimited_escape_policy(&decoded.content, delimiter, quote_character);
    let rows =
        parse_delimited_with_options(&decoded.content, delimiter, quote_character, escape_policy);
    let header_row = delimited_rows_look_like_header(&rows);
    Ok(json!({
        "rows": rows,
        "encoding": decoded.encoding,
        "bom": decoded.bom,
        "delimiter": delimiter.to_string(),
        "quoteCharacter": quote_character.to_string(),
        "escapePolicy": escape_policy,
        "headerRow": header_row,
        "columnTypes": infer_delimited_column_types(&rows, header_row),
        "quoteStyle": detect_delimited_quote_style(&decoded.content, delimiter, quote_character, escape_policy),
        "lineEnding": detect_text_line_ending(&decoded.content),
        "trailingNewline": has_text_trailing_newline(&decoded.content)
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
    let original_decoded = decode_text_bytes(original, "Original delimited file").ok();
    let original_content = original_decoded
        .as_ref()
        .map(|decoded| decoded.content.as_str())
        .unwrap_or_default();
    let original_delimiter = detect_delimited_delimiter(original_content, delimiter);
    let original_quote_character =
        detect_delimited_quote_character(original_content, original_delimiter);
    let original_escape_policy = detect_delimited_escape_policy(
        original_content,
        original_delimiter,
        original_quote_character,
    );
    let delimiter = model
        .get("delimiter")
        .and_then(Value::as_str)
        .and_then(delimited_model_char)
        .unwrap_or(original_delimiter);
    let quote_character = model
        .get("quoteCharacter")
        .and_then(Value::as_str)
        .and_then(delimited_model_char)
        .unwrap_or(original_quote_character);
    let escape_policy = model
        .get("escapePolicy")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "double" | "backslash"))
        .unwrap_or(original_escape_policy);
    let bom = model
        .get("bom")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| original_decoded.as_ref().is_some_and(|decoded| decoded.bom));
    let encoding = model
        .get("encoding")
        .and_then(Value::as_str)
        .and_then(normalize_text_encoding_label)
        .or_else(|| original_decoded.as_ref().map(|decoded| decoded.encoding))
        .unwrap_or("utf-8");
    let line_ending = model
        .get("lineEnding")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "\n" | "\r\n" | "\r"))
        .unwrap_or_else(|| {
            original_decoded
                .as_ref()
                .map_or("\n", |decoded| detect_text_line_ending(&decoded.content))
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
            detect_delimited_quote_style(
                original_content,
                original_delimiter,
                original_quote_character,
                original_escape_policy,
            )
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
                                quote_character,
                                escape_policy,
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
    encode_text_bytes(&content, encoding, bom)
}

pub(super) fn has_utf8_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xEF, 0xBB, 0xBF])
}

struct DecodedText {
    content: String,
    encoding: &'static str,
    bom: bool,
}

fn decode_text_bytes(bytes: &[u8], label: &str) -> AppResult<DecodedText> {
    if has_utf8_bom(bytes) {
        let content = std::str::from_utf8(&bytes[3..])
            .map_err(|_| AppError::BadRequest(format!("{label} is not valid UTF-8")))?;
        return Ok(DecodedText {
            content: content.to_string(),
            encoding: "utf-8",
            bom: true,
        });
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Ok(DecodedText {
            content: decode_utf16_bytes(&bytes[2..], true, label)?,
            encoding: "utf-16le",
            bom: true,
        });
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Ok(DecodedText {
            content: decode_utf16_bytes(&bytes[2..], false, label)?,
            encoding: "utf-16be",
            bom: true,
        });
    }
    if let Ok(content) = std::str::from_utf8(bytes) {
        return Ok(DecodedText {
            content: content.to_string(),
            encoding: "utf-8",
            bom: false,
        });
    }
    let (content, had_errors) = WINDOWS_1252.decode_without_bom_handling(bytes);
    if had_errors {
        return Err(AppError::BadRequest(format!(
            "{label} cannot be decoded as UTF-8, UTF-16, or Windows-1252"
        )));
    }
    Ok(DecodedText {
        content: content.into_owned(),
        encoding: "windows-1252",
        bom: false,
    })
}

fn decode_utf16_bytes(bytes: &[u8], little_endian: bool, label: &str) -> AppResult<String> {
    if !bytes.len().is_multiple_of(2) {
        return Err(AppError::BadRequest(format!(
            "{label} has an invalid UTF-16 byte length"
        )));
    }
    let units = bytes
        .chunks_exact(2)
        .map(|chunk| {
            let pair = [chunk[0], chunk[1]];
            if little_endian {
                u16::from_le_bytes(pair)
            } else {
                u16::from_be_bytes(pair)
            }
        })
        .collect::<Vec<_>>();
    String::from_utf16(&units)
        .map_err(|_| AppError::BadRequest(format!("{label} is not valid UTF-16")))
}

fn encode_text_bytes(content: &str, encoding: &str, bom: bool) -> AppResult<Vec<u8>> {
    let mut output = Vec::new();
    match encoding {
        "utf-16le" => {
            if bom {
                output.extend_from_slice(&[0xFF, 0xFE]);
            }
            for unit in content.encode_utf16() {
                output.extend_from_slice(&unit.to_le_bytes());
            }
        }
        "utf-16be" => {
            if bom {
                output.extend_from_slice(&[0xFE, 0xFF]);
            }
            for unit in content.encode_utf16() {
                output.extend_from_slice(&unit.to_be_bytes());
            }
        }
        "windows-1252" => {
            let (encoded, _, had_errors) = WINDOWS_1252.encode(content);
            if had_errors {
                return Err(AppError::BadRequest(
                    "Content contains characters that cannot be encoded as Windows-1252".into(),
                ));
            }
            output.extend_from_slice(&encoded);
        }
        _ => {
            if bom {
                output.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            output.extend_from_slice(content.as_bytes());
        }
    }
    Ok(output)
}

fn normalize_text_encoding_label(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_lowercase().replace('_', "-");
    match normalized.as_str() {
        "utf8" | "utf-8" => Some("utf-8"),
        "utf16le" | "utf-16le" | "utf-16-le" => Some("utf-16le"),
        "utf16be" | "utf-16be" | "utf-16-be" => Some("utf-16be"),
        "windows-1252" | "cp1252" | "latin1" | "latin-1" | "iso-8859-1" => Some("windows-1252"),
        other => Encoding::for_label(other.as_bytes()).and_then(|encoding| {
            if encoding == WINDOWS_1252 {
                Some("windows-1252")
            } else {
                None
            }
        }),
    }
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
    parse_delimited_with_options(content, delimiter, '"', "double")
}

fn parse_delimited_with_options(
    content: &str,
    delimiter: char,
    quote_character: char,
    escape_policy: &str,
) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut chars = content.chars().peekable();
    let mut quoted = false;
    while let Some(ch) = chars.next() {
        if quoted {
            if escape_policy == "backslash" && ch == '\\' {
                if let Some(next) = chars.next() {
                    cell.push(next);
                } else {
                    cell.push(ch);
                }
            } else if ch == quote_character {
                if escape_policy == "double" && chars.peek() == Some(&quote_character) {
                    cell.push(quote_character);
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                cell.push(ch);
            }
            continue;
        }
        if ch == quote_character && cell.is_empty() {
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

fn detect_delimited_delimiter(content: &str, default_delimiter: char) -> char {
    let mut candidates = vec![default_delimiter, ',', '\t', ';', '|'];
    candidates.sort_unstable();
    candidates.dedup();
    let mut best = default_delimiter;
    let mut best_score = delimiter_score(content, default_delimiter);
    for candidate in candidates {
        let score = delimiter_score(content, candidate);
        if score > best_score {
            best = candidate;
            best_score = score;
        }
    }
    best
}

fn delimiter_score(content: &str, delimiter: char) -> usize {
    let rows = parse_delimited(content, delimiter);
    if rows.is_empty() {
        return 0;
    }
    let mut widths = rows
        .iter()
        .map(|row| row.len())
        .filter(|width| *width > 0)
        .collect::<Vec<_>>();
    if widths.is_empty() {
        return 0;
    }
    widths.sort_unstable();
    let mode_width = widths
        .iter()
        .copied()
        .max_by_key(|width| widths.iter().filter(|item| *item == width).count())
        .unwrap_or(1);
    if mode_width <= 1 {
        return 0;
    }
    let consistent_rows = widths.iter().filter(|width| **width == mode_width).count();
    let delimiter_hits = content.chars().filter(|ch| *ch == delimiter).count();
    consistent_rows * 1000 + mode_width * 100 + delimiter_hits
}

fn detect_delimited_quote_character(content: &str, delimiter: char) -> char {
    let double_score = quote_character_score(content, delimiter, '"');
    let single_score = quote_character_score(content, delimiter, '\'');
    if single_score > double_score {
        '\''
    } else {
        '"'
    }
}

fn quote_character_score(content: &str, delimiter: char, quote_character: char) -> usize {
    let mut score = 0usize;
    let mut cell_start = true;
    let mut quoted = false;
    let mut chars = content.chars().peekable();
    while let Some(ch) = chars.next() {
        if cell_start {
            cell_start = false;
            if ch == quote_character {
                score += 1;
                quoted = true;
                continue;
            }
        }
        if quoted {
            if ch == quote_character {
                if chars.peek() == Some(&quote_character) {
                    chars.next();
                } else {
                    quoted = false;
                }
            }
        } else if ch == delimiter || ch == '\n' || ch == '\r' {
            if ch == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            cell_start = true;
        }
    }
    score
}

fn detect_delimited_escape_policy(
    content: &str,
    delimiter: char,
    quote_character: char,
) -> &'static str {
    let mut double_escape_count = 0usize;
    let mut backslash_escape_count = 0usize;
    let mut quoted = false;
    let mut cell_start = true;
    let mut chars = content.chars().peekable();
    while let Some(ch) = chars.next() {
        if cell_start {
            cell_start = false;
            if ch == quote_character {
                quoted = true;
                continue;
            }
        }
        if quoted {
            if ch == '\\' && chars.peek() == Some(&quote_character) {
                backslash_escape_count += 1;
                chars.next();
            } else if ch == quote_character {
                if chars.peek() == Some(&quote_character) {
                    double_escape_count += 1;
                    chars.next();
                } else {
                    quoted = false;
                }
            }
        } else if ch == delimiter || ch == '\n' || ch == '\r' {
            if ch == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            cell_start = true;
        }
    }
    if backslash_escape_count > double_escape_count {
        "backslash"
    } else {
        "double"
    }
}

fn detect_delimited_quote_style(
    content: &str,
    delimiter: char,
    quote_character: char,
    escape_policy: &str,
) -> &'static str {
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
            if ch == quote_character {
                quoted_count += 1;
                quoted = true;
                continue;
            }
        }
        if quoted {
            if escape_policy == "backslash" && ch == '\\' {
                chars.next();
            } else if ch == quote_character {
                if escape_policy == "double" && chars.peek() == Some(&quote_character) {
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

fn escape_delimited_cell(
    value: &str,
    delimiter: char,
    quote_character: char,
    escape_policy: &str,
    quote_style: &str,
) -> String {
    let must_quote = quote_style == "always"
        || value.contains(delimiter)
        || value.contains(quote_character)
        || value.contains('\n')
        || value.contains('\r')
        || value.starts_with(char::is_whitespace)
        || value.ends_with(char::is_whitespace);
    if must_quote {
        let escaped = if escape_policy == "backslash" {
            value
                .replace('\\', "\\\\")
                .replace(quote_character, &format!("\\{quote_character}"))
        } else {
            value.replace(
                quote_character,
                &format!("{quote_character}{quote_character}"),
            )
        };
        format!("{quote_character}{escaped}{quote_character}")
    } else {
        value.to_string()
    }
}

fn delimited_model_char(value: &str) -> Option<char> {
    let mut chars = value.chars();
    let first = chars.next()?;
    if chars.next().is_none() && !matches!(first, '\n' | '\r') {
        Some(first)
    } else {
        None
    }
}

fn delimited_rows_look_like_header(rows: &[Vec<String>]) -> bool {
    if rows.len() < 2 {
        return false;
    }
    let first = &rows[0];
    let second = &rows[1];
    let column_count = first.len().max(second.len());
    if column_count == 0 {
        return false;
    }
    let mut label_like = 0usize;
    let mut type_shift = 0usize;
    let mut non_empty_headers = std::collections::BTreeSet::new();
    for index in 0..column_count {
        let header = first.get(index).map_or("", String::as_str).trim();
        let value = second.get(index).map_or("", String::as_str).trim();
        if header
            .chars()
            .next()
            .is_some_and(|ch| !ch.is_ascii_digit() && !ch.is_whitespace())
        {
            label_like += 1;
        }
        if !header.is_empty() {
            non_empty_headers.insert(header.to_ascii_lowercase());
        }
        if !header.is_empty()
            && !value.is_empty()
            && infer_delimited_cell_type(header) != infer_delimited_cell_type(value)
        {
            type_shift += 1;
        }
    }
    label_like >= column_count.div_ceil(2)
        && (type_shift > 0 || non_empty_headers.len() == column_count)
}

fn infer_delimited_column_types(rows: &[Vec<String>], header_row: bool) -> Vec<String> {
    let column_count = rows.iter().map(Vec::len).max().unwrap_or(0);
    let body = if header_row && rows.len() > 1 {
        &rows[1..]
    } else {
        rows
    };
    (0..column_count)
        .map(|index| {
            let values = body
                .iter()
                .filter_map(|row| row.get(index))
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            infer_delimited_column_type(&values).to_string()
        })
        .collect()
}

fn infer_delimited_column_type(values: &[&str]) -> &'static str {
    if values.is_empty() {
        return "empty";
    }
    let mut counts = std::collections::BTreeMap::<&'static str, usize>::new();
    for value in values {
        let entry = counts.entry(infer_delimited_cell_type(value)).or_default();
        *entry += 1;
    }
    let Some((kind, count)) = counts.into_iter().max_by_key(|(_, count)| *count) else {
        return "empty";
    };
    if count * 100 >= values.len() * 85 {
        kind
    } else {
        "mixed"
    }
}

fn infer_delimited_cell_type(value: &str) -> &'static str {
    let normalized = value.trim();
    if normalized.is_empty() {
        return "empty";
    }
    if normalized.eq_ignore_ascii_case("true") || normalized.eq_ignore_ascii_case("false") {
        return "boolean";
    }
    if normalized.replace(',', "").parse::<f64>().is_ok() {
        return "number";
    }
    if delimited_date_like(normalized) {
        return "date";
    }
    "text"
}

fn delimited_date_like(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 8
        && bytes.get(4).is_some_and(|ch| *ch == b'-' || *ch == b'/')
        && bytes.iter().take(4).all(u8::is_ascii_digit)
}
