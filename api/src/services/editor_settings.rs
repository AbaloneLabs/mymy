//! Editor settings and custom font storage.
//!
//! Fonts are stored outside the Drive tree so uploading a font for the editor
//! does not silently create project or agent files. Documents can still be
//! packaged with these fonts on download through the Drive package endpoint.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use bytes::Bytes;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::editor_settings::{EditorFont, EditorKeymapEntry, EditorKeymapShortcut};
use crate::state::AppState;

const MAX_FONT_BYTES: usize = 30 * 1024 * 1024;
const FONT_URL_PREFIX: &str = "/api/editor-settings/fonts";
const MAX_KEYMAP_ENTRIES: usize = 512;
const MAX_KEYMAP_FIELD_CHARS: usize = 64;

#[derive(Debug, Clone)]
pub struct EditorFontPackageFile {
    pub font: EditorFont,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Default)]
struct ParsedFontMetadata {
    family_name: Option<String>,
    subfamily_name: Option<String>,
    full_name: Option<String>,
    postscript_name: Option<String>,
    version: Option<String>,
    license: Option<String>,
    license_url: Option<String>,
    weight_class: Option<u16>,
    width_class: Option<u16>,
    embedding: Option<String>,
    supported_scripts: Vec<String>,
}

pub fn fonts_root(state: &AppState) -> PathBuf {
    state.config.agent_data_dir.join("editor").join("fonts")
}

pub fn ensure_fonts_root(state: &AppState) -> AppResult<()> {
    fs::create_dir_all(fonts_root(state))?;
    Ok(())
}

pub fn editor_settings_root(state: &AppState) -> PathBuf {
    state.config.agent_data_dir.join("editor")
}

pub fn ensure_editor_settings_root(state: &AppState) -> AppResult<()> {
    fs::create_dir_all(editor_settings_root(state))?;
    Ok(())
}

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

pub fn read_keymap(state: &AppState) -> AppResult<Vec<EditorKeymapEntry>> {
    ensure_editor_settings_root(state)?;
    let path = keymap_path(state);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path)?;
    let shortcuts: Vec<EditorKeymapEntry> = serde_json::from_slice(&bytes)
        .map_err(|error| AppError::BadRequest(format!("Invalid editor keymap: {error}")))?;
    validate_keymap(&shortcuts)?;
    Ok(shortcuts)
}

pub fn write_keymap(
    state: &AppState,
    shortcuts: Vec<EditorKeymapEntry>,
) -> AppResult<Vec<EditorKeymapEntry>> {
    ensure_editor_settings_root(state)?;
    let mut shortcuts = shortcuts
        .into_iter()
        .filter(|entry| !entry.command_id.trim().is_empty())
        .collect::<Vec<_>>();
    shortcuts.sort_by(|left, right| {
        (left.editor_kind.as_str(), left.command_id.as_str())
            .cmp(&(right.editor_kind.as_str(), right.command_id.as_str()))
    });
    shortcuts.dedup_by(|left, right| {
        left.editor_kind == right.editor_kind && left.command_id == right.command_id
    });
    validate_keymap(&shortcuts)?;
    let bytes = serde_json::to_vec_pretty(&shortcuts)
        .map_err(|error| AppError::Internal(format!("serialize keymap failed: {error}")))?;
    fs::write(keymap_path(state), bytes)?;
    Ok(shortcuts)
}

fn keymap_path(state: &AppState) -> PathBuf {
    editor_settings_root(state).join("keymap.json")
}

fn validate_keymap(shortcuts: &[EditorKeymapEntry]) -> AppResult<()> {
    if shortcuts.len() > MAX_KEYMAP_ENTRIES {
        return Err(AppError::BadRequest(
            "Too many editor keymap entries".into(),
        ));
    }
    let mut shortcut_signatures = std::collections::BTreeSet::new();
    for entry in shortcuts {
        validate_keymap_field("editor kind", &entry.editor_kind)?;
        validate_keymap_field("command id", &entry.command_id)?;
        validate_shortcut(&entry.shortcut)?;
        if !shortcut_signatures.insert(shortcut_signature(entry)) {
            return Err(AppError::BadRequest(
                "Duplicate editor keymap shortcut".into(),
            ));
        }
    }
    Ok(())
}

fn validate_keymap_field(name: &str, value: &str) -> AppResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_KEYMAP_FIELD_CHARS {
        return Err(AppError::BadRequest(format!(
            "Invalid editor keymap {name}"
        )));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':'))
    {
        return Err(AppError::BadRequest(format!(
            "Invalid editor keymap {name}"
        )));
    }
    Ok(())
}

fn validate_shortcut(shortcut: &EditorKeymapShortcut) -> AppResult<()> {
    validate_shortcut_key(&shortcut.key)?;
    if shortcut.display.trim().is_empty() || shortcut.display.len() > MAX_KEYMAP_FIELD_CHARS {
        return Err(AppError::BadRequest(
            "Invalid editor keymap shortcut display".into(),
        ));
    }
    Ok(())
}

