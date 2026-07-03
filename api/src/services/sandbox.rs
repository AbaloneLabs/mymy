//! Sandbox process orchestration.
//!
//! The API is the durable control plane for sandbox activity. It validates
//! agent/project ownership against the database, resolves Drive-backed
//! filesystem roots, delegates process execution to the out-of-process runner,
//! and stores enough metadata to render process/job history even if the runner
//! restarts and loses its volatile process table.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::sandbox::{
    SandboxProcess, SandboxProcessLogsResponse, SandboxProcessResponse, SandboxProcessStatus,
    SandboxProcessesResponse, SandboxRuntime, SandboxRuntimeResponse, StartSandboxProcessRequest,
    StopSandboxProcessResponse,
};
use crate::services::agents;
use crate::services::drive;
use crate::services::sandbox_runner::{
    roots_for_runner, RunnerClient, RunnerExecuteRequest, RunnerProcessSummary, RunnerRoot,
    RunnerStartProcessRequest,
};
use crate::state::AppState;

const MAX_COMMAND_CHARS: usize = 16_000;
const MAX_LABEL_CHARS: usize = 80;

#[derive(Debug, FromRow)]
struct SandboxProcessRow {
    id: Uuid,
    agent_profile: String,
    project_id: Option<Uuid>,
    command: String,
    cwd: String,
    status: String,
    pid: Option<i32>,
    started_at: DateTime<Utc>,
    stopped_at: Option<DateTime<Utc>>,
    exit_code: Option<i32>,
    metadata: Value,
    preview_token: Option<String>,
    preview_target_url: Option<String>,
}

struct SandboxWorkspace {
    agent_profile: String,
    project_id: Option<Uuid>,
    working_dir: PathBuf,
    allowed_roots: Vec<PathBuf>,
}

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
    let rows = if let Some(profile) = agent_profile {
        let profile = agents::normalize_agent_profile(profile)?;
        if let Some(project_id) = project_id {
            sqlx::query_as!(
                SandboxProcessRow,
                r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                          p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                          preview.token AS "preview_token?",
                          preview.target_url AS "preview_target_url?"
                   FROM sandbox_processes p
                   LEFT JOIN LATERAL (
                       SELECT token, target_url
                       FROM preview_endpoints
                       WHERE process_id = p.id AND status = 'active'
                       ORDER BY created_at DESC
                       LIMIT 1
                   ) preview ON true
                   WHERE p.agent_profile = $1 AND p.project_id = $2
                   ORDER BY p.started_at DESC"#,
                profile,
                project_id
            )
            .fetch_all(&state.db)
            .await?
        } else {
            sqlx::query_as!(
                SandboxProcessRow,
                r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                          p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                          preview.token AS "preview_token?",
                          preview.target_url AS "preview_target_url?"
                   FROM sandbox_processes p
                   LEFT JOIN LATERAL (
                       SELECT token, target_url
                       FROM preview_endpoints
                       WHERE process_id = p.id AND status = 'active'
                       ORDER BY created_at DESC
                       LIMIT 1
                   ) preview ON true
                   WHERE p.agent_profile = $1
                   ORDER BY p.started_at DESC"#,
                profile
            )
            .fetch_all(&state.db)
            .await?
        }
    } else {
        sqlx::query_as!(
            SandboxProcessRow,
            r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                      p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                      preview.token AS "preview_token?",
                      preview.target_url AS "preview_target_url?"
               FROM sandbox_processes p
               LEFT JOIN LATERAL (
                   SELECT token, target_url
                   FROM preview_endpoints
                   WHERE process_id = p.id AND status = 'active'
                   ORDER BY created_at DESC
                   LIMIT 1
               ) preview ON true
               WHERE ($1::uuid IS NULL OR p.project_id = $1)
               ORDER BY p.started_at DESC"#,
            project_id
        )
        .fetch_all(&state.db)
        .await?
    };

    Ok(SandboxProcessesResponse {
        processes: rows.into_iter().map(row_to_process).collect(),
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
    reconcile_process_from_runner(
        state,
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
                roots: runner_roots(&workspace.working_dir, &workspace.allowed_roots),
                timeout_secs: None,
                env: None,
            },
            port,
        })
        .await?;
    let pid = runner_response.pid.map(|value| value as i32);
    let metadata = serde_json::json!({
        "runnerStatus": runner_response.status.clone(),
        "forwardedUrl": runner_response.forwarded_url.clone(),
        "port": port,
    });

    sqlx::query!(
        r#"INSERT INTO sandbox_processes
             (id, agent_profile, project_id, command, cwd, status, pid, metadata)
           VALUES ($1, $2, $3, $4, $5, 'running', $6, $7)"#,
        runner_response.id,
        &workspace.agent_profile,
        workspace.project_id,
        command,
        cwd.display().to_string(),
        pid,
        metadata,
    )
    .execute(&state.db)
    .await?;

    if let Some(port) = port {
        let preview_label = label.unwrap_or_else(|| format!("Port {port}"));
        let target_url = runner_response
            .forwarded_url
            .unwrap_or_else(|| format!("http://{}:{port}", state.config.sandbox_preview_host));
        create_process_preview(
            state,
            &workspace.agent_profile,
            workspace.project_id,
            runner_response.id,
            &preview_label,
            &target_url,
        )
        .await?;
    }

    Ok(SandboxProcessResponse {
        process: fetch_process(state, runner_response.id).await?,
    })
}

