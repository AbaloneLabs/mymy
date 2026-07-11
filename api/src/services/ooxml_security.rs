//! Central admission and bounded reading for untrusted OOXML ZIP packages.
//!
//! Every production reader of DOCX, XLSX, or PPTX bytes must enter through
//! this module before expanding an entry. ZIP central-directory sizes are only
//! hints supplied by an attacker, so admission validates both declared values
//! and the bytes observed by a counting reader. The same policy is used for
//! model reads, mutation input, mutation output, and Drive text preview; this
//! prevents a less-visible converter from bypassing the editor's limits.

use std::collections::HashSet;
use std::io::{Cursor, Read};

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use unicode_normalization::UnicodeNormalization as _;
use zip::{CompressionMethod, ZipArchive};

use crate::error::{AppError, AppResult};
use crate::services::document_conversion::checkpoint;

pub(crate) const DEFAULT_OOXML_SECURITY_LIMITS: OoxmlSecurityLimits = OoxmlSecurityLimits {
    compressed_package_bytes: 128 * 1024 * 1024,
    entry_count: 4_096,
    entry_name_bytes: 512,
    entry_expanded_bytes: 64 * 1024 * 1024,
    aggregate_expanded_bytes: 256 * 1024 * 1024,
    compression_ratio: 200,
    compression_ratio_min_expanded_bytes: 64 * 1024,
    unknown_entry_count: 256,
    unknown_expanded_bytes: 32 * 1024 * 1024,
    xml_bytes: 32 * 1024 * 1024,
    xml_depth: 256,
    xml_attributes_per_element: 256,
    xml_attribute_bytes: 256 * 1024,
    xml_text_node_bytes: 4 * 1024 * 1024,
    xml_events: 2_000_000,
};