fn validate_shortcut_key(value: &str) -> AppResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > MAX_KEYMAP_FIELD_CHARS
        || trimmed.chars().any(|ch| ch.is_control())
    {
        return Err(AppError::BadRequest(
            "Invalid editor keymap shortcut key".into(),
        ));
    }
    Ok(())
}

fn shortcut_signature(entry: &EditorKeymapEntry) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        entry.editor_kind.trim(),
        entry.shortcut.key.trim().to_lowercase(),
        entry.shortcut.primary,
        entry.shortcut.shift,
        entry.shortcut.alt,
    )
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

fn parse_opentype_metadata(bytes: &[u8]) -> Option<ParsedFontMetadata> {
    let names = parse_ttf_name_table_records(opentype_table(bytes, b"name")?)?;
    let os2 = opentype_table(bytes, b"OS/2").and_then(parse_os2_metadata);
    Some(ParsedFontMetadata {
        family_name: names.get(&1).cloned(),
        subfamily_name: names.get(&2).cloned(),
        full_name: names.get(&4).cloned(),
        postscript_name: names.get(&6).cloned(),
        version: names.get(&5).cloned(),
        license: names.get(&13).cloned(),
        license_url: names.get(&14).cloned(),
        weight_class: os2.as_ref().and_then(|item| item.weight_class),
        width_class: os2.as_ref().and_then(|item| item.width_class),
        embedding: os2.as_ref().and_then(|item| item.embedding.clone()),
        supported_scripts: os2.map(|item| item.supported_scripts).unwrap_or_default(),
    })
}

#[derive(Debug, Clone, Default)]
struct ParsedOs2Metadata {
    weight_class: Option<u16>,
    width_class: Option<u16>,
    embedding: Option<String>,
    supported_scripts: Vec<String>,
}

fn opentype_table<'a>(bytes: &'a [u8], wanted_tag: &[u8; 4]) -> Option<&'a [u8]> {
    let num_tables = read_u16(bytes, 4)? as usize;
    let table_records_start = 12usize;
    for index in 0..num_tables {
        let start = table_records_start.checked_add(index.checked_mul(16)?)?;
        let tag = bytes.get(start..start + 4)?;
        if tag != wanted_tag {
            continue;
        }
        let offset = read_u32(bytes, start + 8)? as usize;
        let length = read_u32(bytes, start + 12)? as usize;
        return bytes.get(offset..offset.checked_add(length)?);
    }
    None
}

fn parse_ttf_name_table_records(table: &[u8]) -> Option<BTreeMap<u16, String>> {
    let count = read_u16(table, 2)? as usize;
    let storage_offset = read_u16(table, 4)? as usize;
    let mut candidates: BTreeMap<u16, Vec<(u8, String)>> = BTreeMap::new();
    for index in 0..count {
        let record = 6usize.checked_add(index.checked_mul(12)?)?;
        let platform_id = read_u16(table, record)?;
        let language_id = read_u16(table, record + 4)?;
        let name_id = read_u16(table, record + 6)?;
        if name_id != 1 && name_id != 4 {
            continue;
        }
        let length = read_u16(table, record + 8)? as usize;
        let offset = read_u16(table, record + 10)? as usize;
        let value_start = storage_offset.checked_add(offset)?;
        let raw = table.get(value_start..value_start.checked_add(length)?)?;
        let value = decode_font_name(platform_id, raw)?;
        if value.trim().is_empty() {
            continue;
        }
        candidates
            .entry(name_id)
            .or_default()
            .push((font_name_priority(platform_id, language_id), value));
    }
    Some(
        candidates
            .into_iter()
            .filter_map(|(name_id, mut values)| {
                values.sort_by_key(|(priority, _)| *priority);
                values.into_iter().map(|(_, value)| (name_id, value)).next()
            })
            .collect(),
    )
}

fn font_name_priority(platform_id: u16, language_id: u16) -> u8 {
    match (platform_id, language_id) {
        (3, 0x0409) => 0,
        (3, _) => 1,
        (0, _) => 2,
        _ => 3,
    }
}

fn parse_os2_metadata(table: &[u8]) -> Option<ParsedOs2Metadata> {
    let fs_type = read_u16(table, 8);
    let unicode_ranges = [
        read_u32(table, 42).unwrap_or_default(),
        read_u32(table, 46).unwrap_or_default(),
        read_u32(table, 50).unwrap_or_default(),
        read_u32(table, 54).unwrap_or_default(),
    ];
    Some(ParsedOs2Metadata {
        weight_class: read_u16(table, 4),
        width_class: read_u16(table, 6),
        embedding: fs_type.map(font_embedding_label),
        supported_scripts: supported_scripts_from_unicode_ranges(unicode_ranges),
    })
}

fn font_embedding_label(fs_type: u16) -> String {
    if fs_type & 0x0002 != 0 {
        "restricted".to_string()
    } else if fs_type & 0x0008 != 0 {
        "editable".to_string()
    } else if fs_type & 0x0004 != 0 {
        "preview-print".to_string()
    } else {
        "installable".to_string()
    }
}

