use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::process::Command;
use uuid::Uuid;

use super::error::RunnerError;
use super::firecracker::{
    api_put as firecracker_api_put, copy_rootfs_image, guest_mac as firecracker_guest_mac,
    network as firecracker_network, setup_tap,
};
use super::host::{remote_command, run_host_shell, sh_quote, terminate_pid, wait_for_socket};
use super::logs::append_stream;
use super::path_policy::writable_root_paths;
use super::types::{
    ExecuteResponse, FirecrackerRuntime, PreparedRequest, PreparedRootSnapshot, ProcessRecord,
    ProcessStatus, StartProcessRequest, StartProcessResponse,
};
use super::{proxy, RunnerState};

impl RunnerState {
    pub(super) async fn execute_firecracker(
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

    pub(super) async fn start_firecracker_process(
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

    pub(super) async fn sync_firecracker_writable_roots(
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

    pub(super) async fn teardown_firecracker_runtime(&self, runtime: &FirecrackerRuntime) {
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
}
