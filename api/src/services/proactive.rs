//! Opt-in proactive candidate discovery and read-only wake runs.
//!
//! Discovery only projects facts already present in the workspace. It never
//! starts an LLM run by itself: a user approval turns one candidate into one
//! visible, budgeted wake run.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Timelike, Utc};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::prompt::PROMPT_VERSION;
use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};
use crate::models::proactive::{
    ProactiveCandidate, ProactiveCandidatesQuery, ProactiveCandidatesResponse, ProactiveSettings,
    ProactiveSettingsResponse, UpdateProactiveSettings,
};
use crate::state::AppState;

#[derive(Debug, Clone, FromRow)]
struct SettingsRow {
    agent_profile: String,
    enabled: bool,
    quiet_start_hour: i16,
    quiet_end_hour: i16,
    daily_run_budget: i32,
    max_tool_calls: i32,
    max_runtime_seconds: i32,
    max_total_tokens: i32,
    cooldown_hours: i32,
    idle_fallback_days: i32,
}

#[derive(Debug, Clone, FromRow)]
struct CandidateRow {
    id: Uuid,
    agent_profile: String,
    project_id: Option<Uuid>,
    task_id: Option<Uuid>,
    kind: String,
    reason: String,
    score: f64,
    status: String,
    run_id: Option<Uuid>,
    cooldown_until: Option<DateTime<Utc>>,
    discovered_at: DateTime<Utc>,
}

struct CandidateInput<'a> {
    profile: &'a str,
    project_id: Option<Uuid>,
    task_id: Option<Uuid>,
    fingerprint: &'a str,
    kind: &'a str,
    reason: &'a str,
    score: f64,
}

pub fn start_proactive_coordinator(state: Arc<AppState>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(err) = discover_candidates(&state).await {
                tracing::error!(error = %err, "proactive candidate discovery failed");
            }
        }
    })
}

pub async fn get_settings(state: &AppState, profile: &str) -> AppResult<ProactiveSettingsResponse> {
    ensure_agent(state, profile).await?;
    sqlx::query(
        "INSERT INTO proactive_settings (agent_profile) VALUES ($1) ON CONFLICT DO NOTHING",
    )
    .bind(profile)
    .execute(&state.db)
    .await?;
    let row = fetch_settings(state, profile).await?;
    Ok(ProactiveSettingsResponse {
        settings: settings_view(row),
    })
}

pub async fn update_settings(
    state: &AppState,
    profile: &str,
    request: UpdateProactiveSettings,
) -> AppResult<ProactiveSettingsResponse> {
    get_settings(state, profile).await?;
    validate_settings(&request)?;
    sqlx::query(
        r#"UPDATE proactive_settings SET
             enabled = COALESCE($2, enabled),
             quiet_start_hour = COALESCE($3, quiet_start_hour),
             quiet_end_hour = COALESCE($4, quiet_end_hour),
             daily_run_budget = COALESCE($5, daily_run_budget),
             max_tool_calls = COALESCE($6, max_tool_calls),
             max_runtime_seconds = COALESCE($7, max_runtime_seconds),
             max_total_tokens = COALESCE($8, max_total_tokens),
             cooldown_hours = COALESCE($9, cooldown_hours),
             idle_fallback_days = COALESCE($10, idle_fallback_days),
             updated_at = now()
           WHERE agent_profile = $1"#,
    )
    .bind(profile)
    .bind(request.enabled)
    .bind(request.quiet_start_hour)
    .bind(request.quiet_end_hour)
    .bind(request.daily_run_budget)
    .bind(request.max_tool_calls)
    .bind(request.max_runtime_seconds)
    .bind(request.max_total_tokens)
    .bind(request.cooldown_hours)
    .bind(request.idle_fallback_days)
    .execute(&state.db)
    .await?;
    get_settings(state, profile).await
}

