//! mymy sandbox runner.
//!
//! The API process owns authentication, DB state, and prompt assembly. This
//! runner owns untrusted process execution. It intentionally exposes a small
//! HTTP contract so the execution backend can move from bubblewrap to
//! Firecracker without changing agent tools or chat orchestration.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path as AxumPath, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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
            "firecracker mode requires FIRECRACKER_BIN, FIRECRACKER_KERNEL_IMAGE, and FIRECRACKER_ROOTFS_IMAGE".to_string(),
        ));
    }
    let mut command = state.build_command(&prepared, &req.command)?;
    let timeout_secs = req.timeout_secs.unwrap_or(60).clamp(1, 900);
    let output = tokio::time::timeout(Duration::from_secs(timeout_secs), command.output())
        .await
        .map_err(|_| RunnerError::Execution(format!("command timed out after {timeout_secs}s")))?
        .map_err(|err| RunnerError::Execution(format!("command failed to start: {err}")))?;
    state.repair_ownership(&prepared.roots).await;

    Ok(Json(ExecuteResponse {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        cwd: prepared.cwd.display().to_string(),
    }))
}

async fn list_processes(State(state): State<Arc<RunnerState>>) -> Json<ListProcessesResponse> {
    let processes = state.processes.read().await;
    let mut processes = processes
        .values()
        .map(ProcessSummary::from)
        .collect::<Vec<_>>();
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
            "firecracker mode requires Firecracker assets".to_string(),
        ));
    }
    let id = Uuid::new_v4();
    let log_path = state.log_dir.join(format!("{id}.log"));
    let mut command = state.build_command(&prepared, &req.execution.command)?;
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
            cwd: prepared.cwd.display().to_string(),
            pid,
            status: ProcessStatus::Running,
            log_path: log_path.clone(),
            port: req.port,
            writable_roots: writable_roots.clone(),
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
    let (pid, writable_roots) = {
        let processes = state.processes.read().await;
        let record = processes
            .get(&id)
            .ok_or_else(|| RunnerError::NotFound(format!("process {id} not found")))?;
        (record.pid, record.writable_roots.clone())
    };
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
    state.repair_ownership_paths(&writable_roots).await;
    let mut processes = state.processes.write().await;
    if let Some(record) = processes.get_mut(&id) {
        record.status = ProcessStatus::Stopped;
    }
    Ok(Json(StopProcessResponse { success: true }))
}

async fn process_logs(
    State(state): State<Arc<RunnerState>>,
    AxumPath(id): AxumPath<Uuid>,
) -> Result<Json<ProcessLogsResponse>, RunnerError> {
    let record = {
        let processes = state.processes.read().await;
        processes
            .get(&id)
            .cloned()
            .ok_or_else(|| RunnerError::NotFound(format!("process {id} not found")))?
    };
    let content = tokio::fs::read_to_string(&record.log_path)
        .await
        .unwrap_or_default();
    Ok(Json(ProcessLogsResponse {
        id: record.id,
        status: record.status,
        command: record.command,
        cwd: record.cwd,
        pid: record.pid,
        port: record.port,
        logs: content,
    }))
}

async fn append_stream<R>(path: PathBuf, mut reader: R, label: &'static str)
where
    R: AsyncRead + Unpin,
{
    let mut buffer = vec![0_u8; 8192];
    loop {
        let read = match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => break,
        };
        if let Ok(mut file) = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await
        {
            let _ = file.write_all(format!("[{label}] ").as_bytes()).await;
            let _ = file.write_all(&buffer[..read]).await;
        }
    }
}

#[derive(Debug)]
struct RunnerState {
    mode: RunnerMode,
    data_root: PathBuf,
    log_dir: PathBuf,
    preview_host: String,
    unshare_user: bool,
    sandbox_uid: Option<u32>,
    sandbox_gid: Option<u32>,
    firecracker_bin: Option<PathBuf>,
    firecracker_kernel: Option<PathBuf>,
    firecracker_rootfs: Option<PathBuf>,
    processes: RwLock<HashMap<Uuid, ProcessRecord>>,
}

impl RunnerState {
    fn from_env() -> anyhow::Result<Self> {
        let mode = match std::env::var("MYMY_SANDBOX_MODE")
            .unwrap_or_else(|_| "bubblewrap".to_string())
            .to_ascii_lowercase()
            .as_str()
        {
            "firecracker" => RunnerMode::Firecracker,
            _ => RunnerMode::Bubblewrap,
        };
        let data_root = PathBuf::from(
            std::env::var("MYMY_RUNNER_DATA_ROOT")
                .unwrap_or_else(|_| "/app/data/agent".to_string()),
        )
        .canonicalize()?;
        let log_dir = data_root.join("runner-logs");
        std::fs::create_dir_all(&log_dir)?;
        Ok(Self {
            mode,
            data_root,
            log_dir,
            preview_host: std::env::var("MYMY_SANDBOX_PREVIEW_HOST")
                .unwrap_or_else(|_| "sandbox-runner".to_string()),
            unshare_user: env_bool("MYMY_SANDBOX_UNSHARE_USER"),
            sandbox_uid: env_u32("MYMY_SANDBOX_UID"),
            sandbox_gid: env_u32("MYMY_SANDBOX_GID"),
            firecracker_bin: env_path("FIRECRACKER_BIN"),
            firecracker_kernel: env_path("FIRECRACKER_KERNEL_IMAGE"),
            firecracker_rootfs: env_path("FIRECRACKER_ROOTFS_IMAGE"),
            processes: RwLock::new(HashMap::new()),
        })
    }

