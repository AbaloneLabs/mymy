//! Knowledge Base / Wiki domain operations.
//!
//! Hierarchy is modeled as a single-table adjacency list (parent_id
//! self-reference). The full tree is fetched via a recursive CTE and
//! assembled into nested JSON on the application side. Cycle prevention is
//! enforced in `move_node` by walking the ancestor chain of the
//! candidate parent before applying the update.

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::knowledge::{
    CreateKnowledgeArticleRequest, KnowledgeArticle, KnowledgeArticleResponse,
    KnowledgeBreadcrumbItem, KnowledgeBreadcrumbResponse, KnowledgeFlatQuery,
    KnowledgeListResponse, KnowledgeSearchQuery, KnowledgeTreeNode, KnowledgeTreeQuery,
    KnowledgeTreeResponse, MoveKnowledgeArticleRequest, UpdateKnowledgeArticleRequest,
};
use crate::services::audit::log_audit_safe;
use crate::services::versions::{
    compute_knowledge_article_change_summary, create_version_checkpoint, delete_entity_versions,
    knowledge_article_to_snapshot, maybe_create_version,
};
use crate::state::AppState;

/// A knowledge base / wiki article row.
///
/// The `search_tsv` column is server-managed and not read into Rust.
#[derive(Debug, FromRow)]
struct KnowledgeArticleRow {
    id: Uuid,
    parent_id: Option<Uuid>,
    /// Owning project. Only meaningful on root nodes.
    project_id: Option<Uuid>,
    node_type: String,
    title: String,
    slug: String,
    content: String,
    excerpt: String,
    tags: Vec<String>,
    status: String,
    sort_order: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

/// GET /api/knowledge
///
/// Returns the entire document tree (root nodes with nested children),
/// ordered by sort_order then title within each level.
///
/// `project_id` filter (from query params):
/// - absent        → all nodes (every project + no-project nodes)
/// - "null" / ""   → only nodes with no project
/// - <uuid>        → only nodes of that project (subtree stays together)
pub async fn list_tree(
    state: &AppState,
    q: KnowledgeTreeQuery,
) -> AppResult<KnowledgeTreeResponse> {
    // Fetch all nodes in one query, then assemble the tree in Rust. This is
    // simpler and equally fast for the expected document volume (hundreds).
    let rows = sqlx::query_as!(
        KnowledgeArticleRow,
        r#"SELECT id, parent_id, project_id, node_type, title, slug, content, excerpt,
                  tags, status, sort_order, created_at, updated_at
           FROM knowledge_articles
           ORDER BY (node_type = 'category') DESC, sort_order ASC, title ASC"#
    )
    .fetch_all(&state.db)
    .await?;

    // Resolve the project filter into an Option<Option<Uuid>>:
    //   None              → no filter (show everything)
    //   Some(None)        → only no-project roots
    //   Some(Some(uuid))  → only that project's roots
    let project_filter = parse_project_filter(q.project_id.as_deref())?;

    let tree = build_tree(rows, project_filter);
    Ok(KnowledgeTreeResponse { tree })
}

/// GET /api/knowledge/flat
///
/// Flat list with optional filters (status, nodeType, parentId). Useful for
/// the editor's parent-category dropdown and search-result lists.
pub async fn list_flat(
    state: &AppState,
    q: KnowledgeFlatQuery,
) -> AppResult<KnowledgeListResponse> {
    // Normalize filters: an explicit "null" / empty string for parent_id
    // means "root level only".
    let parent_filter = match q.parent_id.as_deref() {
        Some("null") | Some("") => Some(None::<Uuid>),
        Some(pid) => {
            Some(Some(Uuid::parse_str(pid).map_err(|e| {
                AppError::BadRequest(format!("invalid parentId: {e}"))
            })?))
        }
        None => None,
    };

    // project_id filter follows the same convention as parent_id.
    let project_filter = parse_project_filter(q.project_id.as_deref())?;

    let rows = sqlx::query_as!(
        KnowledgeArticleRow,
        r#"SELECT id, parent_id, project_id, node_type, title, slug, content, excerpt,
                  tags, status, sort_order, created_at, updated_at
           FROM knowledge_articles
           WHERE ($1::text IS NULL OR status = $1)
             AND ($2::text IS NULL OR node_type = $2)
             AND ($3::uuid IS NULL OR parent_id IS NOT DISTINCT FROM $3)
             AND ($4::uuid IS NULL OR project_id IS NOT DISTINCT FROM $4)
           ORDER BY (node_type = 'category') DESC, sort_order ASC, title ASC"#,
        q.status.as_deref(),
        q.node_type.as_deref(),
        parent_filter.unwrap_or(None::<Uuid>),
        project_filter.unwrap_or(None::<Uuid>),
    )
    .fetch_all(&state.db)
    .await?;

    let articles = rows.into_iter().map(row_to_article).collect();
    Ok(KnowledgeListResponse { articles })
}

/// GET /api/knowledge/search?q=...
///
/// Full-text search over title + content using the `search_tsv` tsvector
/// (maintained by the `knowledge_search_tsv` trigger).
pub async fn search(state: &AppState, q: KnowledgeSearchQuery) -> AppResult<KnowledgeListResponse> {
    let term = q.q.trim();
    if term.is_empty() {
        return Ok(KnowledgeListResponse { articles: vec![] });
    }

    let rows = sqlx::query_as!(
        KnowledgeArticleRow,
        r#"SELECT id, parent_id, project_id, node_type, title, slug, content, excerpt,
                  tags, status, sort_order, created_at, updated_at
           FROM knowledge_articles
           WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
           ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                    updated_at DESC"#,
        term,
    )
    .fetch_all(&state.db)
    .await?;

    let articles = rows.into_iter().map(row_to_article).collect();
    Ok(KnowledgeListResponse { articles })
}

/// GET /api/knowledge/{id}
pub async fn get_by_id(state: &AppState, id: Uuid) -> AppResult<KnowledgeArticleResponse> {
    let article = fetch_article(state, id).await?;
    Ok(KnowledgeArticleResponse { article })
}

/// GET /api/knowledge/{id}/children
///
/// Direct children of a node (one level deep).
pub async fn get_children(state: &AppState, id: Uuid) -> AppResult<KnowledgeListResponse> {
    let rows = sqlx::query_as!(
        KnowledgeArticleRow,
        r#"SELECT id, parent_id, project_id, node_type, title, slug, content, excerpt,
                  tags, status, sort_order, created_at, updated_at
           FROM knowledge_articles
           WHERE parent_id = $1
           ORDER BY (node_type = 'category') DESC, sort_order ASC, title ASC"#,
        id,
    )
    .fetch_all(&state.db)
    .await?;

    let articles = rows.into_iter().map(row_to_article).collect();
    Ok(KnowledgeListResponse { articles })
}

/// GET /api/knowledge/{id}/breadcrumb
///
/// Returns the path from the root down to (and including) the given node.
pub async fn get_breadcrumb(state: &AppState, id: Uuid) -> AppResult<KnowledgeBreadcrumbResponse> {
    // Recursive CTE: walk up the parent chain, then reverse so the order is
    // root → ... → current.
    let rows = sqlx::query!(
        r#"WITH RECURSIVE ancestors AS (
            SELECT id, parent_id, title, slug, node_type, 0 AS depth
            FROM knowledge_articles
            WHERE id = $1
            UNION ALL
            SELECT ka.id, ka.parent_id, ka.title, ka.slug, ka.node_type, a.depth + 1
            FROM knowledge_articles ka
            JOIN ancestors a ON ka.id = a.parent_id
            WHERE a.depth < 50  -- safety bound against pathological cycles
        )
        SELECT id AS "id!", title AS "title!", slug AS "slug!", node_type AS "node_type!"
        FROM ancestors
        ORDER BY depth DESC"#,
        id,
    )
    .fetch_all(&state.db)
    .await?;