pub async fn list_candidates(
    state: &AppState,
    query: ProactiveCandidatesQuery,
) -> AppResult<ProactiveCandidatesResponse> {
    let rows = sqlx::query_as::<_, CandidateRow>(
        r#"SELECT id, agent_profile, project_id, task_id, kind, reason, score,
                  status, run_id, cooldown_until, discovered_at
           FROM proactive_candidates
           WHERE ($1::text IS NULL OR agent_profile = $1)
             AND ($2::text IS NULL OR status = $2)
           ORDER BY CASE status WHEN 'discovered' THEN 0 ELSE 1 END,
                    score DESC, discovered_at DESC
           LIMIT $3"#,
    )
    .bind(query.agent_profile)
    .bind(query.status)
    .bind(query.limit.clamp(1, 200))
    .fetch_all(&state.db)
    .await?;
    Ok(ProactiveCandidatesResponse {
        candidates: rows.into_iter().map(candidate_view).collect(),
    })
}

pub async fn approve_candidate(state: &AppState, id: Uuid) -> AppResult<ProactiveCandidate> {
    let mut tx = state.db.begin().await?;
    let candidate = sqlx::query_as::<_, CandidateRow>(
        r#"SELECT id, agent_profile, project_id, task_id, kind, reason, score,
                  status, run_id, cooldown_until, discovered_at
           FROM proactive_candidates WHERE id = $1 FOR UPDATE"#,
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("proactive candidate {id} not found")))?;
    if candidate.status == "spawned" {
        tx.commit().await?;
        return Ok(candidate_view(candidate));
    }
    if candidate.status != "discovered" {
        return Err(AppError::Conflict(
            "only a discovered candidate can be approved".to_string(),
        ));
    }
    let settings = sqlx::query_as::<_, SettingsRow>(
        r#"SELECT agent_profile, enabled, quiet_start_hour, quiet_end_hour,
                  daily_run_budget, max_tool_calls, max_runtime_seconds, max_total_tokens,
                  cooldown_hours, idle_fallback_days
           FROM proactive_settings WHERE agent_profile = $1"#,
    )
    .bind(&candidate.agent_profile)
    .fetch_one(&mut *tx)
    .await?;
    if !settings.enabled {
        return Err(AppError::Conflict(
            "proactive mode is disabled for this agent".to_string(),
        ));
    }
    let runs_today = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM agent_runs
           WHERE agent_profile = $1 AND trigger_type = 'wake'
             AND created_at >= date_trunc('day', now())"#,
    )
    .bind(&candidate.agent_profile)
    .fetch_one(&mut *tx)
    .await?;
    if runs_today >= i64::from(settings.daily_run_budget) {
        return Err(AppError::Conflict(
            "daily proactive run budget is exhausted".to_string(),
        ));
    }
    if let Some(task_id) = candidate.task_id {
        let active = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                 SELECT 1 FROM run_task_links rtl
                 INNER JOIN agent_runs r ON r.id = rtl.run_id
                 WHERE rtl.task_identity = $1
                   AND r.status IN ('queued', 'running', 'waiting_decision')
               )"#,
        )
        .bind(task_id)
        .fetch_one(&mut *tx)
        .await?;
        if active {
            return Err(AppError::Conflict(
                "the candidate task is already active in another run".to_string(),
            ));
        }
    }
    let session_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO chat_sessions
             (id, project_id, agent_id, profile, status, message_count,
              automation_result_only)
           VALUES ($1, $2, $3, $4, 'active', 0, true)"#,
    )
    .bind(session_id)
    .bind(candidate.project_id)
    .bind(format!("native-{}", candidate.agent_profile))
    .bind(&candidate.agent_profile)
    .execute(&mut *tx)
    .await?;
    let run_id = Uuid::new_v4();
    let objective = truncate(&candidate.reason, 240);
    let authorization = serde_json::json!({
        "explicitUserAction": false,
        "approvalCeiling": {},
        "budget": {
            "maxToolCalls": settings.max_tool_calls,
            "maxRuntimeSeconds": settings.max_runtime_seconds,
            "maxTotalTokens": settings.max_total_tokens,
        }
    });
    sqlx::query(
        r#"INSERT INTO agent_runs
             (id, session_id, agent_profile, trigger_type, trigger_ref,
              project_id, objective, prompt_version, authorization_context)
           VALUES ($1, $2, $3, 'wake', $4, $5, $6, $7, $8)"#,
    )
    .bind(run_id)
    .bind(session_id)
    .bind(&candidate.agent_profile)
    .bind(candidate.id.to_string())
    .bind(candidate.project_id)
    .bind(objective)
    .bind(PROMPT_VERSION)
    .bind(authorization)
    .execute(&mut *tx)
    .await?;
    let prompt = format!(
        "Perform a read-only proactive review of this approved candidate.\nReason: {}\nInspect live state, explain whether action is still needed, and return a concise proposal. Do not mutate workspace data or start external processes.",
        redact_sensitive_text(&candidate.reason)
    );
    sqlx::query(
        r#"INSERT INTO session_run_inputs
             (session_id, client_request_id, target_run_id, kind, content, options)
           VALUES ($1, $2, $3, 'wake', $4, $5)"#,
    )
    .bind(session_id)
    .bind(format!("wake:{}", candidate.id))
    .bind(run_id)
    .bind(prompt)
    .bind(serde_json::json!({ "candidateId": candidate.id }))
    .execute(&mut *tx)
    .await?;
    if let Some(task_id) = candidate.task_id {
        let (title, project_id) = sqlx::query_as::<_, (String, Option<Uuid>)>(
            "SELECT title, project_id FROM tasks WHERE id = $1",
        )
        .bind(task_id)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            r#"INSERT INTO run_task_links
                 (run_id, task_id, task_identity, link_kind, operation,
                  title_snapshot, project_id_snapshot)
               VALUES ($1, $2, $2, 'reference', 'proactive_review', $3, $4)
               ON CONFLICT DO NOTHING"#,
        )
        .bind(run_id)
        .bind(task_id)
        .bind(title)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
    }
    let updated = sqlx::query_as::<_, CandidateRow>(
        r#"UPDATE proactive_candidates
           SET status = 'spawned', run_id = $2, resolved_at = now()
           WHERE id = $1
           RETURNING id, agent_profile, project_id, task_id, kind, reason,
                     score, status, run_id, cooldown_until, discovered_at"#,
    )
    .bind(id)
    .bind(run_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    state.agent_run_notify.notify_waiters();
    Ok(candidate_view(updated))
}

