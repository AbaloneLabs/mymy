//! Durable reconciliation records for logical document saves.
//!
//! Filesystem rename and PostgreSQL cannot share one transaction. A pending
//! receipt therefore records the exact output content hash before replacement;
//! if the process or HTTP response disappears after rename, a retry can prove
//! that the intended bytes committed and finalize the receipt without writing
//! or enqueueing sync twice.

use sqlx::FromRow;

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
}

pub(super) async fn load_save_receipt(
    state: &AppState,
    idempotency_key: &str,
) -> AppResult<Option<DocumentSaveReceipt>> {
    Ok(sqlx::query_as::<_, DocumentSaveReceipt>(
        r#"SELECT idempotency_key, drive_path, editor_kind,
                  expected_fingerprint, request_hash, result_content_hash,
                  result_fingerprint, status
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
    let result = sqlx::query(
        r#"INSERT INTO document_editor_save_receipts
              (idempotency_key, drive_path, editor_kind,
               expected_fingerprint, request_hash, result_content_hash,
               status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')
           ON CONFLICT (idempotency_key) DO NOTHING"#,
    )
    .bind(&receipt.idempotency_key)
    .bind(&receipt.drive_path)
    .bind(&receipt.editor_kind)
    .bind(&receipt.expected_fingerprint)
    .bind(&receipt.request_hash)
    .bind(&receipt.result_content_hash)
    .execute(&state.db)
    .await?;
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
