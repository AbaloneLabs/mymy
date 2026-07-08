use crate::agent::scheduler::CronJob;
use crate::agent::skills::{SkillRegistry, SkillUsageEvent};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::validation::{
    ensure_assembled_cron_prompt_safe, validate_context_refs, validate_skill_names,
};

pub(super) async fn build_agent_job_prompt(state: &AppState, job: &CronJob) -> AppResult<String> {
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

pub(super) fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated.push_str("\n[truncated]");
    truncated
}
