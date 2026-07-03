//! Sandbox process orchestration.
//!
//! The API is the durable control plane for sandbox activity. It validates
//! agent/project ownership against the database, resolves Drive-backed
//! filesystem roots, delegates process execution to the out-of-process runner,
//! and stores enough metadata to render process/job history even if the runner
//! restarts and loses its volatile process table.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::sandbox::{
    SandboxProcessLogsResponse, SandboxProcessResponse, SandboxProcessesResponse, SandboxRuntime,
    SandboxRuntimeResponse, StartSandboxProcessRequest, StopSandboxProcessResponse,
};
use crate::services::agents;
use crate::services::drive;
use crate::services::sandbox_processes::{self, NewRunningProcess};
use crate::services::sandbox_runner::{
    logical_path_for_runner, roots_for_runner, RunnerClient, RunnerExecuteRequest,
    RunnerProcessSummary, RunnerStartProcessRequest,
};
use crate::state::AppState;

const MAX_COMMAND_CHARS: usize = 16_000;
const MAX_LABEL_CHARS: usize = 80;

pub async fn runtime_status(state: &AppState) -> AppResult<SandboxRuntimeResponse> {
    let Some(runner_url) = &state.config.sandbox_runner_url else {
        return Ok(SandboxRuntimeResponse {
            runtime: SandboxRuntime {
                configured: false,
                mode: "unconfigured".to_string(),
                ready: false,
                data_root: None,
                firecracker_configured: false,
                error: Some("sandbox runner is not configured".to_string()),
            },
        });
    };

    match RunnerClient::new(runner_url.clone()).status().await {
        Ok(status) => Ok(SandboxRuntimeResponse {
            runtime: SandboxRuntime {
                configured: true,
                mode: status.mode,
                ready: status.ready,
                data_root: Some(status.data_root),
                firecracker_configured: status.firecracker_configured,
                error: None,
            },
        }),
        Err(err) => Ok(SandboxRuntimeResponse {
            runtime: SandboxRuntime {
                configured: true,
                mode: "unavailable".to_string(),
                ready: false,
                data_root: None,
                firecracker_configured: false,
                error: Some(err.to_string()),
            },
        }),
    }
}

pub async fn list_processes(
    state: &AppState,
    agent_profile: Option<&str>,
    project_id: Option<&str>,
) -> AppResult<SandboxProcessesResponse> {
    reconcile_live_processes(state).await?;
    let project_id = parse_optional_uuid(project_id, "projectId")?;
    let profile = agent_profile
        .map(agents::normalize_agent_profile)
        .transpose()?;

    Ok(SandboxProcessesResponse {
        processes: sandbox_processes::list_processes(&state.db, profile.as_deref(), project_id)
            .await?,
    })
}

async fn reconcile_live_processes(state: &AppState) -> AppResult<()> {
    let Some(runner_url) = &state.config.sandbox_runner_url else {
        return Ok(());
    };
    let response = match RunnerClient::new(runner_url.clone()).list_processes().await {
        Ok(response) => response,
        Err(err) => {
            tracing::warn!(
                error = %err,
                "sandbox runner process list unavailable; skipping live reconciliation"
            );
            return Ok(());
        }
    };

    let mut live_ids = HashSet::new();
    for process in &response.processes {
        live_ids.insert(process.id);
        reconcile_process_summary(state, process).await?;
    }
    mark_missing_running_processes_failed(state, &live_ids).await?;
    Ok(())
}

async fn reconcile_process_summary(
    state: &AppState,
    process: &RunnerProcessSummary,
) -> AppResult<()> {
    sandbox_processes::reconcile_from_runner(
        &state.db,
        process.id,
        &process.status,
        process.pid.map(|value| value as i32),
        &process.command,
        &process.cwd,
        process.port,
    )
    .await
}

