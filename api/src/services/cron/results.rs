use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::scheduler::{CronJob, JobMode};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::runtime::write_file_atomic;
use super::types::{CronResult, CronResultsQuery, CronResultsResponse};

#[derive(Debug, FromRow)]
struct CronResultRow {
    id: Uuid,
    job_id: String,
    job_title: String,
    mode: String,
    status: String,
    output: String,
    output_path: Option<String>,
    created_at: DateTime<Utc>,
}

pub async fn list_results(
    state: &AppState,
    query: CronResultsQuery,
) -> AppResult<CronResultsResponse> {
    let limit = query.limit.clamp(1, 200);
    let rows = sqlx::query_as!(
        CronResultRow,
        r#"SELECT id, job_id, job_title, mode, status, output, output_path, created_at
           FROM cron_results
           ORDER BY created_at DESC
           LIMIT $1"#,
        limit,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(CronResultsResponse {
        results: rows.into_iter().map(row_to_result).collect(),
    })
}

pub(super) async fn insert_result(
    state: &AppState,
    job: &CronJob,
    status: &str,
    output: &str,
    output_path: Option<String>,
) -> AppResult<()> {
    sqlx::query!(
        r#"INSERT INTO cron_results
           (job_id, job_title, mode, status, output, output_path)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
        job.id,
        job.title,
        mode_label(&job.mode),
        status,
        output,
        output_path,
    )
    .execute(&state.db)
    .await?;
    Ok(())
}

pub(super) fn write_output(
    state: &AppState,
    job: &CronJob,
    status: &str,
    output: &str,
) -> AppResult<Option<String>> {
    let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let dir = state
        .config
        .agent_data_dir
        .join("cron")
        .join("outputs")
        .join(&job.id);
    fs::create_dir_all(&dir)
        .map_err(|err| AppError::Internal(format!("cron output dir create failed: {err}")))?;
    let path = dir.join(format!("{timestamp}.md"));
    let body = format!(
        "# {}\n\nStatus: {}\nJob: {}\n\n{}",
        job.title, status, job.id, output
    );
    write_file_atomic(&path, &body)
        .map_err(|err| AppError::Internal(format!("cron output write failed: {err}")))?;
    prune_output_dir(&dir, state.config.cron_output_keep)?;
    Ok(Some(path.display().to_string()))
}

fn prune_output_dir(dir: &Path, keep: usize) -> AppResult<()> {
    let mut files = fs::read_dir(dir)
        .map_err(|err| AppError::Internal(format!("cron output prune read failed: {err}")))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            metadata.is_file().then(|| {
                (
                    entry.path(),
                    metadata
                        .modified()
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
                )
            })
        })
        .collect::<Vec<_>>();
    if files.len() <= keep {
        return Ok(());
    }
    files.sort_by_key(|(_, modified)| *modified);
    let remove_count = files.len().saturating_sub(keep);
    for (path, _) in files.into_iter().take(remove_count) {
        if let Err(err) = fs::remove_file(&path) {
            tracing::warn!(path = %path.display(), error = %err, "cron output prune failed");
        }
    }
    Ok(())
}

fn row_to_result(row: CronResultRow) -> CronResult {
    CronResult {
        id: row.id.to_string(),
        job_id: row.job_id,
        job_title: row.job_title,
        mode: row.mode,
        status: row.status,
        output: row.output,
        output_path: row.output_path,
        created_at: row.created_at.to_rfc3339(),
    }
}

fn mode_label(mode: &JobMode) -> &'static str {
    match mode {
        JobMode::Agent => "agent",
        JobMode::NoAgent => "no_agent",
    }
}
