//! Native, deterministic content inspection and origin-aware policy.
//!
//! This engine deliberately does not claim antivirus coverage. It recognizes
//! bounded file structures, misleading declarations, active Office content,
//! executable payloads, and archive resource hazards that mymy can verify
//! locally. A `Pass` verdict means only that the bytes passed this policy
//! version; it never means that arbitrary parser or document behavior is safe.

use std::collections::HashSet;
use std::io::{Cursor, Read};
use std::path::Path;

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization as _;
use zip::{CompressionMethod, ZipArchive};

use crate::models::content_security::{
    ContentOrigin, ContentSafetyFinding, ContentSafetyReport, ContentSafetyVerdict, FindingCode,
    FindingSeverity,
};
use crate::services::ooxml_security::{admit_ooxml_package, read_ooxml_entry_bytes};

pub const CONTENT_POLICY_VERSION: &str = "mymy-native-1";
pub const MAX_CONTENT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 4_096;
const MAX_ARCHIVE_ENTRY_NAME_BYTES: usize = 512;
const MAX_ARCHIVE_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ARCHIVE_RATIO: u64 = 200;
const MIN_RATIO_CHECK_BYTES: u64 = 64 * 1024;
const MAX_NESTED_ARCHIVE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH: usize = 3;

#[derive(Debug, Default)]
pub struct ContentSafetyEngine;

impl ContentSafetyEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn inspect(
        &self,
        file_name: &str,
        bytes: &[u8],
        origin: ContentOrigin,
    ) -> ContentSafetyReport {
        let normalized_name = normalize_name(file_name);
        let mut findings = Vec::new();
        let mut structurally_invalid = bytes.len() as u64 > MAX_CONTENT_BYTES;

        inspect_filename(file_name, &normalized_name, &mut findings);
        let detected = detect_content_type(bytes);
        let extension = extension(&normalized_name);

        if !validate_detected_structure(detected, bytes) {
            structurally_invalid = true;
            push_finding(
                &mut findings,
                FindingCode::InvalidMediaStructure,
                FindingSeverity::Invalid,
            );
        }

        if declared_type_mismatch(extension, detected) {
            push_finding(
                &mut findings,
                FindingCode::DeclaredTypeMismatch,
                FindingSeverity::Suspicious,
            );
        }

        match detected {
            DetectedType::Pe | DetectedType::Elf | DetectedType::MachO => push_finding(
                &mut findings,
                FindingCode::ExecutableContent,
                FindingSeverity::Dangerous,
            ),
            DetectedType::Script => push_finding(
                &mut findings,
                FindingCode::ScriptContent,
                FindingSeverity::Suspicious,
            ),
            DetectedType::Html | DetectedType::Svg | DetectedType::Pdf => push_finding(
                &mut findings,
                FindingCode::RestrictedFormat,
                FindingSeverity::Suspicious,
            ),
            DetectedType::Unknown => push_finding(
                &mut findings,
                FindingCode::UnknownContentType,
                FindingSeverity::Suspicious,
            ),
            _ => {}
        }

        let mut detected_type = detected.label().to_string();
        if detected == DetectedType::Zip {
            if is_ooxml_extension(extension) {
                match inspect_ooxml(bytes, &mut findings) {
                    Ok(()) => detected_type = ooxml_media_type(extension).to_string(),
                    Err(InspectionFailure::ResourceLimit) => {
                        structurally_invalid = true;
                        push_finding(
                            &mut findings,
                            FindingCode::ArchiveResourceLimit,
                            FindingSeverity::Invalid,
                        );
                    }
                    Err(InspectionFailure::InvalidStructure) => {
                        structurally_invalid = true;
                        push_finding(
                            &mut findings,
                            FindingCode::InvalidDocumentStructure,
                            FindingSeverity::Invalid,
                        );
                    }
                }
            } else {
                match inspect_archive(bytes) {
                    Ok(active) => {
                        if active {
                            push_finding(
                                &mut findings,
                                FindingCode::ArchiveActiveContent,
                                FindingSeverity::Dangerous,
                            );
                        }
                    }
                    Err(InspectionFailure::ResourceLimit) => {
                        structurally_invalid = true;
                        push_finding(
                            &mut findings,
                            FindingCode::ArchiveResourceLimit,
                            FindingSeverity::Invalid,
                        );
                    }
                    Err(InspectionFailure::InvalidStructure) => {
                        structurally_invalid = true;
                        push_finding(
                            &mut findings,
                            FindingCode::InvalidArchiveStructure,
                            FindingSeverity::Invalid,
                        );
                    }
                }
            }
        }

        let verdict = policy_verdict(origin, structurally_invalid, &findings);
        metrics::counter!(
            "mymy_content_inspections_total",
            "origin" => origin.as_str(),
            "outcome" => verdict_label(verdict),
            "policy" => CONTENT_POLICY_VERSION,
        )
        .increment(1);

        ContentSafetyReport {
            normalized_name,
            detected_type,
            verdict,
            findings,
            policy_version: CONTENT_POLICY_VERSION.to_string(),
            sha256: hex::encode(Sha256::digest(bytes)),
            size: bytes.len() as u64,
        }
    }
}