pub async fn ignore_candidate(state: &AppState, id: Uuid) -> AppResult<ProactiveCandidate> {
    let row = sqlx::query_as::<_, CandidateRow>(
        r#"UPDATE proactive_candidates c
           SET status = 'ignored', resolved_at = now(),
               cooldown_until = now() + make_interval(hours => s.cooldown_hours)
           FROM proactive_settings s
           WHERE c.id = $1 AND c.agent_profile = s.agent_profile
             AND c.status = 'discovered'
           RETURNING c.id, c.agent_profile, c.project_id, c.task_id, c.kind,
                     c.reason, c.score, c.status, c.run_id, c.cooldown_until,
                     c.discovered_at"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Conflict("candidate is no longer discoverable".to_string()))?;
    Ok(candidate_view(row))
}

pub async fn discover_candidates(state: &AppState) -> AppResult<usize> {
    let settings = sqlx::query_as::<_, SettingsRow>(
        r#"SELECT agent_profile, enabled, quiet_start_hour, quiet_end_hour,
                  daily_run_budget, max_tool_calls, max_runtime_seconds, max_total_tokens,
                  cooldown_hours, idle_fallback_days
           FROM proactive_settings WHERE enabled"#,
    )
    .fetch_all(&state.db)
    .await?;
    let mut discovered = 0_usize;
    for setting in settings {
        if in_quiet_hours(&setting, Utc::now().hour() as i16) {
            continue;
        }
        let mut profile_discovered = 0_usize;
        let tasks = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, DateTime<Utc>)>(
            r#"SELECT t.id, t.project_id, t.title, t.due_date
               FROM tasks t
               INNER JOIN task_statuses ts ON ts.slug = t.status
               WHERE t.deleted_at IS NULL AND NOT ts.is_done
                 AND t.due_date < now()
                 AND NOT EXISTS (
                   SELECT 1 FROM run_task_links rtl
                   INNER JOIN agent_runs r ON r.id = rtl.run_id
                   WHERE rtl.task_identity = t.id
                     AND r.status IN ('queued', 'running', 'waiting_decision')
                 )
               ORDER BY t.due_date ASC LIMIT 20"#,
        )
        .fetch_all(&state.db)
        .await?;
        for (task_id, project_id, title, due_date) in tasks {
            let reason = format!(
                "Overdue task requires review: {} (due {})",
                redact_sensitive_text(&title),
                due_date.to_rfc3339()
            );
            let fingerprint = fingerprint(&format!("overdue_task:{task_id}"));
            profile_discovered += insert_candidate(
                state,
                CandidateInput {
                    profile: &setting.agent_profile,
                    project_id,
                    task_id: Some(task_id),
                    fingerprint: &fingerprint,
                    kind: "overdue_task",
                    reason: &reason,
                    score: 100.0,
                },
            )
            .await? as usize;
        }
        discovered += profile_discovered;
        if profile_discovered == 0 {
            let (last_activity, agent_created_at) =
                sqlx::query_as::<_, (Option<DateTime<Utc>>, DateTime<Utc>)>(
                    r#"SELECT MAX(m.occurred_at), a.created_at
                       FROM native_agents a
                       LEFT JOIN meaningful_activity m ON m.agent_profile = a.profile
                       WHERE a.profile = $1
                       GROUP BY a.created_at"#,
                )
                .bind(&setting.agent_profile)
                .fetch_one(&state.db)
                .await?;
            let activity_boundary = last_activity.unwrap_or(agent_created_at);
            let idle = Utc::now() - activity_boundary
                >= chrono::Duration::days(i64::from(setting.idle_fallback_days));
            if idle {
                let bucket = Utc::now().format("%G-W%V");
                let idle_fingerprint = fingerprint(&format!("idle_review:{bucket}"));
                discovered += insert_candidate(state, CandidateInput {
                    profile: &setting.agent_profile,
                    project_id: None,
                    task_id: None,
                    fingerprint: &idle_fingerprint,
                    kind: "idle_review",
                    reason: "No meaningful agent activity was recorded during the configured idle window.",
                    score: 10.0,
                })
                .await? as usize;
            }
        }
    }
    Ok(discovered)
}

