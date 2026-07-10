//! Native cron service.
//!
//! Cron jobs live in the file-backed agent store so the agent tool and HTTP API
//! share one source of truth. Execution results are stored in PostgreSQL because
//! they are user-visible application records that need filtering and retention
//! independent of the mutable job file.

use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::Utc;
use uuid::Uuid;

use crate::agent::scheduler::{jobs_path, parse_schedule, CronJob, CronStore, Schedule};
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

mod blueprints;
mod execution;
mod prompts;
mod results;
mod runtime;
mod security;
mod types;
mod validation;

pub use blueprints::{builtin_blueprints, instantiate_blueprint_prompt};
pub use results::list_results;
pub use security::{
    delete_quarantined_job, export_quarantined_job, get_quarantined_job, list_quarantined_jobs,
    quarantine_legacy_jobs,
};
pub use types::{
    CreateCronJobRequest, CronBlueprintsResponse, CronJobsResponse, CronResultsQuery,
    CronResultsResponse, CronStatusResponse, InstantiateBlueprintRequest,
    QuarantinedCronJobDeleteResponse, QuarantinedCronJobDetailResponse,
    QuarantinedCronJobsResponse, UpdateCronJobRequest,
};

use execution::execute_job;
use results::{insert_result, write_output};
use runtime::{read_heartbeat, record_heartbeat, TickLock};
use validation::{
    ensure_cron_prompt_safe, normalize_context_refs, normalize_names, validate_context_refs,
    validate_skill_names,
};

pub fn start_cron_ticker(state: Arc<AppState>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(StdDuration::from_secs(state.config.cron_tick_interval_secs));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        record_heartbeat(&state, false);
        loop {
            interval.tick().await;
            record_heartbeat(&state, true);
            if let Err(err) = tick_due_jobs(&state).await {
                tracing::error!(error = %err, "native cron tick failed");
            }
            record_heartbeat(&state, false);
        }
    })
}

pub async fn list_jobs(state: &AppState) -> AppResult<CronJobsResponse> {
    Ok(CronJobsResponse {
        jobs: store(state).load().map_err(store_error)?,
    })
}

pub async fn list_blueprints() -> AppResult<CronBlueprintsResponse> {
    Ok(CronBlueprintsResponse {
        blueprints: builtin_blueprints(),
    })
}

pub async fn instantiate_blueprint(
    state: &AppState,
    key: &str,
    req: InstantiateBlueprintRequest,
) -> AppResult<CronJobsResponse> {
    let blueprint = builtin_blueprints()
        .into_iter()
        .find(|blueprint| blueprint.key == key)
        .ok_or_else(|| AppError::NotFound(format!("cron blueprint {key} not found")))?;
    let prompt = instantiate_blueprint_prompt(blueprint.prompt_template, &req.values);
    create_job(
        state,
        CreateCronJobRequest {
            title: req
                .title
                .unwrap_or_else(|| blueprint.title.to_string())
                .trim()
                .to_string(),
            prompt,
            schedule: req
                .schedule
                .unwrap_or_else(|| blueprint.default_schedule.to_string()),
            max_runs: None,
            enabled: req.enabled.unwrap_or(true),
            skills: blueprint
                .suggested_skills
                .iter()
                .map(|skill| (*skill).to_string())
                .collect(),
            context_from: None,
            wake_agent: true,
        },
    )
    .await
}

