//! Native agents service.
//!
//! Agents are first-class mymy records so users can create and remove agents
//! from the web UI without depending on external profile files.

use std::fs;

use chrono::{DateTime, Utc};
use sqlx::FromRow;

use crate::error::{AppError, AppResult};
use crate::models::agent::{
    Agent, AgentModel, AgentResponse, AgentSource, AgentStatus, AgentsResponse, CreateAgentRequest,
    DeleteAgentResponse, SandboxStatus, UpdateAgentRequest,
};
use crate::services::{agent_permissions, drive};
use crate::state::AppState;

const MAX_AGENT_NAME_CHARS: usize = 80;
const MAX_AGENT_ROLE_CHARS: usize = 120;
const MAX_AGENT_DESCRIPTION_CHARS: usize = 2_000;

#[derive(Debug, FromRow)]
struct NativeAgentRow {
    profile: String,
    name: String,
    role: String,
    description: Option<String>,
    status: String,
    model: String,
    drive_path: String,
    sandbox_uid: Option<i32>,
    sandbox_status: String,
    last_active_at: Option<DateTime<Utc>>,
}

pub async fn list_agents(state: &AppState) -> AppResult<AgentsResponse> {
    let mut rows = sqlx::query_as::<_, NativeAgentRow>(
        r#"SELECT a.profile, a.name, a.role, a.description, a.status, a.model,
                  a.drive_path, a.sandbox_uid, a.sandbox_status,
                  MAX(s.updated_at) AS last_active_at
           FROM native_agents a
           LEFT JOIN chat_sessions s ON s.profile = a.profile
           GROUP BY a.profile, a.name, a.role, a.description, a.status, a.model,
                    a.drive_path, a.sandbox_uid, a.sandbox_status
           ORDER BY lower(a.name), a.profile"#,
    )
    .fetch_all(&state.db)
    .await?;

    for row in &mut rows {
        if let Err(err) =
            drive::ensure_agent_workspace(state, &row.profile, &row.name, Some(&row.role))
        {
            tracing::warn!(
                profile = %row.profile,
                error = %err,
                "failed to reconcile agent drive workspace"
            );
        } else if row.sandbox_status != "ready" {
            if let Err(err) =
                sqlx::query("UPDATE native_agents SET sandbox_status = 'ready' WHERE profile = $1")
                    .bind(&row.profile)
                    .execute(&state.db)
                    .await
            {
                tracing::warn!(
                    profile = %row.profile,
                    error = %err,
                    "failed to mark agent sandbox ready"
                );
            } else {
                row.sandbox_status = "ready".to_string();
            }
        }
    }

    let mut agents = Vec::new();
    for row in rows {
        let permissions = agent_permissions::list_permissions(state, &row.profile).await?;
        agents.push(row_to_agent(row, permissions));
    }

    Ok(AgentsResponse { agents })
}