fn policy_verdict(
    origin: ContentOrigin,
    structurally_invalid: bool,
    findings: &[ContentSafetyFinding],
) -> ContentSafetyVerdict {
    if structurally_invalid {
        return ContentSafetyVerdict::Reject;
    }
    if findings.is_empty() {
        return ContentSafetyVerdict::Pass;
    }

    if origin.is_external() {
        return ContentSafetyVerdict::ReviewRequired;
    }

    let only_intentional_script = findings
        .iter()
        .all(|finding| finding.code == FindingCode::ScriptContent);
    if only_intentional_script
        && matches!(
            origin,
            ContentOrigin::UserEdit | ContentOrigin::AgentGenerated
        )
    {
        return ContentSafetyVerdict::Pass;
    }
    ContentSafetyVerdict::Restricted
}

fn inspect_filename(raw: &str, normalized: &str, findings: &mut Vec<ContentSafetyFinding>) {
    let has_ambiguous_character = raw != normalized
        || raw.trim() != raw
        || raw.ends_with(['.', ' '])
        || raw.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '\u{061c}'
                        | '\u{200b}'..='\u{200f}'
                        | '\u{202a}'..='\u{202e}'
                        | '\u{2060}'..='\u{2069}'
                        | '\u{feff}'
                )
        });
    if has_ambiguous_character {
        push_finding(
            findings,
            FindingCode::AmbiguousFilename,
            FindingSeverity::Suspicious,
        );
    }

    let parts = normalized
        .to_ascii_lowercase()
        .split('.')
        .map(str::to_string)
        .collect::<Vec<_>>();
    if parts.len() >= 3
        && parts[1..parts.len() - 1]
            .iter()
            .any(|part| is_active_extension(part))
    {
        push_finding(
            findings,
            FindingCode::DoubleExtension,
            FindingSeverity::Dangerous,
        );
    }
}

fn normalize_name(value: &str) -> String {
    value.trim().nfkc().collect::<String>()
}

fn extension(name: &str) -> &str {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
}

fn is_active_extension(value: &str) -> bool {
    matches!(
        value,
        "exe"
            | "dll"
            | "com"
            | "scr"
            | "msi"
            | "bat"
            | "cmd"
            | "ps1"
            | "vbs"
            | "js"
            | "jar"
            | "sh"
            | "app"
            | "dmg"
            | "elf"
    )
}