    let breadcrumb = rows
        .into_iter()
        .map(|r| KnowledgeBreadcrumbItem {
            id: r.id.to_string(),
            title: r.title,
            slug: r.slug,
            node_type: r.node_type,
        })
        .collect();
    Ok(KnowledgeBreadcrumbResponse { breadcrumb })
}

/// POST /api/knowledge
pub async fn create(
    state: &AppState,
    req: CreateKnowledgeArticleRequest,
) -> AppResult<KnowledgeArticleResponse> {
    let id = Uuid::new_v4();

    let parent_uuid = match req.parent_id.as_deref() {
        Some(pid) => Some(
            Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid parentId: {e}")))?,
        ),
        None => None,
    };

    // Enforce the hierarchy rule: a parent must be a category (folder).
    // Articles are always leaf nodes and cannot have children.
    if let Some(pid) = parent_uuid {
        validate_parent_is_category(&state.db, pid).await?;
    }

    // Resolve the project. Only meaningful on root nodes; children inherit
    // the project from their root ancestor through the tree fetch.
    let project_uuid = match req.project_id.as_deref() {
        Some(pid) => Some(
            Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}")))?,
        ),
        None => None,
    };

    let node_type = req.node_type.as_deref().unwrap_or("article");
    if node_type != "category" && node_type != "article" {
        return Err(AppError::BadRequest(format!(
            "invalid nodeType: {node_type}"
        )));
    }

    let status = req.status.as_deref().unwrap_or("draft");
    if status != "draft" && status != "published" {
        return Err(AppError::BadRequest(format!("invalid status: {status}")));
    }

    // Auto-generate a slug from the title when none is provided. Non-ASCII
    // characters are transliterated to hyphens; a UUID suffix guarantees
    // uniqueness for CJK titles.
    let base_slug = match req.slug.as_deref() {
        Some(s) => s.to_string(),
        None => slugify(&req.title).unwrap_or_else(|| id.to_string()),
    };
    // Ensure uniqueness within the parent: append -2, -3, ... on conflict so
    // that creating multiple "Untitled" nodes under the same parent does not
    // violate the (parent_id, slug) UNIQUE constraint.
    let slug = ensure_unique_slug(&state.db, parent_uuid, &base_slug).await;

    let content = req.content.unwrap_or_default();
    let excerpt = req.excerpt.unwrap_or_default();
    let sort_order = req.sort_order.unwrap_or(0);

    sqlx::query!(
        r#"INSERT INTO knowledge_articles
             (id, parent_id, project_id, node_type, title, slug, content, excerpt, tags, status, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
        id,
        parent_uuid,
        project_uuid,
        node_type,
        req.title,
        slug,
        content,
        excerpt,
        &req.tags as &[String],
        status,
        sort_order,
    )
    .execute(&state.db)
    .await?;

    let article = fetch_article(state, id).await?;

    // Capture the initial version #1 (always checkpoint on creation).
    let snapshot = knowledge_article_to_snapshot(&article);
    if let Err(e) = create_version_checkpoint(
        &state.db,
        "knowledge_article",
        id,
        &snapshot,
        "user",
        Some("user"),
        "Created",
    )
    .await
    {
        tracing::warn!(error = ?e, article_id = %id, "failed to create initial version");
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "knowledge_article",
        Some(&article.id),
        Some(serde_json::json!({
            "after": {
                "title": article.title,
                "slug": article.slug,
                "nodeType": article.node_type,
                "status": article.status,
            }
        })),
    )
    .await;

    Ok(KnowledgeArticleResponse { article })
}