pub async fn create_agent(state: &AppState, req: CreateAgentRequest) -> AppResult<AgentResponse> {
    let name = validate_text(req.name, "agent name", MAX_AGENT_NAME_CHARS)?;
    let role = match req.role {
        Some(value) => validate_text(value, "agent role", MAX_AGENT_ROLE_CHARS)?,
        None => "Agent".to_string(),
    };
    let description = match req.description {
        Some(value) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else if trimmed.chars().count() > MAX_AGENT_DESCRIPTION_CHARS {
                return Err(AppError::BadRequest(format!(
                    "agent description must be at most {MAX_AGENT_DESCRIPTION_CHARS} characters"
                )));
            } else {
                Some(trimmed)
            }
        }
        None => None,
    };
    let profile = match req.profile {
        Some(value) if !value.trim().is_empty() => normalize_agent_profile(value.trim())?,
        _ => next_available_profile(state, &slugify_profile(&name)?).await?,
    };

    let drive_path = drive::logical_agent_path(&profile);
    let row = sqlx::query_as::<_, NativeAgentRow>(
        r#"INSERT INTO native_agents
             (profile, name, role, description, status, model, drive_path, sandbox_status)
           VALUES ($1, $2, $3, $4, 'idle', 'unknown', $5, 'ready')
           RETURNING profile, name, role, description, status, model,
                     drive_path, sandbox_uid, sandbox_status,
                     NULL::timestamptz AS last_active_at"#,
    )
    .bind(&profile)
    .bind(&name)
    .bind(&role)
    .bind(&description)
    .bind(&drive_path)
    .fetch_one(&state.db)
    .await
    .map_err(|err| match err {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::BadRequest(format!("agent profile {profile} already exists"))
        }
        other => AppError::Database(other),
    })?;

    drive::ensure_agent_workspace(state, &profile, &name, Some(&role))?;
    agent_permissions::ensure_defaults(state, &profile).await?;
    let permissions = agent_permissions::list_permissions(state, &profile).await?;

    Ok(AgentResponse {
        agent: row_to_agent(row, permissions),
    })
}

pub async fn update_agent(
    state: &AppState,
    profile: &str,
    req: UpdateAgentRequest,
) -> AppResult<AgentResponse> {
    let profile = normalize_agent_profile(profile)?;
    let existing = sqlx::query_as::<_, NativeAgentRow>(
        r#"SELECT profile, name, role, description, status, model,
                  drive_path, sandbox_uid, sandbox_status,
                  NULL::timestamptz AS last_active_at
           FROM native_agents
           WHERE profile = $1"#,
    )
    .bind(&profile)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent {profile} not found")))?;

    let name = match req.name {
        Some(value) => validate_text(value, "agent name", MAX_AGENT_NAME_CHARS)?,
        None => existing.name,
    };
    let role = match req.role {
        Some(value) => validate_text(value, "agent role", MAX_AGENT_ROLE_CHARS)?,
        None => existing.role,
    };
    let description = match req.description {
        Some(value) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else if trimmed.chars().count() > MAX_AGENT_DESCRIPTION_CHARS {
                return Err(AppError::BadRequest(format!(
                    "agent description must be at most {MAX_AGENT_DESCRIPTION_CHARS} characters"
                )));
            } else {
                Some(trimmed)
            }
        }
        None => existing.description,
    };

    let row = sqlx::query_as::<_, NativeAgentRow>(
        r#"UPDATE native_agents
           SET name = $2, role = $3, description = $4, updated_at = now()
           WHERE profile = $1
           RETURNING profile, name, role, description, status, model,
                     drive_path, sandbox_uid, sandbox_status,
                     NULL::timestamptz AS last_active_at"#,
    )
    .bind(&profile)
    .bind(&name)
    .bind(&role)
    .bind(&description)
    .fetch_one(&state.db)
    .await?;

    drive::ensure_agent_workspace(state, &profile, &name, Some(&role))?;
    let permissions = if let Some(permissions) = req.tool_permissions {
        agent_permissions::replace_permissions(state, &profile, permissions).await?
    } else {
        agent_permissions::list_permissions(state, &profile).await?
    };

    Ok(AgentResponse {
        agent: row_to_agent(row, permissions),
    })
}

pub async fn delete_agent(state: &AppState, profile: &str) -> AppResult<DeleteAgentResponse> {
    let profile = normalize_agent_profile(profile)?;
    let result = sqlx::query("DELETE FROM native_agents WHERE profile = $1")
        .bind(&profile)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("agent {profile} not found")));
    }

    match drive::archive_agent_workspace(state, &profile).await {
        Ok(()) => {}
        Err(err) => {
            tracing::warn!(
                profile = %profile,
                error = %err,
                "failed to archive deleted agent workspace"
            );
        }
    }

    let prompt_dir = state.config.agent_data_dir.join("prompts").join(&profile);
    match fs::remove_dir_all(&prompt_dir) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            tracing::warn!(
                profile = %profile,
                path = %prompt_dir.display(),
                error = %err,
                "failed to remove legacy deleted agent prompt directory"
            );
        }
    }

    Ok(DeleteAgentResponse { success: true })
}