pub async fn record_activity(
    state: &AppState,
    agent_profile: Option<&str>,
    project_id: Option<Uuid>,
    activity_type: &str,
    source_id: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"INSERT INTO meaningful_activity
             (agent_profile, project_id, activity_type, source_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (activity_type, source_id) DO NOTHING"#,
    )
    .bind(agent_profile)
    .bind(project_id)
    .bind(activity_type)
    .bind(source_id)
    .execute(&state.db)
    .await?;
    Ok(())
}

async fn insert_candidate(state: &AppState, input: CandidateInput<'_>) -> AppResult<u64> {
    let result = sqlx::query(
        r#"INSERT INTO proactive_candidates
             (agent_profile, project_id, task_id, fingerprint, kind, reason, score)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (agent_profile, fingerprint) DO UPDATE
             SET status = 'discovered', reason = EXCLUDED.reason,
                 score = EXCLUDED.score, discovered_at = now(), resolved_at = NULL
           WHERE proactive_candidates.status IN ('ignored', 'expired')
             AND proactive_candidates.cooldown_until <= now()"#,
    )
    .bind(input.profile)
    .bind(input.project_id)
    .bind(input.task_id)
    .bind(input.fingerprint)
    .bind(input.kind)
    .bind(input.reason)
    .bind(input.score)
    .execute(&state.db)
    .await?;
    Ok(result.rows_affected())
}

