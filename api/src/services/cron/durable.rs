//! PostgreSQL-backed cron definitions and occurrence orchestration.

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::agent::prompt::PROMPT_VERSION;
use crate::agent::scheduler::{
    compute_next_run_in_timezone, default_max_runtime_seconds, default_max_tool_calls,
    default_max_total_tokens, jobs_path, parse_schedule, CronJob, CronStore, Schedule,
};
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

use super::prompts::{build_agent_job_prompt, truncate_chars};
use super::results::{insert_result, write_output};
use super::runtime::read_heartbeat;
use super::types::{
    CreateCronJobRequest, CronJobsResponse, CronStatusResponse, UpdateCronJobRequest,
};
use super::validation::{
    ensure_cron_prompt_safe, normalize_context_refs, normalize_names, validate_context_refs,
    validate_skill_names,
};

const MAX_OCCURRENCES_PER_TICK: usize = 32;
const DOWNTIME_GRACE_SECONDS: i64 = 120;

#[derive(Debug, Clone, FromRow)]
pub(super) struct DbCronJobRow {
    id: Uuid,
    title: String,
    prompt: String,
    schedule: Value,
    schedule_text: String,
    timezone: String,
    enabled: bool,
    next_run_at: DateTime<Utc>,
    run_count: i32,
    max_runs: Option<i32>,
    skills: Value,
    context_from: Option<Value>,
    wake_agent: bool,
    agent_profile: Option<String>,
    project_id: Option<Uuid>,
    session_policy: String,
    reuse_session_id: Option<Uuid>,
    catch_up_policy: String,
    retry_policy: String,
    budget: Value,
    last_run_id: Option<Uuid>,
    waiting_decision_id: Option<Uuid>,
}