    fn runtime_status(&self) -> RuntimeStatus {
        RuntimeStatus {
            mode: self.mode,
            ready: self.mode == RunnerMode::Bubblewrap || self.firecracker_ready(),
            data_root: self.data_root.display().to_string(),
            firecracker_configured: self.firecracker_ready(),
        }
    }

    fn firecracker_ready(&self) -> bool {
        self.firecracker_bin
            .as_ref()
            .is_some_and(|path| path.exists())
            && self
                .firecracker_kernel
                .as_ref()
                .is_some_and(|path| path.exists())
            && self
                .firecracker_rootfs
                .as_ref()
                .is_some_and(|path| path.exists())
    }

    fn prepare_request(&self, req: &ExecuteRequest) -> Result<PreparedRequest, RunnerError> {
        if req.command.trim().is_empty() {
            return Err(RunnerError::BadRequest(
                "command cannot be empty".to_string(),
            ));
        }
        let mut roots = Vec::new();
        for root in &req.roots {
            let host_path = canonicalize_existing(&root.host_path)?;
            if !host_path.starts_with(&self.data_root) {
                return Err(RunnerError::BadRequest(format!(
                    "root escapes runner data root: {}",
                    root.host_path
                )));
            }
            roots.push(PreparedRoot {
                host_path,
                mount_path: PathBuf::from(&root.mount_path),
                writable: root.writable,
            });
        }
        if roots.is_empty() {
            return Err(RunnerError::BadRequest(
                "at least one workspace root is required".to_string(),
            ));
        }

        let cwd = canonicalize_existing(&req.cwd)?;
        if !roots.iter().any(|root| cwd.starts_with(&root.host_path)) {
            return Err(RunnerError::BadRequest(format!(
                "cwd is outside mounted roots: {}",
                req.cwd
            )));
        }
        Ok(PreparedRequest {
            cwd,
            roots,
            env: req.env.clone().unwrap_or_default(),
        })
    }

    fn build_command(&self, req: &PreparedRequest, command: &str) -> Result<Command, RunnerError> {
        match self.mode {
            RunnerMode::Bubblewrap => self.build_bubblewrap_command(req, command),
            RunnerMode::Firecracker => Err(RunnerError::Unavailable(
                "firecracker backend is configured but VM asset orchestration is not ready"
                    .to_string(),
            )),
        }
    }

    fn build_bubblewrap_command(
        &self,
        req: &PreparedRequest,
        command: &str,
    ) -> Result<Command, RunnerError> {
        let mut cmd = Command::new("bwrap");
        cmd.arg("--die-with-parent")
            .arg("--unshare-pid")
            .arg("--unshare-ipc")
            .arg("--unshare-uts")
            .arg("--share-net")
            .arg("--proc")
            .arg("/proc")
            .arg("--dir")
            .arg("/dev")
            .arg("--tmpfs")
            .arg("/tmp")
            .arg("--tmpfs")
            .arg("/dev/shm");
        for device in [
            "/dev/null",
            "/dev/zero",
            "/dev/full",
            "/dev/random",
            "/dev/urandom",
        ] {
            if Path::new(device).exists() {
                cmd.arg("--dev-bind").arg(device).arg(device);
            }
        }
        if self.unshare_user {
            cmd.arg("--unshare-user");
        }

        for path in ["/usr", "/bin", "/lib", "/lib64", "/etc"] {
            if Path::new(path).exists() {
                cmd.arg("--ro-bind").arg(path).arg(path);
            }
        }
        for root in &req.roots {
            add_parent_dirs(&mut cmd, &root.mount_path);
            if root.writable {
                cmd.arg("--bind");
            } else {
                cmd.arg("--ro-bind");
            }
            cmd.arg(&root.host_path).arg(&root.mount_path);
        }
        if self.unshare_user {
            if let Some(uid) = self.sandbox_uid {
                cmd.arg("--uid").arg(uid.to_string());
            }
            if let Some(gid) = self.sandbox_gid {
                cmd.arg("--gid").arg(gid.to_string());
            }
        }
        cmd.arg("--setenv")
            .arg("HOME")
            .arg(req.cwd.display().to_string());
        for (key, value) in &req.env {
            if is_safe_env_key(key) {
                cmd.arg("--setenv").arg(key).arg(value);
            }
        }
        cmd.arg("--chdir")
            .arg(&req.cwd)
            .arg("--")
            .arg("bash")
            .arg("-lc")
            .arg(command);
        Ok(cmd)
    }

    async fn repair_ownership(&self, roots: &[PreparedRoot]) {
        let paths = writable_root_paths(roots);
        self.repair_ownership_paths(&paths).await;
    }

