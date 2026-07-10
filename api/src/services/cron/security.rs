//! Security quarantine for legacy cron definitions that could execute shell
//! commands in the API process.
//!
//! Startup migrates safe agent jobs to the current schema and moves every
//! no-agent, unknown-mode, or invalid definition into PostgreSQL before the
//! scheduler is started. The raw definition is retained only for an explicit
//! authenticated review/export request; list responses never expose it.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::scheduler::{jobs_path, CronJob, CronStore};
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

use super::types::{
    QuarantinedCronJobDeleteResponse, QuarantinedCronJobDetailResponse, QuarantinedCronJobSummary,
    QuarantinedCronJobsResponse,
};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct QuarantineReport {
    pub quarantined: usize,
    pub active_jobs: usize,
    pub rewritten: bool,
}

#[derive(Debug)]
struct QuarantineCandidate {
    legacy_job_id: String,
    definition_fingerprint: String,
    title: String,
    original_definition: Value,
    was_enabled: bool,
    reason: String,
}

#[derive(Debug, Default)]
struct InspectedJobs {
    active: Vec<CronJob>,
    quarantine: Vec<QuarantineCandidate>,
    rewritten: bool,
}

#[derive(Debug, FromRow)]
struct QuarantinedSummaryRow {
    id: Uuid,
    legacy_job_id: String,
    title: String,
    was_enabled: bool,
    quarantine_reason: String,
    quarantined_at: DateTime<Utc>,
    prior_result_count: i64,
    last_result_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct QuarantinedDetailRow {
    id: Uuid,
    legacy_job_id: String,
    title: String,
    original_definition: Value,
    was_enabled: bool,
    quarantine_reason: String,
    quarantined_at: DateTime<Utc>,
    prior_result_count: i64,
    last_result_at: Option<DateTime<Utc>>,
}

pub async fn quarantine_legacy_jobs(state: &AppState) -> AppResult<QuarantineReport> {
    let path = jobs_path(&state.config.agent_data_dir);
    if !path.exists() {
        return Ok(QuarantineReport::default());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|err| AppError::Internal(format!("cron security migration read failed: {err}")))?;
    let inspected = inspect_jobs_file(&raw);
    let report = QuarantineReport {
        quarantined: inspected.quarantine.len(),
        active_jobs: inspected.active.len(),
        rewritten: inspected.rewritten,
    };

    if !inspected.quarantine.is_empty() {
        let mut tx = state.db.begin().await?;
        for candidate in &inspected.quarantine {
            let inserted = sqlx::query(
                r#"INSERT INTO quarantined_cron_jobs
                   (legacy_job_id, definition_fingerprint, title, original_definition,
                    was_enabled, quarantine_reason)
                   VALUES ($1, $2, $3, $4, $5, $6)
                   ON CONFLICT (definition_fingerprint) DO NOTHING"#,
            )
            .bind(&candidate.legacy_job_id)
            .bind(&candidate.definition_fingerprint)
            .bind(&candidate.title)
            .bind(&candidate.original_definition)
            .bind(candidate.was_enabled)
            .bind(&candidate.reason)
            .execute(&mut *tx)
            .await?;
            if inserted.rows_affected() == 1 && candidate.was_enabled {
                sqlx::query(
                    r#"INSERT INTO cron_results
                       (job_id, job_title, mode, status, output)
                       VALUES ($1, $2, 'no_agent', 'blocked_security_review',
                               'Legacy no-agent cron job quarantined before scheduler startup.')"#,
                )
                .bind(&candidate.legacy_job_id)
                .bind(&candidate.title)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
    }

    if inspected.rewritten {
        CronStore::new(path)
            .save(&inspected.active)
            .map_err(|err| {
                AppError::Internal(format!("cron security migration write failed: {err}"))
            })?;
    }

    if report.quarantined > 0 {
        tracing::warn!(
            quarantined = report.quarantined,
            active_jobs = report.active_jobs,
            "legacy cron definitions quarantined before scheduler startup"
        );
    }
    Ok(report)
}

pub async fn list_quarantined_jobs(state: &AppState) -> AppResult<QuarantinedCronJobsResponse> {
    let rows = sqlx::query_as::<_, QuarantinedSummaryRow>(
        r#"SELECT q.id, q.legacy_job_id, q.title, q.was_enabled,
                  q.quarantine_reason, q.quarantined_at,
                  COUNT(r.id) FILTER (
                      WHERE r.status <> 'blocked_security_review'
                  )::bigint AS prior_result_count,
                  MAX(r.created_at) FILTER (
                      WHERE r.status <> 'blocked_security_review'
                  ) AS last_result_at
           FROM quarantined_cron_jobs q
           LEFT JOIN cron_results r ON r.job_id = q.legacy_job_id
           GROUP BY q.id
           ORDER BY q.quarantined_at DESC"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(QuarantinedCronJobsResponse {
        jobs: rows.into_iter().map(summary_from_row).collect(),
    })
}

pub async fn get_quarantined_job(
    state: &AppState,
    id: Uuid,
) -> AppResult<QuarantinedCronJobDetailResponse> {
    let row = fetch_detail(state, id).await?;
    Ok(detail_from_row(row))
}

pub async fn export_quarantined_job(
    state: &AppState,
    id: Uuid,
) -> AppResult<QuarantinedCronJobDetailResponse> {
    get_quarantined_job(state, id).await
}

pub async fn delete_quarantined_job(
    state: &AppState,
    id: Uuid,
) -> AppResult<QuarantinedCronJobDeleteResponse> {
    let row = fetch_detail(state, id).await?;
    let result = sqlx::query("DELETE FROM quarantined_cron_jobs WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() != 1 {
        return Err(AppError::NotFound(format!(
            "quarantined cron job {id} not found"
        )));
    }
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "quarantined_cron_job",
        Some(&id.to_string()),
        Some(serde_json::json!({
            "before": {
                "legacyJobId": row.legacy_job_id,
                "title": row.title,
            }
        })),
    )
    .await;
    Ok(QuarantinedCronJobDeleteResponse { success: true })
}

async fn fetch_detail(state: &AppState, id: Uuid) -> AppResult<QuarantinedDetailRow> {
    sqlx::query_as::<_, QuarantinedDetailRow>(
        r#"SELECT q.id, q.legacy_job_id, q.title, q.original_definition,
                  q.was_enabled, q.quarantine_reason, q.quarantined_at,
                  COUNT(r.id) FILTER (
                      WHERE r.status <> 'blocked_security_review'
                  )::bigint AS prior_result_count,
                  MAX(r.created_at) FILTER (
                      WHERE r.status <> 'blocked_security_review'
                  ) AS last_result_at
           FROM quarantined_cron_jobs q
           LEFT JOIN cron_results r ON r.job_id = q.legacy_job_id
           WHERE q.id = $1
           GROUP BY q.id"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("quarantined cron job {id} not found")))
}

fn inspect_jobs_file(raw: &str) -> InspectedJobs {
    let value = match serde_json::from_str::<Value>(raw) {
        Ok(value) => value,
        Err(_) => {
            return InspectedJobs {
                quarantine: vec![candidate_for_invalid_file(raw)],
                rewritten: true,
                ..InspectedJobs::default()
            };
        }
    };
    let Some(items) = value.as_array() else {
        return InspectedJobs {
            quarantine: vec![candidate_for_value(
                &value,
                "invalid_top_level",
                "Invalid legacy cron data",
                "top-level",
            )],
            rewritten: true,
            ..InspectedJobs::default()
        };
    };

    let mut inspected = InspectedJobs::default();
    for (index, item) in items.iter().enumerate() {
        let source_key = format!("job-{index}");
        let Some(mut object) = item.as_object().cloned() else {
            inspected.quarantine.push(candidate_for_value(
                item,
                "invalid_definition",
                "Invalid legacy cron job",
                &source_key,
            ));
            inspected.rewritten = true;
            continue;
        };

        let mode = object.remove("mode");
        if mode.is_some() {
            inspected.rewritten = true;
        }
        match mode.as_ref() {
            Some(Value::String(mode)) if mode == "no_agent" => {
                inspected.quarantine.push(candidate_for_value(
                    item,
                    "legacy_no_agent",
                    "Quarantined no-agent cron job",
                    &source_key,
                ));
                inspected.rewritten = true;
            }
            Some(Value::String(mode)) if mode == "agent" => {
                match serde_json::from_value::<CronJob>(Value::Object(object)) {
                    Ok(job) => inspected.active.push(job),
                    Err(_) => {
                        inspected.quarantine.push(candidate_for_value(
                            item,
                            "invalid_definition",
                            "Invalid legacy cron job",
                            &source_key,
                        ));
                        inspected.rewritten = true;
                    }
                }
            }
            None => match serde_json::from_value::<CronJob>(Value::Object(object)) {
                Ok(job) => inspected.active.push(job),
                Err(_) => {
                    inspected.quarantine.push(candidate_for_value(
                        item,
                        "invalid_definition",
                        "Invalid legacy cron job",
                        &source_key,
                    ));
                    inspected.rewritten = true;
                }
            },
            Some(_) => {
                inspected.quarantine.push(candidate_for_value(
                    item,
                    "unsupported_mode",
                    "Unsupported legacy cron job",
                    &source_key,
                ));
                inspected.rewritten = true;
            }
        }
    }
    inspected
}

fn candidate_for_invalid_file(raw: &str) -> QuarantineCandidate {
    let original = Value::String(raw.to_string());
    QuarantineCandidate {
        legacy_job_id: derived_legacy_id(&original),
        definition_fingerprint: definition_fingerprint(&original, "invalid-json"),
        title: "Invalid legacy cron data".to_string(),
        original_definition: original,
        was_enabled: false,
        reason: "invalid_json".to_string(),
    }
}

fn candidate_for_value(
    value: &Value,
    reason: &str,
    fallback_title: &str,
    source_key: &str,
) -> QuarantineCandidate {
    let legacy_job_id = value
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| derived_legacy_id(value));
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(redact_sensitive_text)
        .unwrap_or_else(|| fallback_title.to_string());
    let was_enabled = value
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    QuarantineCandidate {
        legacy_job_id,
        definition_fingerprint: definition_fingerprint(value, source_key),
        title,
        original_definition: value.clone(),
        was_enabled,
        reason: reason.to_string(),
    }
}

fn definition_fingerprint(value: &Value, source_key: &str) -> String {
    let bytes = serde_json::to_vec(&(source_key, value)).unwrap_or_default();
    hex::encode(Sha256::digest(bytes))
}

fn derived_legacy_id(value: &Value) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let digest = Sha256::digest(bytes);
    format!("quarantine-{}", hex::encode(&digest[..12]))
}

