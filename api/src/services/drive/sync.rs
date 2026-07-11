use std::path::PathBuf;

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::document_editor::DocumentEditorSyncStatus;
use crate::models::drive::{
    DriveProviderKind, DriveSyncJob, DriveSyncJobsResponse, DriveSyncOperation, DriveSyncStatus,
};
use crate::state::AppState;

use super::paths::{normalize_logical_drive_path, resolve_drive_path, DRIVE_PREFIX};

const MAX_SYNC_JOBS: i64 = 100;

#[derive(Debug, FromRow)]
struct DriveSyncJobRow {
    id: Uuid,
    provider: String,
    drive_path: String,
    operation: String,
    status: String,
    error: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub async fn list_sync_jobs(state: &AppState) -> AppResult<DriveSyncJobsResponse> {
    let rows = sqlx::query_as!(
        DriveSyncJobRow,
        r#"SELECT id, provider, drive_path, operation, status, error, created_at, updated_at
           FROM drive_sync_jobs
           ORDER BY created_at DESC
           LIMIT $1"#,
        MAX_SYNC_JOBS
    )
    .fetch_all(&state.db)
    .await?;

    Ok(DriveSyncJobsResponse {
        jobs: rows.into_iter().map(row_to_sync_job).collect(),
    })
}

pub async fn enqueue_s3_sync_job(
    state: &AppState,
    logical_path: &str,
    operation: &str,
) -> AppResult<()> {
    if state.config.drive_s3_bucket.is_none() {
        return Ok(());
    }
    let path = normalize_logical_drive_path(logical_path)?;
    sqlx::query!(
        r#"INSERT INTO drive_sync_jobs (provider, drive_path, operation, status)
           VALUES ('s3', $1, $2, 'pending')"#,
        path,
        operation,
    )
    .execute(&state.db)
    .await?;
    Ok(())
}

pub(crate) async fn document_sync_status(
    state: &AppState,
    logical_path: &str,
) -> AppResult<DocumentEditorSyncStatus> {
    if state.config.drive_s3_bucket.is_none() {
        return Ok(DocumentEditorSyncStatus::LocalOnly);
    }
    let path = normalize_logical_drive_path(logical_path)?;
    let status = sqlx::query_scalar::<_, String>(
        r#"SELECT status
           FROM drive_sync_jobs
           WHERE provider = 's3' AND drive_path = $1
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(path)
    .fetch_optional(&state.db)
    .await?;
    Ok(match status.as_deref() {
        Some("done") => DocumentEditorSyncStatus::Synced,
        Some("pending" | "running") => DocumentEditorSyncStatus::Pending,
        Some("failed") | None => DocumentEditorSyncStatus::Failed,
        Some(_) => DocumentEditorSyncStatus::Failed,
    })
}

pub fn physical_path_for_sync(state: &AppState, logical_path: &str) -> AppResult<PathBuf> {
    Ok(resolve_drive_path(&state.config.agent_data_dir, logical_path)?.physical_path)
}

pub fn s3_object_key(logical_path: &str) -> AppResult<String> {
    let normalized = normalize_logical_drive_path(logical_path)?;
    let key = normalized
        .trim_start_matches(DRIVE_PREFIX)
        .trim_start_matches('/')
        .to_string();
    if key.is_empty() {
        return Err(AppError::BadRequest(
            "Drive root cannot be synchronized as a single S3 object".into(),
        ));
    }
    Ok(key)
}

fn row_to_sync_job(row: DriveSyncJobRow) -> DriveSyncJob {
    DriveSyncJob {
        id: row.id.to_string(),
        provider: parse_provider(&row.provider),
        drive_path: row.drive_path,
        operation: parse_sync_operation(&row.operation),
        status: parse_sync_status(&row.status),
        error: row.error,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

fn parse_provider(value: &str) -> DriveProviderKind {
    match value {
        "s3" => DriveProviderKind::S3,
        _ => DriveProviderKind::LocalVm,
    }
}

fn parse_sync_operation(value: &str) -> DriveSyncOperation {
    match value {
        "download" => DriveSyncOperation::Download,
        "delete" => DriveSyncOperation::Delete,
        _ => DriveSyncOperation::Upload,
    }
}

fn parse_sync_status(value: &str) -> DriveSyncStatus {
    match value {
        "running" => DriveSyncStatus::Running,
        "failed" => DriveSyncStatus::Failed,
        "done" => DriveSyncStatus::Done,
        _ => DriveSyncStatus::Pending,
    }
}