/// PATCH /api/knowledge/{id}
pub async fn update(
    state: &AppState,
    id: Uuid,
    req: UpdateKnowledgeArticleRequest,
) -> AppResult<KnowledgeArticleResponse> {
    if let Some(ref nt) = req.node_type {
        if nt != "category" && nt != "article" {
            return Err(AppError::BadRequest(format!("invalid nodeType: {nt}")));
        }
    }
    if let Some(ref s) = req.status {
        if s != "draft" && s != "published" {
            return Err(AppError::BadRequest(format!("invalid status: {s}")));
        }
    }

    // parent_id is Option<Option<String>>:
    //   None                → key absent, leave parent unchanged
    //   Some(None)          → explicit null, move to root
    //   Some(Some(uuid_str))→ new parent
    let parent_uuid: Option<Option<Uuid>> = match req.parent_id {
        None => None,
        Some(None) => Some(None),
        Some(Some(pid)) => {
            Some(Some(Uuid::parse_str(&pid).map_err(|e| {
                AppError::BadRequest(format!("invalid parentId: {e}"))
            })?))
        }
    };

    // If the parent is changing, guard against cycles: the new parent must
    // not be the node itself or one of its descendants. Additionally, the
    // new parent must be a category (folder) — articles are always leaf
    // nodes and cannot have children.
    if let Some(Some(new_parent)) = parent_uuid {
        if new_parent == id {
            return Err(AppError::BadRequest(
                "a node cannot be its own parent".to_string(),
            ));
        }
        check_cycle(&state.db, id, new_parent).await?;
        validate_parent_is_category(&state.db, new_parent).await?;
    }

    // Read the pre-update state (for change summary + version checkpoint).
    let before = fetch_article(state, id).await?;

    // Update all fields except parent_id via a COALESCE patch. parent_id is
    // handled in a separate statement below so that an explicit null (move
    // to root) can be distinguished from "not provided". tags uses Option
    // presence (same sentinel approach as notes).
    if let Some(tags) = &req.tags {
        sqlx::query!(
            r#"UPDATE knowledge_articles SET
                 node_type = COALESCE($2, node_type),
                 title = COALESCE($3, title),
                 slug = COALESCE($4, slug),
                 content = COALESCE($5, content),
                 excerpt = COALESCE($6, excerpt),
                 tags = $7,
                 status = COALESCE($8, status),
                 sort_order = COALESCE($9, sort_order),
                 updated_at = now()
               WHERE id = $1"#,
            id,
            req.node_type.as_deref(),
            req.title.as_deref(),
            req.slug.as_deref(),
            req.content.as_deref(),
            req.excerpt.as_deref(),
            tags as &[String],
            req.status.as_deref(),
            req.sort_order,
        )
        .execute(&state.db)
        .await?;
    } else {
        sqlx::query!(
            r#"UPDATE knowledge_articles SET
                 node_type = COALESCE($2, node_type),
                 title = COALESCE($3, title),
                 slug = COALESCE($4, slug),
                 content = COALESCE($5, content),
                 excerpt = COALESCE($6, excerpt),
                 status = COALESCE($7, status),
                 sort_order = COALESCE($8, sort_order),
                 updated_at = now()
               WHERE id = $1"#,
            id,
            req.node_type.as_deref(),
            req.title.as_deref(),
            req.slug.as_deref(),
            req.content.as_deref(),
            req.excerpt.as_deref(),
            req.status.as_deref(),
            req.sort_order,
        )
        .execute(&state.db)
        .await?;
    }

    // Apply parent_id change only when the key was present in the request.
    // This allows setting it to NULL (root) or to a new parent.
    if let Some(parent) = parent_uuid {
        sqlx::query!(
            "UPDATE knowledge_articles SET parent_id = $2, updated_at = now() WHERE id = $1",
            id,
            parent,
        )
        .execute(&state.db)
        .await?;
    }

    let article = fetch_article(state, id).await?;

    // Conditionally create a version checkpoint (5-min coalescing window).
    let change_summary = compute_knowledge_article_change_summary(&before, &article);
    let snapshot = knowledge_article_to_snapshot(&article);
    if let Err(e) = maybe_create_version(
        &state.db,
        "knowledge_article",
        id,
        &snapshot,
        "user",
        Some("user"),
        &change_summary,
    )
    .await
    {
        tracing::warn!(error = ?e, article_id = %id, "failed to create version checkpoint");
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "knowledge_article",
        Some(&article.id),
        Some(serde_json::json!({
            "after": {
                "title": article.title,
                "slug": article.slug,
                "status": article.status,
            }
        })),
    )
    .await;

    Ok(KnowledgeArticleResponse { article })
}

