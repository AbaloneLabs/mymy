use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::drive::{DriveProviderKind, DriveProviderStatus, DriveProvidersResponse};
use crate::state::AppState;

use super::paths::{
    agent_workspace_path, agents_root, canonical_workspace_roots, drive_root,
    project_workspace_path, projects_root, shared_root, AGENTS_MD_FILE, SOUL_MD_FILE,
};

#[derive(Debug, Clone)]
pub struct AgentDriveWorkspace {
    pub agent_profile: String,
    pub project_id: Option<Uuid>,
    pub working_dir: PathBuf,
    pub allowed_roots: Vec<PathBuf>,
}

pub fn ensure_drive_root(state: &AppState) -> AppResult<()> {
    for path in [
        drive_root(&state.config.agent_data_dir),
        agents_root(&state.config.agent_data_dir),
        projects_root(&state.config.agent_data_dir),
        shared_root(&state.config.agent_data_dir),
        drive_root(&state.config.agent_data_dir).join(".trash"),
    ] {
        fs::create_dir_all(&path)?;
    }
    Ok(())
}

pub fn provider_status(state: &AppState) -> DriveProvidersResponse {
    DriveProvidersResponse {
        providers: vec![
            DriveProviderStatus {
                provider: DriveProviderKind::LocalVm,
                configured: true,
                writable: drive_root(&state.config.agent_data_dir).exists(),
                bucket: None,
                region: None,
                endpoint: None,
            },
            DriveProviderStatus {
                provider: DriveProviderKind::S3,
                configured: state.config.drive_s3_bucket.is_some(),
                writable: state.config.drive_s3_bucket.is_some(),
                bucket: state.config.drive_s3_bucket.clone(),
                region: state.config.drive_s3_region.clone(),
                endpoint: state.config.drive_s3_endpoint.clone(),
            },
        ],
    }
}

pub fn project_drive_slug(name: &str, id: Uuid) -> String {
    let slug = name
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let prefix = if slug.is_empty() { "project" } else { &slug };
    let id_suffix = id.simple().to_string();
    format!("{prefix}-{}", &id_suffix[..8])
}

pub fn ensure_agent_workspace(
    state: &AppState,
    profile: &str,
    display_name: &str,
    role: Option<&str>,
) -> AppResult<()> {
    ensure_drive_root(state)?;
    let workspace = agent_workspace_path(&state.config.agent_data_dir, profile);
    fs::create_dir_all(&workspace)?;

    let agents_path = workspace.join(AGENTS_MD_FILE);
    if !agents_path.exists() {
        fs::write(
            &agents_path,
            default_agents_md(profile, display_name, role.unwrap_or("agent")),
        )?;
    }

    let soul_path = workspace.join(SOUL_MD_FILE);
    if !soul_path.exists() {
        fs::write(
            &soul_path,
            default_soul_md(profile, display_name, role.unwrap_or("agent")),
        )?;
    }

    Ok(())
}

pub fn ensure_project_workspace(state: &AppState, drive_slug: &str) -> AppResult<()> {
    ensure_drive_root(state)?;
    fs::create_dir_all(project_workspace_path(
        &state.config.agent_data_dir,
        drive_slug,
    ))?;
    Ok(())
}

pub async fn resolve_agent_drive_workspace(
    state: &AppState,
    profile: &str,
    project_id: Option<Uuid>,
) -> AppResult<AgentDriveWorkspace> {
    let agent = sqlx::query!(
        "SELECT name, role FROM native_agents WHERE profile = $1",
        profile
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent {profile} not found")))?;

    ensure_agent_workspace(state, profile, &agent.name, Some(&agent.role))?;
    let working_dir = agent_workspace_path(&state.config.agent_data_dir, profile);
    let mut allowed_roots = vec![shared_root(&state.config.agent_data_dir)];

    if let Some(project_id) = project_id {
        let project = sqlx::query!("SELECT drive_slug FROM projects WHERE id = $1", project_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
        ensure_project_workspace(state, &project.drive_slug)?;
        allowed_roots.push(project_workspace_path(
            &state.config.agent_data_dir,
            &project.drive_slug,
        ));
    }

    allowed_roots.push(working_dir.clone());
    Ok(AgentDriveWorkspace {
        agent_profile: profile.to_string(),
        project_id,
        working_dir: working_dir.canonicalize()?,
        allowed_roots: canonical_workspace_roots(allowed_roots)?,
    })
}

pub fn archive_agent_workspace(state: &AppState, profile: &str) -> AppResult<()> {
    let source = agent_workspace_path(&state.config.agent_data_dir, profile);
    if !source.exists() {
        return Ok(());
    }
    ensure_drive_root(state)?;
    let stamp = Utc::now().format("%Y%m%d%H%M%S");
    let target = drive_root(&state.config.agent_data_dir)
        .join(".trash")
        .join("agents")
        .join(format!("{profile}-{stamp}"));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(source, target)?;
    Ok(())
}

fn default_agents_md(profile: &str, display_name: &str, role: &str) -> String {
    format!(
        r#"# Agent Operating Guide

You are {display_name} (`{profile}`), a mymy sandboxed agent.

## Workspace Boundaries

- Treat this directory as your private local workspace.
- Use `/drive/shared` for files that must be visible to other agents.
- Use `/drive/projects/<project>` for project files when a project is assigned.
- Do not attempt to inspect or modify another agent's private workspace.

## Execution

- Prefer small, verifiable changes.
- Keep generated files inside the Drive roots that are explicitly available to you.
- When running a development server, bind to `0.0.0.0` and report the port so mymy can expose a preview endpoint.

## Role

{role}
"#
    )
}

fn default_soul_md(profile: &str, display_name: &str, role: &str) -> String {
    format!(
        r#"# SOUL

Name: {display_name}
Profile: {profile}
Role: {role}

Operate as a careful, self-auditing agent. Preserve user data, keep work inside
the assigned Drive workspace, and explain meaningful risks before taking action.
"#
    )
}
