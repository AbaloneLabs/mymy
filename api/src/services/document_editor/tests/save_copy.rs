use std::fs;

use sqlx::PgPool;
use uuid::Uuid;

use super::super::*;
use crate::config::Config;
use crate::models::document_editor::SaveDocumentEditorCopyRequest;

#[sqlx::test(migrations = "./migrations")]
async fn conflict_copy_uses_the_opened_snapshot_and_is_idempotent(pool: PgPool) {
    let root = std::env::temp_dir().join(format!("mymy-document-copy-{}", Uuid::new_v4()));
    let shared = root.join("drive/shared");
    fs::create_dir_all(&shared).unwrap();
    let source = shared.join("report.md");
    let target = shared.join("report (conflict copy).md");
    fs::write(&source, "base revision\n").unwrap();
    let state = AppState::new(pool, test_config(root.clone()));
    let opened = read_model(&state, "/drive/shared/report.md").await.unwrap();
    for revision in 1..=5 {
        let previous = fs::read(&source).unwrap();
        store_revision_snapshot(
            &state,
            "/drive/shared/report.md",
            &content_hash(&previous),
            &previous,
        )
        .await
        .unwrap();
        fs::write(&source, format!("external revision {revision}\n")).unwrap();
    }

    let request = || SaveDocumentEditorCopyRequest {
        source_path: "/drive/shared/report.md".to_string(),
        target_path: "/drive/shared/report (conflict copy).md".to_string(),
        editor_kind: DocumentEditorKind::Markdown,
        model: json!({
            "content": "local draft\n",
            "encoding": "utf-8",
            "lineEnding": "lf",
            "trailingNewline": true
        }),
        model_schema_version: DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION,
        required_capabilities: document_editor_capabilities(DocumentEditorKind::Markdown),
        idempotency_key: "copy-operation-1".to_string(),
        base_fingerprint: opened.fingerprint.clone(),
        source_session_id: None,
    };

    let copied = save_copy(&state, request()).await.unwrap();
    assert_eq!(copied.path, "/drive/shared/report (conflict copy).md");
    assert_eq!(
        fs::read_to_string(&source).unwrap(),
        "external revision 5\n"
    );
    assert_eq!(fs::read_to_string(&target).unwrap(), "local draft\n");

    let retried = save_copy(&state, request()).await.unwrap();
    assert_eq!(retried.fingerprint, copied.fingerprint);
    assert_eq!(fs::read_to_string(&target).unwrap(), "local draft\n");
    let _ = fs::remove_dir_all(root);
}

fn test_config(agent_data_dir: std::path::PathBuf) -> Config {
    Config {
        database_url: "postgres://sqlx-test".to_string(),
        port: 0,
        cors_origins: Vec::new(),
        agent_data_dir,
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