/// PATCH /api/knowledge/{id}/move
///
/// Changes the parent and/or sort order of a node. Used by the drag-and-drop
/// reorder UI. Cycle prevention is enforced before the update.
pub async fn move_node(
    state: &AppState,
    id: Uuid,
    req: MoveKnowledgeArticleRequest,
) -> AppResult<KnowledgeArticleResponse> {
    // parent_id is Option<Option<String>>:
    //   None                → key absent, leave parent unchanged
    //   Some(None)          → explicit null, move to root
    //   Some(Some(uuid_str))→ new parent
    let parent_uuid: Option<Option<Uuid>> = match req.parent_id {
        None => None,
        Some(None) => Some(None),
        Some(Some(pid)) => {
            Some(Some(Uuid::parse_str(&pid).map_err(|e| {
                AppError::BadRequest(format!("invalid parentId: {e}"))
            })?))
        }
    };

    // project_id is Option<Option<String>> (same sentinel pattern). Only
    // meaningful when the node is at the root level (parent_id is null),
    // because only root nodes carry a project.
    let project_uuid: Option<Option<Uuid>> = match req.project_id {
        None => None,
        Some(None) => Some(None),
        Some(Some(pid)) => {
            Some(Some(Uuid::parse_str(&pid).map_err(|e| {
                AppError::BadRequest(format!("invalid projectId: {e}"))
            })?))
        }
    };

    if let Some(Some(new_parent)) = parent_uuid {
        if new_parent == id {
            return Err(AppError::BadRequest(
                "a node cannot be its own parent".to_string(),
            ));
        }
        check_cycle(&state.db, id, new_parent).await?;
        validate_parent_is_category(&state.db, new_parent).await?;
    }

    // Apply parent_id change only when the key was present in the request.
    // When moving to root, also apply the project_id change if provided.
    if let Some(parent) = parent_uuid {
        // Moving to root: update parent + optional project in one statement.
        if parent.is_none() {
            if let Some(project) = project_uuid {
                sqlx::query!(
                    r#"UPDATE knowledge_articles SET
                         parent_id = $2,
                         project_id = $3,
                         sort_order = COALESCE($4, sort_order),
                         updated_at = now()
                       WHERE id = $1"#,
                    id,
                    parent,
                    project,
                    req.sort_order,
                )
                .execute(&state.db)
                .await?;
            } else {
                sqlx::query!(
                    r#"UPDATE knowledge_articles SET
                         parent_id = $2,
                         sort_order = COALESCE($3, sort_order),
                         updated_at = now()
                       WHERE id = $1"#,
                    id,
                    parent,
                    req.sort_order,
                )
                .execute(&state.db)
                .await?;
            }
        } else {
            // Moving under a parent: clear project_id (children inherit from
            // their root ancestor) and set the new parent.
            sqlx::query!(
                r#"UPDATE knowledge_articles SET
                     parent_id = $2,
                     project_id = NULL,
                     sort_order = COALESCE($3, sort_order),
                     updated_at = now()
                   WHERE id = $1"#,
                id,
                parent,
                req.sort_order,
            )
            .execute(&state.db)
            .await?;
        }
    } else if let Some(project) = project_uuid {
        // parent_id unchanged but project_id provided. Only valid at root.
        sqlx::query!(
            r#"UPDATE knowledge_articles SET
                 project_id = $2,
                 sort_order = COALESCE($3, sort_order),
                 updated_at = now()
               WHERE id = $1"#,
            id,
            project,
            req.sort_order,
        )
        .execute(&state.db)
        .await?;
    } else {
        sqlx::query!(
            r#"UPDATE knowledge_articles SET
                 sort_order = COALESCE($2, sort_order),
                 updated_at = now()
               WHERE id = $1"#,
            id,
            req.sort_order,
        )
        .execute(&state.db)
        .await?;
    }

    let article = fetch_article(state, id).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "knowledge_article",
        Some(&article.id),
        Some(serde_json::json!({
            "after": {
                "parentId": article.parent_id,
                "sortOrder": article.sort_order,
            }
        })),
    )
    .await;

    Ok(KnowledgeArticleResponse { article })
}

