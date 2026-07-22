//! Save-time document validation.
//!
//! The editor writes user-visible files back to the shared drive, so malformed
//! bytes are more costly than an in-memory model error. This module keeps the
//! final validation gate close to persistence while separating it from format
//! conversion code. Text formats are parsed with their native parsers, and
//! OOXML packages are checked for the minimum required parts plus internal
//! relationship targets before the write is accepted.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use serde::Deserialize as _;
use serde_json::Value;
use unicode_normalization::UnicodeNormalization as _;

use crate::error::{AppError, AppResult};
use crate::models::content_security::{ContentOrigin, ContentSafetyVerdict};
use crate::models::document_editor::DocumentEditorKind;
use crate::services::content_safety::ContentSafetyEngine;
use crate::services::document_conversion::checkpoint;

use super::text_formats::has_utf8_bom;
use crate::services::ooxml_security::{expand_ooxml_entries, ExpandedOoxmlEntry};

const MAX_RELATIONSHIPS_PER_PART: usize = 4_096;
const MAX_RELATIONSHIPS_TOTAL: usize = 50_000;
const MAX_RELATIONSHIP_DEPTH: usize = 64;
const MAX_XML_ELEMENTS_TOTAL: usize = 5_000_000;
const MAX_SHARED_STRINGS: usize = 2_000_000;
const MAX_CELL_STYLES: usize = 200_000;
const MAX_FORMULAS: usize = 2_000_000;
const MAX_WORKSHEETS: usize = 1_024;
const MAX_SLIDES: usize = 2_048;
const MAX_DOCUMENT_BLOCKS: usize = 2_000_000;
const MAX_COMMENTS: usize = 500_000;
const MAX_MEDIA_PARTS: usize = 10_000;
const MAX_DRAWING_OBJECTS: usize = 1_000_000;

pub(super) fn validate_saved_document_bytes(
    kind: DocumentEditorKind,
    path: &Path,
    bytes: &[u8],
) -> AppResult<()> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let report = ContentSafetyEngine::new().inspect(file_name, bytes, ContentOrigin::EditorOutput);
    if report.verdict == ContentSafetyVerdict::Reject {
        return Err(AppError::content_rejected());
    }
    validate_structured_text_for_path(path, bytes)?;
    match kind {
        DocumentEditorKind::Docx | DocumentEditorKind::Xlsx | DocumentEditorKind::Pptx => {
            validate_ooxml_package(kind, bytes)
        }
        DocumentEditorKind::Markdown
        | DocumentEditorKind::Text
        | DocumentEditorKind::Csv
        | DocumentEditorKind::Tsv
        | DocumentEditorKind::Preview => Ok(()),
    }
}

