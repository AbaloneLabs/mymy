//! HTTP client for the out-of-process sandbox runner.
//!
//! Agent tools run in the API process, but untrusted commands should not. This
//! module is the small contract between the authenticated API layer and the
//! execution runner. The same request shape works for the current bubblewrap
//! backend and the Firecracker backend once VM assets are configured.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct RunnerClient {
    base_url: String,
    http: reqwest::Client,
    token_file: Option<PathBuf>,
}

impl RunnerClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
            token_file: std::env::var("MYMY_SANDBOX_RUNNER_TOKEN_FILE")
                .ok()
                .map(PathBuf::from),
        }
    }

    pub async fn status(&self) -> AppResult<RunnerStatus> {
        self.get_json("/runtime/status").await
    }

    pub async fn execute(&self, req: &RunnerExecuteRequest) -> AppResult<RunnerExecuteResponse> {
        self.post_json("/execute", req).await
    }

    pub async fn cancel_execution(
        &self,
        execution_id: &str,
    ) -> AppResult<RunnerStopProcessResponse> {
        self.post_json(
            &format!("/executions/{}/cancel", urlencoding::encode(execution_id)),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn start_process(
        &self,
        req: &RunnerStartProcessRequest,
    ) -> AppResult<RunnerStartProcessResponse> {
        self.post_json("/processes", req).await
    }

    pub async fn list_processes(&self) -> AppResult<RunnerListProcessesResponse> {
        self.get_json("/processes").await
    }

    pub async fn stop_process(&self, id: Uuid) -> AppResult<RunnerStopProcessResponse> {
        self.post_json(&format!("/processes/{id}/stop"), &serde_json::json!({}))
            .await
    }

    pub async fn kill_process(&self, id: Uuid) -> AppResult<RunnerStopProcessResponse> {
        self.post_json(&format!("/processes/{id}/kill"), &serde_json::json!({}))
            .await
    }

    pub async fn process_logs(&self, id: Uuid) -> AppResult<RunnerProcessLogsResponse> {
        self.get_json(&format!("/processes/{id}/logs")).await
    }

    async fn get_json<T>(&self, path: &str) -> AppResult<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let mut request = self.http.get(format!("{}{}", self.base_url, path));
        if let Some(token) = self.control_token().await? {
            request = request.header("x-mymy-runner-token", token);
        }
        let response = request
            .send()
            .await
            .map_err(|err| AppError::Internal(format!("sandbox runner request failed: {err}")))?;
        parse_runner_response(response).await
    }

    async fn post_json<T, B>(&self, path: &str, body: &B) -> AppResult<T>
    where
        T: for<'de> Deserialize<'de>,
        B: Serialize + ?Sized,
    {
        let mut request = self
            .http
            .post(format!("{}{}", self.base_url, path))
            .json(body);
        if let Some(token) = self.control_token().await? {
            request = request.header("x-mymy-runner-token", token);
        }
        let response = request
            .send()
            .await
            .map_err(|err| AppError::Internal(format!("sandbox runner request failed: {err}")))?;
        parse_runner_response(response).await
    }

    async fn control_token(&self) -> AppResult<Option<String>> {
        let Some(path) = &self.token_file else {
            return Ok(None);
        };
        let token = tokio::fs::read_to_string(path).await.map_err(|err| {
            AppError::Internal(format!("sandbox runner token unavailable: {err}"))
        })?;
        let token = token.trim();
        if token.len() < 64 {
            return Err(AppError::Internal(
                "sandbox runner token is invalid".to_string(),
            ));
        }
        Ok(Some(token.to_string()))
    }
}

async fn parse_runner_response<T>(response: reqwest::Response) -> AppResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| AppError::Internal(format!("sandbox runner body failed: {err}")))?;
    if !status.is_success() {
        let message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.as_str())
                    .map(str::to_string)
            })
            .unwrap_or(text);
        return Err(AppError::BadRequest(message));
    }
    serde_json::from_str(&text)
        .map_err(|err| AppError::Internal(format!("sandbox runner JSON failed: {err}")))
}

