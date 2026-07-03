//! Drive object-storage synchronization worker.
//!
//! Local Drive remains the source of truth for agent workspaces. When an S3
//! bucket is configured, Drive mutations enqueue durable jobs and this worker
//! mirrors those changes to object storage. Failed jobs are kept in the table
//! with their error message so the UI can show operational state without
//! inventing placeholder data.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use aws_config::BehaviorVersion;
use aws_sdk_s3::config::Region;
use aws_sdk_s3::primitives::ByteStream;
use sqlx::FromRow;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::services::drive;
use crate::state::AppState;

const CLAIM_LIMIT: i64 = 5;
const WORKER_INTERVAL_SECS: u64 = 15;

#[derive(Debug, FromRow)]
struct DriveSyncWorkRow {
    id: Uuid,
    drive_path: String,
    operation: String,
}

pub fn start_drive_sync_worker(state: Arc<AppState>) -> Option<JoinHandle<()>> {
    state.config.drive_s3_bucket.as_ref()?;
    Some(tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(WORKER_INTERVAL_SECS));
        loop {
            interval.tick().await;
            if let Err(err) = process_pending_jobs(&state).await {
                tracing::warn!(error = %err, "drive S3 sync worker tick failed");
            }
        }
    }))
}

async fn process_pending_jobs(state: &AppState) -> AppResult<()> {
    let jobs = claim_jobs(state).await?;
    if jobs.is_empty() {
        return Ok(());
    }
    let client = s3_client(state).await?;
    let bucket = state
        .config
        .drive_s3_bucket
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("S3 bucket is not configured".to_string()))?;

    for job in jobs {
        let result = perform_job(state, &client, bucket, &job).await;
        match result {
            Ok(()) => mark_job_done(state, job.id).await?,
            Err(err) => mark_job_failed(state, job.id, &err.to_string()).await?,
        }
    }
    Ok(())
}

async fn claim_jobs(state: &AppState) -> AppResult<Vec<DriveSyncWorkRow>> {
    sqlx::query_as!(
        DriveSyncWorkRow,
        r#"UPDATE drive_sync_jobs
           SET status = 'running', updated_at = now(), error = NULL
           WHERE id IN (
               SELECT id
               FROM drive_sync_jobs
               WHERE provider = 's3' AND status = 'pending'
               ORDER BY created_at
               LIMIT $1
               FOR UPDATE SKIP LOCKED
           )
           RETURNING id, drive_path, operation"#,
        CLAIM_LIMIT
    )
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)
}

async fn perform_job(
    state: &AppState,
    client: &aws_sdk_s3::Client,
    bucket: &str,
    job: &DriveSyncWorkRow,
) -> anyhow::Result<()> {
    match job.operation.as_str() {
        "upload" => upload_path(state, client, bucket, &job.drive_path).await,
        "delete" => delete_path(client, bucket, &job.drive_path).await,
        "download" => download_path(state, client, bucket, &job.drive_path).await,
        other => anyhow::bail!("unsupported Drive sync operation: {other}"),
    }
}

async fn upload_path(
    state: &AppState,
    client: &aws_sdk_s3::Client,
    bucket: &str,
    logical_path: &str,
) -> anyhow::Result<()> {
    let physical_path = drive::physical_path_for_sync(state, logical_path)?;
    let key = drive::s3_object_key(logical_path)?;
    if physical_path.is_file() {
        upload_file(client, bucket, &key, &physical_path).await?;
        return Ok(());
    }
    if physical_path.is_dir() {
        let mut files = Vec::new();
        collect_files(&physical_path, &mut files)?;
        for file in files {
            let relative = file.strip_prefix(&physical_path)?;
            let relative_key = relative.to_string_lossy().replace('\\', "/");
            let object_key = format!("{}/{}", key.trim_end_matches('/'), relative_key);
            upload_file(client, bucket, &object_key, &file).await?;
        }
        return Ok(());
    }
    anyhow::bail!("Drive path does not exist for upload: {logical_path}");
}

async fn upload_file(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
    path: &Path,
) -> anyhow::Result<()> {
    let body = ByteStream::from_path(path).await?;
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(body)
        .send()
        .await?;
    Ok(())
}

async fn delete_path(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    logical_path: &str,
) -> anyhow::Result<()> {
    let key = drive::s3_object_key(logical_path)?;
    let _ = client.delete_object().bucket(bucket).key(&key).send().await;

    let prefix = format!("{}/", key.trim_end_matches('/'));
    let mut continuation_token = None;
    loop {
        let mut request = client.list_objects_v2().bucket(bucket).prefix(&prefix);
        if let Some(token) = continuation_token {
            request = request.continuation_token(token);
        }
        let response = request.send().await?;
        for object in response.contents() {
            if let Some(object_key) = object.key() {
                client
                    .delete_object()
                    .bucket(bucket)
                    .key(object_key)
                    .send()
                    .await?;
            }
        }
        continuation_token = response.next_continuation_token().map(str::to_string);
        if continuation_token.is_none() {
            break;
        }
    }
    Ok(())
}

async fn download_path(
    state: &AppState,
    client: &aws_sdk_s3::Client,
    bucket: &str,
    logical_path: &str,
) -> anyhow::Result<()> {
    let key = drive::s3_object_key(logical_path)?;
    let physical_path = drive::physical_path_for_sync(state, logical_path)?;
    if let Some(parent) = physical_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let response = client.get_object().bucket(bucket).key(key).send().await?;
    let bytes = response.body.collect().await?.into_bytes();
    tokio::fs::write(physical_path, bytes).await?;
    Ok(())
}

async fn s3_client(state: &AppState) -> AppResult<aws_sdk_s3::Client> {
    let mut loader = aws_config::defaults(BehaviorVersion::latest());
    if let Some(region) = &state.config.drive_s3_region {
        loader = loader.region(Region::new(region.clone()));
    }
    let shared_config = loader.load().await;
    let mut builder = aws_sdk_s3::config::Builder::from(&shared_config);
    if let Some(endpoint) = &state.config.drive_s3_endpoint {
        builder = builder.endpoint_url(endpoint).force_path_style(true);
    }
    Ok(aws_sdk_s3::Client::from_conf(builder.build()))
}

fn collect_files(root: &Path, out: &mut Vec<PathBuf>) -> AppResult<()> {
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_files(&path, out)?;
        } else if file_type.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

async fn mark_job_done(state: &AppState, id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "UPDATE drive_sync_jobs SET status = 'done', updated_at = now(), error = NULL WHERE id = $1",
        id
    )
    .execute(&state.db)
    .await?;
    Ok(())
}

async fn mark_job_failed(state: &AppState, id: Uuid, error: &str) -> AppResult<()> {
    sqlx::query!(
        "UPDATE drive_sync_jobs SET status = 'failed', updated_at = now(), error = $2 WHERE id = $1",
        id,
        error,
    )
    .execute(&state.db)
    .await?;
    Ok(())
}
