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
    pub updated_at: String,
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
    pub updated_at: String,
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
    pub updated_at: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_role: Option<String>,
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSearchScope {
    CurrentProject,
    CurrentPlusGlobal,
    AllPermitted,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSearchDomain {
    Sessions,
    Tasks,
    Notes,
    Knowledge,
    Drive,
    Projects,
    Calendar,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSearchRequest {
    pub query: String,
    pub domains: Vec<WorkspaceSearchDomain>,
    pub scope: WorkspaceSearchScope,
    pub limit: i64,
    pub cursor: Option<String>,
}

/// Browser OmniSearch uses the same adapter contract as agent discovery but
/// supplies its current project explicitly. The authenticated local-owner
/// principal and browser session are derived server-side and are deliberately
/// absent from this request.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserWorkspaceSearchRequest {
    pub query: String,
    pub domains: Vec<WorkspaceSearchDomain>,
    pub scope: WorkspaceSearchScope,
    pub project_id: Option<String>,
    pub limit: i64,
    pub cursor: Option<String>,
}

impl UserWorkspaceSearchRequest {
    pub fn into_workspace_request(self) -> WorkspaceSearchRequest {
        WorkspaceSearchRequest {
            query: self.query,
            domains: self.domains,
            scope: self.scope,
            limit: self.limit,
            cursor: self.cursor,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchHit {
    pub domain: String,
    pub resource_kind: String,
    pub stable_id: String,
    pub title: String,
    pub snippet: Option<String>,
    pub project_id: Option<String>,
    pub scope: String,
    pub lifecycle_state: String,
    pub freshness: Option<String>,
    pub evidence_role: String,
    pub source_link: serde_json::Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locations: Vec<WorkspaceSearchLocation>,
    pub normalized_score: f64,
    pub reason_codes: Vec<String>,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchLocation {
    pub kind: String,
    pub label: Option<String>,
    pub source_link: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResponse {
    pub ranker_version: &'static str,
    pub scope: WorkspaceSearchScopeView,
    pub hits: Vec<WorkspaceSearchHit>,
    pub partial_failures: Vec<WorkspaceSearchPartialFailure>,
    pub next_cursor: Option<String>,
    pub snapshot_expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSearchScopeView {
    CurrentProject,
    CurrentPlusGlobal,
    AllPermitted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchPartialFailure {
    pub domain: String,
    pub code: String,
}