#[derive(Clone, Copy, Debug)]
pub(crate) struct OoxmlSecurityLimits {
    pub(crate) compressed_package_bytes: u64,
    pub(crate) entry_count: usize,
    pub(crate) entry_name_bytes: usize,
    pub(crate) entry_expanded_bytes: u64,
    pub(crate) aggregate_expanded_bytes: u64,
    pub(crate) compression_ratio: u64,
    pub(crate) compression_ratio_min_expanded_bytes: u64,
    pub(crate) unknown_entry_count: usize,
    pub(crate) unknown_expanded_bytes: u64,
    pub(crate) xml_bytes: usize,
    pub(crate) xml_depth: usize,
    pub(crate) xml_attributes_per_element: usize,
    pub(crate) xml_attribute_bytes: usize,
    pub(crate) xml_text_node_bytes: usize,
    pub(crate) xml_events: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct AdmittedOoxmlEntry {
    pub(crate) name: String,
    pub(crate) is_dir: bool,
    pub(crate) declared_expanded_bytes: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct AdmittedOoxmlPackage {
    pub(crate) entries: Vec<AdmittedOoxmlEntry>,
    pub(crate) declared_expanded_bytes: u64,
}

#[derive(Debug)]
pub(crate) struct ExpandedOoxmlEntry {
    pub(crate) name: String,
    pub(crate) is_dir: bool,
    pub(crate) bytes: Vec<u8>,
}

pub(crate) fn admit_ooxml_package(bytes: &[u8]) -> AppResult<AdmittedOoxmlPackage> {
    admit_ooxml_package_with_limits(bytes, DEFAULT_OOXML_SECURITY_LIMITS)
}

pub(crate) fn validate_ooxml_compressed_size(size: u64) -> AppResult<()> {
    if size > DEFAULT_OOXML_SECURITY_LIMITS.compressed_package_bytes {
        return Err(limit_exceeded(
            "compressed_package_bytes",
            "OOXML package exceeds the compressed input limit",
        ));
    }
    Ok(())
}

pub(crate) fn ooxml_entry_names(bytes: &[u8]) -> AppResult<Vec<String>> {
    Ok(admit_ooxml_package(bytes)?
        .entries
        .into_iter()
        .map(|entry| entry.name)
        .collect())
}

pub(crate) fn read_ooxml_entry_bytes(bytes: &[u8], path: &str) -> AppResult<Vec<u8>> {
    read_ooxml_entry_bytes_with_limits(bytes, path, DEFAULT_OOXML_SECURITY_LIMITS)
}

pub(crate) fn read_ooxml_entry_text(bytes: &[u8], path: &str) -> AppResult<String> {
    let output = read_ooxml_entry_bytes(bytes, path)?;
    String::from_utf8(output)
        .map_err(|_| invalid_package("ooxml_xml_encoding", "OOXML XML must be valid UTF-8"))
}

pub(crate) fn expand_ooxml_entries(bytes: &[u8]) -> AppResult<Vec<ExpandedOoxmlEntry>> {
    expand_ooxml_entries_with_limits(bytes, DEFAULT_OOXML_SECURITY_LIMITS)
}

fn admit_ooxml_package_with_limits(
    bytes: &[u8],
    limits: OoxmlSecurityLimits,
) -> AppResult<AdmittedOoxmlPackage> {
    checkpoint()?;
    if bytes.len() as u64 > limits.compressed_package_bytes {
        return Err(limit_exceeded(
            "compressed_package_bytes",
            "OOXML package exceeds the compressed input limit",
        ));
    }
    preflight_central_directory(bytes)?;
    let mut archive = open_archive(bytes)?;
    if archive.len() > limits.entry_count {
        return Err(limit_exceeded(
            "entry_count",
            "OOXML package contains too many entries",
        ));
    }

    let mut entries = Vec::with_capacity(archive.len());
    let mut canonical_names = HashSet::with_capacity(archive.len());
    let mut declared_expanded_bytes = 0_u64;
    let mut unknown_count = 0_usize;
    let mut unknown_bytes = 0_u64;

    for index in 0..archive.len() {
        checkpoint()?;
        let file = archive.by_index(index).map_err(map_untrusted_zip)?;
        let name = validate_entry_name(file.name(), file.is_dir(), limits)?;
        let canonical = canonical_entry_name(&name);
        if !canonical_names.insert(canonical) {
            return Err(invalid_package(
                "duplicate_entry_name",
                "OOXML package contains duplicate or ambiguous entry names",
            ));
        }
        if file.is_symlink() {
            return Err(invalid_package(
                "symlink_entry",
                "OOXML package cannot contain symbolic-link entries",
            ));
        }
        if file.encrypted() {
            return Err(unsupported_package(
                "encrypted_archive",
                "Encrypted OOXML packages are not supported",
            ));
        }
        if !matches!(
            file.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            return Err(unsupported_package(
                "compression_method",
                "OOXML package uses an unsupported compression method",
            ));
        }

        let expanded = file.size();
        if expanded > limits.entry_expanded_bytes {
            return Err(limit_exceeded(
                "entry_expanded_bytes",
                "OOXML entry exceeds the per-entry expansion limit",
            ));
        }
        declared_expanded_bytes =
            declared_expanded_bytes
                .checked_add(expanded)
                .ok_or_else(|| {
                    limit_exceeded(
                        "aggregate_expanded_bytes",
                        "OOXML declared expansion size overflowed",
                    )
                })?;
        if declared_expanded_bytes > limits.aggregate_expanded_bytes {
            return Err(limit_exceeded(
                "aggregate_expanded_bytes",
                "OOXML package exceeds the aggregate expansion limit",
            ));
        }
        validate_compression_ratio(file.compressed_size(), expanded, limits)?;

        if !is_known_ooxml_part(&name) {
            unknown_count += 1;
            unknown_bytes = unknown_bytes.checked_add(expanded).ok_or_else(|| {
                limit_exceeded(
                    "unknown_expanded_bytes",
                    "OOXML unknown-part size overflowed",
                )
            })?;
            if unknown_count > limits.unknown_entry_count {
                return Err(limit_exceeded(
                    "unknown_entry_count",
                    "OOXML package contains too many unknown parts",
                ));
            }
            if unknown_bytes > limits.unknown_expanded_bytes {
                return Err(limit_exceeded(
                    "unknown_expanded_bytes",
                    "OOXML unknown parts exceed the preservation budget",
                ));
            }
        }

        entries.push(AdmittedOoxmlEntry {
            name,
            is_dir: file.is_dir(),
            declared_expanded_bytes: expanded,
        });
    }

    metrics::counter!("mymy_ooxml_admissions_total", "outcome" => "accepted").increment(1);
    metrics::histogram!("mymy_ooxml_declared_expanded_bytes")
        .record(declared_expanded_bytes as f64);
    Ok(AdmittedOoxmlPackage {
        entries,
        declared_expanded_bytes,
    })
}

fn read_ooxml_entry_bytes_with_limits(
    bytes: &[u8],
    path: &str,
    limits: OoxmlSecurityLimits,
) -> AppResult<Vec<u8>> {
    let admission = admit_ooxml_package_with_limits(bytes, limits)?;
    let entry = admission
        .entries
        .iter()
        .find(|entry| entry.name == path && !entry.is_dir)
        .ok_or_else(|| invalid_package("missing_entry", "OOXML package entry is missing"))?;
    let mut archive = open_archive(bytes)?;
    let file = archive.by_name(path).map_err(map_untrusted_zip)?;
    let output = read_bounded_entry(file, entry.declared_expanded_bytes, limits)?;
    validate_xml_part(path, &output, limits)?;
    Ok(output)
}

fn expand_ooxml_entries_with_limits(
    bytes: &[u8],
    limits: OoxmlSecurityLimits,
) -> AppResult<Vec<ExpandedOoxmlEntry>> {
    let admission = admit_ooxml_package_with_limits(bytes, limits)?;
    let mut archive = open_archive(bytes)?;
    let mut actual_total = 0_u64;
    let mut output = Vec::with_capacity(admission.entries.len());
    for (index, entry) in admission.entries.iter().enumerate() {
        let file = archive.by_index(index).map_err(map_untrusted_zip)?;
        if entry.is_dir {
            output.push(ExpandedOoxmlEntry {
                name: entry.name.clone(),
                is_dir: true,
                bytes: Vec::new(),
            });
            continue;
        }
        let contents = read_bounded_entry(file, entry.declared_expanded_bytes, limits)?;
        actual_total = actual_total
            .checked_add(contents.len() as u64)
            .ok_or_else(|| {
                limit_exceeded(
                    "actual_aggregate_expanded_bytes",
                    "OOXML actual expansion size overflowed",
                )
            })?;
        if actual_total > limits.aggregate_expanded_bytes {
            return Err(limit_exceeded(
                "actual_aggregate_expanded_bytes",
                "OOXML actual expansion exceeds the aggregate limit",
            ));
        }
        validate_xml_part(&entry.name, &contents, limits)?;
        output.push(ExpandedOoxmlEntry {
            name: entry.name.clone(),
            is_dir: false,
            bytes: contents,
        });
    }
    if actual_total != admission.declared_expanded_bytes {
        return Err(invalid_package(
            "declared_size_mismatch",
            "OOXML actual expansion differs from declared entry sizes",
        ));
    }
    Ok(output)
}

fn read_bounded_entry<R: Read>(
    mut reader: R,
    declared_size: u64,
    limits: OoxmlSecurityLimits,
) -> AppResult<Vec<u8>> {
    let maximum = declared_size.min(limits.entry_expanded_bytes);
    let initial_capacity = usize::try_from(maximum.min(1024 * 1024)).unwrap_or(0);
    let mut output = Vec::with_capacity(initial_capacity);
    let mut buffer = [0_u8; 32 * 1024];
    loop {
        checkpoint()?;
        let read = reader.read(&mut buffer).map_err(map_untrusted_io)?;
        if read == 0 {
            break;
        }
        let next_size = output.len().checked_add(read).ok_or_else(|| {
            limit_exceeded(
                "actual_entry_expanded_bytes",
                "OOXML actual entry expansion size overflowed",
            )
        })?;
        if next_size as u64 > maximum {
            return Err(limit_exceeded(
                "actual_entry_expanded_bytes",
                "OOXML actual entry expansion exceeds its declared or configured limit",
            ));
        }
        output.extend_from_slice(&buffer[..read]);
    }
    if output.len() as u64 != declared_size {
        return Err(invalid_package(
            "declared_size_mismatch",
            "OOXML entry expansion differs from its declared size",
        ));
    }
    Ok(output)
}

fn validate_entry_name(
    raw_name: &str,
    is_dir: bool,
    limits: OoxmlSecurityLimits,
) -> AppResult<String> {
    if raw_name.is_empty() || raw_name.len() > limits.entry_name_bytes {
        return Err(invalid_package(
            "entry_name_length",
            "OOXML entry name is empty or too long",
        ));
    }
    if raw_name.starts_with('/')
        || raw_name.starts_with('\\')
        || raw_name.contains('\\')
        || raw_name.contains(':')
        || raw_name
            .chars()
            .any(|character| character == '\0' || character.is_control())
        || raw_name.contains(['\u{2215}', '\u{2044}', '\u{ff0f}', '\u{ff3c}'])
    {
        return Err(invalid_package(
            "entry_path",
            "OOXML entry path is absolute or contains a disallowed separator",
        ));
    }
    let lowercase = raw_name.to_ascii_lowercase();
    if ["%2e", "%2f", "%5c", "%00"]
        .iter()
        .any(|encoded| lowercase.contains(encoded))
    {
        return Err(invalid_package(
            "entry_path_encoding",
            "OOXML entry path contains an ambiguous encoded separator",
        ));
    }

    let name = if is_dir {
        raw_name.trim_end_matches('/')
    } else {
        raw_name
    };
    if name.is_empty() {
        return Err(invalid_package(
            "entry_path",
            "OOXML entry path has no usable segment",
        ));
    }
    for segment in name.split('/') {
        if segment.is_empty()
            || matches!(segment, "." | "..")
            || segment.ends_with(['.', ' '])
            || is_windows_reserved_segment(segment)
        {
            return Err(invalid_package(
                "entry_path_segment",
                "OOXML entry path contains an ambiguous segment",
            ));
        }
    }
    Ok(raw_name.to_string())
}

fn canonical_entry_name(name: &str) -> String {
    name.nfkc().flat_map(char::to_lowercase).collect()
}

fn is_windows_reserved_segment(segment: &str) -> bool {
    let stem = segment
        .split_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(segment)
        .to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || stem
            .strip_prefix("com")
            .or_else(|| stem.strip_prefix("lpt"))
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
}

fn validate_compression_ratio(
    compressed: u64,
    expanded: u64,
    limits: OoxmlSecurityLimits,
) -> AppResult<()> {
    if expanded < limits.compression_ratio_min_expanded_bytes {
        return Ok(());
    }
    if compressed == 0 || expanded > compressed.saturating_mul(limits.compression_ratio) {
        return Err(limit_exceeded(
            "compression_ratio",
            "OOXML entry exceeds the allowed compression ratio",
        ));
    }
    Ok(())
}

fn is_known_ooxml_part(name: &str) -> bool {
    let candidate = name.trim_end_matches('/');
    candidate == "[Content_Types].xml"
        || candidate == "_rels"
        || candidate.starts_with("_rels/")
        || candidate == "docProps"
        || candidate.starts_with("docProps/")
        || candidate == "customXml"
        || candidate.starts_with("customXml/")
        || candidate == "word"
        || candidate.starts_with("word/")
        || candidate == "xl"
        || candidate.starts_with("xl/")
        || candidate == "ppt"
        || candidate.starts_with("ppt/")
}

fn validate_xml_part(path: &str, bytes: &[u8], limits: OoxmlSecurityLimits) -> AppResult<()> {
    if !is_xml_part(path) {
        return Ok(());
    }
    if bytes.len() > limits.xml_bytes {
        return Err(limit_exceeded(
            "xml_bytes",
            "OOXML XML part exceeds the byte limit",
        ));
    }
    if contains_ascii_case_insensitive(bytes, b"<!doctype")
        || contains_ascii_case_insensitive(bytes, b"<!entity")
    {
        return Err(invalid_package(
            "xml_entity_declaration",
            "OOXML XML cannot contain DTD or entity declarations",
        ));
    }

    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut depth = 0_usize;
    let mut events = 0_usize;
    loop {
        checkpoint()?;
        events = events
            .checked_add(1)
            .ok_or_else(|| limit_exceeded("xml_events", "OOXML XML event count overflowed"))?;
        if events > limits.xml_events {
            return Err(limit_exceeded(
                "xml_events",
                "OOXML XML contains too many parser events",
            ));
        }
        match reader.read_event().map_err(map_untrusted_xml)? {
            Event::Start(element) => {
                depth = depth
                    .checked_add(1)
                    .ok_or_else(|| limit_exceeded("xml_depth", "OOXML XML depth overflowed"))?;
                if depth > limits.xml_depth {
                    return Err(limit_exceeded(
                        "xml_depth",
                        "OOXML XML nesting exceeds the depth limit",
                    ));
                }
                validate_xml_attributes(&element, limits)?;
            }
            Event::Empty(element) => {
                if depth >= limits.xml_depth {
                    return Err(limit_exceeded(
                        "xml_depth",
                        "OOXML XML nesting exceeds the depth limit",
                    ));
                }
                validate_xml_attributes(&element, limits)?;
            }
            Event::End(_) => {
                depth = depth.checked_sub(1).ok_or_else(|| {
                    invalid_package("xml_structure", "OOXML XML has an unmatched closing tag")
                })?;
            }
            Event::Text(text) => validate_xml_text_size(text.len(), limits)?,
            Event::CData(text) => validate_xml_text_size(text.len(), limits)?,
            Event::Comment(text) => validate_xml_text_size(text.len(), limits)?,
            Event::DocType(_) => {
                return Err(invalid_package(
                    "xml_doctype",
                    "OOXML XML cannot contain a document type declaration",
                ));
            }
            Event::Eof => break,
            Event::Decl(_) | Event::PI(_) | Event::GeneralRef(_) => {}
        }
    }
    if depth != 0 {
        return Err(invalid_package(
            "xml_structure",
            "OOXML XML has unclosed elements",
        ));
    }
    Ok(())
}

fn validate_xml_attributes(element: &BytesStart<'_>, limits: OoxmlSecurityLimits) -> AppResult<()> {
    let mut count = 0_usize;
    for attribute in element.attributes().with_checks(true) {
        let attribute = attribute.map_err(|error| {
            invalid_package(
                "xml_attribute",
                &format!("OOXML XML contains an invalid attribute: {error}"),
            )
        })?;
        count += 1;
        if count > limits.xml_attributes_per_element {
            return Err(limit_exceeded(
                "xml_attributes_per_element",
                "OOXML XML element contains too many attributes",
            ));
        }
        let bytes = attribute
            .key
            .as_ref()
            .len()
            .checked_add(attribute.value.as_ref().len())
            .ok_or_else(|| {
                limit_exceeded("xml_attribute_bytes", "OOXML XML attribute size overflowed")
            })?;
        if bytes > limits.xml_attribute_bytes {
            return Err(limit_exceeded(
                "xml_attribute_bytes",
                "OOXML XML attribute exceeds the byte limit",
            ));
        }
    }
    Ok(())
}

fn validate_xml_text_size(size: usize, limits: OoxmlSecurityLimits) -> AppResult<()> {
    if size > limits.xml_text_node_bytes {
        return Err(limit_exceeded(
            "xml_text_node_bytes",
            "OOXML XML text node exceeds the byte limit",
        ));
    }
    Ok(())
}

fn is_xml_part(path: &str) -> bool {
    let lowercase = path.to_ascii_lowercase();
    lowercase.ends_with(".xml") || lowercase.ends_with(".rels") || lowercase.ends_with(".vml")
}

fn contains_ascii_case_insensitive(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|candidate| {
        candidate
            .iter()
            .zip(needle)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
    })
}

fn open_archive(bytes: &[u8]) -> AppResult<ZipArchive<Cursor<&[u8]>>> {
    ZipArchive::new(Cursor::new(bytes)).map_err(map_untrusted_zip)
}

/// Inspect central-directory metadata before the ZIP crate opens any entry.
///
/// Some ZIP readers surface encryption or unknown compression only while an
/// entry is opened, and may collapse those cases into a generic structure
/// error. Parsing the small fixed-width directory records first gives callers
/// deterministic unsupported-input classification without trusting entry
/// payloads or allocating from attacker-provided sizes.
fn preflight_central_directory(bytes: &[u8]) -> AppResult<()> {
    let search_start = bytes.len().saturating_sub(65_557);
    let eocd = bytes[search_start..]
        .windows(4)
        .rposition(|candidate| candidate == b"PK\x05\x06")
        .map(|offset| search_start + offset)
        .ok_or_else(|| invalid_package("zip_structure", "OOXML ZIP end record is missing"))?;
    if eocd + 22 > bytes.len() {
        return Err(invalid_package(
            "zip_structure",
            "OOXML ZIP end record is truncated",
        ));
    }
    let comment_length = read_le_u16(bytes, eocd + 20)? as usize;
    if eocd + 22 + comment_length != bytes.len() {
        return Err(invalid_package(
            "zip_structure",
            "OOXML ZIP end record length is inconsistent",
        ));
    }
    let entry_count = read_le_u16(bytes, eocd + 10)?;
    let central_size = read_le_u32(bytes, eocd + 12)?;
    let central_offset = read_le_u32(bytes, eocd + 16)?;
    if entry_count == u16::MAX || central_size == u32::MAX || central_offset == u32::MAX {
        return Err(unsupported_package(
            "zip64_archive",
            "ZIP64 OOXML packages are not supported within the configured input limits",
        ));
    }
    let central_end = (central_offset as usize)
        .checked_add(central_size as usize)
        .ok_or_else(|| invalid_package("zip_structure", "OOXML central directory overflowed"))?;
    if central_end > eocd || central_offset as usize > central_end {
        return Err(invalid_package(
            "zip_structure",
            "OOXML central directory bounds are invalid",
        ));
    }

    let mut offset = central_offset as usize;
    for _ in 0..entry_count {
        if offset + 46 > central_end || bytes.get(offset..offset + 4) != Some(b"PK\x01\x02") {
            return Err(invalid_package(
                "zip_structure",
                "OOXML central directory entry is malformed",
            ));
        }
        let flags = read_le_u16(bytes, offset + 8)?;
        if flags & 1 != 0 {
            return Err(unsupported_package(
                "encrypted_archive",
                "Encrypted OOXML packages are not supported",
            ));
        }
        let method = read_le_u16(bytes, offset + 10)?;
        if !matches!(method, 0 | 8) {
            return Err(unsupported_package(
                "compression_method",
                "OOXML package uses an unsupported compression method",
            ));
        }
        let variable_length = usize::from(read_le_u16(bytes, offset + 28)?)
            + usize::from(read_le_u16(bytes, offset + 30)?)
            + usize::from(read_le_u16(bytes, offset + 32)?);
        offset = offset
            .checked_add(46 + variable_length)
            .ok_or_else(|| invalid_package("zip_structure", "OOXML ZIP entry overflowed"))?;
    }
    if offset != central_end {
        return Err(invalid_package(
            "zip_structure",
            "OOXML central directory size is inconsistent",
        ));
    }
    Ok(())
}

fn read_le_u16(bytes: &[u8], offset: usize) -> AppResult<u16> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| invalid_package("zip_structure", "OOXML ZIP metadata is truncated"))?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_le_u32(bytes: &[u8], offset: usize) -> AppResult<u32> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| invalid_package("zip_structure", "OOXML ZIP metadata is truncated"))?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn limit_exceeded(code: &'static str, message: &str) -> AppError {
    metrics::counter!("mymy_ooxml_rejections_total", "class" => "limit", "reason" => code)
        .increment(1);
    AppError::PayloadTooLarge(format!("{code}: {message}"))
}

