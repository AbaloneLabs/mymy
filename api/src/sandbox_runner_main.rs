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

use std::collections::{BTreeMap, HashMap};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path as AxumPath, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::io::{copy_bidirectional, AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio::sync::{watch, RwLock};
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
        let firecracker_work_dir =
            env_path("FIRECRACKER_WORK_DIR").unwrap_or_else(|| data_root.join("firecracker-vms"));
        std::fs::create_dir_all(&firecracker_work_dir)?;
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
            firecracker_ssh_key: env_path("FIRECRACKER_SSH_KEY_PATH"),
            firecracker_work_dir,
            firecracker_guest_user: std::env::var("FIRECRACKER_GUEST_USER")
                .unwrap_or_else(|_| "root".to_string()),
            firecracker_kernel_args: std::env::var("FIRECRACKER_KERNEL_ARGS")
                .unwrap_or_else(|_| "console=ttyS0 reboot=k panic=1 pci=off".to_string()),
            firecracker_vcpu_count: env_u8("FIRECRACKER_VCPU_COUNT").unwrap_or(1),
            firecracker_mem_size_mib: env_u32("FIRECRACKER_MEM_SIZE_MIB").unwrap_or(512),
            firecracker_boot_timeout_secs: env_u64("FIRECRACKER_BOOT_TIMEOUT_SECS").unwrap_or(30),
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
            match self.start_port_proxy(id, port, runtime.guest_ip).await {
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

    async fn start_port_proxy(
        &self,
        id: Uuid,
        port: u16,
        guest_ip: Ipv4Addr,
    ) -> Result<watch::Sender<bool>, RunnerError> {
        let listener = TcpListener::bind(("0.0.0.0", port)).await.map_err(|err| {
            RunnerError::Execution(format!("preview port {port} bind failed: {err}"))
        })?;
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        if changed.is_err() || *shutdown_rx.borrow() {
                            break;
                        }
                    }
                    accepted = listener.accept() => {
                        let Ok((mut inbound, _)) = accepted else {
                            continue;
                        };
                        tokio::spawn(async move {
                            match TcpStream::connect((guest_ip, port)).await {
                                Ok(mut outbound) => {
                                    let _ = copy_bidirectional(&mut inbound, &mut outbound).await;
                                }
                                Err(err) => {
                                    let _ = inbound
                                        .write_all(format!("proxy connection failed: {err}\n").as_bytes())
                                        .await;
                                }
                            }
                        });
                    }
                }
            }
            tracing::debug!(process_id = %id, port, "firecracker preview proxy stopped");
        });
        Ok(shutdown)
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

fn env_u8(key: &str) -> Option<u8> {
    std::env::var(key).ok().and_then(|value| value.parse().ok())
}

