use encoding_rs::{Encoding, WINDOWS_1252};

use crate::error::{AppError, AppResult};

pub(super) struct DecodedText {
    pub(super) content: String,
    pub(super) encoding: &'static str,
    pub(super) bom: bool,
}

pub(super) fn decode_text_bytes(bytes: &[u8], label: &str) -> AppResult<DecodedText> {
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

pub(super) fn encode_text_bytes(content: &str, encoding: &str, bom: bool) -> AppResult<Vec<u8>> {
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

pub(super) fn normalize_text_encoding_label(value: &str) -> Option<&'static str> {
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

pub(super) fn detect_text_line_ending(content: &str) -> &'static str {
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

pub(super) fn normalize_text_line_endings(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

pub(super) fn apply_text_line_ending(content: &str, line_ending: &str) -> String {
    if line_ending == "\n" {
        return content.to_string();
    }
    content.replace('\n', line_ending)
}

pub(super) fn has_text_trailing_newline(content: &str) -> bool {
    content.ends_with('\n') || content.ends_with('\r')
}

pub(super) fn has_utf8_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xEF, 0xBB, 0xBF])
}