async fn mark_missing_running_processes_failed(
    state: &AppState,
    live_ids: &HashSet<Uuid>,
) -> AppResult<()> {
    let metadata = serde_json::json!({ "runnerLost": true });
    if live_ids.is_empty() {
        sqlx::query!(
            r#"UPDATE sandbox_processes
               SET status = 'failed',
                   stopped_at = COALESCE(stopped_at, now()),
                   metadata = metadata || $1
               WHERE status IN ('starting', 'running')"#,
            metadata
        )
        .execute(&state.db)
        .await?;
        sqlx::query!(
            r#"UPDATE preview_endpoints
               SET status = 'failed', updated_at = now()
               WHERE process_id IN (
                   SELECT id FROM sandbox_processes
                   WHERE status = 'failed' AND metadata ? 'runnerLost'
               )
               AND status = 'active'"#
        )
        .execute(&state.db)
        .await?;
        return Ok(());
    }

    let ids = live_ids.iter().copied().collect::<Vec<_>>();
    sqlx::query!(
        r#"UPDATE sandbox_processes
           SET status = 'failed',
               stopped_at = COALESCE(stopped_at, now()),
               metadata = metadata || $1
           WHERE status IN ('starting', 'running')
             AND NOT (id = ANY($2))"#,
        metadata,
        &ids
    )
    .execute(&state.db)
    .await?;
    sqlx::query!(
        r#"UPDATE preview_endpoints
           SET status = 'failed', updated_at = now()
           WHERE process_id IN (
               SELECT id FROM sandbox_processes
               WHERE status = 'failed' AND metadata ? 'runnerLost'
           )
           AND status = 'active'"#
    )
    .execute(&state.db)
    .await?;
    Ok(())
}

pub async fn start_process(
    state: &AppState,
    req: StartSandboxProcessRequest,
) -> AppResult<SandboxProcessResponse> {
    let runner_url = state
        .config
        .sandbox_runner_url
        .clone()
        .ok_or_else(|| AppError::BadRequest("sandbox runner is not configured".to_string()))?;
    let command = validate_command(req.command)?;
    let workspace = resolve_workspace(state, &req.agent_profile, req.project_id.as_deref()).await?;
    let cwd = resolve_cwd(
        &workspace.working_dir,
        &workspace.allowed_roots,
        req.cwd.as_deref(),
    )?;
    let port = validate_port(req.port)?;
    let label = req
        .label
        .map(|value| validate_label(value, "process label", MAX_LABEL_CHARS))
        .transpose()?;

    let runner_response = RunnerClient::new(runner_url)
        .start_process(&RunnerStartProcessRequest {
            execution: RunnerExecuteRequest {
                command: command.clone(),
                cwd: cwd.display().to_string(),
                roots: roots_for_runner(&workspace.working_dir, &workspace.allowed_roots),
                timeout_secs: None,
                env: None,
            },
            port,
        })
        .await?;
    let pid = runner_response.pid.map(|value| value as i32);
    let logical_cwd = logical_path_for_runner(&cwd);
    let metadata = serde_json::json!({
        "runnerStatus": runner_response.status.clone(),
        "forwardedUrl": runner_response.forwarded_url.clone(),
        "port": port,
    });

    sandbox_processes::insert_running_process(
        &state.db,
        &NewRunningProcess {
            id: runner_response.id,
            agent_profile: &workspace.agent_profile,
            project_id: workspace.project_id,
            command: &command,
            cwd: &logical_cwd,
            pid,
            metadata: &metadata,
        },
    )
    .await?;

    if let Some(port) = port {
        let preview_label = label.unwrap_or_else(|| format!("Port {port}"));
        let target_url = runner_response
            .forwarded_url
            .unwrap_or_else(|| format!("http://{}:{port}", state.config.sandbox_preview_host));
        let _preview_path = sandbox_processes::create_process_preview(
            &state.db,
            &workspace.agent_profile,
            workspace.project_id,
            runner_response.id,
            &preview_label,
            &target_url,
        )
        .await?;
    }

    Ok(SandboxProcessResponse {
        process: sandbox_processes::fetch_process(&state.db, runner_response.id).await?,
    })
}

