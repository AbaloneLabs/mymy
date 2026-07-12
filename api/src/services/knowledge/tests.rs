use chrono::Utc;
use uuid::Uuid;

use super::hierarchy::{reject_cycle, validate_parent_is_category};
use super::mutations::{create, move_node, update};
use super::repository::KnowledgeArticleRow;
use super::slugs::slugify;
use super::tree::build_tree;
use crate::error::AppError;
use crate::models::knowledge::{
    AttachKnowledgeResourceRequest, CreateKnowledgeArticleRequest, MoveKnowledgeArticleRequest,
    UpdateKnowledgeArticleRequest,
};
use crate::services::drive;

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

#[sqlx::test(migrations = "./migrations")]
async fn drive_resource_link_survives_move_and_exposes_trash_breakage(pool: sqlx::PgPool) {
    let node = Uuid::new_v4();
    seed_node(&pool, node, None, "article", "Linked Doc").await;
    let agent_data_dir =
        std::env::temp_dir().join(format!("mymy-knowledge-resource-test-{}", Uuid::new_v4()));
    std::fs::create_dir_all(agent_data_dir.join("drive/shared"))
        .expect("Drive test directory should be created");
    std::fs::write(agent_data_dir.join("drive/shared/report.md"), "# Report\n")
        .expect("Drive test file should be created");
    let mut config = test_config();
    config.agent_data_dir = agent_data_dir.clone();
    let state = AppState::new(pool, config);

    super::resources::attach_resource(
        &state,
        node,
        AttachKnowledgeResourceRequest {
            resource_ref: "/drive/shared/report.md".to_string(),
            title: None,
            sort_order: 0,
        },
    )
    .await
    .expect("supported Drive document should attach");
    let attached_resource_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT drive_resource_id FROM knowledge_resources WHERE knowledge_id = $1",
    )
    .bind(node)
    .fetch_one(&state.db)
    .await
    .expect("attached Wiki resource should expose its stable Drive identity")
    .expect("new Wiki links must dual-write a Drive resource id");
    drive::move_path(
        &state,
        "/drive/shared/report.md",
        "/drive/shared/renamed.md",
        None,
        None,
    )
    .await
    .expect("Drive move should reconcile Wiki links");
    let moved = super::resources::list_resources(&state, node)
        .await
        .expect("resources should list after move");
    assert_eq!(moved.resources[0].resource_ref, "/drive/shared/renamed.md");
    assert_eq!(moved.resources[0].status, "linked");
    let moved_resource_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT drive_resource_id FROM knowledge_resources WHERE knowledge_id = $1",
    )
    .bind(node)
    .fetch_one(&state.db)
    .await
    .expect("moved Wiki resource should retain its stable identity");
    assert_eq!(moved_resource_id, Some(attached_resource_id));

    drive::delete_path(&state, "/drive/shared/renamed.md", None, None)
        .await
        .expect("Drive delete should move the file to trash");
    let broken = super::resources::list_resources(&state, node)
        .await
        .expect("broken resource should remain visible");
    assert_eq!(broken.resources[0].status, "broken");

    let trash = drive::list_trash(&state)
        .await
        .expect("trash entry should be visible");
    let trash_id = Uuid::parse_str(&trash.entries[0].id).expect("trash id should be valid");
    drive::restore_trash(&state, trash_id, None, None)
        .await
        .expect("restoring should reconcile Wiki links");
    let restored = super::resources::list_resources(&state, node)
        .await
        .expect("restored resource should list");
    assert_eq!(restored.resources[0].status, "linked");
    let restored_resource_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT drive_resource_id FROM knowledge_resources WHERE knowledge_id = $1",
    )
    .bind(node)
    .fetch_one(&state.db)
    .await
    .expect("restored Wiki resource should retain its stable identity");
    assert_eq!(restored_resource_id, Some(attached_resource_id));

    let _ = std::fs::remove_dir_all(agent_data_dir);
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