fn push_finding(
    findings: &mut Vec<ContentSafetyFinding>,
    code: FindingCode,
    severity: FindingSeverity,
) {
    if findings.iter().any(|finding| finding.code == code) {
        return;
    }
    findings.push(ContentSafetyFinding { code, severity });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DetectedType {
    Empty,
    Text,
    Script,
    Html,
    Svg,
    Pdf,
    Png,
    Jpeg,
    Gif,
    WebP,
    Mp4,
    WebM,
    Ogg,
    Wav,
    Mp3,
    Zip,
    Pe,
    Elf,
    MachO,
    Unknown,
}

impl DetectedType {
    fn label(self) -> &'static str {
        match self {
            Self::Empty => "application/x-empty",
            Self::Text => "text/plain",
            Self::Script => "text/x-script",
            Self::Html => "text/html",
            Self::Svg => "image/svg+xml",
            Self::Pdf => "application/pdf",
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::WebP => "image/webp",
            Self::Mp4 => "video/mp4",
            Self::WebM => "video/webm",
            Self::Ogg => "application/ogg",
            Self::Wav => "audio/wav",
            Self::Mp3 => "audio/mpeg",
            Self::Zip => "application/zip",
            Self::Pe => "application/vnd.microsoft.portable-executable",
            Self::Elf => "application/x-elf",
            Self::MachO => "application/x-mach-binary",
            Self::Unknown => "application/octet-stream",
        }
    }
}

fn detect_content_type(bytes: &[u8]) -> DetectedType {
    if bytes.is_empty() {
        return DetectedType::Empty;
    }
    if bytes.starts_with(b"MZ") {
        return DetectedType::Pe;
    }
    if bytes.starts_with(b"\x7fELF") {
        return DetectedType::Elf;
    }
    if matches!(
        bytes.get(..4),
        Some(b"\xfe\xed\xfa\xce" | b"\xce\xfa\xed\xfe" | b"\xfe\xed\xfa\xcf" | b"\xcf\xfa\xed\xfe")
    ) {
        return DetectedType::MachO;
    }
    if bytes.starts_with(b"#!") {
        return DetectedType::Script;
    }
    if bytes.starts_with(b"%PDF-") {
        return DetectedType::Pdf;
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return DetectedType::Png;
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return DetectedType::Jpeg;
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return DetectedType::Gif;
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return DetectedType::WebP;
    }
    if bytes.len() >= 12 && bytes.get(4..8) == Some(b"ftyp") {
        return DetectedType::Mp4;
    }
    if bytes.starts_with(b"\x1a\x45\xdf\xa3") {
        return DetectedType::WebM;
    }
    if bytes.starts_with(b"OggS") {
        return DetectedType::Ogg;
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WAVE" {
        return DetectedType::Wav;
    }
    if bytes.starts_with(b"ID3")
        || matches!(bytes.get(..2), Some([0xff, second]) if second & 0xe0 == 0xe0)
    {
        return DetectedType::Mp3;
    }
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
        return DetectedType::Zip;
    }

    let prefix = bytes.get(..bytes.len().min(4_096)).unwrap_or(bytes);
    let trimmed = trim_ascii_prefix(prefix);
    if starts_ascii_case_insensitive(trimmed, b"<!doctype html")
        || starts_ascii_case_insensitive(trimmed, b"<html")
    {
        return DetectedType::Html;
    }
    if starts_ascii_case_insensitive(trimmed, b"<svg")
        || (starts_ascii_case_insensitive(trimmed, b"<?xml")
            && contains_ascii_case_insensitive(trimmed, b"<svg"))
    {
        return DetectedType::Svg;
    }
    if !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok() {
        return DetectedType::Text;
    }
    DetectedType::Unknown
}