pub async fn stop_process(state: &AppState, id: Uuid) -> AppResult<StopSandboxProcessResponse> {
    let _process = sandbox_processes::fetch_process(&state.db, id).await?;
    if let Some(runner_url) = &state.config.sandbox_runner_url {
        match RunnerClient::new(runner_url.clone()).stop_process(id).await {
            Ok(response) if !response.success => {
                tracing::warn!(
                    process_id = %id,
                    "sandbox runner returned an unsuccessful stop response"
                );
            }
            Ok(_) => {}
            Err(err) => {
                tracing::warn!(
                    process_id = %id,
                    error = %err,
                    "sandbox runner stop failed; marking durable process stopped"
                );
            }
        }
    }

    sandbox_processes::stop_process_record(&state.db, id).await?;

    Ok(StopSandboxProcessResponse {
        success: true,
        process: sandbox_processes::fetch_process(&state.db, id).await?,
    })
}

pub async fn process_logs(state: &AppState, id: Uuid) -> AppResult<SandboxProcessLogsResponse> {
    let mut logs = String::new();
    if let Some(runner_url) = &state.config.sandbox_runner_url {
        match RunnerClient::new(runner_url.clone()).process_logs(id).await {
            Ok(response) => {
                logs = response.logs;
                sandbox_processes::reconcile_from_runner(
                    &state.db,
                    response.id,
                    &response.status,
                    response.pid.map(|value| value as i32),
                    &response.command,
                    &response.cwd,
                    response.port,
                )
                .await?;
            }
            Err(err) => {
                tracing::warn!(
                    process_id = %id,
                    error = %err,
                    "sandbox runner logs unavailable; returning durable process metadata"
                );
            }
        }
    }

    Ok(SandboxProcessLogsResponse {
        process: sandbox_processes::fetch_process(&state.db, id).await?,
        logs,
    })
}

async fn resolve_workspace(
    state: &AppState,
    agent_profile: &str,
    project_id: Option<&str>,
) -> AppResult<drive::AgentDriveWorkspace> {
    let profile = agents::normalize_agent_profile(agent_profile)?;
    let project_id = parse_optional_uuid(project_id, "projectId")?;
    drive::resolve_agent_drive_workspace(state, &profile, project_id).await
}

fn resolve_cwd(
    working_dir: &Path,
    allowed_roots: &[PathBuf],
    requested: Option<&str>,
) -> AppResult<PathBuf> {
    let root = working_dir.canonicalize()?;
    let candidate = match requested.map(str::trim).filter(|value| !value.is_empty()) {
        Some(raw) => {
            let path = Path::new(raw);
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                root.join(path)
            }
        }
        None => root,
    };
    let cwd = candidate
        .canonicalize()
        .map_err(|err| AppError::BadRequest(format!("sandbox cwd cannot be resolved: {err}")))?;
    if !cwd.is_dir() {
        return Err(AppError::BadRequest(
            "sandbox cwd must be a directory".to_string(),
        ));
    }
    if !allowed_roots.iter().any(|allowed| cwd.starts_with(allowed)) {
        return Err(AppError::BadRequest(
            "sandbox cwd must stay inside the agent, shared, or project workspace".to_string(),
        ));
    }
    Ok(cwd)
}

fn validate_command(value: String) -> AppResult<String> {
    let command = value.trim().to_string();
    if command.is_empty() {
        return Err(AppError::BadRequest(
            "sandbox command cannot be empty".to_string(),
        ));
    }
    if command.chars().count() > MAX_COMMAND_CHARS {
        return Err(AppError::BadRequest(format!(
            "sandbox command must be at most {MAX_COMMAND_CHARS} characters"
        )));
    }
    Ok(command)
}

fn validate_label(value: String, label: &str, max_chars: usize) -> AppResult<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(AppError::BadRequest(format!("{label} cannot be empty")));
    }
    if value.chars().count() > max_chars {
        return Err(AppError::BadRequest(format!(
            "{label} must be at most {max_chars} characters"
        )));
    }
    Ok(value)
}

fn validate_port(value: Option<u16>) -> AppResult<Option<u16>> {
    match value {
        Some(port) if port < 1024 => Err(AppError::BadRequest(
            "sandbox preview port must be between 1024 and 65535".to_string(),
        )),
        other => Ok(other),
    }
}

fn parse_optional_uuid(value: Option<&str>, label: &str) -> AppResult<Option<Uuid>> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            Uuid::parse_str(value)
                .map_err(|err| AppError::BadRequest(format!("invalid {label}: {err}")))
        })
        .transpose()
}
