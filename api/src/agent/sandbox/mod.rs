//! Code execution sandbox abstraction.
//!
//! The first backend is intentionally local and conservative: it gives the
//! agent a stable execution contract, scrubbed environment, bounded runtime,
//! and per-session scratch files without claiming OS isolation. Docker or a
//! remote executor can implement the same trait later without changing the
//! `execute_code` tool surface.

pub mod env;
pub mod local;
pub mod rpc;
pub mod scrub;
pub mod snapshot;

use std::path::PathBuf;

pub use env::{ExecOptions, ExecResult, ExecutionEnvironment};
pub use local::LocalEnvironment;
pub use rpc::{SandboxRpcHandler, SandboxRpcServer};
use snapshot::SessionSnapshot;

#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    #[error("invalid execution request: {0}")]
    InvalidRequest(String),
    #[error("execution timed out after {0}s")]
    Timeout(u64),
    #[error("execution environment unavailable: {0}")]
    Unavailable(String),
    #[error("execution failed: {0}")]
    Execution(String),
}

#[derive(Debug)]
pub struct SandboxManager {
    local: LocalEnvironment,
    snapshot: SessionSnapshot,
    scratch_dir: PathBuf,
}

impl SandboxManager {
    pub fn local(working_dir: PathBuf, scratch_dir: PathBuf) -> Self {
        Self {
            local: LocalEnvironment::new(working_dir, scratch_dir.clone()),
            snapshot: SessionSnapshot::capture_allowed_env(),
            scratch_dir,
        }
    }

    pub async fn execute_local(&self, options: ExecOptions) -> Result<ExecResult, SandboxError> {
        let _safe_env_count = self.snapshot.env.len();
        self.local.execute(options).await
    }

    pub async fn start_rpc(
        &self,
        max_calls: usize,
        handler: std::sync::Arc<dyn SandboxRpcHandler>,
    ) -> Result<SandboxRpcServer, SandboxError> {
        SandboxRpcServer::start(&self.scratch_dir, max_calls, handler).await
    }
}
