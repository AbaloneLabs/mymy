use chrono::Utc;
use uuid::Uuid;

use super::hierarchy::{reject_cycle, validate_parent_is_category};
use super::mutations::{create, move_node, update};
use super::repository::KnowledgeArticleRow;
use super::slugs::slugify;
use super::tree::build_tree;
use crate::error::AppError;
use crate::models::knowledge::{
    CreateKnowledgeArticleRequest, MoveKnowledgeArticleRequest, UpdateKnowledgeArticleRequest,
};

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

use crate::config::Config;
use crate::state::AppState;

async fn seed_node(
    pool: &sqlx::PgPool,
    id: Uuid,
    parent_id: Option<Uuid>,
    node_type: &str,
    title: &str,
) {
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
        agent_data_dir: std::env::temp_dir().join("mymy-test-agent"),
        auth_cookie_secure: false,
        cron_tick_interval_secs: 60,
        cron_timezone: "UTC".to_string(),
        cron_output_keep: 50,
        drive_s3_bucket: None,
        drive_s3_region: None,
        drive_s3_endpoint: None,
        sandbox_runner_url: None,
        sandbox_preview_host: "127.0.0.1".to_string(),
    }
}
