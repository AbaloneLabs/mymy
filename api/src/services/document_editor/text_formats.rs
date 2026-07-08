//! Text-oriented document model conversion.
//!
//! These helpers own the preservation rules that are easy to lose when plain
//! text formats are treated as simple strings. The editor normalizes content for
//! the UI, but save paths must restore UTF-8 BOMs, line endings, trailing
//! newlines, and delimited-file quoting policy so files remain compatible with
//! external editors after a round trip through mymy.

mod delimited;
mod encoding;

use serde_json::{json, Value};

use self::encoding::{
    apply_text_line_ending, decode_text_bytes, detect_text_line_ending, encode_text_bytes,
    has_text_trailing_newline, normalize_text_encoding_label, normalize_text_line_endings,
};
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
    delimited::delimited_model(bytes, delimiter)
}

pub(super) fn delimited_bytes(
    original: &[u8],
    model: &Value,
    delimiter: char,
) -> AppResult<Vec<u8>> {
    delimited::delimited_bytes(original, model, delimiter)
}

#[cfg(test)]
pub(super) fn parse_delimited(content: &str, delimiter: char) -> Vec<Vec<String>> {
    delimited::parse_delimited(content, delimiter)
}

pub(super) fn has_utf8_bom(bytes: &[u8]) -> bool {
    encoding::has_utf8_bom(bytes)
}