/// DELETE /api/knowledge/{id}
///
/// CASCADE delete: the DB foreign key removes all descendants automatically.
pub async fn delete(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query!("DELETE FROM knowledge_articles WHERE id = $1", id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "knowledge article {id} not found"
        )));
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "knowledge_article",
        Some(&id.to_string()),
        Some(serde_json::json!({ "before": { "id": id.to_string() } })),
    )
    .await;

    // Application-level cascade: clear this article's version history.
    if let Err(e) = delete_entity_versions(&state.db, "knowledge_article", id).await {
        tracing::warn!(error = ?e, article_id = %id, "failed to delete article versions");
    }

    Ok(true)
}

// ============================================================
// Helpers
// ============================================================

/// Fetch a single article by id, returning a 404 when missing.
async fn fetch_article(state: &AppState, id: Uuid) -> AppResult<KnowledgeArticle> {
    let row = sqlx::query_as!(
        KnowledgeArticleRow,
        r#"SELECT id, parent_id, project_id, node_type, title, slug, content, excerpt,
                  tags, status, sort_order, created_at, updated_at
           FROM knowledge_articles WHERE id = $1"#,
        id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("knowledge article {id} not found")))?;
    Ok(row_to_article(row))
}

/// Convert a DB row into the API model (Uuid/timestamps → String).
fn row_to_article(row: KnowledgeArticleRow) -> KnowledgeArticle {
    KnowledgeArticle {
        id: row.id.to_string(),
        parent_id: row.parent_id.map(|u| u.to_string()),
        project_id: row.project_id.map(|u| u.to_string()),
        node_type: row.node_type,
        title: row.title,
        slug: row.slug,
        content: row.content,
        excerpt: row.excerpt,
        tags: row.tags,
        status: row.status,
        sort_order: row.sort_order,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

/// Assemble a flat list of rows into a nested tree.
///
/// Nodes are grouped by parent_id; root nodes (parent_id IS NULL) form the
/// top level. Children are already sorted by the SQL ORDER BY, so insertion
/// order is preserved.
///
/// `project_filter` restricts which *root* nodes are included:
/// - None              → all roots
/// - Some(None)        → only roots with no project
/// - Some(Some(uuid))  → only roots of that project
///
/// Descendants are always included together with their root, so a whole
/// subtree stays together when filtered.
fn build_tree(
    rows: Vec<KnowledgeArticleRow>,
    project_filter: Option<Option<Uuid>>,
) -> Vec<KnowledgeTreeNode> {
    use std::collections::HashMap;

    // Index every node by its id so we can attach children in a single pass.
    let mut nodes: HashMap<Uuid, KnowledgeTreeNode> = HashMap::new();
    let mut root_ids: Vec<Uuid> = Vec::new();
    // Map parent_id → ordered list of child ids (preserving SQL order).
    let mut child_map: HashMap<Option<Uuid>, Vec<Uuid>> = HashMap::new();

    for row in rows {
        let id = row.id;
        let parent = row.parent_id;
        let project = row.project_id;
        let is_root = parent.is_none();
        child_map.entry(parent).or_default().push(id);
        if is_root {
            // Apply the project filter to root nodes only.
            let keep = match project_filter {
                None => true,
                Some(None) => project.is_none(),
                Some(Some(pid)) => project == Some(pid),
            };
            if keep {
                root_ids.push(id);
            }
        }
        nodes.insert(
            id,
            KnowledgeTreeNode {
                article: row_to_article(row),
                children: Vec::new(),
            },
        );
    }

    // Recursively attach children. Process parents before children by walking
    // the child_map; since a child only appears once, a single ordered pass
    // over root_ids followed by descent is sufficient.
    fn attach_children(
        node_id: Uuid,
        nodes: &mut HashMap<Uuid, KnowledgeTreeNode>,
        child_map: &HashMap<Option<Uuid>, Vec<Uuid>>,
    ) {
        let children_ids = match child_map.get(&Some(node_id)) {
            Some(ids) => ids.clone(),
            None => return,
        };
        for cid in &children_ids {
            attach_children(*cid, nodes, child_map);
        }
        // Now that all descendants are fully built, move them into this node.
        let built: Vec<KnowledgeTreeNode> = children_ids
            .iter()
            .filter_map(|cid| nodes.remove(cid))
            .collect();
        if let Some(node) = nodes.get_mut(&node_id) {
            node.children = built;
        }
    }

    for rid in &root_ids {
        attach_children(*rid, &mut nodes, &child_map);
    }

    root_ids.iter().filter_map(|id| nodes.remove(id)).collect()
}

/// Reject a parent change that would create a cycle.
///
/// Walks the ancestor chain of `new_parent`; if `node_id` appears among those
/// ancestors, the move would create a cycle (node → ... → node) and is
/// rejected with 400.
async fn check_cycle(db: &sqlx::PgPool, node_id: Uuid, new_parent: Uuid) -> AppResult<()> {
    let row = sqlx::query!(
        r#"WITH RECURSIVE ancestors AS (
            SELECT id, parent_id, 0 AS depth
            FROM knowledge_articles
            WHERE id = $1
            UNION ALL
            SELECT ka.id, ka.parent_id, a.depth + 1
            FROM knowledge_articles ka
            JOIN ancestors a ON ka.id = a.parent_id
            WHERE a.depth < 50
        )
        SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = $2) AS creates_cycle"#,
        new_parent,
        node_id,
    )
    .fetch_one(db)
    .await?;

    reject_cycle(row.creates_cycle.unwrap_or(false))
}

