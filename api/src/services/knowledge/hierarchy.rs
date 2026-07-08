use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub(super) async fn check_cycle(
    db: &sqlx::PgPool,
    node_id: Uuid,
    new_parent: Uuid,
) -> AppResult<()> {
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

pub(super) fn reject_cycle(creates_cycle: bool) -> AppResult<()> {
    if creates_cycle {
        return Err(AppError::BadRequest(
            "moving this node under the given parent would create a cycle".to_string(),
        ));
    }
    Ok(())
}

pub(super) async fn validate_parent_is_category(
    db: &sqlx::PgPool,
    parent_id: Uuid,
) -> AppResult<()> {
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
