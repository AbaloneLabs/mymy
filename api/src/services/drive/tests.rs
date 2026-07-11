use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use uuid::Uuid;
use zip::ZipArchive;

use super::*;
use crate::config::Config;
use crate::services::editor_settings;
use crate::state::AppState;

#[test]
fn logical_drive_path_maps_to_physical_root() {
    let drive_root = Path::new("/tmp/mymy-test/drive");
    let mapped = physical_path_for_logical_drive_path(drive_root, Path::new("/drive/shared/a.md"))
        .unwrap()
        .unwrap();
    assert_eq!(mapped, PathBuf::from("/tmp/mymy-test/drive/shared/a.md"));
}

#[test]
fn logical_drive_mapping_rejects_parent_segments() {
    let drive_root = Path::new("/tmp/mymy-test/drive");
    let err = physical_path_for_logical_drive_path(drive_root, Path::new("/drive/shared/../x"))
        .unwrap_err();
    assert!(err.to_string().contains("Invalid Drive path segment"));
}

#[test]
fn normalize_logical_drive_path_rejects_similar_prefixes() {
    let err = normalize_logical_drive_path("/drivefoo").unwrap_err();
    assert!(err.to_string().contains("Drive paths must start"));
}

#[sqlx::test(migrations = "./migrations")]
async fn document_package_includes_document_and_uploaded_fonts(pool: sqlx::PgPool) {
    let agent_data_dir =
        std::env::temp_dir().join(format!("mymy-drive-package-test-{}", Uuid::new_v4()));
    let _ = fs::remove_dir_all(&agent_data_dir);
    fs::create_dir_all(agent_data_dir.join("drive/agents/elena")).unwrap();

    let state = test_state(pool, agent_data_dir.clone());
    fs::write(
        agent_data_dir.join("drive/agents/elena/test.md"),
        b"# Test document\n",
    )
    .unwrap();
    editor_settings::upload_font(
        &state,
        "Custom Font.ttf",
        bytes::Bytes::from_static(b"font-bytes"),
    )
    .unwrap();

    let (bytes, package_name) = document_package(&state, "/drive/agents/elena/test.md").unwrap();
    assert_eq!(package_name, "test-with-fonts.zip");

    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut document = String::new();
    archive
        .by_name("document/test.md")
        .unwrap()
        .read_to_string(&mut document)
        .unwrap();
    assert_eq!(document, "# Test document\n");

    let mut font = Vec::new();
    archive
        .by_name("fonts/01-Custom Font.ttf")
        .unwrap()
        .read_to_end(&mut font)
        .unwrap();
    assert_eq!(font, b"font-bytes");

    let mut manifest = String::new();
    archive
        .by_name("mymy-font-package.json")
        .unwrap()
        .read_to_string(&mut manifest)
        .unwrap();
    assert!(manifest.contains("\"drivePath\": \"/drive/agents/elena/test.md\""));
    assert!(manifest.contains("\"packagePath\": \"fonts/01-Custom Font.ttf\""));

    archive.by_name("FONT_LICENSE_NOTICE.txt").unwrap();
    let _ = fs::remove_dir_all(agent_data_dir);
}

#[sqlx::test(migrations = "./migrations")]
async fn raw_drive_write_requires_and_rechecks_the_read_fingerprint(pool: sqlx::PgPool) {
    let agent_data_dir =
        std::env::temp_dir().join(format!("mymy-drive-cas-test-{}", Uuid::new_v4()));
    let path = agent_data_dir.join("drive/shared/state.txt");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "first").unwrap();
    let state = test_state(pool, agent_data_dir.clone());

    let opened = read_file(&state, "/drive/shared/state.txt").await.unwrap();
    assert!(!opened.fingerprint.is_empty());
    let missing =
        write_file_conditionally(&state, "/drive/shared/state.txt", "unreviewed", None).await;
    assert!(matches!(missing, Err(crate::error::AppError::Conflict(_))));

    fs::write(&path, "external").unwrap();
    let stale = write_file_conditionally(
        &state,
        "/drive/shared/state.txt",
        "stale overwrite",
        Some(&opened.fingerprint),
    )
    .await;
    assert!(matches!(stale, Err(crate::error::AppError::Conflict(_))));
    assert_eq!(fs::read_to_string(&path).unwrap(), "external");

    let refreshed = read_file(&state, "/drive/shared/state.txt").await.unwrap();
    let committed = write_file_conditionally(
        &state,
        "/drive/shared/state.txt",
        "committed",
        Some(&refreshed.fingerprint),
    )
    .await
    .unwrap();
    assert_ne!(committed.hash, refreshed.fingerprint);
    assert_eq!(fs::read_to_string(&path).unwrap(), "committed");
    let _ = fs::remove_dir_all(agent_data_dir);
}

fn test_state(db: sqlx::PgPool, agent_data_dir: PathBuf) -> AppState {
    AppState::new(
        db,
        Config {
            database_url: "postgres://mymy:mymy@localhost/mymy".to_string(),
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
        },
    )
}
