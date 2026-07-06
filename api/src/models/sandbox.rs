//! Sandbox runtime API models.
//!
//! These responses describe the authenticated API boundary, not the runner's
//! private process table. The API persists durable process metadata in
//! PostgreSQL so the UI can keep showing previous jobs after a server restart,
//! while volatile runner details such as PID and live logs are reconciled when
//! the runner is available.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxRuntimeResponse {
    pub runtime: SandboxRuntime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxRuntime {
    pub configured: bool,
    pub mode: String,
    pub ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_root: Option<String>,
    pub firecracker_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxProcessQuery {
    #[serde(default)]
    pub agent_profile: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSandboxProcessRequest {
    pub agent_profile: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxProcessesResponse {
    pub processes: Vec<SandboxProcess>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxProcessResponse {
    pub process: SandboxProcess,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxProcessLogsResponse {
    pub process: SandboxProcess,
    pub logs: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopSandboxProcessResponse {
    pub success: bool,
    pub process: SandboxProcess,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxProcess {
    pub id: String,
    pub agent_profile: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub command: String,
    pub cwd: String,
    pub status: SandboxProcessStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<i32>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub metadata: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_limit_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_limit_bytes: Option<i64>,
    pub open_ports: Vec<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_heartbeat_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_target_url: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SandboxProcessStatus {
    Starting,
    Running,
    Exited,
    Failed,
    Stopped,
}