fn summary_from_row(row: QuarantinedSummaryRow) -> QuarantinedCronJobSummary {
    QuarantinedCronJobSummary {
        id: row.id.to_string(),
        legacy_job_id: row.legacy_job_id,
        title: row.title,
        was_enabled: row.was_enabled,
        quarantine_reason: row.quarantine_reason,
        quarantined_at: row.quarantined_at.to_rfc3339(),
        prior_result_count: row.prior_result_count,
        last_result_at: row.last_result_at.map(|value| value.to_rfc3339()),
    }
}

fn detail_from_row(row: QuarantinedDetailRow) -> QuarantinedCronJobDetailResponse {
    let job = QuarantinedCronJobSummary {
        id: row.id.to_string(),
        legacy_job_id: row.legacy_job_id,
        title: row.title,
        was_enabled: row.was_enabled,
        quarantine_reason: row.quarantine_reason,
        quarantined_at: row.quarantined_at.to_rfc3339(),
        prior_result_count: row.prior_result_count,
        last_result_at: row.last_result_at.map(|value| value.to_rfc3339()),
    };
    QuarantinedCronJobDetailResponse {
        job,
        original_definition: row.original_definition,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    fn valid_job(id: &str, mode: Option<&str>) -> Value {
        let mut value = serde_json::json!({
            "id": id,
            "title": "Job",
            "prompt": "Do work",
            "schedule": {"kind": "interval", "seconds": 60},
            "enabled": true,
            "next_run_at": "2026-07-10T00:00:00Z",
            "run_count": 0,
            "max_runs": null,
            "skills": [],
            "context_from": null,
            "wake_agent": true
        });
        if let Some(mode) = mode {
            value["mode"] = Value::String(mode.to_string());
        }
        value
    }

    #[test]
    fn mixed_legacy_jobs_preserve_only_agent_jobs() {
        let raw = serde_json::to_string(&vec![
            valid_job("agent-job", Some("agent")),
            valid_job("shell-job", Some("no_agent")),
        ])
        .unwrap();

        let inspected = inspect_jobs_file(&raw);

        assert_eq!(inspected.active.len(), 1);
        assert_eq!(inspected.active[0].id, "agent-job");
        assert_eq!(inspected.quarantine.len(), 1);
        assert_eq!(inspected.quarantine[0].legacy_job_id, "shell-job");
        assert!(inspected.rewritten);
    }

    #[test]
    fn invalid_legacy_records_are_quarantined_without_exposing_prompt() {
        let raw = serde_json::json!([{
            "id": "broken",
            "title": "Broken",
            "prompt": "sensitive command",
            "mode": "unknown",
            "enabled": true
        }])
        .to_string();

        let inspected = inspect_jobs_file(&raw);

        assert!(inspected.active.is_empty());
        assert_eq!(inspected.quarantine.len(), 1);
        assert_eq!(inspected.quarantine[0].reason, "unsupported_mode");
        assert_eq!(inspected.quarantine[0].title, "Broken");
    }

    #[test]
    fn invalid_mode_types_and_duplicate_ids_are_quarantined_independently() {
        let mut first = valid_job("duplicate", None);
        first["mode"] = Value::Null;
        let mut second = valid_job("duplicate", None);
        second["mode"] = serde_json::json!(42);
        let raw = serde_json::to_string(&vec![first, second]).unwrap();

        let inspected = inspect_jobs_file(&raw);

        assert!(inspected.active.is_empty());
        assert_eq!(inspected.quarantine.len(), 2);
        assert_ne!(
            inspected.quarantine[0].definition_fingerprint,
            inspected.quarantine[1].definition_fingerprint
        );
        assert!(inspected
            .quarantine
            .iter()
            .all(|candidate| candidate.reason == "unsupported_mode"));
    }

    #[test]
    fn current_agent_jobs_do_not_require_a_rewrite() {
        let raw = serde_json::to_string(&vec![valid_job("agent-job", None)]).unwrap();

        let inspected = inspect_jobs_file(&raw);

        assert_eq!(inspected.active.len(), 1);
        assert!(inspected.quarantine.is_empty());
        assert!(!inspected.rewritten);
    }

    #[test]
    fn invalid_json_is_quarantined_and_replaced_by_an_empty_active_store() {
        let inspected = inspect_jobs_file("not-json");

        assert!(inspected.active.is_empty());
        assert_eq!(inspected.quarantine.len(), 1);
        assert_eq!(inspected.quarantine[0].reason, "invalid_json");
        assert!(inspected.rewritten);
    }

    #[test]
    fn migration_is_idempotent_after_the_active_store_is_rewritten() {
        let original = serde_json::to_string(&vec![valid_job("agent-job", Some("agent"))]).unwrap();
        let first = inspect_jobs_file(&original);
        let rewritten = serde_json::to_string(&first.active).unwrap();

        let second = inspect_jobs_file(&rewritten);

        assert_eq!(second.active.len(), 1);
        assert!(second.quarantine.is_empty());
        assert!(!second.rewritten);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn quarantine_migration_preserves_agent_jobs_and_inventories_results(pool: sqlx::PgPool) {
        let dir = std::env::temp_dir().join(format!("mymy-cron-security-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("cron")).unwrap();
        let raw = serde_json::to_string(&vec![
            valid_job("agent-job", Some("agent")),
            valid_job("shell-job", Some("no_agent")),
        ])
        .unwrap();
        std::fs::write(dir.join("cron/jobs.json"), raw).unwrap();
        sqlx::query(
            r#"INSERT INTO cron_results
               (job_id, job_title, mode, status, output)
               VALUES ('shell-job', 'Legacy', 'no_agent', 'success', '')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let state = AppState::new(pool, test_config(dir.clone()));

        let report = quarantine_legacy_jobs(&state).await.unwrap();

        assert_eq!(report.quarantined, 1);
        assert_eq!(report.active_jobs, 1);
        assert!(report.rewritten);
        let active = CronStore::new(dir.join("cron/jobs.json")).load().unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "agent-job");
        let quarantined = list_quarantined_jobs(&state).await.unwrap();
        assert_eq!(quarantined.jobs.len(), 1);
        assert_eq!(quarantined.jobs[0].legacy_job_id, "shell-job");
        assert!(quarantined.jobs[0].was_enabled);
        assert_eq!(quarantined.jobs[0].prior_result_count, 1);
        let quarantined_id = Uuid::parse_str(&quarantined.jobs[0].id).unwrap();
        let detail = get_quarantined_job(&state, quarantined_id).await.unwrap();
        assert_eq!(detail.original_definition["id"], "shell-job");
        let exported = export_quarantined_job(&state, quarantined_id)
            .await
            .unwrap();
        assert_eq!(exported.original_definition, detail.original_definition);
        let blocked = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM cron_results
               WHERE job_id = 'shell-job' AND status = 'blocked_security_review'"#,
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(blocked, 1);

        let second = quarantine_legacy_jobs(&state).await.unwrap();
        assert_eq!(second.quarantined, 0);
        assert!(!second.rewritten);
        assert_eq!(list_quarantined_jobs(&state).await.unwrap().jobs.len(), 1);

        let deleted = delete_quarantined_job(&state, quarantined_id)
            .await
            .unwrap();
        assert!(deleted.success);
        assert!(list_quarantined_jobs(&state).await.unwrap().jobs.is_empty());
        let retained_results = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM cron_results WHERE job_id = 'shell-job'",
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(retained_results, 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    fn test_config(agent_data_dir: std::path::PathBuf) -> Config {
        Config {
            database_url: String::new(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir,
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
}
