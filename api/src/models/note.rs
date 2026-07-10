//! Note / wiki models — mirrors frontend `Note`.
//!
//! See: web/src/types/index.ts (Note interface)
//!
//! All id/timestamp fields are `String` (serialized from DB `Uuid`/`timestamptz`
//! in the handler's `row_to_note`), matching the calendar pattern.

use crate::models::scope::PatchField;
use serde::{Deserialize, Serialize};

/// A note as exposed over the API.
///
/// Serialized as camelCase to match the frontend `Note` interface
/// (projectId, createdAt, updatedAt).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesResponse {
    pub notes: Vec<Note>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteResponse {
    pub note: Note,
}

/// Payload for creating a new note.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteRequest {
    pub project_id: Option<String>,
    pub title: String,
    pub content: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
}

/// Payload for patching a note (all fields optional, COALESCE patch).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteRequest {
    #[serde(default)]
    pub project_id: PatchField<String>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub pinned: Option<bool>,
}