pub async fn stop_process(state: &AppState, id: Uuid) -> AppResult<StopSandboxProcessResponse> {
    let process = fetch_process(state, id).await?;
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

    sqlx::query!(
        r#"UPDATE sandbox_processes
           SET status = 'stopped', stopped_at = COALESCE(stopped_at, now())
           WHERE id = $1"#,
        id
    )
    .execute(&state.db)
    .await?;
    sqlx::query!(
        "UPDATE preview_endpoints SET status = 'stopped', updated_at = now() WHERE process_id = $1",
        id
    )
    .execute(&state.db)
    .await?;

    let _ = process;
    Ok(StopSandboxProcessResponse {
        success: true,
        process: fetch_process(state, id).await?,
    })
}

pub async fn process_logs(state: &AppState, id: Uuid) -> AppResult<SandboxProcessLogsResponse> {
    let mut logs = String::new();
    if let Some(runner_url) = &state.config.sandbox_runner_url {
        match RunnerClient::new(runner_url.clone()).process_logs(id).await {
            Ok(response) => {
                logs = response.logs;
                reconcile_process_from_runner(
                    state,
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
        process: fetch_process(state, id).await?,
        logs,
    })
}

async fn resolve_workspace(
    state: &AppState,
    agent_profile: &str,
    project_id: Option<&str>,
) -> AppResult<SandboxWorkspace> {
    let profile = agents::normalize_agent_profile(agent_profile)?;
    let agent = sqlx::query!(
        "SELECT name, role FROM native_agents WHERE profile = $1",
        &profile
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent {profile} not found")))?;
    drive::ensure_agent_workspace(state, &profile, &agent.name, Some(&agent.role))?;

    let working_dir = drive::agent_workspace_path(&state.config.agent_data_dir, &profile);
    let mut allowed_roots = vec![drive::shared_root(&state.config.agent_data_dir)];
    let project_id = parse_optional_uuid(project_id, "projectId")?;
    if let Some(project_id) = project_id {
        let project = sqlx::query!("SELECT drive_slug FROM projects WHERE id = $1", project_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
        drive::ensure_project_workspace(state, &project.drive_slug)?;
        allowed_roots.push(drive::project_workspace_path(
            &state.config.agent_data_dir,
            &project.drive_slug,
        ));
    }
    allowed_roots.push(working_dir.clone());
    allowed_roots = canonical_roots(allowed_roots)?;

    Ok(SandboxWorkspace {
        agent_profile: profile,
        project_id,
        working_dir,
        allowed_roots,
    })
}

fn runner_roots(working_dir: &Path, allowed_roots: &[PathBuf]) -> Vec<RunnerRoot> {
    let mut roots = roots_for_runner(working_dir, allowed_roots);
    roots.sort_by(|left, right| left.host_path.cmp(&right.host_path));
    roots.dedup_by(|left, right| left.host_path == right.host_path);
    roots
}

fn canonical_roots(roots: Vec<PathBuf>) -> AppResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    for root in roots {
        std::fs::create_dir_all(&root)?;
        out.push(root.canonicalize()?);
    }
    out.sort();
    out.dedup();
    Ok(out)
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

async fn create_process_preview(
    state: &AppState,
    agent_profile: &str,
    project_id: Option<Uuid>,
    process_id: Uuid,
    label: &str,
    target_url: &str,
) -> AppResult<()> {
    let token = Uuid::new_v4().simple().to_string();
    sqlx::query!(
        r#"INSERT INTO preview_endpoints
             (agent_profile, project_id, process_id, label, target_url, token, visibility, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'session', 'active')"#,
        agent_profile,
        project_id,
        process_id,
        label,
        target_url,
        token,
    )
    .execute(&state.db)
    .await?;
    Ok(())
}

async fn reconcile_process_from_runner(
    state: &AppState,
    id: Uuid,
    runner_status: &str,
    pid: Option<i32>,
    command: &str,
    cwd: &str,
    port: Option<u16>,
) -> AppResult<()> {
    let status = normalize_process_status(runner_status);
    let stopped = matches!(status, "exited" | "failed" | "stopped");
    let metadata = serde_json::json!({
        "runnerCommand": command,
        "runnerCwd": cwd,
        "port": port,
    });
    sqlx::query!(
        r#"UPDATE sandbox_processes
           SET status = $2,
               pid = COALESCE($3, pid),
               stopped_at = CASE WHEN $4 THEN COALESCE(stopped_at, now()) ELSE stopped_at END,
               metadata = metadata || $5
           WHERE id = $1"#,
        id,
        status,
        pid,
        stopped,
        metadata,
    )
    .execute(&state.db)
    .await?;
    if stopped {
        sqlx::query!(
            "UPDATE preview_endpoints SET status = 'stopped', updated_at = now() WHERE process_id = $1",
            id
        )
        .execute(&state.db)
        .await?;
    }
    Ok(())
}

async fn fetch_process(state: &AppState, id: Uuid) -> AppResult<SandboxProcess> {
    sqlx::query_as!(
        SandboxProcessRow,
        r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                  p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                  preview.token AS "preview_token?",
                  preview.target_url AS "preview_target_url?"
           FROM sandbox_processes p
           LEFT JOIN LATERAL (
               SELECT token, target_url
               FROM preview_endpoints
               WHERE process_id = p.id AND status = 'active'
               ORDER BY created_at DESC
               LIMIT 1
           ) preview ON true
           WHERE p.id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .map(row_to_process)
    .ok_or_else(|| AppError::NotFound(format!("sandbox process {id} not found")))
}

fn row_to_process(row: SandboxProcessRow) -> SandboxProcess {
    SandboxProcess {
        id: row.id.to_string(),
        agent_profile: row.agent_profile,
        project_id: row.project_id.map(|id| id.to_string()),
        command: row.command,
        cwd: row.cwd,
        status: parse_process_status(&row.status),
        pid: row.pid,
        started_at: row.started_at.to_rfc3339(),
        stopped_at: row.stopped_at.map(|time| time.to_rfc3339()),
        exit_code: row.exit_code,
        metadata: row.metadata,
        preview_path: row
            .preview_token
            .map(|token| format!("/api/previews/{token}")),
        preview_target_url: row.preview_target_url,
    }
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

fn normalize_process_status(value: &str) -> &'static str {
    match value {
        "exited" => "exited",
        "failed" => "failed",
        "stopped" => "stopped",
        "starting" => "starting",
        _ => "running",
    }
}

fn parse_process_status(value: &str) -> SandboxProcessStatus {
    match value {
        "starting" => SandboxProcessStatus::Starting,
        "exited" => SandboxProcessStatus::Exited,
        "failed" => SandboxProcessStatus::Failed,
        "stopped" => SandboxProcessStatus::Stopped,
        _ => SandboxProcessStatus::Running,
    }
}
