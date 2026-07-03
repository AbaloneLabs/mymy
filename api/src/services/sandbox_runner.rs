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
}

impl RunnerClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    pub async fn status(&self) -> AppResult<RunnerStatus> {
        self.get_json("/runtime/status").await
    }

    pub async fn execute(&self, req: &RunnerExecuteRequest) -> AppResult<RunnerExecuteResponse> {
        self.post_json("/execute", req).await
    }

    pub async fn start_process(
        &self,
        req: &RunnerStartProcessRequest,
    ) -> AppResult<RunnerStartProcessResponse> {
        self.post_json("/processes", req).await
    }

    pub async fn stop_process(&self, id: Uuid) -> AppResult<RunnerStopProcessResponse> {
        self.post_json(&format!("/processes/{id}/stop"), &serde_json::json!({}))
            .await
    }

    pub async fn process_logs(&self, id: Uuid) -> AppResult<RunnerProcessLogsResponse> {
        self.get_json(&format!("/processes/{id}/logs")).await
    }

    async fn get_json<T>(&self, path: &str) -> AppResult<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let response = self
            .http
            .get(format!("{}{}", self.base_url, path))
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
        let response = self
            .http
            .post(format!("{}{}", self.base_url, path))
            .json(body)
            .send()
            .await
            .map_err(|err| AppError::Internal(format!("sandbox runner request failed: {err}")))?;
        parse_runner_response(response).await
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
    let mut roots = vec![RunnerRoot::writable(primary_root)];
    roots.extend(extra_roots.iter().map(|root| RunnerRoot::writable(root)));
    roots
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerExecuteRequest {
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
    pub fn writable(path: &Path) -> Self {
        let path = path.display().to_string();
        Self {
            host_path: path.clone(),
            mount_path: path,
            writable: true,
        }
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