pub(super) async fn import_file_jobs_once(state: &AppState) -> AppResult<usize> {
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('mymy:cron_jobs_json_v1', 0))")
        .execute(&mut *tx)
        .await?;
    let already_imported = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM runtime_migrations WHERE key = 'cron_jobs_json_v1')",
    )
    .fetch_one(&mut *tx)
    .await?;
    if already_imported {
        tx.commit().await?;
        return Ok(0);
    }
    let store = CronStore::new(jobs_path(&state.config.agent_data_dir));
    let jobs = store
        .load()
        .map_err(|err| AppError::Internal(format!("cron import failed: {err}")))?;
    let mut imported = 0_usize;
    for job in jobs {
        let id = Uuid::parse_str(&job.id).unwrap_or_else(|_| Uuid::new_v4());
        let project_id = job
            .project_id
            .as_deref()
            .and_then(|value| Uuid::parse_str(value).ok());
        let session_id = if let Some(profile) = job.agent_profile.as_deref() {
            let session_id = Uuid::new_v4();
            sqlx::query(
                r#"INSERT INTO chat_sessions
                     (id, project_id, agent_id, profile, title, status,
                      message_count, automation_result_only)
                   VALUES ($1, $2, $3, $4, $5, 'active', 0, false)"#,
            )
            .bind(session_id)
            .bind(project_id)
            .bind(format!("native-{profile}"))
            .bind(profile)
            .bind(format!("Cron: {}", truncate_chars(&job.title, 220)))
            .execute(&mut *tx)
            .await?;
            Some(session_id)
        } else {
            None
        };
        let inserted = sqlx::query(
            r#"INSERT INTO cron_jobs
                 (id, legacy_id, title, prompt, schedule, schedule_text, timezone,
                  enabled, next_run_at, run_count, max_runs, skills, context_from,
                  wake_agent, agent_profile, project_id, session_policy,
                  reuse_session_id, catch_up_policy, retry_policy, budget)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                       $12, $13, $14, $15, $16, 'reuse', $17, $18, $19, $20)
               ON CONFLICT (legacy_id) DO NOTHING"#,
        )
        .bind(id)
        .bind(&job.id)
        .bind(&job.title)
        .bind(&job.prompt)
        .bind(serde_json::to_value(&job.schedule).map_err(|err| {
            AppError::Internal(format!("cron schedule serialization failed: {err}"))
        })?)
        .bind(schedule_text(&job.schedule))
        .bind(&state.config.cron_timezone)
        .bind(job.enabled && job.agent_profile.is_some())
        .bind(job.next_run_at)
        .bind(i32::try_from(job.run_count).unwrap_or(i32::MAX))
        .bind(
            job.max_runs
                .map(|value| i32::try_from(value).unwrap_or(i32::MAX)),
        )
        .bind(serde_json::to_value(&job.skills).unwrap_or_else(|_| Value::Array(Vec::new())))
        .bind(
            job.context_from
                .and_then(|value| serde_json::to_value(value).ok()),
        )
        .bind(job.wake_agent)
        .bind(job.agent_profile)
        .bind(project_id)
        .bind(session_id)
        .bind(job.catch_up_policy)
        .bind(job.retry_policy)
        .bind(serde_json::json!({
            "maxToolCalls": job.max_tool_calls,
            "maxRuntimeSeconds": job.max_runtime_seconds,
            "maxTotalTokens": job.max_total_tokens,
        }))
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 0 {
            if let Some(session_id) = session_id {
                sqlx::query("DELETE FROM chat_sessions WHERE id = $1")
                    .bind(session_id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        imported += inserted.rows_affected() as usize;
    }
    sqlx::query("INSERT INTO runtime_migrations (key, details) VALUES ('cron_jobs_json_v1', $1)")
        .bind(serde_json::json!({ "imported": imported }))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(imported)
}

pub(super) async fn list_jobs(state: &AppState) -> AppResult<CronJobsResponse> {
    let rows = fetch_job_rows(state).await?;
    Ok(CronJobsResponse {
        jobs: rows
            .into_iter()
            .map(row_to_job)
            .collect::<AppResult<Vec<_>>>()?,
    })
}

pub(super) async fn create_job(
    state: &AppState,
    req: CreateCronJobRequest,
) -> AppResult<CronJobsResponse> {
    validate_request_policies(&req.session_policy, &req.catch_up_policy, &req.retry_policy)?;
    validate_runtime_budget(
        req.max_tool_calls,
        req.max_runtime_seconds,
        req.max_total_tokens,
    )?;
    ensure_cron_prompt_safe(&req.prompt)?;
    validate_context_refs(req.context_from.as_deref())?;
    validate_skill_names(&req.skills)?;
    let now = Utc::now();
    let schedule = parse_schedule(&req.schedule, now)
        .ok_or_else(|| AppError::BadRequest("invalid schedule".to_string()))?;
    let title = req.title.trim();
    let prompt = req.prompt.trim();
    if title.is_empty() || prompt.is_empty() {
        return Err(AppError::BadRequest(
            "title and prompt cannot be empty".to_string(),
        ));
    }
    let profile = validate_agent_profile(state, req.agent_profile.as_deref())
        .await?
        .ok_or_else(|| AppError::BadRequest("agentProfile is required".to_string()))?;
    let project_id = parse_project_id(req.project_id.as_deref())?;
    validate_project(state, project_id).await?;
    let max_runs = req
        .max_runs
        .or_else(|| matches!(schedule, Schedule::Once { .. }).then_some(1));
    let next_run_at = compute_next_run_in_timezone(&schedule, now, &state.config.cron_timezone);
    let id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        r#"INSERT INTO chat_sessions
             (id, project_id, agent_id, profile, title, status, message_count,
              automation_result_only)
           VALUES ($1, $2, $3, $4, $5, 'active', 0, false)"#,
    )
    .bind(session_id)
    .bind(project_id)
    .bind(format!("native-{profile}"))
    .bind(&profile)
    .bind(format!("Cron: {}", truncate_chars(title, 220)))
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO cron_jobs
             (id, title, prompt, schedule, schedule_text, timezone, enabled,
              next_run_at, max_runs, skills, context_from, wake_agent,
              agent_profile, project_id, session_policy, reuse_session_id,
              catch_up_policy, retry_policy, budget)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   $12, $13, $14, 'reuse', $15, $16, $17, $18)"#,
    )
    .bind(id)
    .bind(title)
    .bind(prompt)
    .bind(
        serde_json::to_value(&schedule).map_err(|err| {
            AppError::Internal(format!("cron schedule serialization failed: {err}"))
        })?,
    )
    .bind(req.schedule.trim())
    .bind(&state.config.cron_timezone)
    .bind(req.enabled)
    .bind(next_run_at)
    .bind(max_runs.map(|value| i32::try_from(value).unwrap_or(i32::MAX)))
    .bind(serde_json::to_value(normalize_names(req.skills)).unwrap_or_default())
    .bind(
        normalize_context_refs(req.context_from).and_then(|value| serde_json::to_value(value).ok()),
    )
    .bind(req.wake_agent)
    .bind(Some(profile))
    .bind(project_id)
    .bind(session_id)
    .bind(req.catch_up_policy)
    .bind(req.retry_policy)
    .bind(serde_json::json!({
        "maxToolCalls": req.max_tool_calls,
        "maxRuntimeSeconds": req.max_runtime_seconds,
        "maxTotalTokens": req.max_total_tokens,
    }))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    audit_change(state, "create", id, "create", title).await;
    list_jobs(state).await
}

