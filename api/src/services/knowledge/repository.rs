use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::knowledge::KnowledgeArticle;
use crate::state::AppState;

/// A knowledge base / wiki article row.
///
/// The `search_tsv` column is server-managed and not read into Rust.
#[derive(Debug, FromRow)]
pub(super) struct KnowledgeArticleRow {
    pub(super) id: Uuid,
    pub(super) parent_id: Option<Uuid>,
    pub(super) project_id: Option<Uuid>,
    pub(super) node_type: String,
    pub(super) title: String,
    pub(super) slug: String,
    pub(super) content: String,
    pub(super) excerpt: String,
    pub(super) tags: Vec<String>,
    pub(super) status: String,
    pub(super) sort_order: i32,
    pub(super) created_at: DateTime<Utc>,
    pub(super) updated_at: DateTime<Utc>,
}

/// Fetch a single article by id, returning a 404 when missing.
pub(super) async fn fetch_article(state: &AppState, id: Uuid) -> AppResult<KnowledgeArticle> {
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

/// Convert a DB row into the API model (Uuid/timestamps -> String).
pub(super) fn row_to_article(row: KnowledgeArticleRow) -> KnowledgeArticle {
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