fn reject_cycle(creates_cycle: bool) -> AppResult<()> {
    if creates_cycle {
        return Err(AppError::BadRequest(
            "moving this node under the given parent would create a cycle".to_string(),
        ));
    }
    Ok(())
}

/// Validate that a parent node exists and is a category (folder).
///
/// Documents and folders may only be nested under a folder (or at the root
/// level, which is handled by a `None` parent_id). This enforces the rule
/// that articles are always leaf nodes and cannot have children.
async fn validate_parent_is_category(db: &sqlx::PgPool, parent_id: Uuid) -> AppResult<()> {
    let row = sqlx::query!(
        r#"SELECT node_type AS "node_type!"
           FROM knowledge_articles WHERE id = $1"#,
        parent_id,
    )
    .fetch_optional(db)
    .await?;

    match row {
        None => Err(AppError::BadRequest(format!(
            "parent node {parent_id} does not exist"
        ))),
        Some(r) if r.node_type != "category" => Err(AppError::BadRequest(
            "a node can only be nested under a category (folder)".to_string(),
        )),
        Some(_) => Ok(()),
    }
}

/// Parse a `project_id` query param into the sentinel triple-state.
///
/// - absent / None  → `None`               (no filter)
/// - "null" / ""    → `Some(None)`         (only no-project roots)
/// - <uuid>         → `Some(Some(uuid))`   (only that project's roots)
fn parse_project_filter(raw: Option<&str>) -> AppResult<Option<Option<Uuid>>> {
    match raw {
        None => Ok(None),
        Some("null") | Some("") => Ok(Some(None)),
        Some(pid) => {
            let uuid = Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}")))?;
            Ok(Some(Some(uuid)))
        }
    }
}