pub async fn create_job(
    state: &AppState,
    req: CreateCronJobRequest,
) -> AppResult<CronJobsResponse> {
    let now = Utc::now();
    ensure_cron_prompt_safe(&req.prompt)?;
    let schedule = parse_schedule(&req.schedule, now)
        .ok_or_else(|| AppError::BadRequest("invalid schedule".to_string()))?;
    validate_context_refs(req.context_from.as_deref())?;
    validate_skill_names(&req.skills)?;
    let max_runs = req
        .max_runs
        .or_else(|| matches!(schedule, Schedule::Once { .. }).then_some(1));
    let next_run_at = crate::agent::scheduler::compute_next_run_in_timezone(
        &schedule,
        now,
        &state.config.cron_timezone,
    );
    let job = CronJob {
        id: Uuid::new_v4().to_string(),
        title: req.title.trim().to_string(),
        prompt: req.prompt.trim().to_string(),
        schedule,
        enabled: req.enabled,
        next_run_at,
        run_count: 0,
        max_runs,
        skills: normalize_names(req.skills),
        context_from: normalize_context_refs(req.context_from),
        wake_agent: req.wake_agent,
    };
    if job.title.is_empty() || job.prompt.is_empty() {
        return Err(AppError::BadRequest(
            "title and prompt cannot be empty".to_string(),
        ));
    }
    let id = job.id.clone();
    let title = job.title.clone();
    store(state).upsert(job).map_err(store_error)?;
    audit_user_cron_change(state, "create", &id, "create", &title).await;
    list_jobs(state).await
}

pub async fn update_job(
    state: &AppState,
    id: &str,
    req: UpdateCronJobRequest,
) -> AppResult<CronJobsResponse> {
    let cron_store = store(state);
    let mut jobs = cron_store.load().map_err(store_error)?;
    let Some(job) = jobs.iter_mut().find(|job| job.id == id) else {
        return Err(AppError::NotFound(format!("cron job {id} not found")));
    };
    if let Some(title) = req.title {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::BadRequest("title cannot be empty".to_string()));
        }
        job.title = title.to_string();
    }
    if let Some(prompt) = req.prompt {
        ensure_cron_prompt_safe(&prompt)?;
        let prompt = prompt.trim();
        if prompt.is_empty() {
            return Err(AppError::BadRequest("prompt cannot be empty".to_string()));
        }
        job.prompt = prompt.to_string();
    }
    if let Some(schedule_text) = req.schedule {
        let schedule = parse_schedule(&schedule_text, Utc::now())
            .ok_or_else(|| AppError::BadRequest("invalid schedule".to_string()))?;
        job.next_run_at = crate::agent::scheduler::compute_next_run_in_timezone(
            &schedule,
            Utc::now(),
            &state.config.cron_timezone,
        );
        job.schedule = schedule;
    }
    if let Some(max_runs) = req.max_runs {
        job.max_runs = max_runs;
    }
    if let Some(enabled) = req.enabled {
        job.enabled = enabled;
    }
    if let Some(skills) = req.skills {
        validate_skill_names(&skills)?;
        job.skills = normalize_names(skills);
    }
    if let Some(context_from) = req.context_from {
        validate_context_refs(context_from.as_deref())?;
        job.context_from = normalize_context_refs(context_from);
    }
    if let Some(wake_agent) = req.wake_agent {
        job.wake_agent = wake_agent;
    }
    let title = job.title.clone();
    cron_store.save(&jobs).map_err(store_error)?;
    audit_user_cron_change(state, "update", id, "update", &title).await;
    Ok(CronJobsResponse { jobs })
}

pub async fn pause_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    mutate_job(state, id, "pause", |job| job.enabled = false).await
}

pub async fn resume_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    mutate_job(state, id, "resume", |job| job.enabled = true).await
}

pub async fn trigger_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    let now = Utc::now();
    mutate_job(state, id, "trigger", |job| {
        job.enabled = true;
        job.next_run_at = now;
    })
    .await
}

pub async fn delete_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    let cron_store = store(state);
    let mut jobs = cron_store.load().map_err(store_error)?;
    let Some(position) = jobs.iter().position(|job| job.id == id) else {
        return Err(AppError::NotFound(format!("cron job {id} not found")));
    };
    let removed = jobs.remove(position);
    cron_store.save(&jobs).map_err(store_error)?;
    audit_user_cron_change(state, "delete", id, "delete", &removed.title).await;
    Ok(CronJobsResponse { jobs })
}