fn validate_detected_structure(detected: DetectedType, bytes: &[u8]) -> bool {
    match detected {
        DetectedType::Png => {
            bytes.len() >= 33
                && bytes.get(12..16) == Some(b"IHDR")
                && bounded_dimensions(&bytes[16..24], true)
        }
        DetectedType::Jpeg => bytes.len() >= 4 && bytes.ends_with(b"\xff\xd9"),
        DetectedType::Gif => bytes.len() >= 13 && bounded_dimensions(&bytes[6..10], false),
        DetectedType::WebP | DetectedType::Wav => {
            bytes.len() >= 12
                && read_u32_le(bytes, 4)
                    .is_some_and(|declared| u64::from(declared) + 8 == bytes.len() as u64)
        }
        DetectedType::Mp4 => {
            bytes.len() >= 12
                && read_u32_be(bytes, 0).is_some_and(|declared| {
                    declared == 0 || u64::from(declared) <= bytes.len() as u64
                })
        }
        DetectedType::WebM => bytes.len() >= 8,
        DetectedType::Ogg => bytes.len() >= 27 && bytes[4] == 0,
        DetectedType::Mp3 if bytes.starts_with(b"ID3") => {
            bytes.len() >= 10
                && bytes[6..10].iter().all(|value| value & 0x80 == 0)
                && synchsafe_u28(&bytes[6..10])
                    .is_some_and(|size| u64::from(size) + 10 <= bytes.len() as u64)
        }
        DetectedType::Mp3 => true,
        DetectedType::Pdf => bytes
            .get(bytes.len().saturating_sub(1_024)..)
            .is_some_and(|tail| tail.windows(5).any(|window| window == b"%%EOF")),
        _ => true,
    }
}

fn bounded_dimensions(bytes: &[u8], big_endian: bool) -> bool {
    if bytes.len() != 8 && bytes.len() != 4 {
        return false;
    }
    let (width, height) = if big_endian {
        (
            read_u32_be(bytes, 0).unwrap_or_default(),
            read_u32_be(bytes, 4).unwrap_or_default(),
        )
    } else {
        (
            u32::from(u16::from_le_bytes([bytes[0], bytes[1]])),
            u32::from(u16::from_le_bytes([bytes[2], bytes[3]])),
        )
    };
    width > 0 && height > 0 && width <= 100_000 && height <= 100_000
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    let value = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_u32_be(bytes: &[u8], offset: usize) -> Option<u32> {
    let value = bytes.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([value[0], value[1], value[2], value[3]]))
}

fn synchsafe_u28(bytes: &[u8]) -> Option<u32> {
    if bytes.len() != 4 {
        return None;
    }
    Some(
        (u32::from(bytes[0]) << 21)
            | (u32::from(bytes[1]) << 14)
            | (u32::from(bytes[2]) << 7)
            | u32::from(bytes[3]),
    )
}

fn trim_ascii_prefix(bytes: &[u8]) -> &[u8] {
    let offset = bytes
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    &bytes[offset..]
}

fn starts_ascii_case_insensitive(candidate: &[u8], prefix: &[u8]) -> bool {
    candidate.get(..prefix.len()).is_some_and(|value| {
        value
            .iter()
            .zip(prefix)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
    })
}

fn contains_ascii_case_insensitive(candidate: &[u8], needle: &[u8]) -> bool {
    candidate.windows(needle.len()).any(|value| {
        value
            .iter()
            .zip(needle)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
    })
}

fn declared_type_mismatch(extension: &str, detected: DetectedType) -> bool {
    let extension = extension.to_ascii_lowercase();
    match extension.as_str() {
        "txt" | "md" | "csv" | "tsv" | "json" | "yaml" | "yml" | "toml" | "xml" => {
            !matches!(detected, DetectedType::Text | DetectedType::Empty)
        }
        "html" | "htm" => detected != DetectedType::Html,
        "svg" => detected != DetectedType::Svg,
        "pdf" => detected != DetectedType::Pdf,
        "png" => detected != DetectedType::Png,
        "jpg" | "jpeg" => detected != DetectedType::Jpeg,
        "gif" => detected != DetectedType::Gif,
        "webp" => detected != DetectedType::WebP,
        "mp4" | "mov" => detected != DetectedType::Mp4,
        "webm" => detected != DetectedType::WebM,
        "ogg" | "oga" => detected != DetectedType::Ogg,
        "wav" => detected != DetectedType::Wav,
        "mp3" => detected != DetectedType::Mp3,
        "zip" | "docx" | "docm" | "xlsx" | "xlsm" | "pptx" | "pptm" => {
            detected != DetectedType::Zip
        }
        "exe" | "dll" | "scr" => detected != DetectedType::Pe,
        "sh" => !matches!(detected, DetectedType::Script | DetectedType::Text),
        _ => false,
    }
}

