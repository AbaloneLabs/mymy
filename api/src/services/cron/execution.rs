use std::collections::HashMap;
use std::time::Duration as StdDuration;

use futures::StreamExt;
use tokio::process::Command;
use uuid::Uuid;

use crate::agent::loop_engine::AgentEvent;
use crate::agent::scheduler::{CronJob, JobMode};
use crate::agent::security::{detect_dangerous_command, redact_terminal_output};
use crate::error::{AppError, AppResult};
use crate::models::chat::{CreateSessionRequest, SendMessageRequest};
use crate::services::chat as chat_service;
use crate::state::AppState;

use super::prompts::{build_agent_job_prompt, truncate_chars};

const NO_AGENT_TIMEOUT_SECS: u64 = 300;
const MAX_RESULT_CHARS: usize = 50_000;

pub(super) async fn execute_job(state: &AppState, job: &CronJob) -> AppResult<String> {
    match job.mode {
        JobMode::Agent => execute_agent_job(state, job).await,
        JobMode::NoAgent => execute_no_agent_job(job).await,
    }
}

async fn execute_agent_job(state: &AppState, job: &CronJob) -> AppResult<String> {
    let profile = crate::services::agents::first_agent_profile(state)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest("cannot run agent job without a configured agent".to_string())
        })?;
    let session = chat_service::create_session(
        state,
        CreateSessionRequest {
            project_id: None,
            profile: Some(profile),
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

fn scrubbed_env() -> HashMap<String, String> {
    let mut env = HashMap::new();
    for key in ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }
    env
}
