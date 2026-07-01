//! Native cron service.
//!
//! Cron jobs live in the file-backed agent store so the agent tool and HTTP API
//! share one source of truth. Execution results are stored in PostgreSQL because
//! they are user-visible application records that need filtering and retention
//! independent of the mutable job file.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Utc};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use tokio::process::Command;
use uuid::Uuid;

use crate::agent::loop_engine::AgentEvent;
use crate::agent::scheduler::{jobs_path, parse_schedule, CronJob, CronStore, JobMode, Schedule};
use crate::agent::security::{
    detect_dangerous_command, redact_terminal_output, scan_for_threats, ThreatScope,
};
use crate::agent::skills::{SkillRegistry, SkillUsageEvent};
use crate::error::{AppError, AppResult};
use crate::models::chat::{CreateSessionRequest, SendMessageRequest};
use crate::services::chat as chat_service;
use crate::state::AppState;

const NO_AGENT_TIMEOUT_SECS: u64 = 300;
const MAX_RESULT_CHARS: usize = 50_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobsResponse {
    pub jobs: Vec<CronJob>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronStatusResponse {
    pub scheduler_running: bool,
    pub active_jobs: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    pub ticker_alive: bool,
    pub ticker_firing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_age_secs: Option<i64>,
    pub timezone: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronResultsResponse {
    pub results: Vec<CronResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronBlueprint {
    pub key: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub default_schedule: &'static str,
    pub form_schema: Value,
    pub prompt_template: &'static str,
    pub suggested_skills: Vec<&'static str>,
    pub deliver: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronBlueprintsResponse {
    pub blueprints: Vec<CronBlueprint>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstantiateBlueprintRequest {
    #[serde(default)]
    pub values: Value,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronResult {
    pub id: String,
    pub job_id: String,
    pub job_title: String,
    pub mode: String,
    pub status: String,
    pub output: String,
    pub output_path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCronJobRequest {
    pub title: String,
    pub prompt: String,
    pub schedule: String,
    #[serde(default)]
    pub mode: Option<JobMode>,
    #[serde(default)]
    pub max_runs: Option<u32>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub context_from: Option<Vec<String>>,
    #[serde(default = "default_wake_agent")]
    pub wake_agent: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCronJobRequest {
    pub title: Option<String>,
    pub prompt: Option<String>,
    pub schedule: Option<String>,
    pub mode: Option<JobMode>,
    pub max_runs: Option<Option<u32>>,
    pub enabled: Option<bool>,
    pub skills: Option<Vec<String>>,
    pub context_from: Option<Option<Vec<String>>>,
    pub wake_agent: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CronResultsQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
}

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
            mode: Some(JobMode::Agent),
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

pub fn builtin_blueprints() -> Vec<CronBlueprint> {
    vec![
        blueprint(
            "morning_briefing",
            "Morning Briefing",
            "Daily summary of calendar, tasks, and selected topics.",
            "productivity",
            "0 8 * * *",
            vec![
                field_bool("include_calendar", true),
                field_bool("include_tasks", true),
                field_text("focus_topics", false),
            ],
            "Prepare a concise morning briefing. Include calendar: {{include_calendar}}. Include tasks: {{include_tasks}}. Focus topics: {{focus_topics}}.",
        ),
        blueprint(
            "daily_wrapup",
            "Daily Wrap-up",
            "End-of-day summary and next-day priorities.",
            "productivity",
            "0 18 * * *",
            vec![field_text("project_scope", false)],
            "Summarize today's progress, unresolved work, and suggested priorities for tomorrow. Project scope: {{project_scope}}.",
        ),
        blueprint(
            "weekly_review",
            "Weekly Review",
            "Weekly progress review across projects and goals.",
            "planning",
            "0 9 * * 1",
            vec![field_text("review_scope", false)],
            "Prepare a weekly review. Cover completed work, blocked work, goal progress, and next-week risks. Scope: {{review_scope}}.",
        ),
        blueprint(
            "project_healthcheck",
            "Project Healthcheck",
            "Recurring risk and status scan for active projects.",
            "planning",
            "0 17 * * 5",
            vec![field_text("project_filter", false)],
            "Review active projects for stale tasks, schedule risk, missing decisions, and next actions. Project filter: {{project_filter}}.",
        ),
        {
            let mut item = blueprint(
                "news_digest",
                "News Digest",
                "Digest recent news for chosen topics.",
                "research",
                "0 7 * * *",
                vec![field_text("topics", true), field_bool("include_sources", true)],
                "Create a news digest for topics: {{topics}}. Include sources: {{include_sources}}. Summarize only material found through available tools.",
            );
            item.suggested_skills = vec!["news-digest"];
            item
        },
        blueprint(
            "reading_digest",
            "Reading Digest",
            "Summarize saved reading or knowledge updates.",
            "research",
            "0 16 * * 5",
            vec![field_text("collection", false)],
            "Prepare a reading digest from available knowledge or saved material. Collection or topic: {{collection}}.",
        ),
        blueprint(
            "inbox_triage",
            "Inbox Triage",
            "Recurring triage plan for unread or pending communications.",
            "operations",
            "0 10 * * *",
            vec![field_text("channels", false)],
            "Triage pending communications for these channels: {{channels}}. Return urgent items, follow-ups, and low-priority backlog.",
        ),
        blueprint(
            "finance_summary",
            "Finance Summary",
            "Weekly finance and expense review.",
            "finance",
            "0 20 * * 0",
            vec![field_text("scope", false)],
            "Prepare a finance summary for scope: {{scope}}. Highlight unusual spending, pending payments, and next actions.",
        ),
        blueprint(
            "meal_planning",
            "Meal Planning",
            "Plan meals and shopping actions for the week.",
            "personal",
            "0 9 * * 6",
            vec![field_text("diet_notes", false), field_text("budget", false)],
            "Create a weekly meal plan. Diet notes: {{diet_notes}}. Budget: {{budget}}. Include a compact shopping list.",
        ),
        blueprint(
            "gratitude_journal",
            "Gratitude Journal",
            "Prompt a short recurring reflection.",
            "personal",
            "30 21 * * *",
            vec![field_text("reflection_prompt", false)],
            "Write a short gratitude journal prompt and summarize any recurring themes if prior context is available. Prompt: {{reflection_prompt}}.",
        ),
        blueprint(
            "habit_checkin",
            "Habit Check-in",
            "Recurring check-in for tracked habits.",
            "personal",
            "0 20 * * *",
            vec![field_text("habits", true)],
            "Check in on these habits: {{habits}}. Return status, friction, and one small adjustment.",
        ),
        blueprint(
            "learning_plan",
            "Learning Plan",
            "Weekly learning review and next study plan.",
            "learning",
            "0 19 * * 0",
            vec![field_text("subject", true), field_text("time_budget", false)],
            "Create a learning plan for subject: {{subject}}. Time budget: {{time_budget}}. Include review, practice, and next resources.",
        ),
        blueprint(
            "backup_reminder",
            "Backup Reminder",
            "Periodic reminder to verify backups and recovery readiness.",
            "operations",
            "0 12 1 * *",
            vec![field_text("systems", false)],
            "Prepare a backup verification checklist for systems: {{systems}}. Include last-known risks and concrete checks.",
        ),
    ]
}

fn blueprint(
    key: &'static str,
    title: &'static str,
    description: &'static str,
    category: &'static str,
    default_schedule: &'static str,
    fields: Vec<Value>,
    prompt_template: &'static str,
) -> CronBlueprint {
    CronBlueprint {
        key,
        title,
        description,
        category,
        default_schedule,
        form_schema: serde_json::json!({ "fields": fields }),
        prompt_template,
        suggested_skills: Vec::new(),
        deliver: "local",
    }
}

fn field_bool(name: &'static str, default: bool) -> Value {
    serde_json::json!({
        "name": name,
        "type": "boolean",
        "default": default
    })
}

fn field_text(name: &'static str, required: bool) -> Value {
    serde_json::json!({
        "name": name,
        "type": "string",
        "required": required
    })
}

pub fn instantiate_blueprint_prompt(template: &str, values: &Value) -> String {
    let mut prompt = template.to_string();
    if let Some(object) = values.as_object() {
        for (key, value) in object {
            let replacement = match value {
                Value::String(value) => value.clone(),
                Value::Bool(value) => value.to_string(),
                Value::Number(value) => value.to_string(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            prompt = prompt.replace(&format!("{{{{{key}}}}}"), &replacement);
        }
    }
    let placeholder =
        regex::Regex::new(r"\{\{[a-zA-Z0-9_]+\}\}").expect("blueprint placeholder regex compiles");
    placeholder.replace_all(&prompt, "").trim().to_string()
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
        mode: req.mode.unwrap_or(JobMode::Agent),
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
    store(state).upsert(job).map_err(store_error)?;
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
    if let Some(mode) = req.mode {
        job.mode = mode;
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
    cron_store.save(&jobs).map_err(store_error)?;
    Ok(CronJobsResponse { jobs })
}

pub async fn pause_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    mutate_job(state, id, |job| job.enabled = false).await
}

pub async fn resume_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    mutate_job(state, id, |job| job.enabled = true).await
}

pub async fn trigger_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    let now = Utc::now();
    mutate_job(state, id, |job| {
        job.enabled = true;
        job.next_run_at = now;
    })
    .await
}

pub async fn delete_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    let cron_store = store(state);
    let mut jobs = cron_store.load().map_err(store_error)?;
    let before = jobs.len();
    jobs.retain(|job| job.id != id);
    if before == jobs.len() {
        return Err(AppError::NotFound(format!("cron job {id} not found")));
    }
    cron_store.save(&jobs).map_err(store_error)?;
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

async fn mutate_job<F>(state: &AppState, id: &str, mutate: F) -> AppResult<CronJobsResponse>
where
    F: FnOnce(&mut CronJob),
{
    let cron_store = store(state);
    let mut jobs = cron_store.load().map_err(store_error)?;
    let Some(job) = jobs.iter_mut().find(|job| job.id == id) else {
        return Err(AppError::NotFound(format!("cron job {id} not found")));
    };
    mutate(job);
    cron_store.save(&jobs).map_err(store_error)?;
    Ok(CronJobsResponse { jobs })
}

async fn execute_job(state: &AppState, job: &CronJob) -> AppResult<String> {
    match job.mode {
        JobMode::Agent => execute_agent_job(state, job).await,
        JobMode::NoAgent => execute_no_agent_job(job).await,
    }
}

async fn execute_agent_job(state: &AppState, job: &CronJob) -> AppResult<String> {
    let session = chat_service::create_session(
        state,
        CreateSessionRequest {
            project_id: None,
            profile: "default".to_string(),
        },
    )
    .await?
    .session;
    let session_id = Uuid::parse_str(&session.id)
        .map_err(|err| AppError::Internal(format!("cron session id parse failed: {err}")))?;
    let mut turn = chat_service::prepare_native_turn(
        state,
        session_id,
        SendMessageRequest {
            text: build_agent_job_prompt(state, job).await?,
            use_moa: false,
            moa_preset_id: None,
        },
    )
    .await?;

    let mut output = String::new();
    if let chat_service::PreparedExecution::Agent(agent_loop) = &mut turn.execution {
        let mut events = agent_loop.run(&turn.system_prompt, &mut turn.messages);
        while let Some(event) = events.next().await {
            match event {
                AgentEvent::TextDelta(content) => output.push_str(&content),
                AgentEvent::Error(message) => {
                    output.push_str("\n[error] ");
                    output.push_str(&message);
                }
                AgentEvent::Done { .. } => break,
                _ => {}
            }
        }
    } else {
        return Err(AppError::Internal(
            "cron job unexpectedly prepared a MoA chat turn".into(),
        ));
    }
    let new_messages = turn.messages[turn.agent_message_start..].to_vec();
    chat_service::save_agent_messages(state, turn.session_id, &new_messages).await?;
    Ok(truncate_chars(&output, MAX_RESULT_CHARS))
}

async fn execute_no_agent_job(job: &CronJob) -> AppResult<String> {
    if let Some(matched) = detect_dangerous_command(&job.prompt) {
        return Err(AppError::BadRequest(format!(
            "cron script blocked: {} ({})",
            matched.description, matched.pattern_key
        )));
    }
    let cwd = std::env::current_dir()
        .map_err(|err| AppError::Internal(format!("failed to resolve current dir: {err}")))?;
    let output = tokio::time::timeout(
        StdDuration::from_secs(NO_AGENT_TIMEOUT_SECS),
        Command::new("bash")
            .arg("-c")
            .arg(&job.prompt)
            .current_dir(cwd)
            .env_clear()
            .envs(scrubbed_env())
            .output(),
    )
    .await
    .map_err(|_| AppError::Internal("cron script timed out".to_string()))?
    .map_err(|err| AppError::Internal(format!("cron script failed to spawn: {err}")))?;

    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str("[stderr]\n");
        text.push_str(&stderr);
    }
    if !output.status.success() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&format!(
            "[exit_code] {}",
            output.status.code().unwrap_or(-1)
        ));
    }
    Ok(truncate_chars(
        &redact_terminal_output(&text),
        MAX_RESULT_CHARS,
    ))
}

async fn insert_result(
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

fn write_output(
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

fn write_file_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp.{}", Uuid::new_v4()));
    fs::write(&tmp, content)?;
    fs::rename(tmp, path)?;
    Ok(())
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

fn store(state: &AppState) -> CronStore {
    CronStore::new(jobs_path(&state.config.agent_data_dir))
}

async fn build_agent_job_prompt(state: &AppState, job: &CronJob) -> AppResult<String> {
    let mut blocks = Vec::new();
    blocks.push(
        "[IMPORTANT: You are running as a scheduled cron job.\nDELIVERY: Your final response will be automatically stored for the user. Do not use send_message. Produce the report as your final response.\nSILENT: If there is genuinely nothing new to report, respond with exactly \"[SILENT]\" and nothing else.]"
            .to_string(),
    );
    blocks.push(format!(
        "[CRON JOB: {}]\n\n{}",
        job.title.trim(),
        job.prompt.trim()
    ));
    if let Some(context) = load_context_from(state, job).await? {
        blocks.push(context);
    }
    let skills = load_skill_blocks(state, job)?;
    if !skills.is_empty() {
        blocks.push(skills);
    }
    let prompt = blocks.join("\n\n");
    ensure_assembled_cron_prompt_safe(&prompt)?;
    Ok(prompt)
}

fn ensure_cron_prompt_safe(prompt: &str) -> AppResult<()> {
    let findings = scan_for_threats(prompt, ThreatScope::Strict);
    if findings.is_empty() {
        return Ok(());
    }
    let ids = findings
        .into_iter()
        .map(|finding| finding.pattern_id)
        .collect::<Vec<_>>()
        .join(", ");
    Err(AppError::BadRequest(format!(
        "cron prompt blocked by security scan: {ids}"
    )))
}

async fn load_context_from(state: &AppState, job: &CronJob) -> AppResult<Option<String>> {
    let Some(refs) = job.context_from.as_ref().filter(|refs| !refs.is_empty()) else {
        return Ok(None);
    };
    validate_context_refs(Some(refs))?;
    let mut blocks = Vec::new();
    for job_id in refs {
        let row = sqlx::query!(
            r#"SELECT output, created_at
               FROM cron_results
               WHERE job_id = $1
               ORDER BY created_at DESC
               LIMIT 1"#,
            job_id,
        )
        .fetch_optional(&state.db)
        .await?;
        if let Some(row) = row {
            blocks.push(format!(
                "Upstream cron job {job_id} at {}:\n{}",
                row.created_at.to_rfc3339(),
                truncate_chars(&row.output, 8_000)
            ));
        }
    }
    if blocks.is_empty() {
        return Ok(None);
    }
    Ok(Some(format!(
        "[Injected context from prior cron results]\n{}",
        blocks.join("\n\n")
    )))
}

fn load_skill_blocks(state: &AppState, job: &CronJob) -> AppResult<String> {
    if job.skills.is_empty() {
        return Ok(String::new());
    }
    validate_skill_names(&job.skills)?;
    let registry = SkillRegistry::new(state.config.agent_data_dir.join("skills"));
    let mut blocks = Vec::new();
    for skill_name in &job.skills {
        let view = registry.view(skill_name, None).map_err(|err| {
            AppError::BadRequest(format!("cron skill {skill_name} cannot be loaded: {err}"))
        })?;
        registry
            .record_usage(skill_name, SkillUsageEvent::Use)
            .map_err(|err| AppError::Internal(format!("cron skill usage update failed: {err}")))?;
        blocks.push(format!(
            "[IMPORTANT: skill \"{}\" invoked by cron job. Content below.]\n\n{}",
            view.name, view.content
        ));
    }
    Ok(blocks.join("\n\n"))
}

fn ensure_assembled_cron_prompt_safe(prompt: &str) -> AppResult<()> {
    let findings = scan_for_threats(prompt, ThreatScope::Context);
    if findings.is_empty() {
        return Ok(());
    }
    let ids = findings
        .into_iter()
        .map(|finding| finding.pattern_id)
        .collect::<Vec<_>>()
        .join(", ");
    Err(AppError::BadRequest(format!(
        "assembled cron prompt blocked by security scan: {ids}"
    )))
}

fn validate_skill_names(skills: &[String]) -> AppResult<()> {
    for skill in skills {
        let skill = skill.trim();
        if skill.is_empty()
            || skill.contains('/')
            || skill.contains('\\')
            || skill.contains("..")
            || skill.chars().count() > 64
        {
            return Err(AppError::BadRequest(format!(
                "invalid skill reference: {skill}"
            )));
        }
    }
    Ok(())
}

fn validate_context_refs(context_from: Option<&[String]>) -> AppResult<()> {
    let Some(refs) = context_from else {
        return Ok(());
    };
    for reference in refs {
        let value = reference.trim();
        if value.is_empty()
            || value.contains('/')
            || value.contains('\\')
            || value.contains("..")
            || value.chars().count() > 128
        {
            return Err(AppError::BadRequest(format!(
                "invalid context_from reference: {value}"
            )));
        }
    }
    Ok(())
}

fn normalize_names(values: Vec<String>) -> Vec<String> {
    let mut names = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

fn normalize_context_refs(values: Option<Vec<String>>) -> Option<Vec<String>> {
    let refs = normalize_names(values.unwrap_or_default());
    (!refs.is_empty()).then_some(refs)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatFile {
    updated_at: String,
    firing: bool,
}

struct HeartbeatSnapshot {
    alive: bool,
    firing: bool,
    age_secs: i64,
}

fn record_heartbeat(state: &AppState, firing: bool) {
    let payload = HeartbeatFile {
        updated_at: Utc::now().to_rfc3339(),
        firing,
    };
    let path = heartbeat_path(state);
    match serde_json::to_string_pretty(&payload) {
        Ok(content) => {
            if let Err(err) = write_file_atomic(&path, &content) {
                tracing::warn!(error = %err, "cron heartbeat write failed");
            }
        }
        Err(err) => tracing::warn!(error = %err, "cron heartbeat serialization failed"),
    }
}

fn read_heartbeat(state: &AppState) -> Option<HeartbeatSnapshot> {
    let raw = fs::read_to_string(heartbeat_path(state)).ok()?;
    let heartbeat = serde_json::from_str::<HeartbeatFile>(&raw).ok()?;
    let updated_at = DateTime::parse_from_rfc3339(&heartbeat.updated_at)
        .ok()?
        .with_timezone(&Utc);
    let age_secs = (Utc::now() - updated_at).num_seconds().max(0);
    Some(HeartbeatSnapshot {
        alive: age_secs < (state.config.cron_tick_interval_secs as i64 * 3),
        firing: heartbeat.firing,
        age_secs,
    })
}

fn heartbeat_path(state: &AppState) -> PathBuf {
    state
        .config
        .agent_data_dir
        .join("cron")
        .join("heartbeat.json")
}

struct TickLock {
    path: PathBuf,
}

impl TickLock {
    fn try_acquire(state: &AppState) -> AppResult<Option<Self>> {
        let path = state.config.agent_data_dir.join("cron").join("tick.lock");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| AppError::Internal(format!("cron lock dir create failed: {err}")))?;
        }
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => Ok(Some(Self { path })),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(None),
            Err(err) => Err(AppError::Internal(format!(
                "cron tick lock acquire failed: {err}"
            ))),
        }
    }
}

impl Drop for TickLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn store_error(err: std::io::Error) -> AppError {
    AppError::Internal(format!("cron store failed: {err}"))
}

fn scrubbed_env() -> HashMap<String, String> {
    let mut env = HashMap::new();
    for key in ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }
    env
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated.push_str("\n[truncated]");
    truncated
}

fn mode_label(mode: &JobMode) -> &'static str {
    match mode {
        JobMode::Agent => "agent",
        JobMode::NoAgent => "no_agent",
    }
}

fn default_enabled() -> bool {
    true
}

fn default_limit() -> i64 {
    50
}

fn default_wake_agent() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blueprint_catalog_has_thirteen_templates() {
        let blueprints = builtin_blueprints();
        assert_eq!(blueprints.len(), 13);
        assert!(blueprints
            .iter()
            .any(|blueprint| blueprint.key == "morning_briefing"));
    }

    #[test]
    fn blueprint_prompt_instantiates_values_and_clears_missing_placeholders() {
        let prompt = instantiate_blueprint_prompt(
            "Calendar: {{include_calendar}}. Topic: {{topic}}. Missing: {{missing}}.",
            &serde_json::json!({
                "include_calendar": true,
                "topic": "release planning"
            }),
        );
        assert_eq!(
            prompt,
            "Calendar: true. Topic: release planning. Missing: ."
        );
    }
}
