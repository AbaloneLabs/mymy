use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::knowledge::{
    CreateKnowledgeArticleRequest, KnowledgeArticleResponse, MoveKnowledgeArticleRequest,
    UpdateKnowledgeArticleRequest,
};
use crate::services::audit::log_audit_safe;
use crate::services::versions::{
    compute_knowledge_article_change_summary, create_version_checkpoint, delete_entity_versions,
    knowledge_article_to_snapshot, maybe_create_version,
};
use crate::state::AppState;

use super::hierarchy::{check_cycle, validate_parent_is_category};
use super::repository::fetch_article;
use super::slugs::{ensure_unique_slug, slugify};

/// POST /api/knowledge
pub async fn create(
    state: &AppState,
    req: CreateKnowledgeArticleRequest,
) -> AppResult<KnowledgeArticleResponse> {
    let id = Uuid::new_v4();
    let parent_uuid = parse_optional_uuid(req.parent_id.as_deref(), "parentId")?;

    if let Some(parent_id) = parent_uuid {
        validate_parent_is_category(&state.db, parent_id).await?;
    }

    let project_uuid = parse_optional_uuid(req.project_id.as_deref(), "projectId")?;
    let node_type = req.node_type.as_deref().unwrap_or("article");
    validate_node_type(node_type)?;
    let status = req.status.as_deref().unwrap_or("draft");
    validate_status(status)?;

    let base_slug = match req.slug.as_deref() {
        Some(slug) => slug.to_string(),
        None => slugify(&req.title).unwrap_or_else(|| id.to_string()),
    };
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
    let snapshot = knowledge_article_to_snapshot(&article);
    if let Err(err) = create_version_checkpoint(
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
        tracing::warn!(error = ?err, article_id = %id, "failed to create initial version");
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
    if let Some(ref node_type) = req.node_type {
        validate_node_type(node_type)?;
    }
    if let Some(ref status) = req.status {
        validate_status(status)?;
    }

    let parent_uuid = parse_nested_optional_uuid(req.parent_id, "parentId")?;
    if let Some(Some(new_parent)) = parent_uuid {
        validate_parent_change(&state.db, id, new_parent).await?;
    }

    let before = fetch_article(state, id).await?;

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
    let change_summary = compute_knowledge_article_change_summary(&before, &article);
    let snapshot = knowledge_article_to_snapshot(&article);
    if let Err(err) = maybe_create_version(
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
        tracing::warn!(error = ?err, article_id = %id, "failed to create version checkpoint");
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
pub async fn move_node(
    state: &AppState,
    id: Uuid,
    req: MoveKnowledgeArticleRequest,
) -> AppResult<KnowledgeArticleResponse> {
    let parent_uuid = parse_nested_optional_uuid(req.parent_id, "parentId")?;
    let project_uuid = parse_nested_optional_uuid(req.project_id, "projectId")?;

    if let Some(Some(new_parent)) = parent_uuid {
        validate_parent_change(&state.db, id, new_parent).await?;
    }

    if let Some(parent) = parent_uuid {
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

    if let Err(err) = delete_entity_versions(&state.db, "knowledge_article", id).await {
        tracing::warn!(error = ?err, article_id = %id, "failed to delete article versions");
    }

    Ok(true)
}

fn parse_optional_uuid(raw: Option<&str>, field: &str) -> AppResult<Option<Uuid>> {
    raw.map(|value| {
        Uuid::parse_str(value)
            .map_err(|err| AppError::BadRequest(format!("invalid {field}: {err}")))
    })
    .transpose()
}

fn parse_nested_optional_uuid(
    raw: Option<Option<String>>,
    field: &str,
) -> AppResult<Option<Option<Uuid>>> {
    match raw {
        None => Ok(None),
        Some(None) => Ok(Some(None)),
        Some(Some(value)) => {
            Ok(Some(Some(Uuid::parse_str(&value).map_err(|err| {
                AppError::BadRequest(format!("invalid {field}: {err}"))
            })?)))
        }
    }
}

fn validate_node_type(value: &str) -> AppResult<()> {
    if value == "category" || value == "article" {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid nodeType: {value}")))
    }
}

fn validate_status(value: &str) -> AppResult<()> {
    if value == "draft" || value == "published" {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid status: {value}")))
    }
}

async fn validate_parent_change(
    db: &sqlx::PgPool,
    node_id: Uuid,
    new_parent: Uuid,
) -> AppResult<()> {
    if new_parent == node_id {
        return Err(AppError::BadRequest(
            "a node cannot be its own parent".to_string(),
        ));
    }
    check_cycle(db, node_id, new_parent).await?;
    validate_parent_is_category(db, new_parent).await
}