fn supported_scripts_from_unicode_ranges(ranges: [u32; 4]) -> Vec<String> {
    const SCRIPT_BITS: &[(usize, &str)] = &[
        (0, "Latin"),
        (1, "Latin-1"),
        (2, "Latin Extended"),
        (9, "Cyrillic"),
        (10, "Armenian"),
        (11, "Hebrew"),
        (13, "Arabic"),
        (17, "Devanagari"),
        (18, "Bengali"),
        (19, "Gurmukhi"),
        (20, "Gujarati"),
        (21, "Odia"),
        (22, "Tamil"),
        (23, "Telugu"),
        (24, "Kannada"),
        (25, "Malayalam"),
        (28, "Thai"),
        (29, "Lao"),
        (30, "Georgian"),
        (31, "Hangul Jamo"),
        (48, "CJK"),
        (49, "Hangul"),
        (50, "Hiragana"),
        (51, "Katakana"),
        (59, "CJK Symbols"),
        (60, "Kana"),
        (85, "Mathematical Alphanumeric Symbols"),
    ];
    let mut scripts = Vec::new();
    for (bit, label) in SCRIPT_BITS {
        let range_index = bit / 32;
        let bit_index = bit % 32;
        if ranges
            .get(range_index)
            .map(|range| range & (1u32 << bit_index) != 0)
            .unwrap_or(false)
        {
            scripts.push((*label).to_string());
        }
    }
    scripts.sort();
    scripts.dedup();
    scripts
}

fn decode_font_name(platform_id: u16, raw: &[u8]) -> Option<String> {
    if platform_id == 0 || platform_id == 3 {
        if !raw.len().is_multiple_of(2) {
            return None;
        }
        let code_units = raw
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        String::from_utf16(&code_units).ok()
    } else {
        String::from_utf8(raw.to_vec()).ok()
    }
    .map(|value| value.trim_matches(char::from(0)).trim().to_string())
    .filter(|value| !value.is_empty())
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let chunk = bytes.get(offset..offset.checked_add(2)?)?;
    Some(u16::from_be_bytes([chunk[0], chunk[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let chunk = bytes.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttf_name_table_display_name_reads_windows_family_name() {
        let bytes = minimal_ttf_with_family_name("Real Font");

        assert_eq!(
            parse_opentype_metadata(&bytes).and_then(|metadata| metadata.family_name),
            Some("Real Font".to_string())
        );
    }

    #[test]
    fn ttf_name_table_display_name_ignores_invalid_bytes() {
        assert!(parse_opentype_metadata(b"font-bytes").is_none());
    }

    #[test]
    fn keymap_validation_accepts_normal_shortcut_entry() {
        let shortcuts = vec![EditorKeymapEntry {
            editor_kind: "text".to_string(),
            command_id: "formatSource".to_string(),
            shortcut: EditorKeymapShortcut {
                key: "f".to_string(),
                display: "Ctrl/Cmd+Shift+F".to_string(),
                primary: true,
                shift: true,
                alt: false,
            },
        }];

        validate_keymap(&shortcuts).expect("valid keymap should pass");
    }

    #[test]
    fn keymap_validation_rejects_invalid_fields() {
        let shortcuts = vec![EditorKeymapEntry {
            editor_kind: "../text".to_string(),
            command_id: "formatSource".to_string(),
            shortcut: EditorKeymapShortcut {
                key: "f".to_string(),
                display: "Ctrl/Cmd+Shift+F".to_string(),
                primary: true,
                shift: true,
                alt: false,
            },
        }];

        assert!(validate_keymap(&shortcuts).is_err());
    }

    #[test]
    fn keymap_validation_rejects_duplicate_shortcuts_for_same_editor() {
        let shortcuts = vec![
            EditorKeymapEntry {
                editor_kind: "text".to_string(),
                command_id: "formatSource".to_string(),
                shortcut: EditorKeymapShortcut {
                    key: "f".to_string(),
                    display: "Ctrl/Cmd+Shift+F".to_string(),
                    primary: true,
                    shift: true,
                    alt: false,
                },
            },
            EditorKeymapEntry {
                editor_kind: "text".to_string(),
                command_id: "find".to_string(),
                shortcut: EditorKeymapShortcut {
                    key: "F".to_string(),
                    display: "Ctrl/Cmd+Shift+F".to_string(),
                    primary: true,
                    shift: true,
                    alt: false,
                },
            },
        ];

        assert!(validate_keymap(&shortcuts).is_err());
    }

    fn minimal_ttf_with_family_name(name: &str) -> Vec<u8> {
        let mut encoded_name = Vec::new();
        for unit in name.encode_utf16() {
            encoded_name.extend_from_slice(&unit.to_be_bytes());
        }

        let name_table_offset = 28u32;
        let name_table_length = 18 + encoded_name.len();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0001_0000u32.to_be_bytes());
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(b"name");
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&name_table_offset.to_be_bytes());
        bytes.extend_from_slice(&(name_table_length as u32).to_be_bytes());

        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&18u16.to_be_bytes());
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&0x0409u16.to_be_bytes());
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&(encoded_name.len() as u16).to_be_bytes());
        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(&encoded_name);
        bytes
    }
}
