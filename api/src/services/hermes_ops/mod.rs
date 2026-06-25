//! Hermes operational data service.
//!
//! This module queries the Hermes CLI for read-only status information.
//! Hermes remains the source of truth; mymy does not persist this data.

mod cli;
mod files;
mod parsers;
mod types;

use std::path::Path;

use crate::models::agent_ops::{
    CronJob, CronStatus, EnvironmentInfo, GatewayStatus, MemoryInfo, SessionInfo, SkillInfo,
};

pub use cli::delete_session;
use cli::run_hermes_cli;
pub use files::query_identity;
use files::{parse_config_model, read_gateway_running, read_user_memory};
use parsers::{
    build_gateway_message, detect_gateway_running, parse_active_job_count, parse_cron_jobs,
    parse_environment, parse_memory_status, parse_next_run, parse_sessions, parse_skills,
    reconcile_cron_message,
};
pub use types::OpsError;

/// Query the cron job list via `hermes cron list`.
pub async fn query_cron_list(
    cli_path: &str,
    profile: Option<&str>,
) -> Result<Vec<CronJob>, OpsError> {
    let output = run_hermes_cli(cli_path, &["cron", "list"], profile).await?;
    if output.contains("No scheduled jobs") {
        return Ok(Vec::new());
    }
    parse_cron_jobs(&output)
}

/// Query cron scheduler status via `hermes cron status`.
pub async fn query_cron_status(
    cli_path: &str,
    profile_dir: Option<&str>,
    profile: Option<&str>,
) -> Result<CronStatus, OpsError> {
    let output = run_hermes_cli(cli_path, &["cron", "status"], profile).await?;

    let file_state = read_gateway_running(profile_dir);
    let running = file_state
        .unwrap_or_else(|| output.contains("✓") && output.to_lowercase().contains("running"));
    let active_jobs = parse_active_job_count(&output);
    let next_run = parse_next_run(&output);

    let mut message = output
        .lines()
        .find(|l| {
            let t = l.trim();
            !t.is_empty()
                && !t.starts_with("To enable")
                && !t.starts_with("hermes gateway")
                && !t.starts_with("sudo hermes")
        })
        .map(|l| l.trim().to_string());

    if file_state.is_some() {
        message = reconcile_cron_message(running, active_jobs, next_run.as_deref());
    }

    Ok(CronStatus {
        scheduler_running: running,
        active_jobs,
        next_run,
        message,
    })
}

/// Query gateway + model status via `hermes status` and config.yaml.
pub async fn query_gateway_status(
    cli_path: &str,
    profile_dir: Option<&str>,
    profile: Option<&str>,
) -> Result<GatewayStatus, OpsError> {
    let output = run_hermes_cli(cli_path, &["status"], profile).await?;

    let file_state = read_gateway_running(profile_dir);
    let running = file_state.unwrap_or_else(|| detect_gateway_running(&output));

    let (model, provider) = match profile_dir {
        Some(dir) => parse_config_model(Path::new(dir)),
        None => (None, None),
    };
    let message = build_gateway_message(running);

    Ok(GatewayStatus {
        running,
        model,
        provider,
        message,
    })
}

/// Query recent chat sessions via `hermes sessions list`.
pub async fn query_sessions(
    cli_path: &str,
    profile: Option<&str>,
) -> Result<Vec<SessionInfo>, OpsError> {
    let output = run_hermes_cli(cli_path, &["sessions", "list"], profile).await?;
    Ok(parse_sessions(&output))
}

/// Query installed skills via `hermes skills list`.
pub async fn query_skills(
    cli_path: &str,
    profile: Option<&str>,
) -> Result<Vec<SkillInfo>, OpsError> {
    let output = run_hermes_cli(cli_path, &["skills", "list"], profile).await?;
    Ok(parse_skills(&output))
}

/// Query memory provider status + built-in memory content.
pub async fn query_memory(
    cli_path: &str,
    profile_dir: Option<&str>,
    profile: Option<&str>,
) -> Result<MemoryInfo, OpsError> {
    let output = run_hermes_cli(cli_path, &["memory", "status"], profile).await?;
    let (provider, builtin_active, installed_plugins) = parse_memory_status(&output);
    let user_memory = read_user_memory(profile_dir);

    Ok(MemoryInfo {
        provider,
        builtin_active,
        installed_plugins,
        user_memory,
    })
}

/// Query the full Hermes environment status via `hermes status`.
pub async fn query_environment(
    cli_path: &str,
    profile: Option<&str>,
) -> Result<EnvironmentInfo, OpsError> {
    let output = run_hermes_cli(cli_path, &["status"], profile).await?;
    Ok(parse_environment(&output))
}
