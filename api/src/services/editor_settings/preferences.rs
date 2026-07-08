use std::fs;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::models::editor_settings::EditorPreferences;
use crate::state::AppState;

use super::{
    editor_settings_root, ensure_editor_settings_root, MAX_AUTOSAVE_DELAY_MS, MIN_AUTOSAVE_DELAY_MS,
};

pub fn read_preferences(state: &AppState) -> AppResult<EditorPreferences> {
    ensure_editor_settings_root(state)?;
    let path = preferences_path(state);
    if !path.is_file() {
        return Ok(EditorPreferences::default());
    }
    let bytes = fs::read(path)?;
    let preferences: EditorPreferences = serde_json::from_slice(&bytes)
        .map_err(|error| AppError::BadRequest(format!("Invalid editor preferences: {error}")))?;
    validate_preferences(&preferences)?;
    Ok(preferences)
}

pub fn write_preferences(
    state: &AppState,
    preferences: EditorPreferences,
) -> AppResult<EditorPreferences> {
    ensure_editor_settings_root(state)?;
    validate_preferences(&preferences)?;
    let bytes = serde_json::to_vec_pretty(&preferences)
        .map_err(|error| AppError::Internal(format!("serialize preferences failed: {error}")))?;
    fs::write(preferences_path(state), bytes)?;
    Ok(preferences)
}

fn preferences_path(state: &AppState) -> PathBuf {
    editor_settings_root(state).join("preferences.json")
}

pub(super) fn validate_preferences(preferences: &EditorPreferences) -> AppResult<()> {
    if !(MIN_AUTOSAVE_DELAY_MS..=MAX_AUTOSAVE_DELAY_MS).contains(&preferences.autosave_delay_ms) {
        return Err(AppError::BadRequest(
            "Autosave delay must be between 1000 and 60000 ms".into(),
        ));
    }
    Ok(())
}
