//! Wire and internal process types for the sandbox runner.
//!
//! Keeping request/response DTOs separate from backend implementations makes
//! the HTTP contract stable while bubblewrap, Firecracker, and future shared-VM
//! backends evolve independently.

use std::collections::BTreeMap;
use std::net::Ipv4Addr;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RunnerMode {
    Bubblewrap,
    Firecracker,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeStatus {
    pub(crate) mode: RunnerMode,
    pub(crate) ready: bool,
    pub(crate) data_root: String,
    pub(crate) firecracker_configured: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteRequest {
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) roots: Vec<RunnerRoot>,
    pub(crate) timeout_secs: Option<u64>,
    pub(crate) env: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartProcessRequest {
    #[serde(flatten)]
    pub(crate) execution: ExecuteRequest,
    pub(crate) port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunnerRoot {
    pub(crate) host_path: String,
    pub(crate) mount_path: String,
    pub(crate) writable: bool,
}

#[derive(Debug)]
pub(crate) struct PreparedRequest {
    pub(crate) sandbox_cwd: PathBuf,
    pub(crate) roots: Vec<PreparedRoot>,
    pub(crate) env: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedRoot {
    pub(crate) host_path: PathBuf,
    pub(crate) mount_path: PathBuf,
    pub(crate) writable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteResponse {
    pub(crate) success: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) exit_code: i32,
    pub(crate) cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProcessStatus {
    Running,
    Exited,
    Failed,
    Stopped,
}

#[derive(Debug, Clone)]
pub(crate) struct ProcessRecord {
    pub(crate) id: Uuid,
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) pid: Option<u32>,
    pub(crate) status: ProcessStatus,
    pub(crate) log_path: PathBuf,
    pub(crate) port: Option<u16>,
    pub(crate) writable_roots: Vec<PathBuf>,
    pub(crate) firecracker: Option<FirecrackerRuntime>,
    pub(crate) proxy_shutdown: Option<watch::Sender<bool>>,
}

#[derive(Debug, Clone)]
pub(crate) struct FirecrackerRuntime {
    pub(crate) id: Uuid,
    pub(crate) work_dir: PathBuf,
    pub(crate) socket_path: PathBuf,
    pub(crate) rootfs_path: PathBuf,
    pub(crate) tap_name: String,
    pub(crate) host_ip: Ipv4Addr,
    pub(crate) guest_ip: Ipv4Addr,
    pub(crate) firecracker_pid: Option<u32>,
    pub(crate) roots: Vec<PreparedRootSnapshot>,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedRootSnapshot {
    pub(crate) host_path: PathBuf,
    pub(crate) mount_path: PathBuf,
    pub(crate) writable: bool,
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
pub(crate) struct StartProcessResponse {
    pub(crate) id: Uuid,
    pub(crate) pid: Option<u32>,
    pub(crate) status: ProcessStatus,
    pub(crate) forwarded_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ListProcessesResponse {
    pub(crate) processes: Vec<ProcessSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessSummary {
    pub(crate) id: Uuid,
    pub(crate) status: ProcessStatus,
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) pid: Option<u32>,
    pub(crate) port: Option<u16>,
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
pub(crate) struct StopProcessResponse {
    pub(crate) success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessLogsResponse {
    pub(crate) id: Uuid,
    pub(crate) status: ProcessStatus,
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) pid: Option<u32>,
    pub(crate) port: Option<u16>,
    pub(crate) logs: String,
}