pub(super) async fn update_job(
    state: &AppState,
    id: &str,
    req: UpdateCronJobRequest,
) -> AppResult<CronJobsResponse> {
    let id = parse_job_id(id)?;
    let mut row = fetch_job(state, id).await?;
    if let Some(title) = req.title {
        if title.trim().is_empty() {
            return Err(AppError::BadRequest("title cannot be empty".to_string()));
        }
        row.title = title.trim().to_string();
    }
    if let Some(prompt) = req.prompt {
        ensure_cron_prompt_safe(&prompt)?;
        if prompt.trim().is_empty() {
            return Err(AppError::BadRequest("prompt cannot be empty".to_string()));
        }
        row.prompt = prompt.trim().to_string();
    }
    if let Some(schedule_text) = req.schedule {
        let schedule = parse_schedule(&schedule_text, Utc::now())
            .ok_or_else(|| AppError::BadRequest("invalid schedule".to_string()))?;
        row.next_run_at = compute_next_run_in_timezone(&schedule, Utc::now(), &row.timezone);
        row.schedule = serde_json::to_value(schedule).map_err(|err| {
            AppError::Internal(format!("cron schedule serialization failed: {err}"))
        })?;
        row.schedule_text = schedule_text;
    }
    if let Some(max_runs) = req.max_runs {
        row.max_runs = max_runs.map(|value| i32::try_from(value).unwrap_or(i32::MAX));
    }
    if let Some(enabled) = req.enabled {
        row.enabled = enabled;
    }
    if let Some(skills) = req.skills {
        validate_skill_names(&skills)?;
        row.skills = serde_json::to_value(normalize_names(skills)).unwrap_or_default();
    }
    if let Some(context_from) = req.context_from {
        validate_context_refs(context_from.as_deref())?;
        row.context_from =
            normalize_context_refs(context_from).and_then(|value| serde_json::to_value(value).ok());
    }
    if let Some(wake_agent) = req.wake_agent {
        row.wake_agent = wake_agent;
    }
    if let Some(profile) = req.agent_profile {
        let requested = validate_agent_profile(state, profile.as_deref())
            .await?
            .ok_or_else(|| AppError::BadRequest("agentProfile cannot be cleared".to_string()))?;
        if row.agent_profile.as_deref() != Some(requested.as_str()) {
            return Err(AppError::BadRequest(
                "cron agentProfile cannot change after its stable session is created".to_string(),
            ));
        }
    }
    if let Some(project) = req.project_id {
        let requested = parse_project_id(project.as_deref())?;
        validate_project(state, requested).await?;
        if row.project_id != requested {
            return Err(AppError::BadRequest(
                "cron projectId cannot change after its stable session is created".to_string(),
            ));
        }
    }
    if let Some(policy) = req.session_policy {
        if policy != "reuse" {
            return Err(AppError::BadRequest(
                "sessionPolicy must be reuse because each cron owns one stable session".to_string(),
            ));
        }
        row.session_policy = "reuse".to_string();
    }
    if let Some(policy) = req.catch_up_policy {
        row.catch_up_policy = policy;
    }
    if let Some(policy) = req.retry_policy {
        row.retry_policy = policy;
    }
    if let Some(value) = req.max_tool_calls {
        row.budget["maxToolCalls"] = Value::from(value);
    }
    if let Some(value) = req.max_runtime_seconds {
        row.budget["maxRuntimeSeconds"] = Value::from(value);
    }
    if let Some(value) = req.max_total_tokens {
        row.budget["maxTotalTokens"] = Value::from(value);
    }
    if row.enabled && row.agent_profile.is_none() {
        return Err(AppError::BadRequest(
            "an enabled cron job requires agentProfile".to_string(),
        ));
    }
    validate_request_policies(&row.session_policy, &row.catch_up_policy, &row.retry_policy)?;
    let (max_tool_calls, max_runtime_seconds, max_total_tokens) = budget_limits(&row.budget);
    validate_runtime_budget(max_tool_calls, max_runtime_seconds, max_total_tokens)?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        r#"UPDATE cron_jobs SET title = $2, prompt = $3, schedule = $4,
              schedule_text = $5, enabled = $6, next_run_at = $7,
              max_runs = $8, skills = $9, context_from = $10, wake_agent = $11,
              agent_profile = $12, project_id = $13, session_policy = $14,
              catch_up_policy = $15, retry_policy = $16, budget = $17,
              updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL"#,
    )
    .bind(row.id)
    .bind(&row.title)
    .bind(&row.prompt)
    .bind(&row.schedule)
    .bind(&row.schedule_text)
    .bind(row.enabled)
    .bind(row.next_run_at)
    .bind(row.max_runs)
    .bind(&row.skills)
    .bind(&row.context_from)
    .bind(row.wake_agent)
    .bind(&row.agent_profile)
    .bind(row.project_id)
    .bind(&row.session_policy)
    .bind(&row.catch_up_policy)
    .bind(&row.retry_policy)
    .bind(&row.budget)
    .execute(&mut *tx)
    .await?;
    if let Some(session_id) = row.reuse_session_id {
        sqlx::query(
            r#"UPDATE chat_sessions SET title = $2, updated_at = now()
               WHERE id = $1"#,
        )
        .bind(session_id)
        .bind(format!("Cron: {}", truncate_chars(&row.title, 220)))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    audit_change(state, "update", id, "update", &row.title).await;
    list_jobs(state).await
}

