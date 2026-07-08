use sqlx::PgPool;
use uuid::Uuid;

pub(super) fn slugify(input: &str) -> Option<String> {
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

pub(super) async fn ensure_unique_slug(
    db: &PgPool,
    parent_id: Option<Uuid>,
    base_slug: &str,
) -> String {
    let base = if base_slug.trim().is_empty() {
        format!("node-{}", Uuid::new_v4().simple())
    } else {
        base_slug.to_string()
    };

    if !slug_exists(db, parent_id, &base).await {
        return base;
    }

    for n in 2..=1000 {
        let candidate = format!("{base}-{n}");
        if !slug_exists(db, parent_id, &candidate).await {
            return candidate;
        }
    }

    format!("{base}-{}", Uuid::new_v4().simple())
}

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
