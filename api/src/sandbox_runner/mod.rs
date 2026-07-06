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

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path as AxumPath, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use tokio::process::Command;
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

mod config_env;
mod error;
mod firecracker;
mod host;
mod logs;
mod path_policy;
mod proxy;
mod types;

use error::RunnerError;
use firecracker::{
    api_put as firecracker_api_put, copy_rootfs_image, guest_mac as firecracker_guest_mac,
    network as firecracker_network, setup_tap,
};
use host::{
    command_exists, remote_command, run_host_shell, sh_quote, terminate_pid, wait_for_pid_exit,
    wait_for_socket,
};
use logs::append_stream;
use path_policy::{
    add_parent_dirs, canonicalize_existing, is_safe_env_key, map_host_path_to_mount,
    writable_root_paths,
};
use types::{
    ExecuteRequest, ExecuteResponse, FirecrackerRuntime, ListProcessesResponse, PreparedRequest,
    PreparedRoot, PreparedRootSnapshot, ProcessLogsResponse, ProcessRecord, ProcessStatus,
    ProcessSummary, RunnerMode, RuntimeStatus, StartProcessRequest, StartProcessResponse,
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
    firecracker_ssh_key: Option<PathBuf>,
    firecracker_work_dir: PathBuf,
    firecracker_guest_user: String,
    firecracker_kernel_args: String,
    firecracker_vcpu_count: u8,
    firecracker_mem_size_mib: u32,
    firecracker_boot_timeout_secs: u64,
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
        let firecracker_work_dir = config_env::path("FIRECRACKER_WORK_DIR")
            .unwrap_or_else(|| data_root.join("firecracker-vms"));
        std::fs::create_dir_all(&firecracker_work_dir)?;
        Ok(Self {
            mode,
            data_root,
            log_dir,
            preview_host: std::env::var("MYMY_SANDBOX_PREVIEW_HOST")
                .unwrap_or_else(|_| "sandbox-runner".to_string()),
            unshare_user: config_env::flag("MYMY_SANDBOX_UNSHARE_USER"),
            sandbox_uid: config_env::u32("MYMY_SANDBOX_UID"),
            sandbox_gid: config_env::u32("MYMY_SANDBOX_GID"),
            firecracker_bin: config_env::path("FIRECRACKER_BIN"),
            firecracker_kernel: config_env::path("FIRECRACKER_KERNEL_IMAGE"),
            firecracker_rootfs: config_env::path("FIRECRACKER_ROOTFS_IMAGE"),
            firecracker_ssh_key: config_env::path("FIRECRACKER_SSH_KEY_PATH"),
            firecracker_work_dir,
            firecracker_guest_user: std::env::var("FIRECRACKER_GUEST_USER")
                .unwrap_or_else(|_| "root".to_string()),
            firecracker_kernel_args: std::env::var("FIRECRACKER_KERNEL_ARGS")
                .unwrap_or_else(|_| "console=ttyS0 reboot=k panic=1 pci=off".to_string()),
            firecracker_vcpu_count: config_env::u8("FIRECRACKER_VCPU_COUNT").unwrap_or(1),
            firecracker_mem_size_mib: config_env::u32("FIRECRACKER_MEM_SIZE_MIB").unwrap_or(512),
            firecracker_boot_timeout_secs: config_env::u64("FIRECRACKER_BOOT_TIMEOUT_SECS")
                .unwrap_or(30),
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
            && self
                .firecracker_ssh_key
                .as_ref()
                .is_some_and(|path| path.exists())
            && Path::new("/dev/kvm").exists()
            && command_exists("ssh")
            && command_exists("tar")
            && command_exists("ip")
            && command_exists("curl")
    }

    async fn process_summary(&self, record: &ProcessRecord) -> ProcessSummary {
        let (cpu_percent, memory_bytes) = match record.pid {
            Some(pid) => process_usage(pid).await,
            None => (None, None),
        };
        let storage_bytes = storage_usage(&record.writable_roots).await;
        let mut open_ports = record.port.into_iter().collect::<Vec<_>>();
        if let Some(pid) = record.pid {
            open_ports.extend(process_ports(pid).await);
        }
        open_ports.sort_unstable();
        open_ports.dedup();
        ProcessSummary {
            id: record.id,
            status: record.status.clone(),
            command: record.command.clone(),
            cwd: record.cwd.clone(),
            pid: record.pid,
            port: record.port,
            cpu_percent,
            memory_bytes,
            storage_bytes,
            open_ports,
        }
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
        let sandbox_cwd = map_host_path_to_mount(&cwd, &roots).ok_or_else(|| {
            RunnerError::BadRequest(format!("cwd cannot be mapped into sandbox: {}", req.cwd))
        })?;
        Ok(PreparedRequest {
            sandbox_cwd,
            roots,
            env: req.env.clone().unwrap_or_default(),
        })
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
            .arg(req.sandbox_cwd.display().to_string());
        for (key, value) in &req.env {
            if is_safe_env_key(key) {
                cmd.arg("--setenv").arg(key).arg(value);
            }
        }
        cmd.arg("--chdir")
            .arg(&req.sandbox_cwd)
            .arg("--")
            .arg("bash")
            .arg("-lc")
            .arg(command);
        Ok(cmd)
    }

    async fn execute_firecracker(
        &self,
        req: &PreparedRequest,
        command: &str,
        timeout_secs: u64,
    ) -> Result<ExecuteResponse, RunnerError> {
        let id = Uuid::new_v4();
        let log_path = self.log_dir.join(format!("{id}.firecracker.log"));
        let runtime = self.launch_firecracker_runtime(id, req, &log_path).await?;
        let result = async {
            self.sync_firecracker_roots_to_guest(&runtime).await?;
            let mut ssh = self.firecracker_ssh_command(&runtime)?;
            ssh.arg(remote_command(&req.sandbox_cwd, &req.env, command));
            let output = tokio::time::timeout(Duration::from_secs(timeout_secs), ssh.output())
                .await
                .map_err(|_| {
                    RunnerError::Execution(format!("command timed out after {timeout_secs}s"))
                })?
                .map_err(|err| {
                    RunnerError::Execution(format!("firecracker ssh failed to start: {err}"))
                })?;
            self.sync_firecracker_writable_roots(&runtime).await?;
            Ok(ExecuteResponse {
                success: output.status.success(),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code().unwrap_or(-1),
                cwd: req.sandbox_cwd.display().to_string(),
            })
        }
        .await;
        self.teardown_firecracker_runtime(&runtime).await;
        self.repair_ownership(&req.roots).await;
        result
    }

    async fn start_firecracker_process(
        self: &Arc<Self>,
        id: Uuid,
        log_path: PathBuf,
        prepared: PreparedRequest,
        req: StartProcessRequest,
    ) -> Result<StartProcessResponse, RunnerError> {
        let runtime = self
            .launch_firecracker_runtime(id, &prepared, &log_path)
            .await?;
        if let Err(err) = self.sync_firecracker_roots_to_guest(&runtime).await {
            self.teardown_firecracker_runtime(&runtime).await;
            return Err(err);
        }
        let proxy_shutdown = if let Some(port) = req.port {
            match proxy::start_port_proxy(id, port, runtime.guest_ip).await {
                Ok(shutdown) => Some(shutdown),
                Err(err) => {
                    self.teardown_firecracker_runtime(&runtime).await;
                    return Err(err);
                }
            }
        } else {
            None
        };

        let mut command = self.firecracker_ssh_command(&runtime)?;
        command.arg(remote_command(
            &prepared.sandbox_cwd,
            &prepared.env,
            &req.execution.command,
        ));
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                self.teardown_firecracker_runtime(&runtime).await;
                return Err(RunnerError::Execution(format!(
                    "firecracker process failed to start: {err}"
                )));
            }
        };
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let writable_roots = writable_root_paths(&prepared.roots);

        {
            let mut processes = self.processes.write().await;
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
                    firecracker: Some(runtime.clone()),
                    proxy_shutdown,
                },
            );
        }

        if let Some(stdout) = stdout {
            tokio::spawn(append_stream(log_path.clone(), stdout, "stdout"));
        }
        if let Some(stderr) = stderr {
            tokio::spawn(append_stream(log_path.clone(), stderr, "stderr"));
        }
        let process_state = Arc::clone(self);
        tokio::spawn(async move {
            let status = child.wait().await;
            let _ = process_state
                .sync_firecracker_writable_roots(&runtime)
                .await;
            process_state.teardown_firecracker_runtime(&runtime).await;
            process_state.repair_ownership_paths(&writable_roots).await;
            let mut processes = process_state.processes.write().await;
            if let Some(record) = processes.get_mut(&id) {
                record.status = match status {
                    Ok(status) if status.success() => ProcessStatus::Exited,
                    Ok(_) => ProcessStatus::Failed,
                    Err(_) => ProcessStatus::Failed,
                };
                if let Some(shutdown) = record.proxy_shutdown.take() {
                    let _ = shutdown.send(true);
                }
            }
        });

        Ok(StartProcessResponse {
            id,
            pid,
            status: ProcessStatus::Running,
            forwarded_url: req
                .port
                .map(|port| format!("http://{}:{port}", self.preview_host)),
        })
    }

    async fn launch_firecracker_runtime(
        &self,
        id: Uuid,
        req: &PreparedRequest,
        log_path: &Path,
    ) -> Result<FirecrackerRuntime, RunnerError> {
        let bin = self.firecracker_bin.as_ref().ok_or_else(|| {
            RunnerError::Unavailable("FIRECRACKER_BIN is not configured".to_string())
        })?;
        let kernel = self.firecracker_kernel.as_ref().ok_or_else(|| {
            RunnerError::Unavailable("FIRECRACKER_KERNEL_IMAGE is not configured".to_string())
        })?;
        let rootfs = self.firecracker_rootfs.as_ref().ok_or_else(|| {
            RunnerError::Unavailable("FIRECRACKER_ROOTFS_IMAGE is not configured".to_string())
        })?;
        let vm_net = firecracker_network(id);
        let work_dir = self.firecracker_work_dir.join(id.to_string());
        tokio::fs::create_dir_all(&work_dir).await.map_err(|err| {
            RunnerError::Execution(format!("firecracker work dir create failed: {err}"))
        })?;
        let socket_path = work_dir.join("firecracker.sock");
        let rootfs_path = work_dir.join("rootfs.ext4");
        copy_rootfs_image(rootfs, &rootfs_path).await?;
        setup_tap(&vm_net.tap_name, vm_net.host_ip).await?;

        let stdout = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .map_err(|err| RunnerError::Execution(format!("firecracker log open failed: {err}")))?;
        let stderr = stdout.try_clone().map_err(|err| {
            RunnerError::Execution(format!("firecracker log clone failed: {err}"))
        })?;
        let mut child = Command::new(bin);
        child
            .arg("--api-sock")
            .arg(&socket_path)
            .stdout(std::process::Stdio::from(stdout))
            .stderr(std::process::Stdio::from(stderr));
        let mut child = child.spawn().map_err(|err| {
            RunnerError::Execution(format!("firecracker process failed to start: {err}"))
        })?;
        let firecracker_pid = child.id();
        tokio::spawn(async move {
            let _ = child.wait().await;
        });

        let runtime = FirecrackerRuntime {
            id,
            work_dir,
            socket_path,
            rootfs_path,
            tap_name: vm_net.tap_name,
            host_ip: vm_net.host_ip,
            guest_ip: vm_net.guest_ip,
            firecracker_pid,
            roots: req.roots.iter().map(PreparedRootSnapshot::from).collect(),
        };
        let configured = async {
            wait_for_socket(&runtime.socket_path).await?;
            self.configure_firecracker(&runtime, kernel).await?;
            self.wait_for_firecracker_ssh(&runtime).await
        }
        .await;
        if let Err(err) = configured {
            self.teardown_firecracker_runtime(&runtime).await;
            return Err(err);
        }
        Ok(runtime)
    }

    async fn configure_firecracker(
        &self,
        runtime: &FirecrackerRuntime,
        kernel: &Path,
    ) -> Result<(), RunnerError> {
        firecracker_api_put(
            &runtime.socket_path,
            "/machine-config",
            serde_json::json!({
                "vcpu_count": self.firecracker_vcpu_count,
                "mem_size_mib": self.firecracker_mem_size_mib,
                "smt": false,
                "track_dirty_pages": false,
            }),
        )
        .await?;
        let boot_args = format!(
            "{} root=/dev/vda rw ip={}::{}:255.255.255.252::eth0:off",
            self.firecracker_kernel_args, runtime.guest_ip, runtime.host_ip
        );
        firecracker_api_put(
            &runtime.socket_path,
            "/boot-source",
            serde_json::json!({
                "kernel_image_path": kernel.display().to_string(),
                "boot_args": boot_args,
            }),
        )
        .await?;
        firecracker_api_put(
            &runtime.socket_path,
            "/drives/rootfs",
            serde_json::json!({
                "drive_id": "rootfs",
                "path_on_host": runtime.rootfs_path.display().to_string(),
                "is_root_device": true,
                "is_read_only": false,
            }),
        )
        .await?;
        firecracker_api_put(
            &runtime.socket_path,
            "/network-interfaces/eth0",
            serde_json::json!({
                "iface_id": "eth0",
                "guest_mac": firecracker_guest_mac(runtime.id),
                "host_dev_name": runtime.tap_name,
            }),
        )
        .await?;
        firecracker_api_put(
            &runtime.socket_path,
            "/actions",
            serde_json::json!({ "action_type": "InstanceStart" }),
        )
        .await
    }

    async fn wait_for_firecracker_ssh(
        &self,
        runtime: &FirecrackerRuntime,
    ) -> Result<(), RunnerError> {
        let attempts = self.firecracker_boot_timeout_secs.saturating_mul(2).max(1);
        for _ in 0..attempts {
            let mut ssh = self.firecracker_ssh_command(runtime)?;
            ssh.arg("true")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            if ssh
                .status()
                .await
                .map(|status| status.success())
                .unwrap_or(false)
            {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Err(RunnerError::Unavailable(format!(
            "firecracker guest {} did not become reachable over SSH",
            runtime.guest_ip
        )))
    }

    fn firecracker_ssh_command(
        &self,
        runtime: &FirecrackerRuntime,
    ) -> Result<Command, RunnerError> {
        let key = self.firecracker_ssh_key.as_ref().ok_or_else(|| {
            RunnerError::Unavailable("FIRECRACKER_SSH_KEY_PATH is not configured".to_string())
        })?;
        let mut command = Command::new("ssh");
        command
            .arg("-i")
            .arg(key)
            .arg("-o")
            .arg("BatchMode=yes")
            .arg("-o")
            .arg("StrictHostKeyChecking=no")
            .arg("-o")
            .arg("UserKnownHostsFile=/dev/null")
            .arg("-o")
            .arg("LogLevel=ERROR")
            .arg("-o")
            .arg("ConnectTimeout=2")
            .arg(format!(
                "{}@{}",
                self.firecracker_guest_user, runtime.guest_ip
            ));
        Ok(command)
    }

    fn firecracker_ssh_shell_prefix(
        &self,
        runtime: &FirecrackerRuntime,
    ) -> Result<String, RunnerError> {
        let key = self.firecracker_ssh_key.as_ref().ok_or_else(|| {
            RunnerError::Unavailable("FIRECRACKER_SSH_KEY_PATH is not configured".to_string())
        })?;
        Ok(format!(
            "ssh -i {} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=2 {}@{}",
            sh_quote(&key.display().to_string()),
            sh_quote(&self.firecracker_guest_user),
            runtime.guest_ip
        ))
    }

    async fn sync_firecracker_roots_to_guest(
        &self,
        runtime: &FirecrackerRuntime,
    ) -> Result<(), RunnerError> {
        let ssh = self.firecracker_ssh_shell_prefix(runtime)?;
        for root in &runtime.roots {
            let host = root.host_path.display().to_string();
            let mount = root.mount_path.display().to_string();
            let remote = format!(
                "mkdir -p {} && tar -C {} -xf -",
                sh_quote(&mount),
                sh_quote(&mount)
            );
            let pipeline = format!(
                "tar -C {} -cf - . | {} {}",
                sh_quote(&host),
                ssh,
                sh_quote(&remote)
            );
            run_host_shell(&pipeline, "firecracker root upload").await?;
        }
        Ok(())
    }

    async fn sync_firecracker_writable_roots(
        &self,
        runtime: &FirecrackerRuntime,
    ) -> Result<(), RunnerError> {
        let ssh = self.firecracker_ssh_shell_prefix(runtime)?;
        for root in runtime.roots.iter().filter(|root| root.writable) {
            let host = root.host_path.display().to_string();
            let mount = root.mount_path.display().to_string();
            let remote = format!("tar -C {} -cf - .", sh_quote(&mount));
            let pipeline = format!(
                "tmp=$(mktemp); {} {} > \"$tmp\" && find {} -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} + && tar -C {} -xf \"$tmp\"; rc=$?; rm -f \"$tmp\"; exit $rc",
                ssh,
                sh_quote(&remote),
                sh_quote(&host),
                sh_quote(&host)
            );
            run_host_shell(&pipeline, "firecracker root download").await?;
        }
        Ok(())
    }

    async fn teardown_firecracker_runtime(&self, runtime: &FirecrackerRuntime) {
        if let Some(pid) = runtime.firecracker_pid {
            terminate_pid(pid).await;
        }
        let _ = Command::new("ip")
            .arg("link")
            .arg("del")
            .arg(&runtime.tap_name)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
        let _ = tokio::fs::remove_dir_all(&runtime.work_dir).await;
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

async fn process_usage(pid: u32) -> (Option<f64>, Option<i64>) {
    let output = Command::new("ps")
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("%cpu=,rss=")
        .output()
        .await;
    let Ok(output) = output else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let cpu = parts.next().and_then(|value| value.parse::<f64>().ok());
    let memory_bytes = parts
        .next()
        .and_then(|value| value.parse::<i64>().ok())
        .map(|rss_kib| rss_kib.saturating_mul(1024));
    (cpu, memory_bytes)
}

async fn storage_usage(roots: &[PathBuf]) -> Option<i64> {
    let roots = roots.to_vec();
    tokio::task::spawn_blocking(move || {
        let total = roots
            .iter()
            .map(|root| directory_size(root))
            .fold(0_u64, u64::saturating_add);
        i64::try_from(total).ok()
    })
    .await
    .ok()
    .flatten()
}

fn directory_size(path: &Path) -> u64 {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if metadata.is_file() {
        return metadata.len();
    }
    if !metadata.is_dir() {
        return 0;
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .fold(0_u64, u64::saturating_add)
}

async fn process_ports(pid: u32) -> Vec<u16> {
    if !command_exists("ss") {
        return Vec::new();
    }
    let output = Command::new("ss").arg("-ltnp").output().await;
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let pid_marker = format!("pid={pid},");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| line.contains(&pid_marker))
        .filter_map(|line| {
            let local = line.split_whitespace().nth(3)?;
            local.rsplit(':').next()?.parse::<u16>().ok()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

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