fn is_ooxml_extension(extension: &str) -> bool {
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "docx" | "docm" | "xlsx" | "xlsm" | "pptx" | "pptm"
    )
}

fn ooxml_media_type(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docm" => "application/vnd.ms-word.document.macroenabled.12",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsm" => "application/vnd.ms-excel.sheet.macroenabled.12",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pptm" => "application/vnd.ms-powerpoint.presentation.macroenabled.12",
        _ => "application/zip",
    }
}

#[derive(Debug, Clone, Copy)]
enum InspectionFailure {
    ResourceLimit,
    InvalidStructure,
}

fn inspect_ooxml(
    bytes: &[u8],
    findings: &mut Vec<ContentSafetyFinding>,
) -> Result<(), InspectionFailure> {
    let package = admit_ooxml_package(bytes).map_err(classify_ooxml_error)?;
    for entry in package.entries {
        let name = entry.name.to_ascii_lowercase();
        if name.ends_with("vbaproject.bin") || name.contains("/vba/") {
            push_finding(
                findings,
                FindingCode::OoxmlMacro,
                FindingSeverity::Dangerous,
            );
        }
        if name.contains("/activex/") {
            push_finding(
                findings,
                FindingCode::OoxmlActiveX,
                FindingSeverity::Dangerous,
            );
        }
        if name.contains("/embeddings/") || name.ends_with("oleobject.bin") {
            push_finding(
                findings,
                FindingCode::OoxmlOleEmbedding,
                FindingSeverity::Dangerous,
            );
        }
        if name.ends_with(".svg") {
            push_finding(
                findings,
                FindingCode::OoxmlSvgContent,
                FindingSeverity::Suspicious,
            );
        }
        if name.ends_with(".rels") && !entry.is_dir {
            let relationship_bytes =
                read_ooxml_entry_bytes(bytes, &entry.name).map_err(classify_ooxml_error)?;
            if contains_ascii_case_insensitive(&relationship_bytes, b"targetmode=\"external\"")
                || contains_ascii_case_insensitive(&relationship_bytes, b"targetmode='external'")
            {
                push_finding(
                    findings,
                    FindingCode::OoxmlExternalRelationship,
                    FindingSeverity::Dangerous,
                );
            }
        }
    }
    Ok(())
}

fn classify_ooxml_error(error: crate::error::AppError) -> InspectionFailure {
    match error {
        crate::error::AppError::PayloadTooLarge(_) => InspectionFailure::ResourceLimit,
        _ => InspectionFailure::InvalidStructure,
    }
}

fn inspect_archive(bytes: &[u8]) -> Result<bool, InspectionFailure> {
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(InspectionFailure::ResourceLimit);
    }
    let mut work_budget = MAX_ARCHIVE_EXPANDED_BYTES;
    inspect_archive_inner(bytes, 0, &mut work_budget)
}