async fn fetch_settings(state: &AppState, profile: &str) -> AppResult<SettingsRow> {
    sqlx::query_as::<_, SettingsRow>(
        r#"SELECT agent_profile, enabled, quiet_start_hour, quiet_end_hour,
                  daily_run_budget, max_tool_calls, max_runtime_seconds, max_total_tokens,
                  cooldown_hours, idle_fallback_days
           FROM proactive_settings WHERE agent_profile = $1"#,
    )
    .bind(profile)
    .fetch_one(&state.db)
    .await
    .map_err(Into::into)
}

async fn ensure_agent(state: &AppState, profile: &str) -> AppResult<()> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM native_agents WHERE profile = $1)",
    )
    .bind(profile)
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(AppError::NotFound(format!("agent {profile} not found")));
    }
    Ok(())
}

fn validate_settings(request: &UpdateProactiveSettings) -> AppResult<()> {
    if request
        .quiet_start_hour
        .is_some_and(|value| !(0..=23).contains(&value))
        || request
            .quiet_end_hour
            .is_some_and(|value| !(0..=23).contains(&value))
    {
        return Err(AppError::BadRequest(
            "quiet hours must be between 0 and 23".to_string(),
        ));
    }
    if request
        .daily_run_budget
        .is_some_and(|value| !(0..=100).contains(&value))
        || request
            .max_tool_calls
            .is_some_and(|value| !(1..=500).contains(&value))
        || request
            .max_runtime_seconds
            .is_some_and(|value| !(10..=3_600).contains(&value))
        || request
            .max_total_tokens
            .is_some_and(|value| !(1_000..=1_000_000).contains(&value))
        || request
            .cooldown_hours
            .is_some_and(|value| !(1..=720).contains(&value))
        || request
            .idle_fallback_days
            .is_some_and(|value| !(1..=365).contains(&value))
    {
        return Err(AppError::BadRequest(
            "proactive budgets and cooldowns are outside their valid range".to_string(),
        ));
    }
    Ok(())
}

fn in_quiet_hours(settings: &SettingsRow, hour: i16) -> bool {
    if settings.quiet_start_hour == settings.quiet_end_hour {
        return false;
    }
    if settings.quiet_start_hour < settings.quiet_end_hour {
        (settings.quiet_start_hour..settings.quiet_end_hour).contains(&hour)
    } else {
        hour >= settings.quiet_start_hour || hour < settings.quiet_end_hour
    }
}

fn fingerprint(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

fn settings_view(row: SettingsRow) -> ProactiveSettings {
    ProactiveSettings {
        agent_profile: row.agent_profile,
        enabled: row.enabled,
        quiet_start_hour: row.quiet_start_hour,
        quiet_end_hour: row.quiet_end_hour,
        daily_run_budget: row.daily_run_budget,
        max_tool_calls: row.max_tool_calls,
        max_runtime_seconds: row.max_runtime_seconds,
        max_total_tokens: row.max_total_tokens,
        cooldown_hours: row.cooldown_hours,
        idle_fallback_days: row.idle_fallback_days,
    }
}

fn candidate_view(row: CandidateRow) -> ProactiveCandidate {
    ProactiveCandidate {
        id: row.id.to_string(),
        agent_profile: row.agent_profile,
        project_id: row.project_id.map(|id| id.to_string()),
        task_id: row.task_id.map(|id| id.to_string()),
        kind: row.kind,
        reason: row.reason,
        score: row.score,
        status: row.status,
        run_id: row.run_id.map(|id| id.to_string()),
        cooldown_until: row.cooldown_until.map(|value| value.to_rfc3339()),
        discovered_at: row.discovered_at.to_rfc3339(),
    }
}

fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}
