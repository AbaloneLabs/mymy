use std::fs;

use sqlx::PgPool;
use uuid::Uuid;

use super::super::*;
use crate::config::Config;

#[sqlx::test(migrations = "./migrations")]
async fn lost_save_response_retries_without_a_second_commit(pool: PgPool) {
    let (state, root, path) = markdown_state(pool, false);
    let opened = read_model(&state, "/drive/shared/notes.md").await.unwrap();
    let mut edited = opened.model.clone();
    edited["content"] = json!("committed once\n");

    let first = write_model(
        &state,
        write_request(&opened, edited.clone(), "lost-response-save"),
    )
    .await
    .unwrap();
    let retried = write_model(&state, write_request(&opened, edited, "lost-response-save"))
        .await
        .unwrap();

    assert_eq!(retried.fingerprint, first.fingerprint);
    assert_eq!(fs::read_to_string(path).unwrap(), "committed once\n");
    let receipt_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM document_editor_save_receipts WHERE idempotency_key = 'lost-response-save'",
    )
    .fetch_one(&state.db)
    .await
    .unwrap();
    let revision_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM document_revision_events WHERE operation_key = 'lost-response-save'",
    )
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(receipt_count, 1);
    assert_eq!(revision_count, 1);
    fs::remove_dir_all(root).unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn two_tabs_and_a_third_revision_keep_every_overwrite_conditional(pool: PgPool) {
    let (state, root, path) = markdown_state(pool, false);
    let tab_a = read_model(&state, "/drive/shared/notes.md").await.unwrap();
    let tab_b = read_model(&state, "/drive/shared/notes.md").await.unwrap();
    let mut model_a = tab_a.model.clone();
    model_a["content"] = json!("tab A\n");
    let revision_a = write_model(&state, write_request(&tab_a, model_a, "tab-a-save"))
        .await
        .unwrap();

    let mut model_b = tab_b.model.clone();
    model_b["content"] = json!("tab B\n");
    let stale_b = write_model(
        &state,
        write_request(&tab_b, model_b.clone(), "tab-b-stale"),
    )
    .await;
    assert!(matches!(stale_b, Err(AppError::Conflict(_))));
    assert_eq!(fs::read_to_string(&path).unwrap(), "tab A\n");

    let reviewed_a = read_model(&state, "/drive/shared/notes.md").await.unwrap();
    assert_eq!(reviewed_a.fingerprint, revision_a.fingerprint);
    let mut model_c = reviewed_a.model.clone();
    model_c["content"] = json!("third revision\n");
    write_model(
        &state,
        write_request(&reviewed_a, model_c, "third-revision-save"),
    )
    .await
    .unwrap();

    let reviewed_overwrite = WriteDocumentEditorModelRequest {
        path: tab_b.path.clone(),
        editor_kind: tab_b.editor_kind,
        model: model_b,
        model_schema_version: tab_b.model_schema_version,
        required_capabilities: document_editor_capabilities(tab_b.editor_kind),
        idempotency_key: "tab-b-reviewed-overwrite".to_string(),
        expected_fingerprint: reviewed_a.fingerprint,
    };
    let stale_review = write_model(&state, reviewed_overwrite).await;

    assert!(matches!(stale_review, Err(AppError::Conflict(_))));
    assert_eq!(fs::read_to_string(path).unwrap(), "third revision\n");
    fs::remove_dir_all(root).unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn sync_enqueue_failure_does_not_hide_the_local_commit(pool: PgPool) {
    let (state, root, path) = markdown_state(pool, true);
    let opened = read_model(&state, "/drive/shared/notes.md").await.unwrap();
    sqlx::query("DROP TABLE drive_sync_jobs")
        .execute(&state.db)
        .await
        .unwrap();
    let mut edited = opened.model.clone();
    edited["content"] = json!("local durable revision\n");

    let saved = write_model(
        &state,
        write_request(&opened, edited, "local-save-sync-failure"),
    )
    .await
    .unwrap();

    assert_eq!(saved.sync_status, DocumentEditorSyncStatus::Failed);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "local durable revision\n"
    );
    let reopened = read_model(&state, "/drive/shared/notes.md").await.unwrap();
    assert_eq!(reopened.model["content"], "local durable revision\n");
    assert_eq!(reopened.fingerprint, saved.fingerprint);
    assert_eq!(reopened.sync_status, DocumentEditorSyncStatus::Failed);
    fs::remove_dir_all(root).unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn model_version_and_capability_mismatches_fail_before_writing(pool: PgPool) {
    let (state, root, path) = markdown_state(pool, false);
    let opened = read_model(&state, "/drive/shared/notes.md").await.unwrap();
    let mut edited = opened.model.clone();
    edited["content"] = json!("must not commit\n");
    let mut version_request = write_request(&opened, edited.clone(), "newer-ui-version");
    version_request.model_schema_version += 1;

    let version_result = write_model(&state, version_request).await;
    assert!(matches!(version_result, Err(AppError::BadRequest(_))));
    assert_eq!(fs::read_to_string(&path).unwrap(), "base revision\n");

    let mut capability_request = write_request(&opened, edited, "newer-ui-capability");
    capability_request
        .required_capabilities
        .push("document-model-from-the-future-v1".to_string());
    let capability_result = write_model(&state, capability_request).await;

    assert!(matches!(capability_result, Err(AppError::BadRequest(_))));
    assert_eq!(fs::read_to_string(path).unwrap(), "base revision\n");
    fs::remove_dir_all(root).unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn agent_revision_is_visible_without_overwriting_the_user_draft(pool: PgPool) {
    let (state, root, path) = markdown_state(pool, false);
    let user_opened = read_model(&state, "/drive/shared/notes.md").await.unwrap();
    let agent_opened = crate::services::drive::read_file(&state, "/drive/shared/notes.md")
        .await
        .unwrap();
    let agent_revision = crate::services::drive::write_file_conditionally(
        &state,
        "/drive/shared/notes.md",
        "agent revision\n",
        Some(&agent_opened.fingerprint),
    )
    .await
    .unwrap();
    record_document_revision(
        &state,
        "/drive/shared/notes.md",
        &agent_revision.hash,
        RevisionActor::Agent("document-agent"),
        "agent-file-tool",
        Some("agent-document-save"),
    )
    .await
    .unwrap();

    let mut user_draft = user_opened.model.clone();
    user_draft["content"] = json!("unsaved user draft\n");
    let stale_user_save = write_model(
        &state,
        write_request(&user_opened, user_draft.clone(), "stale-user-save"),
    )
    .await;

    assert!(matches!(stale_user_save, Err(AppError::Conflict(_))));
    assert_eq!(fs::read_to_string(&path).unwrap(), "agent revision\n");
    assert_eq!(user_draft["content"], "unsaved user draft\n");
    let refreshed = read_model(&state, "/drive/shared/notes.md").await.unwrap();
    let provenance = refreshed.revision_provenance.unwrap();
    assert_eq!(
        provenance.actor_kind,
        crate::models::document_editor::DocumentRevisionActorKind::Agent
    );
    assert_eq!(provenance.actor_id.as_deref(), Some("document-agent"));
    fs::remove_dir_all(root).unwrap();
}

fn write_request(
    opened: &DocumentEditorModelResponse,
    model: Value,
    idempotency_key: &str,
) -> WriteDocumentEditorModelRequest {
    WriteDocumentEditorModelRequest {
        path: opened.path.clone(),
        editor_kind: opened.editor_kind,
        model,
        model_schema_version: opened.model_schema_version,
        required_capabilities: document_editor_capabilities(opened.editor_kind),
        idempotency_key: idempotency_key.to_string(),
        expected_fingerprint: opened.fingerprint.clone(),
    }
}

fn markdown_state(
    pool: PgPool,
    with_s3: bool,
) -> (AppState, std::path::PathBuf, std::path::PathBuf) {
    let root = std::env::temp_dir().join(format!("mymy-document-save-{}", Uuid::new_v4()));
    let path = root.join("drive/shared/notes.md");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "base revision\n").unwrap();
    let state = AppState::new(
        pool,
        Config {
            database_url: "postgres://sqlx-test".to_string(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: root.clone(),
            auth_cookie_secure: false,
            cron_tick_interval_secs: 60,
            cron_timezone: "UTC".to_string(),
            cron_output_keep: 50,
            drive_s3_bucket: with_s3.then(|| "test-bucket".to_string()),
            drive_s3_region: None,
            drive_s3_endpoint: None,
            sandbox_runner_url: None,
            sandbox_preview_host: "127.0.0.1".to_string(),
        },
    );
    (state, root, path)
}