fn env_u64(key: &str) -> Option<u64> {
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

fn command_exists(command: &str) -> bool {
    std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {}", sh_quote(command)))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
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

fn map_host_path_to_mount(path: &Path, roots: &[PreparedRoot]) -> Option<PathBuf> {
    roots
        .iter()
        .filter(|root| path.starts_with(&root.host_path))
        .max_by_key(|root| root.host_path.components().count())
        .map(|root| {
            let suffix = path.strip_prefix(&root.host_path).unwrap_or(Path::new(""));
            root.mount_path.join(suffix)
        })
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

fn sh_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn remote_command(cwd: &Path, env: &BTreeMap<String, String>, command: &str) -> String {
    let assignments = env
        .iter()
        .filter(|(key, _)| is_safe_env_key(key))
        .map(|(key, value)| format!("{key}={}", sh_quote(value)))
        .collect::<Vec<_>>();
    let env_prefix = if assignments.is_empty() {
        String::new()
    } else {
        format!("env {} ", assignments.join(" "))
    };
    format!(
        "cd {} && {}bash -lc {}",
        sh_quote(&cwd.display().to_string()),
        env_prefix,
        sh_quote(command)
    )
}

async fn copy_rootfs_image(source: &Path, destination: &Path) -> Result<(), RunnerError> {
    let status = Command::new("cp")
        .arg("--reflink=auto")
        .arg("--sparse=always")
        .arg(source)
        .arg(destination)
        .status()
        .await;
    if status.map(|status| status.success()).unwrap_or(false) {
        return Ok(());
    }
    tokio::fs::copy(source, destination)
        .await
        .map_err(|err| RunnerError::Execution(format!("firecracker rootfs copy failed: {err}")))?;
    Ok(())
}

async fn setup_tap(name: &str, host_ip: Ipv4Addr) -> Result<(), RunnerError> {
    let _ = Command::new("ip")
        .arg("link")
        .arg("del")
        .arg(name)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
    let mut create = Command::new("ip");
    create
        .arg("tuntap")
        .arg("add")
        .arg("dev")
        .arg(name)
        .arg("mode")
        .arg("tap");
    run_host_command(&mut create, "tap create").await?;

    let mut address = Command::new("ip");
    address
        .arg("addr")
        .arg("add")
        .arg(format!("{host_ip}/30"))
        .arg("dev")
        .arg(name);
    run_host_command(&mut address, "tap address").await?;

    let mut enable = Command::new("ip");
    enable.arg("link").arg("set").arg(name).arg("up");
    run_host_command(&mut enable, "tap enable").await
}

async fn run_host_command(command: &mut Command, label: &str) -> Result<(), RunnerError> {
    let output = command
        .output()
        .await
        .map_err(|err| RunnerError::Execution(format!("{label} failed to start: {err}")))?;
    if output.status.success() {
        return Ok(());
    }
    Err(RunnerError::Execution(format!(
        "{label} failed: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )))
}

async fn run_host_shell(command: &str, label: &str) -> Result<(), RunnerError> {
    let mut shell = Command::new("bash");
    shell.arg("-lc").arg(command);
    run_host_command(&mut shell, label).await
}

async fn wait_for_socket(path: &Path) -> Result<(), RunnerError> {
    for _ in 0..100 {
        if path.exists() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(RunnerError::Unavailable(format!(
        "firecracker API socket was not created: {}",
        path.display()
    )))
}

async fn firecracker_api_put(
    socket_path: &Path,
    path: &str,
    body: serde_json::Value,
) -> Result<(), RunnerError> {
    let mut command = Command::new("curl");
    command
        .arg("--silent")
        .arg("--show-error")
        .arg("--fail")
        .arg("--unix-socket")
        .arg(socket_path)
        .arg("-X")
        .arg("PUT")
        .arg(format!("http://localhost{path}"))
        .arg("-H")
        .arg("Content-Type: application/json")
        .arg("-d")
        .arg(body.to_string());
    run_host_command(&mut command, &format!("firecracker API PUT {path}")).await
}

async fn terminate_pid(pid: u32) {
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

struct FirecrackerNetwork {
    tap_name: String,
    host_ip: Ipv4Addr,
    guest_ip: Ipv4Addr,
}

fn firecracker_network(id: Uuid) -> FirecrackerNetwork {
    let bytes = id.as_bytes();
    let third = bytes[0].max(1);
    let base = (bytes[1] % 62) * 4 + 1;
    FirecrackerNetwork {
        tap_name: format!("tap{}", &id.simple().to_string()[..8]),
        host_ip: Ipv4Addr::new(172, 31, third, base),
        guest_ip: Ipv4Addr::new(172, 31, third, base + 1),
    }
}

fn firecracker_guest_mac(id: Uuid) -> String {
    let bytes = id.as_bytes();
    format!(
        "AA:FC:{:02X}:{:02X}:{:02X}:{:02X}",
        bytes[0], bytes[1], bytes[2], bytes[3]
    )
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
    sandbox_cwd: PathBuf,
    roots: Vec<PreparedRoot>,
    env: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
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
    firecracker: Option<FirecrackerRuntime>,
    proxy_shutdown: Option<watch::Sender<bool>>,
}

#[derive(Debug, Clone)]
struct FirecrackerRuntime {
    id: Uuid,
    work_dir: PathBuf,
    socket_path: PathBuf,
    rootfs_path: PathBuf,
    tap_name: String,
    host_ip: Ipv4Addr,
    guest_ip: Ipv4Addr,
    firecracker_pid: Option<u32>,
    roots: Vec<PreparedRootSnapshot>,
}

#[derive(Debug, Clone)]
struct PreparedRootSnapshot {
    host_path: PathBuf,
    mount_path: PathBuf,
    writable: bool,
}

impl From<&PreparedRoot> for PreparedRootSnapshot {
    fn from(root: &PreparedRoot) -> Self {
        Self {
            host_path: root.host_path.clone(),
            mount_path: root.mount_path.clone(),
            writable: root.writable,
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

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