pub(super) fn validate_structured_text_for_path(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "json" | "yaml" | "yml" | "toml") {
        return Ok(());
    }
    let body = if has_utf8_bom(bytes) {
        &bytes[3..]
    } else {
        bytes
    };
    let content = std::str::from_utf8(body)
        .map_err(|_| AppError::BadRequest("Structured text file is not valid UTF-8".into()))?;
    match extension.as_str() {
        "json" => {
            serde_json::from_str::<Value>(content)
                .map_err(|error| AppError::BadRequest(format!("Saved JSON is invalid: {error}")))?;
        }
        "yaml" | "yml" => {
            for document in serde_yaml::Deserializer::from_str(content) {
                serde_yaml::Value::deserialize(document).map_err(|error| {
                    AppError::BadRequest(format!("Saved YAML is invalid: {error}"))
                })?;
            }
        }
        "toml" => {
            toml::from_str::<toml::Value>(content)
                .map_err(|error| AppError::BadRequest(format!("Saved TOML is invalid: {error}")))?;
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn validate_ooxml_package(kind: DocumentEditorKind, bytes: &[u8]) -> AppResult<()> {
    let entries = expand_ooxml_entries(bytes)?;
    let names = entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect::<Vec<_>>();
    let required = match kind {
        // A Word document only needs a document-level relationship part when
        // its main part actually relates to images, styles, hyperlinks, or
        // another package part. Minimal text-only DOCX producers may omit it,
        // and the decoder already treats that absence as an empty relation set.
        DocumentEditorKind::Docx => {
            &["[Content_Types].xml", "_rels/.rels", "word/document.xml"][..]
        }
        DocumentEditorKind::Xlsx => &[
            "[Content_Types].xml",
            "_rels/.rels",
            "xl/workbook.xml",
            "xl/_rels/workbook.xml.rels",
        ][..],
        DocumentEditorKind::Pptx => &[
            "[Content_Types].xml",
            "_rels/.rels",
            "ppt/presentation.xml",
            "ppt/_rels/presentation.xml.rels",
        ][..],
        _ => &[][..],
    };
    for part in required {
        if !names.contains(part) {
            return Err(AppError::BadRequest(format!(
                "Saved OOXML package is missing required part: {part}"
            )));
        }
    }
    validate_ooxml_domain_limits(kind, &entries)?;
    validate_ooxml_relationship_targets(&entries, &names)
}

fn validate_ooxml_relationship_targets(
    entries: &[ExpandedOoxmlEntry],
    names: &[&str],
) -> AppResult<()> {
    let canonical_names = names
        .iter()
        .map(|name| (canonical_part_name(name), *name))
        .collect::<HashMap<_, _>>();
    let mut graph = HashMap::<String, Vec<String>>::new();
    let mut relationship_total = 0_usize;

    for entry in entries.iter().filter(|entry| entry.name.ends_with(".rels")) {
        checkpoint()?;
        let source = ooxml_relationship_source_part(&entry.name);
        if !source.is_empty() && !canonical_names.contains_key(&canonical_part_name(&source)) {
            return Err(AppError::BadRequest(
                "relationship_source_missing: OOXML relationship source part is missing".into(),
            ));
        }
        let relationships = parse_relationships(&entry.bytes)?;
        if relationships.len() > MAX_RELATIONSHIPS_PER_PART {
            return Err(AppError::PayloadTooLarge(
                "relationships_per_part: OOXML relationship part contains too many entries".into(),
            ));
        }
        relationship_total = relationship_total
            .checked_add(relationships.len())
            .ok_or_else(|| {
                AppError::PayloadTooLarge(
                    "relationships_total: OOXML relationship count overflowed".into(),
                )
            })?;
        if relationship_total > MAX_RELATIONSHIPS_TOTAL {
            return Err(AppError::PayloadTooLarge(
                "relationships_total: OOXML package contains too many relationships".into(),
            ));
        }

        for relationship in relationships {
            if relationship.external {
                continue;
            }
            if relationship.target.starts_with('#') {
                continue;
            }
            if has_uri_scheme(&relationship.target) {
                return Err(AppError::BadRequest(
                    "internal_relationship_uri: OOXML internal relationship cannot target an external URI"
                        .into(),
                ));
            }
            let resolved = resolve_ooxml_relationship_target(&entry.name, &relationship.target)?;
            let canonical_target = canonical_part_name(&resolved);
            let Some(actual_target) = canonical_names.get(&canonical_target) else {
                return Err(AppError::BadRequest(
                    "relationship_target_missing: OOXML internal relationship target is missing"
                        .into(),
                ));
            };
            if !is_standard_back_reference(&source, &relationship.relationship_type) {
                graph
                    .entry(canonical_part_name(&source))
                    .or_default()
                    .push(canonical_part_name(actual_target));
            }
        }
    }
    validate_relationship_graph(&graph)
}

#[derive(Debug)]
struct OoxmlRelationship {
    target: String,
    relationship_type: String,
    external: bool,
}

fn parse_relationships(bytes: &[u8]) -> AppResult<Vec<OoxmlRelationship>> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut relationships = Vec::new();
    loop {
        checkpoint()?;
        match reader.read_event().map_err(|error| {
            AppError::BadRequest(format!(
                "relationship_xml: invalid OOXML relationship XML: {error}"
            ))
        })? {
            Event::Start(element) | Event::Empty(element)
                if local_name(element.name().as_ref()) == b"Relationship" =>
            {
                let target =
                    relationship_attribute(&reader, &element, b"Target")?.ok_or_else(|| {
                        AppError::BadRequest(
                            "relationship_target: OOXML relationship target is required".into(),
                        )
                    })?;
                let relationship_type =
                    relationship_attribute(&reader, &element, b"Type")?.unwrap_or_default();
                let external = relationship_attribute(&reader, &element, b"TargetMode")?
                    .is_some_and(|value| value.eq_ignore_ascii_case("external"));
                relationships.push(OoxmlRelationship {
                    target,
                    relationship_type,
                    external,
                });
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(relationships)
}

fn relationship_attribute(
    reader: &Reader<&[u8]>,
    element: &BytesStart<'_>,
    name: &[u8],
) -> AppResult<Option<String>> {
    for attribute in element.attributes().with_checks(true) {
        let attribute = attribute.map_err(|error| {
            AppError::BadRequest(format!(
                "relationship_attribute: invalid OOXML relationship attribute: {error}"
            ))
        })?;
        if local_name(attribute.key.as_ref()) == name {
            let value = attribute
                .decoded_and_normalized_value(XmlVersion::Implicit1_0, reader.decoder())
                .map_err(|error| {
                    AppError::BadRequest(format!(
                        "relationship_attribute: invalid OOXML relationship value: {error}"
                    ))
                })?;
            return Ok(Some(value.into_owned()));
        }
    }
    Ok(None)
}

fn resolve_ooxml_relationship_target(rels_path: &str, target: &str) -> AppResult<String> {
    let decoded = percent_encoding::percent_decode_str(target)
        .decode_utf8()
        .map_err(|_| {
            AppError::BadRequest(
                "relationship_target_encoding: OOXML relationship target is not valid UTF-8".into(),
            )
        })?;
    if decoded.contains('\\') || decoded.contains('\0') || decoded.chars().any(char::is_control) {
        return Err(AppError::BadRequest(
            "relationship_target_path: OOXML relationship target contains an invalid path character"
                .into(),
        ));
    }
    let normalized_target = decoded.trim_start_matches('/');
    let base = ooxml_relationship_source_directory(rels_path);
    normalize_ooxml_part_path(&format!("{base}/{normalized_target}"))
}

fn ooxml_relationship_source_directory(rels_path: &str) -> String {
    if rels_path == "_rels/.rels" {
        return String::new();
    }
    let source_part = rels_path
        .replace("/_rels/", "/")
        .strip_suffix(".rels")
        .map(str::to_string)
        .unwrap_or_else(|| rels_path.to_string());
    source_part
        .rsplit_once('/')
        .map(|(directory, _)| directory.to_string())
        .unwrap_or_default()
}

fn normalize_ooxml_part_path(path: &str) -> AppResult<String> {
    let mut parts = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if parts.pop().is_none() {
                return Err(AppError::BadRequest(
                    "Saved OOXML relationship target escapes package root".into(),
                ));
            }
            continue;
        }
        if part.ends_with(['.', ' ']) || part.contains(':') {
            return Err(AppError::BadRequest(
                "relationship_target_path: OOXML relationship target contains an ambiguous segment"
                    .into(),
            ));
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

fn ooxml_relationship_source_part(rels_path: &str) -> String {
    if rels_path == "_rels/.rels" {
        return String::new();
    }
    rels_path
        .replace("/_rels/", "/")
        .strip_suffix(".rels")
        .map(str::to_string)
        .unwrap_or_else(|| rels_path.to_string())
}

fn canonical_part_name(value: &str) -> String {
    value.nfkc().flat_map(char::to_lowercase).collect()
}

fn has_uri_scheme(target: &str) -> bool {
    let Some((scheme, _)) = target.split_once(':') else {
        return false;
    };
    !scheme.is_empty()
        && scheme.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphabetic()
                || (index > 0 && (byte.is_ascii_digit() || matches!(byte, b'+' | b'-' | b'.')))
        })
}

fn is_standard_back_reference(source: &str, relationship_type: &str) -> bool {
    (source.contains("/notesSlides/") && relationship_type.ends_with("/slide"))
        || (source.contains("/slideLayouts/") && relationship_type.ends_with("/slideMaster"))
}

fn validate_relationship_graph(graph: &HashMap<String, Vec<String>>) -> AppResult<()> {
    let mut heights = HashMap::new();
    let mut active = HashSet::new();
    for node in graph.keys() {
        checkpoint()?;
        relationship_node_height(node, graph, &mut active, &mut heights)?;
    }
    Ok(())
}

fn relationship_node_height(
    node: &str,
    graph: &HashMap<String, Vec<String>>,
    active: &mut HashSet<String>,
    heights: &mut HashMap<String, usize>,
) -> AppResult<usize> {
    if let Some(height) = heights.get(node) {
        return Ok(*height);
    }
    if !active.insert(node.to_string()) {
        return Err(AppError::BadRequest(
            "relationship_cycle: OOXML relationship graph contains a cycle".into(),
        ));
    }
    let mut height = 0_usize;
    if let Some(targets) = graph.get(node) {
        for target in targets {
            checkpoint()?;
            let target_height = relationship_node_height(target, graph, active, heights)?;
            height = height.max(target_height.saturating_add(1));
            if height > MAX_RELATIONSHIP_DEPTH {
                return Err(AppError::PayloadTooLarge(
                    "relationship_depth: OOXML relationship traversal exceeds the depth limit"
                        .into(),
                ));
            }
        }
    }
    active.remove(node);
    heights.insert(node.to_string(), height);
    Ok(height)
}

#[derive(Default)]
struct DomainCounts {
    xml_elements: usize,
    shared_strings: usize,
    cell_styles: usize,
    formulas: usize,
    worksheets: usize,
    slides: usize,
    document_blocks: usize,
    comments: usize,
    media_parts: usize,
    drawing_objects: usize,
}

fn validate_ooxml_domain_limits(
    kind: DocumentEditorKind,
    entries: &[ExpandedOoxmlEntry],
) -> AppResult<()> {
    let mut counts = DomainCounts::default();
    for entry in entries.iter().filter(|entry| !entry.is_dir) {
        checkpoint()?;
        let path = entry.name.as_str();
        if is_worksheet_part(path) {
            counts.worksheets += 1;
        }
        if is_slide_part(path) {
            counts.slides += 1;
        }
        if path.contains("/media/") {
            counts.media_parts += 1;
        }
        if is_xml_part(path) {
            count_domain_elements(kind, path, &entry.bytes, &mut counts)?;
        }
    }
    enforce_domain_limit(counts.xml_elements, MAX_XML_ELEMENTS_TOTAL, "xml_elements")?;
    enforce_domain_limit(counts.shared_strings, MAX_SHARED_STRINGS, "shared_strings")?;
    enforce_domain_limit(counts.cell_styles, MAX_CELL_STYLES, "cell_styles")?;
    enforce_domain_limit(counts.formulas, MAX_FORMULAS, "formulas")?;
    enforce_domain_limit(counts.worksheets, MAX_WORKSHEETS, "worksheets")?;
    enforce_domain_limit(counts.slides, MAX_SLIDES, "slides")?;
    enforce_domain_limit(
        counts.document_blocks,
        MAX_DOCUMENT_BLOCKS,
        "document_blocks",
    )?;
    enforce_domain_limit(counts.comments, MAX_COMMENTS, "comments")?;
    enforce_domain_limit(counts.media_parts, MAX_MEDIA_PARTS, "media_parts")?;
    enforce_domain_limit(
        counts.drawing_objects,
        MAX_DRAWING_OBJECTS,
        "drawing_objects",
    )?;
    Ok(())
}

fn count_domain_elements(
    kind: DocumentEditorKind,
    path: &str,
    bytes: &[u8],
    counts: &mut DomainCounts,
) -> AppResult<()> {
    let mut reader = Reader::from_reader(bytes);
    loop {
        checkpoint()?;
        match reader.read_event().map_err(|error| {
            AppError::BadRequest(format!("domain_xml: invalid OOXML XML: {error}"))
        })? {
            Event::Start(element) | Event::Empty(element) => {
                counts.xml_elements = counts.xml_elements.saturating_add(1);
                let qualified_name = element.name();
                let name = local_name(qualified_name.as_ref());
                match kind {
                    DocumentEditorKind::Xlsx => {
                        if path == "xl/sharedStrings.xml" && name == b"si" {
                            counts.shared_strings += 1;
                        }
                        if path == "xl/styles.xml" && name == b"xf" {
                            counts.cell_styles += 1;
                        }
                        if is_worksheet_part(path) && name == b"f" {
                            counts.formulas += 1;
                        }
                    }
                    DocumentEditorKind::Docx => {
                        if path.starts_with("word/") && matches!(name, b"p" | b"tbl") {
                            counts.document_blocks += 1;
                        }
                    }
                    DocumentEditorKind::Pptx
                    | DocumentEditorKind::Markdown
                    | DocumentEditorKind::Text
                    | DocumentEditorKind::Csv
                    | DocumentEditorKind::Tsv
                    | DocumentEditorKind::Preview => {}
                }
                if path.to_ascii_lowercase().contains("comment") && name == b"comment" {
                    counts.comments += 1;
                }
                if is_drawing_part(path)
                    && matches!(name, b"sp" | b"pic" | b"graphicFrame" | b"cxnSp" | b"grpSp")
                {
                    counts.drawing_objects += 1;
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(())
}

fn enforce_domain_limit(value: usize, limit: usize, code: &'static str) -> AppResult<()> {
    if value > limit {
        metrics::counter!("mymy_ooxml_rejections_total", "class" => "limit", "reason" => code)
            .increment(1);
        return Err(AppError::PayloadTooLarge(format!(
            "{code}: OOXML domain object count exceeds the configured limit"
        )));
    }
    Ok(())
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn is_xml_part(path: &str) -> bool {
    let lowercase = path.to_ascii_lowercase();
    lowercase.ends_with(".xml") || lowercase.ends_with(".rels") || lowercase.ends_with(".vml")
}

fn is_worksheet_part(path: &str) -> bool {
    path.starts_with("xl/worksheets/") && path.ends_with(".xml")
}

fn is_slide_part(path: &str) -> bool {
    path.starts_with("ppt/slides/") && path.ends_with(".xml") && !path.contains("/_rels/")
}

fn is_drawing_part(path: &str) -> bool {
    path.contains("/drawings/") || is_slide_part(path)
}

#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn relationship_cycles_and_depth_overflow_are_rejected_at_the_boundary() {
        let mut cycle = HashMap::new();
        cycle.insert("a.xml".to_string(), vec!["b.xml".to_string()]);
        cycle.insert("b.xml".to_string(), vec!["a.xml".to_string()]);
        assert_error_code(validate_relationship_graph(&cycle), "relationship_cycle");

        let accepted = relationship_chain(MAX_RELATIONSHIP_DEPTH + 1);
        validate_relationship_graph(&accepted).unwrap();
        let rejected = relationship_chain(MAX_RELATIONSHIP_DEPTH + 2);
        assert_error_code(validate_relationship_graph(&rejected), "relationship_depth");
    }

    #[test]
    fn relationship_count_limit_and_external_non_dereference_are_enforced() {
        let relationships = (0..=MAX_RELATIONSHIPS_PER_PART)
            .map(|index| {
                format!(r#"<Relationship Id="r{index}" Type="type" Target="target.xml"/>"#)
            })
            .collect::<String>();
        let rels = ExpandedOoxmlEntry {
            name: "_rels/.rels".into(),
            is_dir: false,
            bytes: format!("<Relationships>{relationships}</Relationships>").into_bytes(),
        };
        let target = ExpandedOoxmlEntry {
            name: "target.xml".into(),
            is_dir: false,
            bytes: b"<target/>".to_vec(),
        };
        assert_error_code(
            validate_ooxml_relationship_targets(&[rels, target], &["_rels/.rels", "target.xml"]),
            "relationships_per_part",
        );

        let external = ExpandedOoxmlEntry {
            name: "_rels/.rels".into(),
            is_dir: false,
            bytes: br#"<Relationships><Relationship Id="r1" Type="hyperlink" Target="https://unreachable.invalid/resource" TargetMode="External"/></Relationships>"#.to_vec(),
        };
        validate_ooxml_relationship_targets(&[external], &["_rels/.rels"]).unwrap();
    }

    #[test]
    fn domain_count_boundaries_accept_limit_and_reject_next_value() {
        enforce_domain_limit(MAX_FORMULAS, MAX_FORMULAS, "formulas").unwrap();
        assert_error_code(
            enforce_domain_limit(MAX_FORMULAS + 1, MAX_FORMULAS, "formulas"),
            "formulas",
        );

        let mut counts = DomainCounts::default();
        count_domain_elements(
            DocumentEditorKind::Xlsx,
            "xl/worksheets/sheet1.xml",
            b"<worksheet><f/><f/><f/></worksheet>",
            &mut counts,
        )
        .unwrap();
        assert_eq!(counts.formulas, 3);
    }

    fn relationship_chain(node_count: usize) -> HashMap<String, Vec<String>> {
        (0..node_count.saturating_sub(1))
            .map(|index| {
                (
                    format!("part-{index}.xml"),
                    vec![format!("part-{}.xml", index + 1)],
                )
            })
            .collect()
    }

    fn assert_error_code<T>(result: AppResult<T>, code: &str) {
        let message = match result {
            Ok(_) => panic!("expected {code}, got success"),
            Err(error) => error.to_string(),
        };
        assert!(message.contains(code), "expected {code}, got {message}");
    }
}
