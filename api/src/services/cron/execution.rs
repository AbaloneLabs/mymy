use futures::StreamExt;
use uuid::Uuid;

use crate::agent::loop_engine::AgentEvent;
use crate::agent::scheduler::CronJob;
use crate::error::{AppError, AppResult};
use crate::models::chat::{CreateSessionRequest, SendMessageRequest};
use crate::services::chat as chat_service;
use crate::state::AppState;

use super::prompts::{build_agent_job_prompt, truncate_chars};

const MAX_RESULT_CHARS: usize = 50_000;

pub(super) async fn execute_job(state: &AppState, job: &CronJob) -> AppResult<String> {
    execute_agent_job(state, job).await
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
    let new_messages;
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
        new_messages = agent_loop.generated_messages();
    } else {
        return Err(AppError::Internal(
            "cron job unexpectedly prepared a MoA chat turn".into(),
        ));
    }
    chat_service::save_agent_messages(state, turn.session_id, &new_messages).await?;
    Ok(truncate_chars(&output, MAX_RESULT_CHARS))
}