pub(super) async fn set_enabled(
    state: &AppState,
    id: &str,
    enabled: bool,
    operation: &str,
) -> AppResult<CronJobsResponse> {
    let id = parse_job_id(id)?;
    if enabled {
        ensure_job_has_agent(state, id).await?;
    }
    let title = sqlx::query_scalar::<_, String>(
        r#"UPDATE cron_jobs SET enabled = $2, updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL RETURNING title"#,
    )
    .bind(id)
    .bind(enabled)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("cron job {id} not found")))?;
    audit_change(state, "update", id, operation, &title).await;
    list_jobs(state).await
}

pub(super) async fn trigger_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    let id = parse_job_id(id)?;
    ensure_job_has_agent(state, id).await?;
    let title = sqlx::query_scalar::<_, String>(
        r#"UPDATE cron_jobs SET enabled = true, next_run_at = now(), updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL RETURNING title"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("cron job {id} not found")))?;
    audit_change(state, "update", id, "trigger", &title).await;
    list_jobs(state).await
}

pub(super) async fn delete_job(state: &AppState, id: &str) -> AppResult<CronJobsResponse> {
    let id = parse_job_id(id)?;
    let mut tx = state.db.begin().await?;
    let (title, session_id) = sqlx::query_as::<_, (String, Option<Uuid>)>(
        r#"UPDATE cron_jobs SET enabled = false, deleted_at = now(), updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL RETURNING title, reuse_session_id"#,
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("cron job {id} not found")))?;
    if let Some(session_id) = session_id {
        sqlx::query(
            "UPDATE chat_sessions SET status = 'archived', updated_at = now() WHERE id = $1",
        )
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    audit_change(state, "delete", id, "delete", &title).await;
    list_jobs(state).await
}

pub(super) async fn status(state: &AppState) -> AppResult<CronStatusResponse> {
    let (active_jobs, next_run_at) = sqlx::query_as::<_, (i64, Option<DateTime<Utc>>)>(
        r#"SELECT COUNT(*)::bigint, MIN(next_run_at)
           FROM cron_jobs WHERE enabled AND deleted_at IS NULL
             AND (max_runs IS NULL OR run_count < max_runs)"#,
    )
    .fetch_one(&state.db)
    .await?;
    let heartbeat = read_heartbeat(state);
    Ok(CronStatusResponse {
        scheduler_running: true,
        active_jobs: usize::try_from(active_jobs).unwrap_or(usize::MAX),
        next_run_at: next_run_at.map(|value| value.to_rfc3339()),
        ticker_alive: heartbeat.as_ref().is_some_and(|value| value.alive),
        ticker_firing: heartbeat.as_ref().is_some_and(|value| value.firing),
        heartbeat_age_secs: heartbeat.map(|value| value.age_secs),
        timezone: state.config.cron_timezone.clone(),
    })
}

pub(super) async fn tick_due_jobs(state: &AppState) -> AppResult<usize> {
    let mut enqueued = 0_usize;
    for _ in 0..MAX_OCCURRENCES_PER_TICK {
        if !enqueue_one_due_occurrence(state).await? {
            break;
        }
        enqueued += 1;
    }
    if enqueued > 0 {
        state.agent_run_notify.notify_waiters();
    }
    Ok(enqueued)
}

