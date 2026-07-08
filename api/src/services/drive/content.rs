use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::Path;

use regex::Regex;
use serde_json::json;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::{AppError, AppResult};
use crate::services::editor_settings;
use crate::state::AppState;

use super::paths::resolve_drive_path;

const MAX_TEXT_PREVIEW_BYTES: u64 = 1_000_000;

pub(super) fn read_preview_content(
    physical_path: &Path,
    metadata: &fs::Metadata,
    mime_type: &str,
) -> AppResult<String> {
    if is_docx(physical_path) {
        extract_docx_text(physical_path)
    } else if is_textual(physical_path, mime_type) {
        if metadata.len() > MAX_TEXT_PREVIEW_BYTES {
            return Err(AppError::BadRequest(
                "Text preview is limited to 1MB files".into(),
            ));
        }
        Ok(fs::read_to_string(physical_path)?)
    } else {
        Ok(String::new())
    }
}

pub fn document_package(state: &AppState, logical_path: &str) -> AppResult<(Vec<u8>, String)> {
    let resolved = resolve_drive_path(&state.config.agent_data_dir, logical_path)?;
    let metadata = fs::metadata(&resolved.physical_path)?;
    if !metadata.is_file() {
        return Err(AppError::BadRequest("Drive path is not a file".into()));
    }
    let document_name = resolved
        .physical_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| AppError::BadRequest("Invalid Drive file name".into()))?;
    let document_bytes = fs::read(&resolved.physical_path)?;
    let font_files = editor_settings::custom_font_files_for_package(state)?;

    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer
        .start_file(format!("document/{document_name}"), options)
        .map_err(|error| AppError::Internal(format!("package zip failed: {error}")))?;
    writer
        .write_all(&document_bytes)
        .map_err(|error| AppError::Internal(format!("package write failed: {error}")))?;

    let mut packaged_fonts = Vec::new();
    let mut skipped_fonts = Vec::new();
    for item in &font_files {
        if item.font.embedding.as_deref() == Some("restricted") {
            skipped_fonts.push(json!({
                "fileName": item.font.file_name,
                "displayName": item.font.display_name,
                "familyName": item.font.family_name,
                "embedding": item.font.embedding,
                "reason": "Font declares restricted embedding rights.",
            }));
            continue;
        }
        let font_name = &item.font.file_name;
        let font_path = &item.path;
        let package_path = format!("fonts/{:02}-{}", packaged_fonts.len() + 1, font_name);
        let bytes = fs::read(font_path)?;
        writer
            .start_file(&package_path, options)
            .map_err(|error| AppError::Internal(format!("package zip failed: {error}")))?;
        writer
            .write_all(&bytes)
            .map_err(|error| AppError::Internal(format!("package write failed: {error}")))?;
        packaged_fonts.push(json!({
            "fileName": font_name,
            "displayName": item.font.display_name,
            "familyName": item.font.family_name,
            "subfamilyName": item.font.subfamily_name,
            "fullName": item.font.full_name,
            "postscriptName": item.font.postscript_name,
            "version": item.font.version,
            "license": item.font.license,
            "licenseUrl": item.font.license_url,
            "weightClass": item.font.weight_class,
            "widthClass": item.font.width_class,
            "embedding": item.font.embedding,
            "supportedScripts": item.font.supported_scripts,
            "packagePath": package_path,
        }));
    }

    let manifest = json!({
        "document": {
            "fileName": document_name,
            "drivePath": resolved.logical_path,
        },
        "fonts": packaged_fonts,
        "skippedFonts": skipped_fonts,
        "note": "Fonts are included for compatibility when opening this document outside mymy. Fonts that declare restricted embedding rights are excluded. Respect each font license before sharing the package.",
    });
    writer
        .start_file("mymy-font-package.json", options)
        .map_err(|error| AppError::Internal(format!("package zip failed: {error}")))?;
    writer
        .write_all(
            serde_json::to_string_pretty(&manifest)
                .map_err(|error| AppError::Internal(format!("package manifest failed: {error}")))?
                .as_bytes(),
        )
        .map_err(|error| AppError::Internal(format!("package write failed: {error}")))?;
    writer
        .start_file("FONT_LICENSE_NOTICE.txt", options)
        .map_err(|error| AppError::Internal(format!("package zip failed: {error}")))?;
    writer
        .write_all(
            b"mymy includes uploaded custom font files in this package for document compatibility. Fonts that declare restricted embedding rights are excluded. Review and respect each font license before redistribution.\n",
        )
        .map_err(|error| AppError::Internal(format!("package write failed: {error}")))?;

    let cursor = writer
        .finish()
        .map_err(|error| AppError::Internal(format!("package zip failed: {error}")))?;
    let package_name = format!("{}-with-fonts.zip", file_stem_or_name(&document_name));
    Ok((cursor.into_inner(), package_name))
}

pub fn mime_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" => "text/markdown",
        "txt" | "log" => "text/plain",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "rs" => "text/x-rust",
        "py" => "text/x-python",
        "sh" => "application/x-sh",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

pub(super) fn is_editable(path: &Path) -> bool {
    let mime_type = mime_type_for_path(path);
    is_textual(path, mime_type)
}

fn is_docx(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("docx"))
}

fn is_textual(path: &Path, mime_type: &str) -> bool {
    if mime_type.starts_with("text/") {
        return true;
    }
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "json" | "yaml" | "yml" | "toml" | "rs" | "py" | "sh"
    )
}

fn extract_docx_text(path: &Path) -> AppResult<String> {
    let file = File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| AppError::Internal(format!("Failed to read docx archive: {error}")))?;
    let mut document = archive
        .by_name("word/document.xml")
        .map_err(|error| AppError::Internal(format!("Failed to read docx document: {error}")))?;
    let mut xml = String::new();
    document.read_to_string(&mut xml)?;

    let paragraph_re = Regex::new(r"</w:p>").expect("static regex");
    let tag_re = Regex::new(r"<[^>]+>").expect("static regex");
    let entity_re = Regex::new(r"&(?:amp|lt|gt|quot|apos);").expect("static regex");
    let with_breaks = paragraph_re.replace_all(&xml, "\n");
    let stripped = tag_re.replace_all(&with_breaks, "");
    let decoded = entity_re.replace_all(&stripped, |caps: &regex::Captures<'_>| match &caps[0] {
        "&amp;" => "&",
        "&lt;" => "<",
        "&gt;" => ">",
        "&quot;" => "\"",
        "&apos;" => "'",
        _ => "",
    });
    Ok(decoded
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n"))
}

fn file_stem_or_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| file_name.to_string())
}