fn invalid_package(code: &'static str, message: &str) -> AppError {
    metrics::counter!("mymy_ooxml_rejections_total", "class" => "invalid", "reason" => code)
        .increment(1);
    AppError::BadRequest(format!("{code}: {message}"))
}

fn unsupported_package(code: &'static str, message: &str) -> AppError {
    metrics::counter!("mymy_ooxml_rejections_total", "class" => "unsupported", "reason" => code)
        .increment(1);
    AppError::UnsupportedMedia(format!("{code}: {message}"))
}

fn map_untrusted_zip(error: zip::result::ZipError) -> AppError {
    match error {
        zip::result::ZipError::UnsupportedArchive(reason)
            if reason == zip::result::ZipError::PASSWORD_REQUIRED =>
        {
            unsupported_package(
                "encrypted_archive",
                "Encrypted OOXML packages are not supported",
            )
        }
        zip::result::ZipError::InvalidPassword => unsupported_package(
            "encrypted_archive",
            "Encrypted OOXML packages are not supported",
        ),
        zip::result::ZipError::UnsupportedArchive(_) => unsupported_package(
            "compression_method",
            "OOXML package uses an unsupported archive feature or compression method",
        ),
        error => invalid_package(
            "zip_structure",
            &format!("Invalid OOXML ZIP structure: {error}"),
        ),
    }
}

