//! mymy sandbox runner.
//!
//! The API process owns authentication, DB state, and prompt assembly. This
//! runner owns untrusted process execution. It intentionally exposes a small
//! HTTP contract so the API and agent tools do not depend on the isolation
//! backend. Bubblewrap can bind host Drive directories directly, while
//! Firecracker cannot; the Firecracker backend therefore stages only the
//! authorized Drive roots into each guest over SSH, copies writable roots back
//! when execution stops, and keeps preview URLs stable by proxying runner ports
//! into the guest network.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path as AxumPath, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use tokio::process::Command;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

mod config_env;
mod error;
mod firecracker;
mod firecracker_runtime;
mod host;
mod logs;
mod metrics;
mod path_policy;
mod proxy;
mod state;
mod types;

use error::RunnerError;
use host::wait_for_pid_exit;
use logs::append_stream;
use path_policy::writable_root_paths;
use state::RunnerState;
use types::{
    ExecuteRequest, ExecuteResponse, ListProcessesResponse, ProcessLogsResponse, ProcessRecord,
    ProcessStatus, RunnerMode, RuntimeStatus, StartProcessRequest, StartProcessResponse,
    StopProcessResponse,
};

pub async fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("mymy_sandbox_runner=info,tower_http=info")),
        )
        .init();

    let port = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(33698);
    let state = Arc::new(RunnerState::from_env()?);
    let app = Router::new()
        .route("/health", get(health))
        .route("/runtime/status", get(runtime_status))
        .route("/execute", post(execute))
        .route("/processes", get(list_processes).post(start_process))
        .route("/processes/{id}/stop", post(stop_process))
        .route("/processes/{id}/kill", post(kill_process))
        .route("/processes/{id}/logs", get(process_logs))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "starting mymy-sandbox-runner");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}

async fn runtime_status(State(state): State<Arc<RunnerState>>) -> Json<RuntimeStatus> {
    Json(state.runtime_status())
}

async fn execute(
    State(state): State<Arc<RunnerState>>,
    Json(req): Json<ExecuteRequest>,
) -> Result<Json<ExecuteResponse>, RunnerError> {
    let prepared = state.prepare_request(&req)?;
    if state.mode == RunnerMode::Firecracker && !state.firecracker_ready() {
        return Err(RunnerError::Unavailable(
            "firecracker mode requires FIRECRACKER_BIN, FIRECRACKER_KERNEL_IMAGE, FIRECRACKER_ROOTFS_IMAGE, and FIRECRACKER_SSH_KEY_PATH".to_string(),
        ));
    }
    let timeout_secs = req.timeout_secs.unwrap_or(60).clamp(1, 900);
    match state.mode {
        RunnerMode::Bubblewrap => {
            let mut command = state.build_bubblewrap_command(&prepared, &req.command)?;
            let output = tokio::time::timeout(Duration::from_secs(timeout_secs), command.output())
                .await
                .map_err(|_| {
                    RunnerError::Execution(format!("command timed out after {timeout_secs}s"))
                })?
                .map_err(|err| RunnerError::Execution(format!("command failed to start: {err}")))?;
            state.repair_ownership(&prepared.roots).await;

            Ok(Json(ExecuteResponse {
                success: output.status.success(),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code().unwrap_or(-1),
                cwd: prepared.sandbox_cwd.display().to_string(),
            }))
        }
        RunnerMode::Firecracker => state
            .execute_firecracker(&prepared, &req.command, timeout_secs)
            .await
            .map(Json),
    }
}

async fn list_processes(State(state): State<Arc<RunnerState>>) -> Json<ListProcessesResponse> {
    let records = state
        .processes
        .read()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let mut processes = Vec::with_capacity(records.len());
    for record in &records {
        processes.push(state.process_summary(record).await);
    }
    processes.sort_by_key(|process| process.id);
    Json(ListProcessesResponse { processes })
}

async fn start_process(
    State(state): State<Arc<RunnerState>>,
    Json(req): Json<StartProcessRequest>,
) -> Result<Json<StartProcessResponse>, RunnerError> {
    let prepared = state.prepare_request(&req.execution)?;
    if state.mode == RunnerMode::Firecracker && !state.firecracker_ready() {
        return Err(RunnerError::Unavailable(
            "firecracker mode requires Firecracker binary, kernel, rootfs, and SSH key assets"
                .to_string(),
        ));
    }
    let id = Uuid::new_v4();
    let log_path = state.log_dir.join(format!("{id}.log"));
    if state.mode == RunnerMode::Firecracker {
        return state
            .start_firecracker_process(id, log_path, prepared, req)
            .await
            .map(Json);
    }

    let mut command = state.build_bubblewrap_command(&prepared, &req.execution.command)?;
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|err| RunnerError::Execution(format!("process failed to start: {err}")))?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let writable_roots = writable_root_paths(&prepared.roots);

    let mut processes = state.processes.write().await;
    processes.insert(
        id,
        ProcessRecord {
            id,
            command: req.execution.command.clone(),
            cwd: prepared.sandbox_cwd.display().to_string(),
            pid,
            status: ProcessStatus::Running,
            log_path: log_path.clone(),
            port: req.port,
            writable_roots: writable_roots.clone(),
            firecracker: None,
            proxy_shutdown: None,
        },
    );
    drop(processes);

    if let Some(stdout) = stdout {
        tokio::spawn(append_stream(log_path.clone(), stdout, "stdout"));
    }
    if let Some(stderr) = stderr {
        tokio::spawn(append_stream(log_path.clone(), stderr, "stderr"));
    }
    let process_state = Arc::clone(&state);
    tokio::spawn(async move {
        let status = child.wait().await;
        process_state.repair_ownership_paths(&writable_roots).await;
        let mut processes = process_state.processes.write().await;
        if let Some(record) = processes.get_mut(&id) {
            record.status = match status {
                Ok(status) if status.success() => ProcessStatus::Exited,
                Ok(_) => ProcessStatus::Failed,
                Err(_) => ProcessStatus::Failed,
            };
        }
    });

    Ok(Json(StartProcessResponse {
        id,
        pid,
        status: ProcessStatus::Running,
        forwarded_url: req
            .port
            .map(|port| format!("http://{}:{port}", state.preview_host)),
    }))
}