/// Convert a title into a URL-safe slug (lowercase ascii + hyphens).
///
/// Non-ASCII characters (e.g. CJK) are dropped; if nothing remains, `None` is
/// returned and the caller falls back to a UUID-based slug.
fn slugify(input: &str) -> Option<String> {
    // Drop non-ASCII chars entirely so fully non-ASCII titles collapse to
    // an empty slug instead of producing a bare "-" that would violate the
    // ka_slug_format CHECK constraint.
    let slug: String = input
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || c.is_whitespace() || *c == '-' || *c == '_')
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        None
    } else {
        Some(slug)
    }
}

/// Ensure the slug is unique under the given parent by appending `-2`, `-3`, ...
/// suffixes when a collision is detected. Falls back to a UUID-based slug when
/// the base slug is empty (e.g. CJK-only titles) or after too many attempts.
async fn ensure_unique_slug(db: &PgPool, parent_id: Option<Uuid>, base_slug: &str) -> String {
    let base = if base_slug.trim().is_empty() {
        format!("node-{}", Uuid::new_v4().simple())
    } else {
        base_slug.to_string()
    };

    // Check the base slug first.
    if !slug_exists(db, parent_id, &base).await {
        return base;
    }

    // Append numeric suffixes until we find a free slot.
    for n in 2..=1000 {
        let candidate = format!("{base}-{n}");
        if !slug_exists(db, parent_id, &candidate).await {
            return candidate;
        }
    }

    // Fallback: append a short random suffix to avoid an infinite loop.
    format!("{base}-{}", Uuid::new_v4().simple())
}