fn map_untrusted_io(error: std::io::Error) -> AppError {
    invalid_package("zip_stream", &format!("Invalid OOXML ZIP stream: {error}"))
}

fn map_untrusted_xml(error: quick_xml::Error) -> AppError {
    invalid_package(
        "xml_structure",
        &format!("Invalid OOXML XML structure: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    use super::*;

    #[test]
    fn admission_rejects_ambiguous_and_unsafe_names() {
        let duplicate = package(&[
            ("word/document.xml", b"<w:document/>"),
            ("WORD/document.xml", b"<w:document/>"),
        ]);
        assert_error_code(admit_ooxml_package(&duplicate), "duplicate_entry_name");

        for name in [
            "/word/document.xml",
            "../word/document.xml",
            "word\\document.xml",
            "word//document.xml",
            "word/con.xml",
            "word/document.xml. ",
            "word/%2e%2e/document.xml",
        ] {
            let candidate = package(&[(name, b"content")]);
            assert_error_code(admit_ooxml_package(&candidate), "entry_");
        }
    }

    #[test]
    fn admission_rejects_high_ratio_and_many_entries() {
        let bomb = package(&[("word/document.xml", &vec![b'a'; 2 * 1024 * 1024])]);
        assert_error_code(admit_ooxml_package(&bomb), "compression_ratio");

        let entries = (0..=DEFAULT_OOXML_SECURITY_LIMITS.entry_count)
            .map(|index| (format!("word/item{index}.xml"), b"<x/>".to_vec()))
            .collect::<Vec<_>>();
        let borrowed = entries
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
            .collect::<Vec<_>>();
        let many = package(&borrowed);
        assert_error_code(admit_ooxml_package(&many), "entry_count");
    }

    #[test]
    fn xml_limits_reject_entities_depth_and_large_text() {
        let entities = package(&[(
            "word/document.xml",
            br#"<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>"#,
        )]);
        assert_error_code(
            read_ooxml_entry_bytes(&entities, "word/document.xml"),
            "xml_entity_declaration",
        );

        let mut limits = DEFAULT_OOXML_SECURITY_LIMITS;
        limits.xml_depth = 3;
        let deep = package(&[("word/document.xml", b"<a><b><c><d/></c></b></a>")]);
        assert_error_code(
            read_ooxml_entry_bytes_with_limits(&deep, "word/document.xml", limits),
            "xml_depth",
        );

        limits = DEFAULT_OOXML_SECURITY_LIMITS;
        limits.xml_text_node_bytes = 3;
        let text = package(&[("word/document.xml", b"<a>four</a>")]);
        assert_error_code(
            read_ooxml_entry_bytes_with_limits(&text, "word/document.xml", limits),
            "xml_text_node_bytes",
        );
    }

    #[test]
    fn limits_accept_values_at_the_boundary_and_reject_the_next_value() {
        let bytes = package(&[("word/document.xml", b"<x/>")]);
        let mut limits = DEFAULT_OOXML_SECURITY_LIMITS;
        limits.compressed_package_bytes = bytes.len() as u64;
        assert!(admit_ooxml_package_with_limits(&bytes, limits).is_ok());
        limits.compressed_package_bytes -= 1;
        assert_error_code(
            admit_ooxml_package_with_limits(&bytes, limits),
            "compressed_package_bytes",
        );

        limits = DEFAULT_OOXML_SECURITY_LIMITS;
        limits.entry_count = 1;
        assert!(admit_ooxml_package_with_limits(&bytes, limits).is_ok());
        limits.entry_count = 0;
        assert_error_code(
            admit_ooxml_package_with_limits(&bytes, limits),
            "entry_count",
        );

        limits = DEFAULT_OOXML_SECURITY_LIMITS;
        limits.entry_expanded_bytes = 4;
        limits.aggregate_expanded_bytes = 4;
        assert!(expand_ooxml_entries_with_limits(&bytes, limits).is_ok());
        limits.entry_expanded_bytes = 3;
        assert_error_code(
            expand_ooxml_entries_with_limits(&bytes, limits),
            "entry_expanded_bytes",
        );
    }

    #[test]
    fn admission_rejects_truncated_packages() {
        let valid = package(&[("word/document.xml", b"<x/>")]);
        let mut truncated = valid.clone();
        truncated.truncate(truncated.len() - 12);
        assert_error_code(admit_ooxml_package(&truncated), "zip_structure");
    }

    #[test]
    fn admission_classifies_encryption() {
        let valid = package(&[("word/document.xml", b"<x/>")]);
        let mut encrypted = valid.clone();
        mutate_zip_headers(&mut encrypted, |flags, _method| *flags |= 1);
        assert_error_code(admit_ooxml_package(&encrypted), "encrypted_archive");
    }

    #[test]
    fn admission_classifies_unsupported_compression() {
        let valid = package(&[("word/document.xml", b"<x/>")]);
        let mut unsupported = valid;
        let central = unsupported
            .windows(4)
            .rposition(|candidate| candidate == b"PK\x01\x02")
            .unwrap();
        unsupported[central + 10..central + 12].copy_from_slice(&99_u16.to_le_bytes());
        assert_error_code(admit_ooxml_package(&unsupported), "compression_method");
    }

    #[test]
    fn admission_enforces_unknown_part_budget() {
        let unknown = package(&[("unrecognized/item.bin", b"opaque")]);
        let mut limits = DEFAULT_OOXML_SECURITY_LIMITS;
        limits.unknown_entry_count = 0;
        assert_error_code(
            admit_ooxml_package_with_limits(&unknown, limits),
            "unknown_entry_count",
        );
    }

    #[test]
    fn valid_package_can_be_read_after_a_rejection() {
        let invalid = package(&[("../bad", b"bad")]);
        assert!(admit_ooxml_package(&invalid).is_err());
        let valid = package(&[("word/document.xml", b"<w:document/>")]);
        assert_eq!(
            read_ooxml_entry_text(&valid, "word/document.xml").unwrap(),
            "<w:document/>"
        );
    }

    fn package(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, bytes) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn mutate_zip_headers(bytes: &mut [u8], mut mutation: impl FnMut(&mut u16, &mut u16)) {
        let headers = [(b"PK\x03\x04".as_slice(), 6, 8), (b"PK\x01\x02", 8, 10)];
        for (signature, flags_delta, method_delta) in headers {
            let offset = bytes
                .windows(signature.len())
                .position(|candidate| candidate == signature)
                .expect("test ZIP header must exist");
            let flags_offset = offset + flags_delta;
            let method_offset = offset + method_delta;
            let mut flags = u16::from_le_bytes([bytes[flags_offset], bytes[flags_offset + 1]]);
            let mut method = u16::from_le_bytes([bytes[method_offset], bytes[method_offset + 1]]);
            mutation(&mut flags, &mut method);
            bytes[flags_offset..flags_offset + 2].copy_from_slice(&flags.to_le_bytes());
            bytes[method_offset..method_offset + 2].copy_from_slice(&method.to_le_bytes());
        }
    }

    fn assert_error_code<T>(result: AppResult<T>, code: &str) {
        let error = result
            .err()
            .unwrap_or_else(|| panic!("expected package rejection containing {code}"));
        assert!(
            error.to_string().contains(code),
            "unexpected error: {error}"
        );
    }
}