async fn stop_process(
    State(state): State<Arc<RunnerState>>,
    AxumPath(id): AxumPath<Uuid>,
) -> Result<Json<StopProcessResponse>, RunnerError> {
    let (pid, writable_roots, firecracker, proxy_shutdown) = {
        let mut processes = state.processes.write().await;
        let record = processes
            .get_mut(&id)
            .ok_or_else(|| RunnerError::NotFound(format!("process {id} not found")))?;
        record.status = ProcessStatus::Stopped;
        (
            record.pid,
            record.writable_roots.clone(),
            record.firecracker.clone(),
            record.proxy_shutdown.take(),
        )
    };
    if let Some(shutdown) = proxy_shutdown {
        let _ = shutdown.send(true);
    }
    if let Some(pid) = pid {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .await;
        if !wait_for_pid_exit(pid).await {
            let _ = Command::new("kill")
                .arg("-KILL")
                .arg(pid.to_string())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .output()
                .await;
            let _ = wait_for_pid_exit(pid).await;
        }
    }
    if let Some(runtime) = firecracker {
        let _ = state.sync_firecracker_writable_roots(&runtime).await;
        state.teardown_firecracker_runtime(&runtime).await;
    }
    state.repair_ownership_paths(&writable_roots).await;
    Ok(Json(StopProcessResponse { success: true }))
}

async fn kill_process(
    State(state): State<Arc<RunnerState>>,
    AxumPath(id): AxumPath<Uuid>,
) -> Result<Json<StopProcessResponse>, RunnerError> {
    let (pid, writable_roots, firecracker, proxy_shutdown) = {
        let mut processes = state.processes.write().await;
        let record = processes
            .get_mut(&id)
            .ok_or_else(|| RunnerError::NotFound(format!("process {id} not found")))?;
        record.status = ProcessStatus::Stopped;
        (
            record.pid,
            record.writable_roots.clone(),
            record.firecracker.clone(),
            record.proxy_shutdown.take(),
        )
    };
    if let Some(shutdown) = proxy_shutdown {
        let _ = shutdown.send(true);
    }
    if let Some(pid) = pid {
        let _ = Command::new("kill")
            .arg("-KILL")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .await;
        let _ = wait_for_pid_exit(pid).await;
    }
    if let Some(runtime) = firecracker {
        let _ = state.sync_firecracker_writable_roots(&runtime).await;
        state.teardown_firecracker_runtime(&runtime).await;
    }
    state.repair_ownership_paths(&writable_roots).await;
    Ok(Json(StopProcessResponse { success: true }))
}

async fn process_logs(
    State(state): State<Arc<RunnerState>>,
    AxumPath(id): AxumPath<Uuid>,
) -> Result<Json<ProcessLogsResponse>, RunnerError> {
    let (id, status, command, cwd, pid, port, log_path) = {
        let processes = state.processes.read().await;
        let record = processes
            .get(&id)
            .ok_or_else(|| RunnerError::NotFound(format!("process {id} not found")))?;
        (
            record.id,
            record.status.clone(),
            record.command.clone(),
            record.cwd.clone(),
            record.pid,
            record.port,
            record.log_path.clone(),
        )
    };
    let content = tokio::fs::read_to_string(&log_path)
        .await
        .unwrap_or_default();
    Ok(Json(ProcessLogsResponse {
        id,
        status,
        command,
        cwd,
        pid,
        port,
        logs: content,
    }))
}

#[cfg(test)]
mod tests {
    use super::firecracker::network as firecracker_network;
    use super::host::remote_command;
    use super::path_policy::map_host_path_to_mount;
    use super::types::PreparedRoot;
    use super::*;
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    #[test]
    fn maps_host_cwd_to_mount_path() {
        let roots = vec![
            PreparedRoot {
                host_path: PathBuf::from("/data/drive/shared"),
                mount_path: PathBuf::from("/drive/shared"),
                writable: true,
            },
            PreparedRoot {
                host_path: PathBuf::from("/data/drive/agents/elena"),
                mount_path: PathBuf::from("/drive/agents/elena"),
                writable: true,
            },
        ];
        assert_eq!(
            map_host_path_to_mount(Path::new("/data/drive/agents/elena/work/subdir"), &roots),
            Some(PathBuf::from("/drive/agents/elena/work/subdir"))
        );
    }

    #[test]
    fn quotes_remote_command_environment() {
        let mut env = BTreeMap::new();
        env.insert("SAFE_VALUE".to_string(), "can't break".to_string());
        env.insert("API_KEY".to_string(), "secret".to_string());
        let command = remote_command(Path::new("/drive/agents/elena"), &env, "printf 'ok'");
        assert!(command.contains("SAFE_VALUE='can'\"'\"'t break'"));
        assert!(!command.contains("API_KEY"));
        assert!(command.contains("bash -lc 'printf '\"'\"'ok'\"'\"''"));
    }

    #[test]
    fn firecracker_network_uses_short_tap_name() {
        let id = Uuid::parse_str("5ea1ec39-59e7-445b-b0ba-1b081a7d076d").unwrap();
        let network = firecracker_network(id);
        assert!(network.tap_name.len() <= 15);
        assert_ne!(network.host_ip, network.guest_ip);
    }
}