/// Return true if a knowledge node with the given (parent_id, slug) already exists.
async fn slug_exists(db: &PgPool, parent_id: Option<Uuid>, slug: &str) -> bool {
    let row = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM knowledge_articles
           WHERE parent_id IS NOT DISTINCT FROM $1 AND slug = $2"#,
    )
    .bind(parent_id)
    .bind(slug)
    .fetch_one(db)
    .await;
    matches!(row, Ok(c) if c > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn article_row(id: Uuid, parent_id: Option<Uuid>, title: &str) -> KnowledgeArticleRow {
        let now = Utc::now();
        KnowledgeArticleRow {
            id,
            parent_id,
            project_id: None,
            node_type: "article".to_string(),
            title: title.to_string(),
            slug: slugify(title).unwrap_or_else(|| id.to_string()),
            content: String::new(),
            excerpt: String::new(),
            tags: Vec::new(),
            status: "draft".to_string(),
            sort_order: 0,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn slugify_ascii() {
        assert_eq!(
            slugify("Deployment Guide").as_deref(),
            Some("deployment-guide")
        );
        assert_eq!(
            slugify("API  Reference!!").as_deref(),
            Some("api-reference")
        );
    }

    #[test]
    fn slugify_non_ascii_returns_none() {
        assert_eq!(slugify("배포 가이드"), None);
        assert_eq!(slugify("日本語"), None);
    }

    #[test]
    fn slugify_empty() {
        assert_eq!(slugify(""), None);
        assert_eq!(slugify("   "), None);
    }

    #[test]
    fn build_tree_nests_children_under_parents() {
        let root_id = Uuid::new_v4();
        let child_id = Uuid::new_v4();
        let grandchild_id = Uuid::new_v4();

        let tree = build_tree(
            vec![
                article_row(root_id, None, "Root"),
                article_row(child_id, Some(root_id), "Child"),
                article_row(grandchild_id, Some(child_id), "Grandchild"),
            ],
            None,
        );

        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].article.id, root_id.to_string());
        assert_eq!(tree[0].children.len(), 1);
        assert_eq!(tree[0].children[0].article.id, child_id.to_string());
        assert_eq!(tree[0].children[0].children.len(), 1);
        assert_eq!(
            tree[0].children[0].children[0].article.id,
            grandchild_id.to_string()
        );
    }

    #[test]
    fn reject_cycle_returns_bad_request_for_cycle() {
        let err = reject_cycle(true).expect_err("cycle should be rejected");
        assert!(matches!(err, AppError::BadRequest(_)));
        assert!(reject_cycle(false).is_ok());
    }

    // ---- DB integration tests for parent-type validation ----

    use crate::config::Config;
    use crate::state::AppState;

    /// Insert a knowledge node directly into the DB for test setup.
    async fn seed_node(
        pool: &sqlx::PgPool,
        id: Uuid,
        parent_id: Option<Uuid>,
        node_type: &str,
        title: &str,
    ) {
        // Build a slug from the node type + last 8 hex chars of the uuid so
        // every seed is unique within its parent.
        let slug = format!("{}-{}", node_type, id.simple().to_string().split_off(28));
        sqlx::query!(
            r#"INSERT INTO knowledge_articles (id, parent_id, node_type, title, slug)
               VALUES ($1, $2, $3, $4, $5)"#,
            id,
            parent_id,
            node_type,
            title,
            slug,
        )
        .execute(pool)
        .await
        .expect("node should be seeded");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn validate_parent_accepts_category(pool: sqlx::PgPool) {
        let cat = Uuid::new_v4();
        seed_node(&pool, cat, None, "category", "Folder").await;

        validate_parent_is_category(&pool, cat)
            .await
            .expect("category parent should be valid");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn validate_parent_rejects_article(pool: sqlx::PgPool) {
        let doc = Uuid::new_v4();
        seed_node(&pool, doc, None, "article", "Doc").await;

        let err = validate_parent_is_category(&pool, doc)
            .await
            .expect_err("article parent should be rejected");
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn validate_parent_rejects_nonexistent(pool: sqlx::PgPool) {
        let missing = Uuid::new_v4();
        let err = validate_parent_is_category(&pool, missing)
            .await
            .expect_err("nonexistent parent should be rejected");
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_allows_category_parent(pool: sqlx::PgPool) {
        let cat = Uuid::new_v4();
        seed_node(&pool, cat, None, "category", "Folder").await;

        let state = AppState::new(pool, test_config());

        let res = create(
            &state,
            CreateKnowledgeArticleRequest {
                parent_id: Some(cat.to_string()),
                project_id: None,
                node_type: Some("article".to_string()),
                title: "Child Doc".to_string(),
                slug: None,
                content: None,
                excerpt: None,
                tags: vec![],
                status: None,
                sort_order: None,
            },
        )
        .await;

        assert!(res.is_ok(), "creating under a category should succeed");
        assert_eq!(
            res.unwrap().article.parent_id.as_deref(),
            Some(cat.to_string().as_str())
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_rejects_article_parent(pool: sqlx::PgPool) {
        let doc = Uuid::new_v4();
        seed_node(&pool, doc, None, "article", "Doc").await;

        let state = AppState::new(pool, test_config());

        let err = create(
            &state,
            CreateKnowledgeArticleRequest {
                parent_id: Some(doc.to_string()),
                project_id: None,
                node_type: Some("article".to_string()),
                title: "Nested Doc".to_string(),
                slug: None,
                content: None,
                excerpt: None,
                tags: vec![],
                status: None,
                sort_order: None,
            },
        )
        .await
        .expect_err("creating under an article should be rejected");

        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_rejects_article_parent(pool: sqlx::PgPool) {
        let cat = Uuid::new_v4();
        let doc_a = Uuid::new_v4();
        let doc_b = Uuid::new_v4();
        seed_node(&pool, cat, None, "category", "Folder").await;
        seed_node(&pool, doc_a, Some(cat), "article", "Doc A").await;
        seed_node(&pool, doc_b, Some(cat), "article", "Doc B").await;

        let state = AppState::new(pool, test_config());

        // Attempt to move doc_b under doc_a (an article) — must be rejected.
        let err = update(
            &state,
            doc_b,
            UpdateKnowledgeArticleRequest {
                parent_id: Some(Some(doc_a.to_string())),
                node_type: None,
                title: None,
                slug: None,
                content: None,
                excerpt: None,
                tags: None,
                status: None,
                sort_order: None,
            },
        )
        .await
        .expect_err("moving under an article should be rejected");

        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn move_node_rejects_article_parent(pool: sqlx::PgPool) {
        let cat = Uuid::new_v4();
        let doc_a = Uuid::new_v4();
        let doc_b = Uuid::new_v4();
        seed_node(&pool, cat, None, "category", "Folder").await;
        seed_node(&pool, doc_a, Some(cat), "article", "Doc A").await;
        seed_node(&pool, doc_b, Some(cat), "article", "Doc B").await;

        let state = AppState::new(pool, test_config());

        let err = move_node(
            &state,
            doc_b,
            MoveKnowledgeArticleRequest {
                parent_id: Some(Some(doc_a.to_string())),
                project_id: None,
                sort_order: None,
            },
        )
        .await
        .expect_err("moving under an article should be rejected");

        assert!(matches!(err, AppError::BadRequest(_)));
    }

    fn test_config() -> Config {
        Config {
            database_url: "postgres://sqlx-test".to_string(),
            port: 0,
            cors_origins: Vec::new(),
            auth_cookie_secure: false,
        }
    }
}
