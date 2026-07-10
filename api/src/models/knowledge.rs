//! Knowledge Base / Wiki models — hierarchical documents.
//!
//! See: web/src/types/index.ts (KnowledgeArticle, KnowledgeTreeNode interfaces)
//!
//! All id/timestamp fields are `String` (serialized from DB `Uuid`/`timestamptz`
//! in the handler's `row_to_knowledge_article`), matching the notes/goals
//! pattern. Every struct uses `#[serde(rename_all = "camelCase")]`.

use serde::{Deserialize, Deserializer, Serialize};

use crate::models::document_editor::DocumentEditorKind;

/// Deserialize helper that distinguishes "key absent" from "key present but
/// null", returning `Option<Option<T>>`:
/// - key absent → `None`        (leave the DB value unchanged)
/// - key null   → `Some(None)`  (set the DB column to NULL)
/// - key value  → `Some(Some(v))` (set the DB column to v)
///
/// This is required for nullable self-referential columns like
/// `parent_id`, where COALESCE cannot tell "not provided" apart from "null".
fn deserialize_some<'de, T, D>(deserializer: D) -> Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

/// A knowledge base node (category or article) as exposed over the API.
///
/// Serialized as camelCase to match the frontend `KnowledgeArticle` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeArticle {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Owning project (only stored on root nodes; NULL = no project).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// "category" | "article"
    pub node_type: String,
    pub title: String,
    pub slug: String,
    pub content: String,
    pub excerpt: String,
    pub tags: Vec<String>,
    /// "draft" | "published"
    pub status: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// A tree node: an article plus its (recursively nested) children.
/// Categories usually have children; articles usually do not, but the
/// structure is uniform so the tree can be rendered generically.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTreeNode {
    #[serde(flatten)]
    pub article: KnowledgeArticle,
    pub children: Vec<KnowledgeTreeNode>,
    pub resources: Vec<KnowledgeResource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeResource {
    pub id: String,
    pub knowledge_id: String,
    pub resource_type: String,
    pub resource_ref: String,
    pub title: String,
    pub sort_order: i32,
    pub status: String,
    pub editor_kind: DocumentEditorKind,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeResourcesResponse {
    pub resources: Vec<KnowledgeResource>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachKnowledgeResourceRequest {
    pub resource_ref: String,
    pub title: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
}

/// A breadcrumb path entry (root → current). Lightweight: only the fields
/// needed to render the navigation trail.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBreadcrumbItem {
    pub id: String,
    pub title: String,
    pub slug: String,
    pub node_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTreeResponse {
    pub tree: Vec<KnowledgeTreeNode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeListResponse {
    pub articles: Vec<KnowledgeArticle>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeArticleResponse {
    pub article: KnowledgeArticle,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBreadcrumbResponse {
    pub breadcrumb: Vec<KnowledgeBreadcrumbItem>,
}

/// Payload for creating a new knowledge article / category.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKnowledgeArticleRequest {
    #[serde(default)]
    pub parent_id: Option<String>,
    /// Owning project. Only meaningful for root nodes (parent_id is null);
    /// children inherit the project from their root ancestor. NULL or
    /// absent means "no project".
    #[serde(default)]
    pub project_id: Option<String>,
    /// "category" | "article" (defaults to "article").
    pub node_type: Option<String>,
    pub title: String,
    pub slug: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub excerpt: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// "draft" | "published" (defaults to "draft").
    pub status: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i32>,
}

/// Payload for patching an article (all fields optional, COALESCE patch).
///
/// `parent_id` uses `Option<Option<String>>` so that an explicit `null` can be
/// distinguished from an absent key: `null` moves the node to the root, while
/// an absent key leaves the parent unchanged.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKnowledgeArticleRequest {
    #[serde(default, deserialize_with = "deserialize_some")]
    pub parent_id: Option<Option<String>>,
    pub node_type: Option<String>,
    pub title: Option<String>,
    pub slug: Option<String>,
    pub content: Option<String>,
    pub excerpt: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub sort_order: Option<i32>,
}

/// Payload for moving a node (changing parent and/or sort order).
/// Used by the drag-and-drop reorder UI.
///
/// `parent_id` uses `Option<Option<String>>`: an explicit `null` moves the
/// node to the root, while an absent key leaves the parent unchanged.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveKnowledgeArticleRequest {
    /// New parent id; null = move to root level. Absent = unchanged.
    #[serde(default, deserialize_with = "deserialize_some")]
    pub parent_id: Option<Option<String>>,
    /// New project id. Only meaningful when moving *to* the root level
    /// (parent_id becomes null), because only root nodes carry a project.
    /// Absent = leave the existing project_id unchanged.
    #[serde(default, deserialize_with = "deserialize_some")]
    pub project_id: Option<Option<String>>,
    /// New sort order within the (new) parent.
    pub sort_order: Option<i32>,
}

/// Query params for GET /api/knowledge (tree) and GET /api/knowledge/flat.
///
/// `project_id` filters root nodes by project:
/// - absent        → all nodes (every project + no-project nodes)
/// - "null" / ""   → only nodes with no project
/// - <uuid>        → only nodes of that project
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTreeQuery {
    pub project_id: Option<String>,
}

/// Query params for GET /api/knowledge/flat.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeFlatQuery {
    pub status: Option<String>,
    pub node_type: Option<String>,
    pub parent_id: Option<String>,
    pub project_id: Option<String>,
}

/// Query params for GET /api/knowledge/search.
#[derive(Debug, Deserialize)]
pub struct KnowledgeSearchQuery {
    pub q: String,
}
