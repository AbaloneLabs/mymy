use std::fs;
use std::path::{Path, PathBuf};

use bytes::Bytes;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::editor_settings::EditorFont;
use crate::state::AppState;

use super::opentype::{parse_opentype_metadata, ParsedFontMetadata};
use super::{
    ensure_fonts_root, fonts_root, EditorFontPackageFile, FONT_URL_PREFIX, MAX_FONT_BYTES,
};

pub fn list_fonts(state: &AppState) -> AppResult<Vec<EditorFont>> {
    ensure_fonts_root(state)?;
    let mut fonts = Vec::new();
    for entry in fs::read_dir(fonts_root(state))? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() || !is_supported_font_path(&path) {
            continue;
        }
        fonts.push(font_for_path(&path)?);
    }
    fonts.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
    });
    Ok(fonts)
}

pub fn upload_font(state: &AppState, original_name: &str, bytes: Bytes) -> AppResult<EditorFont> {
    ensure_fonts_root(state)?;
    if bytes.is_empty() {
        return Err(AppError::BadRequest("Font file is empty".into()));
    }
    if bytes.len() > MAX_FONT_BYTES {
        return Err(AppError::BadRequest("Font file is too large".into()));
    }

    let safe_name = validate_font_file_name(original_name)?;
    let extension = Path::new(&safe_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let stored_name = format!("{}__{}", Uuid::new_v4().simple(), safe_name);
    let target = fonts_root(state).join(stored_name);
    fs::write(&target, bytes)?;

    if mime_type_for_font_extension(&extension).is_none() {
        let _ = fs::remove_file(&target);
        return Err(AppError::BadRequest("Unsupported font type".into()));
    }

    font_for_path(&target)
}

pub fn delete_font(state: &AppState, id: &str) -> AppResult<()> {
    let path = font_path_for_id(state, id)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub fn font_blob(state: &AppState, id: &str) -> AppResult<(PathBuf, String)> {
    let path = font_path_for_id(state, id)?;
    if !path.is_file() || !is_supported_font_path(&path) {
        return Err(AppError::NotFound(format!("font {id} not found")));
    }
    let mime_type = mime_type_for_font_path(&path)
        .ok_or_else(|| AppError::BadRequest("Unsupported font type".into()))?;
    Ok((path, mime_type.to_string()))
}

pub fn custom_font_files_for_package(state: &AppState) -> AppResult<Vec<EditorFontPackageFile>> {
    Ok(list_fonts(state)?
        .into_iter()
        .map(|font| {
            let path = fonts_root(state).join(&font.id);
            EditorFontPackageFile { font, path }
        })
        .filter(|item| item.path.is_file())
        .collect())
}

fn font_for_path(path: &Path) -> AppResult<EditorFont> {
    let metadata = fs::metadata(path)?;
    let id = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| AppError::BadRequest("Invalid font path".into()))?;
    let file_name = original_font_file_name(&id);
    let font_metadata = parsed_font_metadata(path);
    let fallback_name = file_stem_or_name(&file_name);
    let family_name = font_metadata
        .family_name
        .clone()
        .unwrap_or_else(|| fallback_name.clone());
    let display_name = font_metadata
        .full_name
        .clone()
        .or_else(|| font_metadata.family_name.clone())
        .unwrap_or(fallback_name);
    let mime_type = mime_type_for_font_path(path)
        .unwrap_or("application/octet-stream")
        .to_string();
    let uploaded_at = fs::metadata(path)?
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
        .map(|value| value.to_rfc3339());
    Ok(EditorFont {
        id: id.clone(),
        display_name,
        family_name,
        subfamily_name: font_metadata.subfamily_name,
        full_name: font_metadata.full_name,
        postscript_name: font_metadata.postscript_name,
        version: font_metadata.version,
        license: font_metadata.license,
        license_url: font_metadata.license_url,
        weight_class: font_metadata.weight_class,
        width_class: font_metadata.width_class,
        embedding: font_metadata.embedding,
        supported_scripts: font_metadata.supported_scripts,
        file_name,
        mime_type,
        size: metadata.len(),
        uploaded_at,
        url: format!("{FONT_URL_PREFIX}/{}/blob", url_escape_segment(&id)),
    })
}

fn parsed_font_metadata(path: &Path) -> ParsedFontMetadata {
    fs::read(path)
        .ok()
        .and_then(|bytes| parse_opentype_metadata(&bytes))
        .unwrap_or_default()
}

fn file_stem_or_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| file_name.to_string())
}

fn font_path_for_id(state: &AppState, id: &str) -> AppResult<PathBuf> {
    let safe_id = validate_stored_font_id(id)?;
    ensure_fonts_root(state)?;
    let root = fonts_root(state).canonicalize()?;
    let path = root.join(safe_id);
    let boundary = if path.exists() {
        path.canonicalize()?
    } else {
        root.clone()
    };
    if !boundary.starts_with(&root) {
        return Err(AppError::BadRequest("Invalid font id".into()));
    }
    Ok(path)
}

fn validate_font_file_name(value: &str) -> AppResult<String> {
    let name = value.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(AppError::BadRequest("Invalid font file name".into()));
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if mime_type_for_font_extension(&extension).is_none() {
        return Err(AppError::BadRequest("Unsupported font type".into()));
    }
    Ok(name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ') {
                ch
            } else {
                '_'
            }
        })
        .collect())
}

fn validate_stored_font_id(value: &str) -> AppResult<String> {
    let id = value.trim();
    if id.is_empty()
        || id == "."
        || id == ".."
        || id.contains('/')
        || id.contains('\\')
        || id.contains('\0')
    {
        return Err(AppError::BadRequest("Invalid font id".into()));
    }
    Ok(id.to_string())
}

fn original_font_file_name(stored_id: &str) -> String {
    stored_id
        .split_once("__")
        .map(|(_, original)| original.to_string())
        .unwrap_or_else(|| stored_id.to_string())
}

fn is_supported_font_path(path: &Path) -> bool {
    mime_type_for_font_path(path).is_some()
}

fn mime_type_for_font_path(path: &Path) -> Option<&'static str> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    mime_type_for_font_extension(&extension)
}

fn mime_type_for_font_extension(extension: &str) -> Option<&'static str> {
    match extension {
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        _ => None,
    }
}

fn url_escape_segment(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| {
            let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.');
            if keep {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect()
            }
        })
        .collect()
}