async fn enqueue_one_due_occurrence(state: &AppState) -> AppResult<bool> {
    let mut tx = state.db.begin().await?;
    let Some(mut job) = fetch_due_job_for_update(&mut tx).await? else {
        tx.commit().await?;
        return Ok(false);
    };
    let schedule: Schedule = serde_json::from_value(job.schedule.clone())
        .map_err(|err| AppError::Internal(format!("stored cron schedule is invalid: {err}")))?;
    let scheduled_for = job.next_run_at;
    let now = Utc::now();
    let overdue = now - scheduled_for > Duration::seconds(DOWNTIME_GRACE_SECONDS);
    if overdue && job.catch_up_policy == "skip" {
        insert_skipped_occurrence(
            &mut tx,
            &job,
            scheduled_for,
            serde_json::json!({ "code": "downtime_skip", "overdueSeconds": (now - scheduled_for).num_seconds() }),
        )
        .await?;
        advance_job(&mut tx, &job, &schedule, now, false).await?;
        tx.commit().await?;
        return Ok(true);
    }
    let waiting_decision = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"SELECT r.id, d.id FROM cron_occurrences o
           INNER JOIN agent_runs r ON r.id = o.run_id
           INNER JOIN decisions d ON d.run_id = r.id AND d.status = 'pending' AND d.suspend
           WHERE o.job_id = $1 AND r.status = 'waiting_decision'
           ORDER BY d.created_at DESC LIMIT 1"#,
    )
    .bind(job.id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((run_id, decision_id)) = waiting_decision {
        insert_skipped_occurrence(
            &mut tx,
            &job,
            scheduled_for,
            serde_json::json!({
                "code": "waiting_decision",
                "runId": run_id,
                "decisionId": decision_id,
            }),
        )
        .await?;
        advance_job(&mut tx, &job, &schedule, now, false).await?;
        tx.commit().await?;
        return Ok(true);
    }
    let profile = job.agent_profile.clone();
    let Some(profile) = profile else {
        insert_skipped_occurrence(
            &mut tx,
            &job,
            scheduled_for,
            serde_json::json!({ "code": "agent_unavailable" }),
        )
        .await?;
        advance_job(&mut tx, &job, &schedule, now, false).await?;
        tx.commit().await?;
        return Ok(true);
    };
    job.agent_profile = Some(profile.clone());
    let session_id = resolve_session(&mut tx, &mut job, &profile).await?;
    let occurrence_id = Uuid::new_v4();
    let occurrence_key = format!("{}:{}", job.id, scheduled_for.to_rfc3339());
    let cron_job = row_to_job(job.clone())?;
    let prompt = build_agent_job_prompt(state, &cron_job).await?;
    let snapshot = serde_json::to_value(&cron_job)
        .map_err(|err| AppError::Internal(format!("cron job snapshot failed: {err}")))?;
    let occurrence_inserted = sqlx::query(
        r#"INSERT INTO cron_occurrences
             (id, job_id, scheduled_for, occurrence_key, status, job_snapshot)
           VALUES ($1, $2, $3, $4, 'pending', $5)
           ON CONFLICT (job_id, scheduled_for) DO NOTHING"#,
    )
    .bind(occurrence_id)
    .bind(job.id)
    .bind(scheduled_for)
    .bind(&occurrence_key)
    .bind(snapshot)
    .execute(&mut *tx)
    .await?;
    if occurrence_inserted.rows_affected() == 0 {
        advance_job(&mut tx, &job, &schedule, now, false).await?;
        tx.commit().await?;
        return Ok(true);
    }
    let run_id = Uuid::new_v4();
    let authorization = serde_json::json!({
        "explicitUserAction": false,
        "budget": job.budget,
        "retryPolicy": job.retry_policy,
    });
    sqlx::query(
        r#"INSERT INTO agent_runs
             (id, session_id, agent_profile, trigger_type, trigger_ref,
              project_id, status, objective, prompt_version, authorization_context)
           VALUES ($1, $2, $3, 'cron', $4, $5, 'queued', $6, $7, $8)"#,
    )
    .bind(run_id)
    .bind(session_id)
    .bind(&profile)
    .bind(job.id.to_string())
    .bind(job.project_id)
    .bind(truncate_chars(&job.title, 240))
    .bind(PROMPT_VERSION)
    .bind(authorization)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO session_run_inputs
             (session_id, client_request_id, target_run_id, kind, content, options)
           VALUES ($1, $2, $3, 'cron', $4, $5)"#,
    )
    .bind(session_id)
    .bind(format!("cron:{occurrence_id}"))
    .bind(run_id)
    .bind(prompt)
    .bind(serde_json::json!({ "occurrenceId": occurrence_id, "jobId": job.id }))
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE cron_occurrences SET status = 'enqueued', run_id = $2 WHERE id = $1")
        .bind(occurrence_id)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
    advance_job(&mut tx, &job, &schedule, now, true).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn mark_occurrence_waiting(state: &AppState, run_id: Uuid) -> AppResult<()> {
    sqlx::query("UPDATE cron_occurrences SET status = 'waiting_decision' WHERE run_id = $1")
        .bind(run_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

pub async fn finalize_occurrence(
    state: &AppState,
    run_id: Uuid,
    run_status: &str,
) -> AppResult<()> {
    let Some((occurrence_id, snapshot)) = sqlx::query_as::<_, (Uuid, Value)>(
        "SELECT id, job_snapshot FROM cron_occurrences WHERE run_id = $1",
    )
    .bind(run_id)
    .fetch_optional(&state.db)
    .await?
    else {
        return Ok(());
    };
    let job: CronJob = serde_json::from_value(snapshot)
        .map_err(|err| AppError::Internal(format!("cron occurrence snapshot invalid: {err}")))?;
    let output = sqlx::query_scalar::<_, String>(
        r#"SELECT COALESCE(string_agg(payload->>'content', '' ORDER BY sequence), '')
           FROM agent_run_events
           WHERE run_id = $1 AND event_type = 'text_delta'"#,
    )
    .bind(run_id)
    .fetch_one(&state.db)
    .await?;
    let output = truncate_chars(&output, 50_000);
    let status = cron_result_status(run_status, &output);
    let output_path = write_output(state, &job, status, &output)?;
    insert_result(
        state,
        &job,
        status,
        &output,
        output_path,
        Some(run_id),
        Some(occurrence_id),
    )
    .await?;
    sqlx::query(
        r#"UPDATE cron_occurrences
           SET status = $2, completed_at = now()
           WHERE id = $1"#,
    )
    .bind(occurrence_id)
    .bind(match run_status {
        "completed" => "completed",
        "cancelled" => "cancelled",
        _ => "failed",
    })
    .execute(&state.db)
    .await?;
    Ok(())
}

fn cron_result_status(run_status: &str, output: &str) -> &'static str {
    match run_status {
        "completed" if output.trim() == "[SILENT]" => "silent",
        "completed" if !output.trim().is_empty() => "success",
        "cancelled" => "cancelled",
        _ => "error",
    }
}

async fn fetch_job_rows(state: &AppState) -> AppResult<Vec<DbCronJobRow>> {
    sqlx::query_as::<_, DbCronJobRow>(&format!(
        r#"SELECT {},
                  (SELECT o.run_id FROM cron_occurrences o
                   WHERE o.job_id = j.id AND o.run_id IS NOT NULL
                   ORDER BY o.scheduled_for DESC LIMIT 1) AS last_run_id,
                  (SELECT d.id FROM cron_occurrences o
                   INNER JOIN decisions d ON d.run_id = o.run_id
                   WHERE o.job_id = j.id AND d.status = 'pending' AND d.suspend
                   ORDER BY d.created_at DESC LIMIT 1) AS waiting_decision_id
           FROM cron_jobs j WHERE j.deleted_at IS NULL ORDER BY j.created_at DESC"#,
        job_columns("j")
    ))
    .fetch_all(&state.db)
    .await
    .map_err(Into::into)
}

async fn fetch_job(state: &AppState, id: Uuid) -> AppResult<DbCronJobRow> {
    sqlx::query_as::<_, DbCronJobRow>(&format!(
        "SELECT {}, NULL::uuid AS last_run_id, NULL::uuid AS waiting_decision_id FROM cron_jobs j WHERE j.id = $1 AND j.deleted_at IS NULL",
        job_columns("j")
    ))
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("cron job {id} not found")))
}

