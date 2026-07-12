//! Recoverable source bytes for document-editor revisions.
//!
//! OOXML edits are ownership-based: a model alone cannot recreate preserved
//! package parts that the editor intentionally does not understand. Keeping a
//! small path-local revision window therefore serves two reliability needs:
//! restoring the last known good file after an operational mistake and
//! serializing a conflict copy against the exact package revision the user
//! actually edited, rather than against unrelated newer bytes.

use sqlx::FromRow;

use crate::error::AppResult;
use crate::state::AppState;

const SNAPSHOTS_PER_PATH: i64 = 3;
const SNAPSHOT_PIN_DAYS: i32 = 30;

#[derive(Debug, FromRow)]
pub(super) struct DocumentRevisionSnapshot {
    pub(super) content_bytes: Vec<u8>,
}

pub(super) async fn store_revision_snapshot(
    state: &AppState,
    drive_path: &str,
    content_hash: &str,
    bytes: &[u8],
) -> AppResult<()> {
    upsert_revision_snapshot(state, drive_path, content_hash, bytes, false).await
}

pub(super) async fn pin_revision_snapshot(
    state: &AppState,
    drive_path: &str,
    content_hash: &str,
    bytes: &[u8],
) -> AppResult<()> {
    upsert_revision_snapshot(state, drive_path, content_hash, bytes, true).await
}

pub(super) async fn refresh_revision_snapshot_pin(
    state: &AppState,
    drive_path: &str,
    content_hash: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE document_revision_snapshots
           SET pinned_until = GREATEST(
                   COALESCE(pinned_until, now()),
                   now() + make_interval(days => $3)
               ),
               last_used_at = now()
           WHERE drive_path = $1 AND content_hash = $2"#,
    )
    .bind(drive_path)
    .bind(content_hash)
    .bind(SNAPSHOT_PIN_DAYS)
    .execute(&state.db)
    .await?;
    Ok(())
}

async fn upsert_revision_snapshot(
    state: &AppState,
    drive_path: &str,
    content_hash: &str,
    bytes: &[u8],
    pin: bool,
) -> AppResult<()> {
    let resource_id =
        crate::services::resource_identity::active_resource_id_for_path(&state.db, drive_path)
            .await?;
    let mut transaction = state.db.begin().await?;
    sqlx::query(
        r#"INSERT INTO document_revision_snapshots
              (drive_path, resource_id, content_hash, content_bytes, content_size, pinned_until)
           VALUES (
               $1, $2, $3, $4, $5,
               CASE WHEN $6 THEN now() + make_interval(days => $7) ELSE NULL END
           )
           ON CONFLICT (drive_path, content_hash)
           DO UPDATE SET
               resource_id = COALESCE(EXCLUDED.resource_id, document_revision_snapshots.resource_id),
               last_used_at = now(),
               pinned_until = CASE
                   WHEN $6 THEN GREATEST(
                       COALESCE(document_revision_snapshots.pinned_until, now()),
                       now() + make_interval(days => $7)
                   )
                   ELSE document_revision_snapshots.pinned_until
               END"#,
    )
    .bind(drive_path)
    .bind(resource_id)
    .bind(content_hash)
    .bind(bytes)
    .bind(bytes.len() as i64)
    .bind(pin)
    .bind(SNAPSHOT_PIN_DAYS)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"DELETE FROM document_revision_snapshots
           WHERE drive_path = $1
             AND (pinned_until IS NULL OR pinned_until <= now())
             AND content_hash IN (
                 SELECT content_hash
                 FROM document_revision_snapshots
                 WHERE drive_path = $1
                   AND (pinned_until IS NULL OR pinned_until <= now())
                 ORDER BY last_used_at DESC, created_at DESC
                 OFFSET $2
             )"#,
    )
    .bind(drive_path)
    .bind(SNAPSHOTS_PER_PATH)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

pub(super) async fn load_revision_snapshot(
    state: &AppState,
    drive_path: &str,
    content_hash: &str,
) -> AppResult<Option<Vec<u8>>> {
    let resource_id =
        crate::services::resource_identity::active_resource_id_for_path(&state.db, drive_path)
            .await?;
    let snapshot = sqlx::query_as::<_, DocumentRevisionSnapshot>(
        r#"UPDATE document_revision_snapshots
           SET last_used_at = now(),
               pinned_until = GREATEST(
                   COALESCE(pinned_until, now()),
                   now() + make_interval(days => $3)
               )
           WHERE content_hash = $2
             AND ((resource_id = $4) OR (resource_id IS NULL AND drive_path = $1))
           RETURNING content_bytes"#,
    )
    .bind(drive_path)
    .bind(content_hash)
    .bind(SNAPSHOT_PIN_DAYS)
    .bind(resource_id)
    .fetch_optional(&state.db)
    .await?;
    Ok(snapshot.map(|value| value.content_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "./migrations")]
    async fn snapshots_keep_active_bases_and_bound_inactive_revisions(pool: sqlx::PgPool) {
        let state = AppState::new(pool, test_config());
        pin_revision_snapshot(&state, "/drive/report.docx", "active-base", b"active bytes")
            .await
            .unwrap();
        for index in 0..4 {
            store_revision_snapshot(
                &state,
                "/drive/report.docx",
                &format!("hash-{index}"),
                format!("bytes-{index}").as_bytes(),
            )
            .await
            .unwrap();
        }
        assert_eq!(
            load_revision_snapshot(&state, "/drive/report.docx", "hash-3")
                .await
                .unwrap(),
            Some(b"bytes-3".to_vec())
        );
        assert_eq!(
            load_revision_snapshot(&state, "/drive/report.docx", "active-base")
                .await
                .unwrap(),
            Some(b"active bytes".to_vec())
        );
        assert_eq!(
            load_revision_snapshot(&state, "/drive/report.docx", "hash-0")
                .await
                .unwrap(),
            None
        );
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM document_revision_snapshots WHERE drive_path = $1",
        )
        .bind("/drive/report.docx")
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(count, SNAPSHOTS_PER_PATH + 1);
    }

    fn test_config() -> crate::config::Config {
        crate::config::Config {
            database_url: "postgres://sqlx-test".to_string(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: std::env::temp_dir().join("mymy-document-snapshot-test"),
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
}