    async fn repair_ownership_paths(&self, roots: &[PathBuf]) {
        let (Some(uid), Some(gid)) = (self.sandbox_uid, self.sandbox_gid) else {
            return;
        };
        for root in roots {
            let Ok(root) = root.canonicalize() else {
                continue;
            };
            if !root.starts_with(&self.data_root) {
                tracing::warn!(
                    root = %root.display(),
                    data_root = %self.data_root.display(),
                    "skipping ownership repair outside runner data root"
                );
                continue;
            }
            match Command::new("chown")
                .arg("-hR")
                .arg(format!("{uid}:{gid}"))
                .arg("--")
                .arg(&root)
                .status()
                .await
            {
                Ok(status) if status.success() => {}
                Ok(status) => {
                    tracing::warn!(
                        root = %root.display(),
                        status = ?status.code(),
                        "ownership repair command failed"
                    );
                }
                Err(err) => {
                    tracing::warn!(
                        root = %root.display(),
                        error = %err,
                        "ownership repair command could not start"
                    );
                }
            }
        }
    }
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn env_u32(key: &str) -> Option<u32> {
    std::env::var(key).ok().and_then(|value| value.parse().ok())
}

fn env_bool(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn canonicalize_existing(path: &str) -> Result<PathBuf, RunnerError> {
    Path::new(path)
        .canonicalize()
        .map_err(|err| RunnerError::BadRequest(format!("invalid path {path}: {err}")))
}

fn add_parent_dirs(cmd: &mut Command, path: &Path) {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if current == Path::new("/") || current == path {
            continue;
        }
        cmd.arg("--dir").arg(&current);
    }
}

fn writable_root_paths(roots: &[PreparedRoot]) -> Vec<PathBuf> {
    let mut paths = roots
        .iter()
        .filter(|root| root.writable)
        .map(|root| root.host_path.clone())
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    paths
}

async fn wait_for_pid_exit(pid: u32) -> bool {
    for _ in 0..20 {
        let running = Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false);
        if !running {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

fn is_safe_env_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
        && !key.contains("KEY")
        && !key.contains("TOKEN")
        && !key.contains("SECRET")
        && !key.contains("PASSWORD")
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RunnerMode {
    Bubblewrap,
    Firecracker,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    mode: RunnerMode,
    ready: bool,
    data_root: String,
    firecracker_configured: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteRequest {
    command: String,
    cwd: String,
    roots: Vec<RunnerRoot>,
    timeout_secs: Option<u64>,
    env: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartProcessRequest {
    #[serde(flatten)]
    execution: ExecuteRequest,
    port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerRoot {
    host_path: String,
    mount_path: String,
    writable: bool,
}

#[derive(Debug)]
struct PreparedRequest {
    cwd: PathBuf,
    roots: Vec<PreparedRoot>,
    env: BTreeMap<String, String>,
}

#[derive(Debug)]
struct PreparedRoot {
    host_path: PathBuf,
    mount_path: PathBuf,
    writable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResponse {
    success: bool,
    stdout: String,
    stderr: String,
    exit_code: i32,
    cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ProcessStatus {
    Running,
    Exited,
    Failed,
    Stopped,
}

#[derive(Debug, Clone)]
struct ProcessRecord {
    id: Uuid,
    command: String,
    cwd: String,
    pid: Option<u32>,
    status: ProcessStatus,
    log_path: PathBuf,
    port: Option<u16>,
    writable_roots: Vec<PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartProcessResponse {
    id: Uuid,
    pid: Option<u32>,
    status: ProcessStatus,
    forwarded_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct ListProcessesResponse {
    processes: Vec<ProcessSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessSummary {
    id: Uuid,
    status: ProcessStatus,
    command: String,
    cwd: String,
    pid: Option<u32>,
    port: Option<u16>,
}

impl From<&ProcessRecord> for ProcessSummary {
    fn from(record: &ProcessRecord) -> Self {
        Self {
            id: record.id,
            status: record.status.clone(),
            command: record.command.clone(),
            cwd: record.cwd.clone(),
            pid: record.pid,
            port: record.port,
        }
    }
}

#[derive(Debug, Serialize)]
struct StopProcessResponse {
    success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessLogsResponse {
    id: Uuid,
    status: ProcessStatus,
    command: String,
    cwd: String,
    pid: Option<u32>,
    port: Option<u16>,
    logs: String,
}

#[derive(Debug, thiserror::Error)]
enum RunnerError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("unavailable: {0}")]
    Unavailable(String),
    #[error("execution error: {0}")]
    Execution(String),
}

impl axum::response::IntoResponse for RunnerError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            RunnerError::BadRequest(_) => axum::http::StatusCode::BAD_REQUEST,
            RunnerError::NotFound(_) => axum::http::StatusCode::NOT_FOUND,
            RunnerError::Unavailable(_) => axum::http::StatusCode::SERVICE_UNAVAILABLE,
            RunnerError::Execution(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = Json(serde_json::json!({ "error": self.to_string() }));
        (status, body).into_response()
    }
}
