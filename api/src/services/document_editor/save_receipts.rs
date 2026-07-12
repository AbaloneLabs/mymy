//! Durable reconciliation records for logical document saves.
//!
//! Filesystem rename and PostgreSQL cannot share one transaction. A pending
//! receipt therefore records the exact output content hash before replacement;
//! if the process or HTTP response disappears after rename, a retry can prove
//! that the intended bytes committed and finalize the receipt without writing
//! or enqueueing sync twice.

use sqlx::FromRow;
use uuid::Uuid;

use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, FromRow)]
pub(super) struct DocumentSaveReceipt {
    pub(super) idempotency_key: String,
    pub(super) drive_path: String,
    pub(super) editor_kind: String,
    pub(super) expected_fingerprint: String,
    pub(super) request_hash: String,
    pub(super) result_content_hash: String,
    pub(super) result_fingerprint: Option<String>,
    pub(super) status: String,
    pub(super) source_session_id: Option<Uuid>,
}

pub(super) async fn load_save_receipt(
    state: &AppState,
    idempotency_key: &str,
) -> AppResult<Option<DocumentSaveReceipt>> {
    Ok(sqlx::query_as::<_, DocumentSaveReceipt>(
        r#"SELECT idempotency_key, drive_path, editor_kind,
                  expected_fingerprint, request_hash, result_content_hash,
                  result_fingerprint, status, source_session_id
           FROM document_editor_save_receipts
           WHERE idempotency_key = $1"#,
    )
    .bind(idempotency_key)
    .fetch_optional(&state.db)
    .await?)
}

pub(super) async fn insert_pending_save_receipt(
    state: &AppState,
    receipt: &DocumentSaveReceipt,
) -> AppResult<bool> {
    let mut tx = state.db.begin().await?;
    if let Some(session_id) = receipt.source_session_id {
        let deleting_at = sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
            "SELECT deleting_at FROM chat_sessions WHERE id = $1 FOR KEY SHARE",
        )
        .bind(session_id)
        .fetch_optional(&mut *tx)
        .await?;
        if !matches!(deleting_at, Some(None)) {
            return Err(crate::error::AppError::Conflict(
                "artifact source session is being deleted".to_string(),
            ));
        }
    }
    let result = sqlx::query(
        r#"INSERT INTO document_editor_save_receipts
              (idempotency_key, drive_path, editor_kind,
               expected_fingerprint, request_hash, result_content_hash,
               status, source_session_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
           ON CONFLICT (idempotency_key) DO NOTHING"#,
    )
    .bind(&receipt.idempotency_key)
    .bind(&receipt.drive_path)
    .bind(&receipt.editor_kind)
    .bind(&receipt.expected_fingerprint)
    .bind(&receipt.request_hash)
    .bind(&receipt.result_content_hash)
    .bind(receipt.source_session_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if result.rows_affected() == 0 && receipt.source_session_id.is_some() {
        let existing = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM document_editor_save_receipts WHERE idempotency_key = $1)",
        )
        .bind(&receipt.idempotency_key)
        .fetch_one(&state.db)
        .await?;
        if !existing {
            return Err(crate::error::AppError::Conflict(
                "artifact source session is being deleted".to_string(),
            ));
        }
    }
    Ok(result.rows_affected() == 1)
}

pub(super) async fn mark_save_receipt_committed(
    state: &AppState,
    idempotency_key: &str,
    result_fingerprint: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE document_editor_save_receipts
           SET status = 'committed', result_fingerprint = $2, updated_at = now()
           WHERE idempotency_key = $1"#,
    )
    .bind(idempotency_key)
    .bind(result_fingerprint)
    .execute(&state.db)
    .await?;
    Ok(())
}

pub(super) async fn refresh_pending_result_hash(
    state: &AppState,
    idempotency_key: &str,
    result_content_hash: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE document_editor_save_receipts
           SET result_content_hash = $2, updated_at = now()
           WHERE idempotency_key = $1 AND status = 'pending'"#,
    )
    .bind(idempotency_key)
    .bind(result_content_hash)
    .execute(&state.db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::*;

    fn test_config() -> crate::config::Config {
        crate::config::Config {
            database_url: String::new(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: std::env::temp_dir()
                .join(format!("mymy-save-fence-test-{}", Uuid::new_v4())),
            auth_cookie_secure: false,
            cron_tick_interval_secs: 60,
            cron_timezone: "UTC".to_string(),
            cron_output_keep: 10,
            drive_s3_bucket: None,
            drive_s3_region: None,
            drive_s3_endpoint: None,
            sandbox_runner_url: None,
            sandbox_preview_host: "127.0.0.1".to_string(),
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn deletion_fence_serializes_with_pending_save_admission(pool: sqlx::PgPool) {
        let state = Arc::new(AppState::new(pool.clone(), test_config()));
        let session_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO chat_sessions(agent_id, profile) VALUES ('save-fence', 'save-fence') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let mut deletion = pool.begin().await.unwrap();
        sqlx::query("SELECT id FROM chat_sessions WHERE id = $1 FOR UPDATE")
            .bind(session_id)
            .execute(&mut *deletion)
            .await
            .unwrap();
        sqlx::query("UPDATE chat_sessions SET deleting_at = now() WHERE id = $1")
            .bind(session_id)
            .execute(&mut *deletion)
            .await
            .unwrap();

        let insert_state = state.clone();
        let mut insert = tokio::spawn(async move {
            insert_pending_save_receipt(
                &insert_state,
                &DocumentSaveReceipt {
                    idempotency_key: "delete-save-race".to_string(),
                    drive_path: "/drive/shared/report.md".to_string(),
                    editor_kind: "markdown".to_string(),
                    expected_fingerprint: "before".to_string(),
                    request_hash: "request".to_string(),
                    result_content_hash: "after".to_string(),
                    result_fingerprint: None,
                    status: "pending".to_string(),
                    source_session_id: Some(session_id),
                },
            )
            .await
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut insert)
                .await
                .is_err()
        );

        deletion.commit().await.unwrap();
        let error = insert.await.unwrap().unwrap_err();
        assert!(matches!(error, crate::error::AppError::Conflict(_)));
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM document_editor_save_receipts WHERE idempotency_key = 'delete-save-race'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
    }
}
