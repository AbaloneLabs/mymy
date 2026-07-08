use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tokio::process::Command;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::config_env;
use super::error::RunnerError;
use super::host::command_exists;
use super::metrics;
use super::path_policy::{
    add_parent_dirs, canonicalize_existing, is_safe_env_key, map_host_path_to_mount,
    writable_root_paths,
};
use super::types::{
    PreparedRequest, PreparedRoot, ProcessRecord, ProcessSummary, RunnerMode, RuntimeStatus,
};

#[derive(Debug)]
pub(super) struct RunnerState {
    pub(super) mode: RunnerMode,
    pub(super) data_root: PathBuf,
    pub(super) log_dir: PathBuf,
    pub(super) preview_host: String,
    pub(super) unshare_user: bool,
    pub(super) sandbox_uid: Option<u32>,
    pub(super) sandbox_gid: Option<u32>,
    pub(super) firecracker_bin: Option<PathBuf>,
    pub(super) firecracker_kernel: Option<PathBuf>,
    pub(super) firecracker_rootfs: Option<PathBuf>,
    pub(super) firecracker_ssh_key: Option<PathBuf>,
    pub(super) firecracker_work_dir: PathBuf,
    pub(super) firecracker_guest_user: String,
    pub(super) firecracker_kernel_args: String,
    pub(super) firecracker_vcpu_count: u8,
    pub(super) firecracker_mem_size_mib: u32,
    pub(super) firecracker_boot_timeout_secs: u64,
    pub(super) processes: RwLock<HashMap<Uuid, ProcessRecord>>,
}

impl RunnerState {
    pub(super) fn from_env() -> anyhow::Result<Self> {
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

    pub(super) fn runtime_status(&self) -> RuntimeStatus {
        RuntimeStatus {
            mode: self.mode,
            ready: self.mode == RunnerMode::Bubblewrap || self.firecracker_ready(),
            data_root: self.data_root.display().to_string(),
            firecracker_configured: self.firecracker_ready(),
        }
    }

    pub(super) fn firecracker_ready(&self) -> bool {
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

    pub(super) async fn process_summary(&self, record: &ProcessRecord) -> ProcessSummary {
        let (cpu_percent, memory_bytes) = match record.pid {
            Some(pid) => metrics::process_usage(pid).await,
            None => (None, None),
        };
        let storage_bytes = metrics::storage_usage(&record.writable_roots).await;
        let mut open_ports = record.port.into_iter().collect::<Vec<_>>();
        if let Some(pid) = record.pid {
            open_ports.extend(metrics::process_ports(pid).await);
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

    pub(super) fn prepare_request(
        &self,
        req: &super::types::ExecuteRequest,
    ) -> Result<PreparedRequest, RunnerError> {
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

    pub(super) fn build_bubblewrap_command(
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

    pub(super) async fn repair_ownership(&self, roots: &[PreparedRoot]) {
        let paths = writable_root_paths(roots);
        self.repair_ownership_paths(&paths).await;
    }

    pub(super) async fn repair_ownership_paths(&self, roots: &[PathBuf]) {
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