pub async fn first_agent_profile(state: &AppState) -> AppResult<Option<String>> {
    let row = sqlx::query_scalar::<_, String>(
        r#"SELECT profile FROM native_agents ORDER BY lower(name), profile LIMIT 1"#,
    )
    .fetch_optional(&state.db)
    .await?;
    Ok(row)
}

fn row_to_agent(
    row: NativeAgentRow,
    tool_permissions: Vec<crate::models::agent::AgentToolPermission>,
) -> Agent {
    Agent {
        id: row.profile.clone(),
        profile: row.profile,
        name: row.name,
        role: row.role,
        description: row.description,
        status: parse_status(&row.status),
        source: AgentSource::Native,
        model: parse_model(&row.model),
        avatar_url: None,
        profile_path: None,
        drive_path: row.drive_path,
        sandbox_uid: row.sandbox_uid,
        sandbox_status: parse_sandbox_status(&row.sandbox_status),
        last_active_at: row.last_active_at.map(|dt| dt.to_rfc3339()),
        tool_permissions,
    }
}

fn validate_text(value: String, label: &str, max_chars: usize) -> AppResult<String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(format!("{label} cannot be empty")));
    }
    if trimmed.chars().count() > max_chars {
        return Err(AppError::BadRequest(format!(
            "{label} must be at most {max_chars} characters"
        )));
    }
    Ok(trimmed)
}

pub fn normalize_agent_profile(value: &str) -> AppResult<String> {
    let profile = value.trim().to_ascii_lowercase();
    if profile == "default" {
        return Err(AppError::BadRequest(
            "default is reserved and cannot be used as an agent profile".to_string(),
        ));
    }
    if profile.is_empty()
        || !profile
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(AppError::BadRequest(
            "agent profile may contain only letters, numbers, dash, underscore, or dot".to_string(),
        ));
    }
    Ok(profile)
}

fn slugify_profile(name: &str) -> AppResult<String> {
    let mut out = String::new();
    let mut previous_dash = false;
    for ch in name.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            previous_dash = false;
        } else if !previous_dash {
            out.push('-');
            previous_dash = true;
        }
    }
    let slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        return Ok("agent".to_string());
    }
    normalize_agent_profile(&slug)
}

async fn next_available_profile(state: &AppState, base: &str) -> AppResult<String> {
    let base = normalize_agent_profile(base)?;
    for suffix in 0..100 {
        let candidate = if suffix == 0 {
            base.clone()
        } else {
            format!("{base}-{}", suffix + 1)
        };
        let exists =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM native_agents WHERE profile = $1")
                .bind(&candidate)
                .fetch_one(&state.db)
                .await?;
        if exists == 0 {
            return Ok(candidate);
        }
    }
    Err(AppError::BadRequest(
        "could not generate an available agent profile".to_string(),
    ))
}

fn parse_status(value: &str) -> AgentStatus {
    match value {
        "active" => AgentStatus::Active,
        "offline" => AgentStatus::Offline,
        _ => AgentStatus::Idle,
    }
}

fn parse_model(value: &str) -> AgentModel {
    match value {
        "qwen" => AgentModel::Qwen,
        "openai" => AgentModel::Openai,
        "anthropic" => AgentModel::Anthropic,
        "local" => AgentModel::Local,
        _ => AgentModel::Unknown,
    }
}

fn parse_sandbox_status(value: &str) -> SandboxStatus {
    match value {
        "pending" => SandboxStatus::Pending,
        "reconciling" => SandboxStatus::Reconciling,
        "failed" => SandboxStatus::Failed,
        _ => SandboxStatus::Ready,
    }
}
