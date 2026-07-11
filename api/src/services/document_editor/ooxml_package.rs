//! OOXML ZIP package helpers.
//!
//! DOCX, XLSX, and PPTX files all share the same package container rules even
//! though their editable XML parts differ. Keeping ZIP reads, writes, and entry
//! replacement in one module gives every Office editor the same failure mode and
//! preserves unknown package entries while typed format modules replace only the
//! parts they own.

use std::collections::BTreeMap;
use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::{AppError, AppResult};
use crate::services::ooxml_security::{
    expand_ooxml_entries, ooxml_entry_names, read_ooxml_entry_bytes, read_ooxml_entry_text,
};

pub(super) fn replace_zip_entries(
    original: &[u8],
    replacements: &[(&str, Vec<u8>)],
) -> AppResult<Vec<u8>> {
    let entries = expand_ooxml_entries(original)?;
    let mut replacement_map = replacements
        .iter()
        .map(|(path, bytes)| ((*path).to_string(), bytes.as_slice()))
        .collect::<BTreeMap<_, _>>();
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    for entry in entries {
        let name = entry.name;
        if entry.is_dir {
            writer.add_directory(&name, options).map_err(map_zip)?;
            continue;
        }
        let bytes = replacement_map
            .remove(&name)
            .unwrap_or(entry.bytes.as_slice());
        writer.start_file(&name, options).map_err(map_zip)?;
        writer.write_all(bytes).map_err(map_io)?;
    }
    for (name, bytes) in replacement_map {
        writer.start_file(&name, options).map_err(map_zip)?;
        writer.write_all(bytes).map_err(map_io)?;
    }
    let cursor = writer.finish().map_err(map_zip)?;
    Ok(cursor.into_inner())
}

pub(super) fn read_zip_text(bytes: &[u8], path: &str) -> AppResult<String> {
    read_ooxml_entry_text(bytes, path)
}

pub(super) fn read_zip_bytes(bytes: &[u8], path: &str) -> AppResult<Vec<u8>> {
    read_ooxml_entry_bytes(bytes, path)
}

pub(super) fn zip_entry_names(bytes: &[u8]) -> AppResult<Vec<String>> {
    ooxml_entry_names(bytes)
}

pub(super) fn next_rid(rels: &str) -> usize {
    rels.split("Id=\"rId")
        .skip(1)
        .filter_map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse::<usize>()
                .ok()
        })
        .max()
        .unwrap_or(0)
        + 1
}

pub(super) fn replacement_zip_text_or_default<F>(
    original: &[u8],
    replacements: &[(String, Vec<u8>)],
    path: &str,
    default: F,
) -> String
where
    F: FnOnce() -> String,
{
    if let Some((_, bytes)) = replacements.iter().rev().find(|(name, _)| name == path) {
        if let Ok(text) = std::str::from_utf8(bytes) {
            return text.to_string();
        }
    }
    read_zip_text(original, path).unwrap_or_else(|_| default())
}

pub(super) fn upsert_zip_replacement(
    replacements: &mut Vec<(String, Vec<u8>)>,
    path: String,
    bytes: Vec<u8>,
) {
    if let Some((_, existing)) = replacements.iter_mut().find(|(name, _)| name == &path) {
        *existing = bytes;
        return;
    }
    replacements.push((path, bytes));
}

fn map_zip(error: zip::result::ZipError) -> AppError {
    AppError::BadRequest(format!("OOXML zip operation failed: {error}"))
}

fn map_io(error: std::io::Error) -> AppError {
    AppError::Internal(format!("document IO operation failed: {error}"))
}
