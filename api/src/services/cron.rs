//! Durable native cron service.
//!
//! PostgreSQL owns mutable job definitions, occurrence uniqueness, and AgentRun
//! hand-off. The legacy jobs file is read exactly once as an import source; it
//! is never used as the live scheduler lock or write target.

use std::sync::Arc;
use std::time::Duration as StdDuration;

use crate::error::AppResult;
use crate::state::AppState;

mod blueprints;
mod durable;
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

pub fn start_cron_ticker(state: Arc<AppState>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(err) = durable::import_file_jobs_once(&state).await {
            tracing::error!(error = %err, "legacy cron import failed");
        }
        let mut interval =
            tokio::time::interval(StdDuration::from_secs(state.config.cron_tick_interval_secs));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        runtime::record_heartbeat(&state, false);
        loop {
            interval.tick().await;
            runtime::record_heartbeat(&state, true);
            if let Err(err) = tick_due_jobs(&state).await {
                tracing::error!(error = %err, "native cron tick failed");
            }
            runtime::record_heartbeat(&state, false);
        }
    })
}

pub async fn list_jobs(state: &AppState) -> AppResult<CronJobsResponse> {
    durable::list_jobs(state).await
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
        .ok_or_else(|| {
            crate::error::AppError::NotFound(format!("cron blueprint {key} not found"))
        })?;
    durable::create_job(
        state,
        CreateCronJobRequest {
            title: req.title.unwrap_or_else(|| blueprint.title.to_string()),
            prompt: instantiate_blueprint_prompt(blueprint.prompt_template, &req.values),
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
            agent_profile: req.agent_profile,
            project_id: req.project_id,
            session_policy: "reuse".to_string(),
            catch_up_policy: "latest".to_string(),
            retry_policy: "safe".to_string(),
            max_tool_calls: crate::agent::scheduler::default_max_tool_calls(),
            max_runtime_seconds: crate::agent::scheduler::default_max_runtime_seconds(),
            max_total_tokens: crate::agent::scheduler::default_max_total_tokens(),
        },
    )
    .await
}

pub async fn create_job(
    state: &AppState,
    req: CreateCronJobRequest,
) -> AppResult<CronJobsResponse> {
    durable::create_job(state, req).await
}

pub async fn update_job(
    state: &AppState,
    id: &str,
    req: UpdateCronJobRequest,
) -> AppResult<CronJobsResponse> {
    durable::update_job(state, id, req).await
}

pub async fn pause_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    durable::set_enabled(state, id, false, "pause").await
}

pub async fn resume_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    durable::set_enabled(state, id, true, "resume").await
}

pub async fn trigger_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    durable::trigger_job(state, id).await
}

pub async fn delete_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    durable::delete_job(state, id).await
}

pub async fn status(state: &AppState) -> AppResult<CronStatusResponse> {
    durable::status(state).await
}

pub async fn tick_due_jobs(state: &AppState) -> AppResult<usize> {
    durable::tick_due_jobs(state).await
}

pub async fn mark_occurrence_waiting(state: &AppState, run_id: uuid::Uuid) -> AppResult<()> {
    durable::mark_occurrence_waiting(state, run_id).await
}

pub async fn finalize_occurrence(
    state: &AppState,
    run_id: uuid::Uuid,
    status: &str,
) -> AppResult<()> {
    durable::finalize_occurrence(state, run_id, status).await
}
