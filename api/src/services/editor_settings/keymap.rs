use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::models::editor_settings::{EditorKeymapEntry, EditorKeymapShortcut};
use crate::state::AppState;

use super::{
    editor_settings_root, ensure_editor_settings_root, MAX_KEYMAP_ENTRIES, MAX_KEYMAP_FIELD_CHARS,
};

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

pub(super) fn validate_keymap(shortcuts: &[EditorKeymapEntry]) -> AppResult<()> {
    if shortcuts.len() > MAX_KEYMAP_ENTRIES {
        return Err(AppError::BadRequest(
            "Too many editor keymap entries".into(),
        ));
    }
    let mut shortcut_signatures = BTreeSet::new();
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