fn inspect_archive_inner(
    bytes: &[u8],
    depth: usize,
    work_budget: &mut u64,
) -> Result<bool, InspectionFailure> {
    if depth >= MAX_ARCHIVE_DEPTH {
        return Err(InspectionFailure::ResourceLimit);
    }
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|_| InspectionFailure::InvalidStructure)?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(InspectionFailure::ResourceLimit);
    }

    let mut canonical_names = HashSet::with_capacity(archive.len());
    let mut declared_total = 0_u64;
    let mut active = false;
    for index in 0..archive.len() {
        let mut nested_bytes = None;
        let expanded;
        {
            let mut entry = archive
                .by_index(index)
                .map_err(|_| InspectionFailure::InvalidStructure)?;
            validate_archive_entry(&entry, &mut canonical_names)?;
            expanded = entry.size();
            if expanded > MAX_ARCHIVE_ENTRY_BYTES {
                return Err(InspectionFailure::ResourceLimit);
            }
            declared_total = declared_total
                .checked_add(expanded)
                .ok_or(InspectionFailure::ResourceLimit)?;
            if declared_total > MAX_ARCHIVE_EXPANDED_BYTES || declared_total > *work_budget {
                return Err(InspectionFailure::ResourceLimit);
            }
            if expanded >= MIN_RATIO_CHECK_BYTES
                && (entry.compressed_size() == 0
                    || expanded > entry.compressed_size().saturating_mul(MAX_ARCHIVE_RATIO))
            {
                return Err(InspectionFailure::ResourceLimit);
            }

            let lower_name = entry.name().to_ascii_lowercase();
            if is_active_extension(extension(&lower_name)) {
                active = true;
            }
            if !entry.is_dir() {
                let mut header = [0_u8; 16];
                let header_size = entry
                    .read(&mut header)
                    .map_err(|_| InspectionFailure::InvalidStructure)?;
                if matches!(
                    detect_content_type(&header[..header_size]),
                    DetectedType::Pe
                        | DetectedType::Elf
                        | DetectedType::MachO
                        | DetectedType::Script
                ) {
                    active = true;
                }
                let looks_nested = lower_name.ends_with(".zip")
                    || header[..header_size].starts_with(b"PK\x03\x04");
                if looks_nested {
                    if expanded > MAX_NESTED_ARCHIVE_BYTES {
                        return Err(InspectionFailure::ResourceLimit);
                    }
                    let capacity =
                        usize::try_from(expanded).map_err(|_| InspectionFailure::ResourceLimit)?;
                    let mut nested = Vec::with_capacity(capacity);
                    nested.extend_from_slice(&header[..header_size]);
                    entry
                        .take(MAX_NESTED_ARCHIVE_BYTES + 1)
                        .read_to_end(&mut nested)
                        .map_err(|_| InspectionFailure::InvalidStructure)?;
                    if nested.len() as u64 != expanded {
                        return Err(InspectionFailure::InvalidStructure);
                    }
                    nested_bytes = Some(nested);
                } else {
                    // Reading to EOF makes the ZIP reader validate the actual
                    // deflate stream and CRC. Central-directory sizes alone
                    // are attacker-controlled and cannot establish structure.
                    let mut actual = header_size as u64;
                    let mut buffer = [0_u8; 8 * 1024];
                    loop {
                        let read = entry
                            .read(&mut buffer)
                            .map_err(|_| InspectionFailure::InvalidStructure)?;
                        if read == 0 {
                            break;
                        }
                        actual = actual
                            .checked_add(read as u64)
                            .ok_or(InspectionFailure::ResourceLimit)?;
                        if actual > expanded || actual > *work_budget {
                            return Err(InspectionFailure::ResourceLimit);
                        }
                    }
                    if actual != expanded {
                        return Err(InspectionFailure::InvalidStructure);
                    }
                }
            }
        }

        *work_budget = work_budget
            .checked_sub(expanded)
            .ok_or(InspectionFailure::ResourceLimit)?;
        if let Some(nested) = nested_bytes {
            active |= inspect_archive_inner(&nested, depth + 1, work_budget)?;
        }
    }
    Ok(active)
}

fn validate_archive_entry(
    entry: &zip::read::ZipFile<'_>,
    canonical_names: &mut HashSet<String>,
) -> Result<(), InspectionFailure> {
    let name = entry.name();
    if name.is_empty()
        || name.len() > MAX_ARCHIVE_ENTRY_NAME_BYTES
        || name.starts_with(['/', '\\'])
        || name.contains('\\')
        || name.contains(':')
        || name.chars().any(char::is_control)
        || name
            .trim_end_matches('/')
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(InspectionFailure::InvalidStructure);
    }
    let canonical = name.nfkc().flat_map(char::to_lowercase).collect::<String>();
    if !canonical_names.insert(canonical) || entry.is_symlink() || entry.encrypted() {
        return Err(InspectionFailure::InvalidStructure);
    }
    if !matches!(
        entry.compression(),
        CompressionMethod::Stored | CompressionMethod::Deflated
    ) {
        return Err(InspectionFailure::InvalidStructure);
    }
    Ok(())
}

