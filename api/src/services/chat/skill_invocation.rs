use std::io;

use uuid::Uuid;

use crate::agent::skills::{BundleRegistry, SkillRegistry};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub(super) async fn resolve_skill_invocation(
    state: &AppState,
    text: &str,
    session_id: Uuid,
) -> AppResult<String> {
    let Some((slash_name, user_instruction)) = split_slash_invocation(text) else {
        return Ok(text.to_string());
    };
    let skills = SkillRegistry::new(state.config.agent_data_dir.join("skills"));
    let bundles = BundleRegistry::new(
        state.config.agent_data_dir.join("skill-bundles"),
        skills.clone(),
    );
    let config = crate::services::skills::load_config(state)?;
    let session_id = session_id.to_string();

    if let Some(bundle) = bundles
        .resolve(slash_name)
        .map_err(|err| map_skill_io("skill bundle resolve failed", err))?
    {
        return bundles
            .build_invocation_message(&bundle, user_instruction, &session_id, &config)
            .await
            .map_err(|err| map_skill_io("skill bundle invocation failed", err));
    }

    if let Some(skill) = skills
        .resolve_slash(slash_name)
        .map_err(|err| map_skill_io("skill resolve failed", err))?
    {
        return skills
            .build_invocation_message(&skill.name, user_instruction, &session_id, &config)
            .await
            .map_err(|err| map_skill_io("skill invocation failed", err));
    }

    Ok(text.to_string())
}

fn split_slash_invocation(text: &str) -> Option<(&str, &str)> {
    let rest = text.trim().strip_prefix('/')?.trim_start();
    if rest.is_empty() {
        return None;
    }
    let command_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let slash_name = &rest[..command_end];
    if slash_name.is_empty() {
        return None;
    }
    Some((slash_name, rest[command_end..].trim_start()))
}

fn map_skill_io(context: &str, err: io::Error) -> AppError {
    let message = format!("{context}: {err}");
    match err.kind() {
        io::ErrorKind::AlreadyExists
        | io::ErrorKind::InvalidData
        | io::ErrorKind::InvalidInput
        | io::ErrorKind::PermissionDenied => AppError::BadRequest(message),
        io::ErrorKind::NotFound => AppError::NotFound(message),
        _ => AppError::Internal(message),
    }
}