async fn fetch_due_job_for_update(
    tx: &mut Transaction<'_, Postgres>,
) -> AppResult<Option<DbCronJobRow>> {
    sqlx::query_as::<_, DbCronJobRow>(&format!(
        r#"SELECT {}, NULL::uuid AS last_run_id, NULL::uuid AS waiting_decision_id
           FROM cron_jobs j
           WHERE j.enabled AND j.deleted_at IS NULL AND j.next_run_at <= now()
             AND (j.max_runs IS NULL OR j.run_count < j.max_runs)
             AND NOT EXISTS (
               SELECT 1 FROM cron_occurrences active_occurrence
               INNER JOIN agent_runs active_run
                 ON active_run.id = active_occurrence.run_id
               WHERE active_occurrence.job_id = j.id
                 AND active_run.status IN ('queued', 'running', 'waiting_decision')
             )
           ORDER BY j.next_run_at, j.id FOR UPDATE SKIP LOCKED LIMIT 1"#,
        job_columns("j")
    ))
    .fetch_optional(&mut **tx)
    .await
    .map_err(Into::into)
}

fn job_columns(alias: &str) -> String {
    format!(
        "{alias}.id, {alias}.title, {alias}.prompt, \
         {alias}.schedule, {alias}.schedule_text, {alias}.timezone, \
         {alias}.enabled, {alias}.next_run_at, {alias}.run_count, \
         {alias}.max_runs, {alias}.skills, {alias}.context_from, \
         {alias}.wake_agent, {alias}.agent_profile, {alias}.project_id, \
         {alias}.session_policy, {alias}.reuse_session_id, \
         {alias}.catch_up_policy, {alias}.retry_policy, \
         {alias}.budget"
    )
}

fn row_to_job(row: DbCronJobRow) -> AppResult<CronJob> {
    Ok(CronJob {
        id: row.id.to_string(),
        title: row.title,
        prompt: row.prompt,
        schedule: serde_json::from_value(row.schedule)
            .map_err(|err| AppError::Internal(format!("stored cron schedule is invalid: {err}")))?,
        enabled: row.enabled,
        next_run_at: row.next_run_at,
        run_count: u32::try_from(row.run_count).unwrap_or(u32::MAX),
        max_runs: row
            .max_runs
            .map(|value| u32::try_from(value).unwrap_or(u32::MAX)),
        skills: serde_json::from_value(row.skills).unwrap_or_default(),
        context_from: row
            .context_from
            .and_then(|value| serde_json::from_value(value).ok()),
        wake_agent: row.wake_agent,
        agent_profile: row.agent_profile,
        project_id: row.project_id.map(|id| id.to_string()),
        session_policy: row.session_policy,
        catch_up_policy: row.catch_up_policy,
        retry_policy: row.retry_policy,
        max_tool_calls: budget_limits(&row.budget).0,
        max_runtime_seconds: budget_limits(&row.budget).1,
        max_total_tokens: budget_limits(&row.budget).2,
        last_run_id: row.last_run_id.map(|id| id.to_string()),
        waiting_decision_id: row.waiting_decision_id.map(|id| id.to_string()),
    })
}

