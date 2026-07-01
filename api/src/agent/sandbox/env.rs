//! Shared execution environment contract.
//!
//! Tool code talks to this trait instead of spawning interpreters directly so
//! approval, environment scrubbing, RPC limits, and future container backends
//! stay behind one narrow boundary.

use std::collections::BTreeMap;
use std::path::PathBuf;

use async_trait::async_trait;
use serde::Serialize;

use super::SandboxError;

#[derive(Debug, Clone)]
pub struct ExecOptions {
    pub language: String,
    pub code: String,
    pub cwd: Option<PathBuf>,
    pub timeout_secs: u64,
    pub extra_env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub cwd: String,
}

#[async_trait]
pub trait ExecutionEnvironment: Send + Sync {
    async fn execute(&self, options: ExecOptions) -> Result<ExecResult, SandboxError>;
}
