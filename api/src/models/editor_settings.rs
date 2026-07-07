//! Editor settings API models.
//!
//! Custom fonts are workspace assets rather than document contents. The API
//! exposes only sanitized file identifiers and browser-safe font URLs so the
//! frontend can render uploaded fonts without learning host filesystem paths.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFont {
    pub id: String,
    pub display_name: String,
    pub family_name: String,
    pub subfamily_name: Option<String>,
    pub full_name: Option<String>,
    pub postscript_name: Option<String>,
    pub version: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub weight_class: Option<u16>,
    pub width_class: Option<u16>,
    pub embedding: Option<String>,
    pub supported_scripts: Vec<String>,
    pub file_name: String,
    pub mime_type: String,
    pub size: u64,
    pub uploaded_at: Option<String>,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFontsResponse {
    pub fonts: Vec<EditorFont>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFontUploadResponse {
    pub success: bool,
    pub fonts: Vec<EditorFont>,
}

#[derive(Debug, Serialize)]
pub struct EditorFontMutationResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorKeymapShortcut {
    pub key: String,
    pub display: String,
    pub primary: bool,
    pub shift: bool,
    pub alt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorKeymapEntry {
    pub editor_kind: String,
    pub command_id: String,
    pub shortcut: EditorKeymapShortcut,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorKeymapResponse {
    pub shortcuts: Vec<EditorKeymapEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorKeymapUpdateRequest {
    pub shortcuts: Vec<EditorKeymapEntry>,
}