fn verdict_label(verdict: ContentSafetyVerdict) -> &'static str {
    match verdict {
        ContentSafetyVerdict::Pass => "pass",
        ContentSafetyVerdict::Restricted => "restricted",
        ContentSafetyVerdict::ReviewRequired => "review_required",
        ContentSafetyVerdict::Reject => "reject",
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    use super::*;

    #[test]
    fn external_disguised_executable_requires_review() {
        let report = ContentSafetyEngine::new().inspect(
            "invoice.pdf",
            b"MZ\x90\0executable",
            ContentOrigin::AgentDownload,
        );
        assert_eq!(report.verdict, ContentSafetyVerdict::ReviewRequired);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::ExecutableContent));
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::DeclaredTypeMismatch));
    }

    #[test]
    fn intentional_agent_script_passes_without_weakening_external_policy() {
        let engine = ContentSafetyEngine::new();
        let generated = engine.inspect(
            "build.sh",
            b"#!/bin/sh\nset -eu\n",
            ContentOrigin::AgentGenerated,
        );
        assert_eq!(generated.verdict, ContentSafetyVerdict::Pass);

        let downloaded = engine.inspect(
            "build.sh",
            b"#!/bin/sh\nset -eu\n",
            ContentOrigin::AgentDownload,
        );
        assert_eq!(downloaded.verdict, ContentSafetyVerdict::ReviewRequired);
    }

    #[test]
    fn archive_traversal_is_non_releasable() {
        let bytes = zip(&[("../escape.txt", b"content")]);
        let report =
            ContentSafetyEngine::new().inspect("bundle.zip", &bytes, ContentOrigin::UserUpload);
        assert_eq!(report.verdict, ContentSafetyVerdict::Reject);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::InvalidArchiveStructure));
    }

    #[test]
    fn active_archive_requires_review() {
        let bytes = zip(&[("setup.exe", b"MZ\x90\0payload")]);
        let report =
            ContentSafetyEngine::new().inspect("bundle.zip", &bytes, ContentOrigin::UserUpload);
        assert_eq!(report.verdict, ContentSafetyVerdict::ReviewRequired);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::ArchiveActiveContent));
    }

    #[test]
    fn ambiguous_names_are_reported_without_echoing_them_in_codes() {
        let report = ContentSafetyEngine::new().inspect(
            "report.exe\u{202e}fdp",
            b"plain text",
            ContentOrigin::UserUpload,
        );
        assert_eq!(report.verdict, ContentSafetyVerdict::ReviewRequired);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::AmbiguousFilename));
    }

    #[test]
    fn truncated_supported_media_is_rejected_instead_of_trusted_by_magic_only() {
        let report = ContentSafetyEngine::new().inspect(
            "image.png",
            b"\x89PNG\r\n\x1a\n",
            ContentOrigin::UserUpload,
        );
        assert_eq!(report.verdict, ContentSafetyVerdict::Reject);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::InvalidMediaStructure));
    }

    #[test]
    fn archive_with_corrupted_deflate_payload_is_rejected() {
        let mut bytes = zip(&[("payload.txt", &b"bounded fixture ".repeat(512))]);
        let data_offset = 30 + "payload.txt".len();
        bytes[data_offset + 2] ^= 0x5a;

        let report =
            ContentSafetyEngine::new().inspect("bundle.zip", &bytes, ContentOrigin::UserUpload);

        assert_eq!(report.verdict, ContentSafetyVerdict::Reject);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::InvalidArchiveStructure));
    }

    fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, bytes) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
}
