use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::knowledge::{
    KnowledgeArticleResponse, KnowledgeBreadcrumbItem, KnowledgeBreadcrumbResponse,
    KnowledgeFlatQuery, KnowledgeListResponse, KnowledgeSearchQuery, KnowledgeTreeQuery,
    KnowledgeTreeResponse,
};
use crate::state::AppState;

use super::repository::{fetch_article, row_to_article};
use super::tree::{attach_resources, build_tree, parse_project_filter};

/// GET /api/knowledge
pub async fn list_tree(
    state: &AppState,
    q: KnowledgeTreeQuery,
) -> AppResult<KnowledgeTreeResponse> {
    let rows = sqlx::query_as!(
        super::repository::KnowledgeArticleRow,
        r#"SELECT id, parent_id, project_id, node_type, title, slug, content, excerpt,
                  tags, status, sort_order, created_at, updated_at
           FROM knowledge_articles
           ORDER BY (node_type = 'category') DESC, sort_order ASC, title ASC"#
    )
    .fetch_all(&state.db)
    .await?;

    let project_filter = parse_project_filter(q.project_id.as_deref())?;
    let mut tree = build_tree(rows, project_filter);
    let mut resources = super::resources::resource_map(state).await?;
    attach_resources(&mut tree, &mut resources);
    Ok(KnowledgeTreeResponse { tree })
}

/// GET /api/knowledge/flat
pub async fn list_flat(
    state: &AppState,
    q: KnowledgeFlatQuery,
) -> AppResult<KnowledgeListResponse> {
    let parent_filter = match q.parent_id.as_deref() {
        Some("null") | Some("") => Some(None::<Uuid>),
        Some(pid) => {
            Some(Some(Uuid::parse_str(pid).map_err(|e| {
                AppError::BadRequest(format!("invalid parentId: {e}"))
            })?))
        }
        None => None,
    };
    let project_filter = parse_project_filter(q.project_id.as_deref())?;

    let rows = sqlx::query_as!(
        super::repository::KnowledgeArticleRow,
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
pub async fn search(state: &AppState, q: KnowledgeSearchQuery) -> AppResult<KnowledgeListResponse> {
    let term = q.q.trim();
    if term.is_empty() {
        return Ok(KnowledgeListResponse { articles: vec![] });
    }

    let rows = sqlx::query_as!(
        super::repository::KnowledgeArticleRow,
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
pub async fn get_children(state: &AppState, id: Uuid) -> AppResult<KnowledgeListResponse> {
    let rows = sqlx::query_as!(
        super::repository::KnowledgeArticleRow,
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
pub async fn get_breadcrumb(state: &AppState, id: Uuid) -> AppResult<KnowledgeBreadcrumbResponse> {
    let rows = sqlx::query!(
        r#"WITH RECURSIVE ancestors AS (
            SELECT id, parent_id, title, slug, node_type, 0 AS depth
            FROM knowledge_articles
            WHERE id = $1
            UNION ALL
            SELECT ka.id, ka.parent_id, ka.title, ka.slug, ka.node_type, a.depth + 1
            FROM knowledge_articles ka
            JOIN ancestors a ON ka.id = a.parent_id
            WHERE a.depth < 50
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
        .map(|row| KnowledgeBreadcrumbItem {
            id: row.id.to_string(),
            title: row.title,
            slug: row.slug,
            node_type: row.node_type,
        })
        .collect();
    Ok(KnowledgeBreadcrumbResponse { breadcrumb })
}