async fn resolve_session(
    tx: &mut Transaction<'_, Postgres>,
    job: &mut DbCronJobRow,
    profile: &str,
) -> AppResult<Uuid> {
    if let Some(session_id) = job.reuse_session_id {
        let valid = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(SELECT 1 FROM chat_sessions
               WHERE id = $1 AND profile = $2
                 AND project_id IS NOT DISTINCT FROM $3)"#,
        )
        .bind(session_id)
        .bind(profile)
        .bind(job.project_id)
        .fetch_one(&mut **tx)
        .await?;
        if valid {
            return Ok(session_id);
        }
    }
    let session_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO chat_sessions
             (id, project_id, agent_id, profile, title, status, message_count,
              automation_result_only)
           VALUES ($1, $2, $3, $4, $5, 'active', 0, false)"#,
    )
    .bind(session_id)
    .bind(job.project_id)
    .bind(format!("native-{profile}"))
    .bind(profile)
    .bind(format!("Cron: {}", truncate_chars(&job.title, 220)))
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE cron_jobs SET session_policy = 'reuse', reuse_session_id = $2 WHERE id = $1",
    )
    .bind(job.id)
    .bind(session_id)
    .execute(&mut **tx)
    .await?;
    job.session_policy = "reuse".to_string();
    job.reuse_session_id = Some(session_id);
    Ok(session_id)
}

async fn insert_skipped_occurrence(
    tx: &mut Transaction<'_, Postgres>,
    job: &DbCronJobRow,
    scheduled_for: DateTime<Utc>,
    reason: Value,
) -> AppResult<()> {
    sqlx::query(
        r#"INSERT INTO cron_occurrences
             (job_id, scheduled_for, occurrence_key, status, skip_reason, job_snapshot)
           VALUES ($1, $2, $3, 'skipped', $4, $5)
           ON CONFLICT (job_id, scheduled_for) DO NOTHING"#,
    )
    .bind(job.id)
    .bind(scheduled_for)
    .bind(format!("{}:{}", job.id, scheduled_for.to_rfc3339()))
    .bind(reason)
    .bind(serde_json::to_value(row_to_job(job.clone())?).unwrap_or_default())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn advance_job(
    tx: &mut Transaction<'_, Postgres>,
    job: &DbCronJobRow,
    schedule: &Schedule,
    now: DateTime<Utc>,
    counted: bool,
) -> AppResult<()> {
    let base = if job.catch_up_policy == "all" {
        job.next_run_at
    } else {
        now
    };
    let next = compute_next_run_in_timezone(schedule, base, &job.timezone);
    let disable_once = matches!(schedule, Schedule::Once { .. });
    sqlx::query(
        r#"UPDATE cron_jobs SET
             run_count = run_count + CASE WHEN $2 THEN 1 ELSE 0 END,
             next_run_at = $3,
             enabled = CASE WHEN $4 THEN false ELSE enabled END,
             updated_at = now()
           WHERE id = $1"#,
    )
    .bind(job.id)
    .bind(counted)
    .bind(next)
    .bind(disable_once)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn validate_request_policies(session: &str, catch_up: &str, retry: &str) -> AppResult<()> {
    if session != "reuse" {
        return Err(AppError::BadRequest(
            "sessionPolicy must be reuse because each cron owns one stable session".to_string(),
        ));
    }
    if !matches!(catch_up, "skip" | "latest" | "all") {
        return Err(AppError::BadRequest("invalid catchUpPolicy".to_string()));
    }
    if !matches!(retry, "none" | "safe") {
        return Err(AppError::BadRequest("invalid retryPolicy".to_string()));
    }
    Ok(())
}

fn budget_limits(budget: &Value) -> (u32, u32, u32) {
    let max_tool_calls = budget
        .get("maxToolCalls")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or_else(default_max_tool_calls);
    let max_runtime_seconds = budget
        .get("maxRuntimeSeconds")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or_else(default_max_runtime_seconds);
    let max_total_tokens = budget
        .get("maxTotalTokens")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or_else(default_max_total_tokens);
    (max_tool_calls, max_runtime_seconds, max_total_tokens)
}

fn validate_runtime_budget(
    max_tool_calls: u32,
    max_runtime_seconds: u32,
    max_total_tokens: u32,
) -> AppResult<()> {
    if !(1..=1_000).contains(&max_tool_calls) {
        return Err(AppError::BadRequest(
            "maxToolCalls must be between 1 and 1000".to_string(),
        ));
    }
    if !(1..=86_400).contains(&max_runtime_seconds) {
        return Err(AppError::BadRequest(
            "maxRuntimeSeconds must be between 1 and 86400".to_string(),
        ));
    }
    if !(1_000..=2_000_000).contains(&max_total_tokens) {
        return Err(AppError::BadRequest(
            "maxTotalTokens must be between 1000 and 2000000".to_string(),
        ));
    }
    Ok(())
}

async fn validate_agent_profile(
    state: &AppState,
    profile: Option<&str>,
) -> AppResult<Option<String>> {
    let Some(profile) = profile.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM native_agents WHERE profile = $1)",
    )
    .bind(profile)
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(AppError::BadRequest(format!(
            "unknown agent profile: {profile}"
        )));
    }
    Ok(Some(profile.to_string()))
}

async fn validate_project(state: &AppState, project_id: Option<Uuid>) -> AppResult<()> {
    let Some(project_id) = project_id else {
        return Ok(());
    };
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)")
            .bind(project_id)
            .fetch_one(&state.db)
            .await?;
    if !exists {
        return Err(AppError::BadRequest(format!(
            "unknown project: {project_id}"
        )));
    }
    Ok(())
}

