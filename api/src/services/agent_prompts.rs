//! Native agent prompt file service.
//!
//! The UI is allowed to edit only the two prompt files that participate in
//! native prompt assembly: the selected profile's `AGENTS.md` operating guide
//! and `SOUL.md` identity file. Both live in the agent's Drive workspace so the
//! same files are visible in Drive, editable from the prompt menu, and mounted
//! into the sandbox runtime without exposing host-local repository files.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::content_security::ContentOrigin;
use crate::services::agents;
use crate::services::drive;
use crate::services::file_observations::fingerprint_path;
use crate::services::workspace_content::{AdmissionActor, AdmissionOutcome, AdmissionRequest};
use crate::state::AppState;

const MAX_PROMPT_FILE_BYTES: usize = 200_000;

#[derive(Debug, Deserialize)]
pub struct AgentPromptQuery {
    #[serde(default)]
    pub profile: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptsResponse {
    pub profile: String,
    pub agents_md: PromptFile,
    pub soul_md: PromptFile,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptFile {
    pub path: String,
    pub exists: bool,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentPromptsRequest {
    #[serde(default)]
    pub agents_md: Option<String>,
    #[serde(default)]
    pub soul_md: Option<String>,
}

pub async fn get_prompts(
    state: &AppState,
    query: AgentPromptQuery,
) -> AppResult<AgentPromptsResponse> {
    let profile = normalize_profile(query.profile)?;
    let agent = registered_agent(state, &profile).await?;
    drive::ensure_agent_workspace(state, &profile, &agent.name, Some(&agent.role)).await?;
    let agents_path = agents_md_path(&state.config.agent_data_dir, &profile)?;
    let soul_path = soul_md_path(&state.config.agent_data_dir, &profile)?;
    Ok(AgentPromptsResponse {
        profile: profile.clone(),
        agents_md: read_prompt_file(
            &agents_path,
            &drive::logical_agent_file_path(&profile, drive::AGENTS_MD_FILE),
        )?,
        soul_md: read_prompt_file(
            &soul_path,
            &drive::logical_agent_file_path(&profile, drive::SOUL_MD_FILE),
        )?,
    })
}

pub async fn update_prompts(
    state: &AppState,
    query: AgentPromptQuery,
    req: UpdateAgentPromptsRequest,
) -> AppResult<AgentPromptsResponse> {
    let profile = normalize_profile(query.profile)?;
    let agent = registered_agent(state, &profile).await?;
    drive::ensure_agent_workspace(state, &profile, &agent.name, Some(&agent.role)).await?;
    if let Some(content) = req.agents_md {
        write_prompt_file(
            state,
            &profile,
            drive::AGENTS_MD_FILE,
            &agents_md_path(&state.config.agent_data_dir, &profile)?,
            &content,
        )
        .await?;
    }
    if let Some(content) = req.soul_md {
        write_prompt_file(
            state,
            &profile,
            drive::SOUL_MD_FILE,
            &soul_md_path(&state.config.agent_data_dir, &profile)?,
            &content,
        )
        .await?;
    }
    get_prompts(
        state,
        AgentPromptQuery {
            profile: Some(profile),
        },
    )
    .await
}

pub fn soul_md_path(agent_data_dir: &Path, profile: &str) -> AppResult<PathBuf> {
    let profile = normalize_profile(Some(profile.to_string()))?;
    Ok(drive::agent_soul_md_path(agent_data_dir, &profile))
}

pub fn agents_md_path(agent_data_dir: &Path, profile: &str) -> AppResult<PathBuf> {
    let profile = normalize_profile(Some(profile.to_string()))?;
    Ok(drive::agent_agents_md_path(agent_data_dir, &profile))
}

fn normalize_profile(profile: Option<String>) -> AppResult<String> {
    let Some(value) = profile else {
        return Err(AppError::BadRequest(
            "agent profile is required".to_string(),
        ));
    };
    agents::normalize_agent_profile(value.trim())
}

struct RegisteredAgent {
    name: String,
    role: String,
}

async fn registered_agent(state: &AppState, profile: &str) -> AppResult<RegisteredAgent> {
    let row = sqlx::query!(
        r#"SELECT name, role FROM native_agents WHERE profile = $1"#,
        profile
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent profile {profile} not found")))?;
    Ok(RegisteredAgent {
        name: row.name,
        role: row.role,
    })
}

fn read_prompt_file(path: &Path, display_path: &str) -> AppResult<PromptFile> {
    match fs::metadata(path) {
        Ok(metadata) => {
            let updated_at = metadata
                .modified()
                .ok()
                .map(DateTime::<Utc>::from)
                .map(|dt| dt.to_rfc3339());
            let content = fs::read_to_string(path)
                .map_err(|err| map_io("prompt file read failed", path, err))?;
            Ok(PromptFile {
                path: display_path.to_string(),
                exists: true,
                content,
                updated_at,
            })
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(PromptFile {
            path: display_path.to_string(),
            exists: false,
            content: String::new(),
            updated_at: None,
        }),
        Err(err) => Err(map_io("prompt file metadata failed", path, err)),
    }
}

async fn write_prompt_file(
    state: &AppState,
    profile: &str,
    file_name: &str,
    path: &Path,
    content: &str,
) -> AppResult<()> {
    if content.len() > MAX_PROMPT_FILE_BYTES {
        return Err(AppError::BadRequest(format!(
            "prompt file exceeds {MAX_PROMPT_FILE_BYTES} bytes"
        )));
    }
    let expected_fingerprint = if path.is_file() {
        Some(
            fingerprint_path(path)
                .await
                .map_err(|error| AppError::Internal(format!("prompt fingerprint failed: {error}")))?
                .hash,
        )
    } else {
        None
    };
    let outcome = state
        .workspace_content
        .admit_bytes(
            state,
            AdmissionRequest {
                desired_path: drive::logical_agent_file_path(profile, file_name),
                file_name: file_name.to_string(),
                origin: ContentOrigin::UserEdit,
                actor: AdmissionActor::user(),
                expected_fingerprint,
                allow_overwrite: true,
                enqueue_s3_sync: true,
            },
            content.as_bytes(),
        )
        .await?;
    match outcome {
        AdmissionOutcome::Committed { .. } => Ok(()),
        AdmissionOutcome::Quarantined { .. } => Err(AppError::content_quarantined()),
        AdmissionOutcome::Rejected => Err(AppError::content_rejected()),
    }
}

fn map_io(context: &str, path: &Path, err: std::io::Error) -> AppError {
    AppError::Internal(format!("{context}: {}: {err}", path.display()))
}