pub fn roots_for_runner(primary_root: &Path, extra_roots: &[PathBuf]) -> Vec<RunnerRoot> {
    let mut roots = vec![RunnerRoot::for_path(primary_root)];
    roots.extend(extra_roots.iter().map(|root| RunnerRoot::for_path(root)));
    roots.sort_by(|left, right| left.host_path.cmp(&right.host_path));
    roots.dedup_by(|left, right| left.host_path == right.host_path);
    roots
}

pub fn logical_path_for_runner(path: &Path) -> String {
    let components = path
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if let Some(index) = components.iter().position(|component| component == "drive") {
        let suffix = components[index..].join("/");
        return format!("/{suffix}");
    }
    path.display().to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerExecuteRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_id: Option<String>,
    pub command: String,
    pub cwd: String,
    pub roots: Vec<RunnerRoot>,
    pub timeout_secs: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStartProcessRequest {
    #[serde(flatten)]
    pub execution: RunnerExecuteRequest,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerRoot {
    pub host_path: String,
    pub mount_path: String,
    pub writable: bool,
}

impl RunnerRoot {
    pub fn for_path(path: &Path) -> Self {
        let path = path.display().to_string();
        Self {
            host_path: path.clone(),
            mount_path: logical_path_for_runner(Path::new(&path)),
            // Drive is an admission-controlled data namespace. Sandboxed
            // processes receive it read-only and must use file-tool RPC for
            // writes, while non-Drive scratch roots remain writable.
            writable: !Path::new(&path)
                .components()
                .any(|component| component.as_os_str() == "drive"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{logical_path_for_runner, roots_for_runner};
    use std::path::{Path, PathBuf};

    #[test]
    fn maps_drive_paths_to_logical_mounts() {
        assert_eq!(
            logical_path_for_runner(Path::new("/app/data/agent/drive/agents/elena")),
            "/drive/agents/elena"
        );
        assert_eq!(
            logical_path_for_runner(Path::new("/app/data/agent/drive/shared")),
            "/drive/shared"
        );
    }

    #[test]
    fn leaves_non_drive_paths_physical() {
        assert_eq!(
            logical_path_for_runner(Path::new("/app/data/agent/sandbox/job")),
            "/app/data/agent/sandbox/job"
        );
    }

    #[test]
    fn runner_mounts_drive_read_only_and_scratch_writable() {
        let roots = roots_for_runner(
            Path::new("/app/data/agent/drive/agents/elena"),
            &[
                PathBuf::from("/app/data/agent/drive/shared"),
                PathBuf::from("/app/data/agent/sandbox/session"),
            ],
        );
        assert!(roots
            .iter()
            .filter(|root| root.host_path.contains("/drive/"))
            .all(|root| !root.writable));
        assert!(roots
            .iter()
            .find(|root| root.host_path.contains("/sandbox/"))
            .is_some_and(|root| root.writable));
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStatus {
    pub mode: String,
    pub ready: bool,
    pub data_root: String,
    pub firecracker_configured: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerExecuteResponse {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub cwd: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStartProcessResponse {
    pub id: Uuid,
    pub pid: Option<u32>,
    pub status: String,
    pub forwarded_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerListProcessesResponse {
    pub processes: Vec<RunnerProcessSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerProcessSummary {
    pub id: Uuid,
    pub status: String,
    pub command: String,
    pub cwd: String,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub cpu_percent: Option<f64>,
    pub memory_bytes: Option<i64>,
    pub storage_bytes: Option<i64>,
    #[serde(default)]
    pub open_ports: Vec<u16>,
}

#[derive(Debug, Deserialize)]
pub struct RunnerStopProcessResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerProcessLogsResponse {
    pub id: Uuid,
    pub status: String,
    pub command: String,
    pub cwd: String,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub logs: String,
}