async fn ensure_job_has_agent(state: &AppState, id: Uuid) -> AppResult<()> {
    let profile = sqlx::query_scalar::<_, Option<String>>(
        "SELECT agent_profile FROM cron_jobs WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("cron job {id} not found")))?;
    if profile.is_none() {
        return Err(AppError::Conflict(
            "assign an agentProfile before enabling or triggering this cron job".to_string(),
        ));
    }
    Ok(())
}

fn parse_project_id(value: Option<&str>) -> AppResult<Option<Uuid>> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|err| AppError::BadRequest(format!("invalid projectId: {err}")))
}

fn parse_job_id(value: &str) -> AppResult<Uuid> {
    Uuid::parse_str(value)
        .map_err(|err| AppError::BadRequest(format!("invalid cron job id: {err}")))
}

fn schedule_text(schedule: &Schedule) -> String {
    match schedule {
        Schedule::Once { at } => at.to_rfc3339(),
        Schedule::Interval { seconds } => format!("every {seconds}s"),
        Schedule::Cron { expression } => expression.clone(),
    }
}

async fn audit_change(state: &AppState, action: &str, id: Uuid, operation: &str, title: &str) {
    log_audit_safe(
        &state.db,
        "user",
        "user",
        action,
        "cron_job",
        Some(&id.to_string()),
        Some(serde_json::json!({
            "operation": operation,
            "title": redact_sensitive_text(title),
        })),
    )
    .await;
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::config::Config;

    #[sqlx::test(migrations = "./migrations")]
    async fn each_cron_owns_one_visible_session_and_reuses_it_for_occurrences(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents
                 (profile, name, drive_path, sandbox_status)
               VALUES ('cron-session-test', 'Cron session test',
                       '/drive/agents/cron-session-test', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        for index in 0..3 {
            create_job(&state, request(&format!("Job {index}")))
                .await
                .unwrap();
        }

        let jobs = sqlx::query_as::<_, (Uuid, Uuid)>(
            r#"SELECT id, reuse_session_id
               FROM cron_jobs ORDER BY title"#,
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(jobs.len(), 3);
        assert_eq!(
            jobs.iter()
                .map(|(_, session_id)| *session_id)
                .collect::<HashSet<_>>()
                .len(),
            3
        );
        let visible_sessions = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM chat_sessions
               WHERE profile = 'cron-session-test' AND NOT automation_result_only"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(visible_sessions, 3);

        let (job_id, stable_session_id) = jobs[0];
        trigger_job(&state, &job_id.to_string()).await.unwrap();
        assert_eq!(tick_due_jobs(&state).await.unwrap(), 1);
        let first_run_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM agent_runs WHERE trigger_ref = $1 ORDER BY created_at LIMIT 1",
        )
        .bind(job_id.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE agent_runs SET status = 'running' WHERE id = $1")
            .bind(first_run_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE agent_runs SET status = 'completed' WHERE id = $1")
            .bind(first_run_id)
            .execute(&pool)
            .await
            .unwrap();

        trigger_job(&state, &job_id.to_string()).await.unwrap();
        assert_eq!(tick_due_jobs(&state).await.unwrap(), 1);
        let run_sessions = sqlx::query_scalar::<_, Uuid>(
            "SELECT session_id FROM agent_runs WHERE trigger_ref = $1 ORDER BY created_at",
        )
        .bind(job_id.to_string())
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(run_sessions, vec![stable_session_id, stable_session_id]);
    }

    #[test]
    fn cron_result_status_never_treats_empty_completion_as_success() {
        assert_eq!(cron_result_status("completed", ""), "error");
        assert_eq!(cron_result_status("completed", "  \n"), "error");
        assert_eq!(cron_result_status("completed", "[SILENT]"), "silent");
        assert_eq!(cron_result_status("completed", "Real result"), "success");
        assert_eq!(cron_result_status("cancelled", "partial"), "cancelled");
        assert_eq!(cron_result_status("failed", "partial"), "error");
    }

    fn request(title: &str) -> CreateCronJobRequest {
        CreateCronJobRequest {
            title: title.to_string(),
            prompt: "Perform one bounded scheduled task.".to_string(),
            schedule: "every 1h".to_string(),
            max_runs: None,
            enabled: false,
            skills: Vec::new(),
            context_from: None,
            wake_agent: false,
            agent_profile: Some("cron-session-test".to_string()),
            project_id: None,
            session_policy: "reuse".to_string(),
            catch_up_policy: "latest".to_string(),
            retry_policy: "safe".to_string(),
            max_tool_calls: default_max_tool_calls(),
            max_runtime_seconds: default_max_runtime_seconds(),
            max_total_tokens: default_max_total_tokens(),
        }
    }

    fn test_config() -> Config {
        Config {
            database_url: String::new(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: std::env::temp_dir(),
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
