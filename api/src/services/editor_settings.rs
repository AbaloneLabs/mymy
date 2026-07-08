//! Editor settings and custom font storage.
//!
//! Fonts are stored outside the Drive tree so uploading a font for the editor
//! does not silently create project or agent files. Documents can still be
//! packaged with these fonts on download through the Drive package endpoint.

use std::fs;
use std::path::PathBuf;

use crate::error::AppResult;
use crate::models::editor_settings::EditorFont;
use crate::state::AppState;

const MAX_FONT_BYTES: usize = 30 * 1024 * 1024;
const FONT_URL_PREFIX: &str = "/api/editor-settings/fonts";
const MAX_KEYMAP_ENTRIES: usize = 512;
const MAX_KEYMAP_FIELD_CHARS: usize = 64;
const MIN_AUTOSAVE_DELAY_MS: u64 = 1_000;
const MAX_AUTOSAVE_DELAY_MS: u64 = 60_000;

mod fonts;
mod keymap;
mod opentype;
mod preferences;

pub use fonts::{custom_font_files_for_package, delete_font, font_blob, list_fonts, upload_font};
pub use keymap::{read_keymap, write_keymap};
pub use preferences::{read_preferences, write_preferences};

#[cfg(test)]
use keymap::validate_keymap;
#[cfg(test)]
use opentype::parse_opentype_metadata;
#[cfg(test)]
use preferences::validate_preferences;

#[derive(Debug, Clone)]
pub struct EditorFontPackageFile {
    pub font: EditorFont,
    pub path: PathBuf,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::editor_settings::{
        EditorKeymapEntry, EditorKeymapShortcut, EditorPreferences,
    };

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

    #[test]
    fn preferences_validation_accepts_supported_autosave_delay() {
        let preferences = EditorPreferences {
            autosave_enabled: true,
            autosave_delay_ms: 5_000,
        };

        validate_preferences(&preferences).expect("supported autosave delay should pass");
    }

    #[test]
    fn preferences_validation_rejects_unsafe_autosave_delay() {
        let preferences = EditorPreferences {
            autosave_enabled: true,
            autosave_delay_ms: 250,
        };

        assert!(validate_preferences(&preferences).is_err());
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
