//! OmniSearch result models — lightweight structs scoped to search results.
//!
//! See: web/src/types/index.ts (Search* interfaces)
//!
//! All id/timestamp fields are `String` (serialized from DB `Uuid`/`timestamptz`
//! in the handler), matching the existing model pattern. Every struct uses
//! `#[serde(rename_all = "camelCase")]` to match the frontend.

use serde::{Deserialize, Serialize};

/// A note search result. `preview` is a truncated content snippet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultNote {
    pub id: String,
    pub title: String,
    pub preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub updated_at: String,
}

/// A task search result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultTask {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
}

/// A project search result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultProject {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: String,
}

/// A calendar event search result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultEvent {
    pub id: String,
    pub title: String,
    pub start_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

/// A chat search result. Covers both chat sessions (matched by title) and
/// chat messages (matched by content). `entity_type` discriminates the two:
/// "chatSession" or "chatMessage".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultMessage {
    /// "chatSession" or "chatMessage".
    pub entity_type: String,
    pub id: String,
    /// Session title (chatSession) or message content snippet (chatMessage).
    pub title: String,
    /// The owning session id (only for chatMessage results).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub updated_at: String,
}

/// A knowledge base article search result. `preview` is a truncated content
/// snippet. Knowledge articles are organization-wide (no project scope).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultKnowledge {
    pub id: String,
    pub title: String,
    /// Truncated content snippet.
    pub preview: String,
    /// "category" | "article"
    pub node_type: String,
    /// "draft" | "published"
    pub status: String,
    pub updated_at: String,
}

/// Grouped search results, one array per entity kind.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub notes: Vec<SearchResultNote>,
    pub tasks: Vec<SearchResultTask>,
    pub projects: Vec<SearchResultProject>,
    pub events: Vec<SearchResultEvent>,
    pub messages: Vec<SearchResultMessage>,
    pub knowledge: Vec<SearchResultKnowledge>,
}

/// Top-level search response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub query: String,
    pub results: SearchResults,
    pub total: usize,
}

/// Query params for GET /api/search.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub q: String,
    /// Optional project scope filter.
    pub project_id: Option<String>,
    /// Max results per entity group (default 5, clamped to 20).
    pub limit: Option<i64>,
}