pub async fn status(state: &AppState) -> AppResult<CronStatusResponse> {
    let jobs = store(state).load().map_err(store_error)?;
    let heartbeat = read_heartbeat(state);
    let mut active = jobs
        .iter()
        .filter(|job| job.enabled)
        .filter(|job| job.max_runs.is_none_or(|max| job.run_count < max))
        .collect::<Vec<_>>();
    active.sort_by_key(|job| job.next_run_at);
    Ok(CronStatusResponse {
        scheduler_running: true,
        active_jobs: active.len(),
        next_run_at: active.first().map(|job| job.next_run_at.to_rfc3339()),
        ticker_alive: heartbeat.as_ref().is_some_and(|value| value.alive),
        ticker_firing: heartbeat.as_ref().is_some_and(|value| value.firing),
        heartbeat_age_secs: heartbeat.map(|value| value.age_secs),
        timezone: state.config.cron_timezone.clone(),
    })
}

pub async fn tick_due_jobs(state: &AppState) -> AppResult<usize> {
    let Some(_lock) = TickLock::try_acquire(state)? else {
        return Ok(0);
    };
    let cron_store = store(state);
    let now = Utc::now();
    let due = cron_store.due_jobs(now).map_err(store_error)?;
    let mut executed = 0_usize;
    for job in due {
        cron_store
            .mark_run_with_timezone(&job.id, now, &state.config.cron_timezone)
            .map_err(store_error)?;
        let execution = execute_job(state, &job).await;
        let (status, output) = match execution {
            Ok(output) if output.trim() == "[SILENT]" => ("silent".to_string(), output),
            Ok(output) if output.trim().is_empty() && !job.wake_agent => {
                ("silent".to_string(), output)
            }
            Ok(output) if output.trim().is_empty() => {
                ("error".to_string(), "job produced no output".to_string())
            }
            Ok(output) => ("success".to_string(), output),
            Err(err) => ("error".to_string(), err.to_string()),
        };
        let output_path = write_output(state, &job, &status, &output)?;
        insert_result(state, &job, &status, &output, output_path).await?;
        executed += 1;
    }
    Ok(executed)
}

async fn mutate_job<F>(
    state: &AppState,
    id: &str,
    operation: &str,
    mutate: F,
) -> AppResult<CronJobsResponse>
where
    F: FnOnce(&mut CronJob),
{
    let cron_store = store(state);
    let mut jobs = cron_store.load().map_err(store_error)?;
    let Some(job) = jobs.iter_mut().find(|job| job.id == id) else {
        return Err(AppError::NotFound(format!("cron job {id} not found")));
    };
    mutate(job);
    let title = job.title.clone();
    cron_store.save(&jobs).map_err(store_error)?;
    audit_user_cron_change(state, "update", id, operation, &title).await;
    Ok(CronJobsResponse { jobs })
}

async fn audit_user_cron_change(
    state: &AppState,
    action: &str,
    id: &str,
    operation: &str,
    title: &str,
) {
    log_audit_safe(
        &state.db,
        "user",
        "user",
        action,
        "cron_job",
        Some(id),
        Some(serde_json::json!({
            "operation": operation,
            "title": redact_sensitive_text(title),
        })),
    )
    .await;
}

fn store(state: &AppState) -> CronStore {
    CronStore::new(jobs_path(&state.config.agent_data_dir))
}

fn store_error(err: std::io::Error) -> AppError {
    AppError::Internal(format!("cron store failed: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    #[sqlx::test(migrations = "./migrations")]
    async fn user_created_jobs_are_agent_only_and_audited(pool: sqlx::PgPool) {
        let dir =
            std::env::temp_dir().join(format!("mymy-user-cron-audit-{}", uuid::Uuid::new_v4()));
        let state = AppState::new(pool.clone(), test_config(dir.clone()));

        create_job(
            &state,
            CreateCronJobRequest {
                title: "User job".to_string(),
                prompt: "Review tasks".to_string(),
                schedule: "every 1h".to_string(),
                max_runs: None,
                enabled: true,
                skills: Vec::new(),
                context_from: None,
                wake_agent: true,
            },
        )
        .await
        .unwrap();

        let raw = std::fs::read_to_string(dir.join("cron/jobs.json")).unwrap();
        assert!(!raw.contains("\"mode\""));
        let actor = sqlx::query_scalar::<_, String>(
            r#"SELECT actor_id FROM audit_logs
               WHERE entity_type = 'cron_job' AND action = 'create'"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(actor, "user");
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
