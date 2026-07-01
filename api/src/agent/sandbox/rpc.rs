//! Tool RPC transport for sandboxed code.
//!
//! The Python helper stub talks to this server over a per-execution Unix
//! domain socket. The socket keeps host tools out of the subprocess address
//! space while still allowing explicitly permitted calls, and the shared call
//! limiter gives every script a hard upper bound.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::task::JoinHandle;

use super::SandboxError;

const MAX_REQUEST_BYTES: usize = 64 * 1024;

#[async_trait]
pub trait SandboxRpcHandler: Send + Sync + 'static {
    async fn call(&self, tool: &str, args: Value) -> Result<Value, String>;
}

#[derive(Debug)]
pub struct SandboxRpcLimiter {
    max_calls: usize,
    used_calls: AtomicUsize,
}

impl SandboxRpcLimiter {
    pub fn new(max_calls: usize) -> Self {
        Self {
            max_calls,
            used_calls: AtomicUsize::new(0),
        }
    }

    pub fn try_acquire(&self) -> bool {
        let previous = self.used_calls.fetch_add(1, Ordering::SeqCst);
        if previous >= self.max_calls {
            self.used_calls.fetch_sub(1, Ordering::SeqCst);
            return false;
        }
        true
    }
}

pub struct SandboxRpcServer {
    socket_path: PathBuf,
    task: JoinHandle<()>,
}

impl SandboxRpcServer {
    pub async fn start(
        scratch_dir: &Path,
        max_calls: usize,
        handler: Arc<dyn SandboxRpcHandler>,
    ) -> Result<Self, SandboxError> {
        tokio::fs::create_dir_all(scratch_dir)
            .await
            .map_err(|err| SandboxError::Execution(format!("RPC dir create failed: {err}")))?;
        let socket_path = std::env::temp_dir().join(format!("mymy-{}.sock", uuid::Uuid::new_v4()));
        let _ = tokio::fs::remove_file(&socket_path).await;
        let listener = UnixListener::bind(&socket_path)
            .map_err(|err| SandboxError::Unavailable(format!("RPC socket bind failed: {err}")))?;
        let limiter = Arc::new(SandboxRpcLimiter::new(max_calls));
        let task = tokio::spawn(accept_loop(listener, limiter, handler));
        Ok(Self { socket_path, task })
    }

    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }
}

impl Drop for SandboxRpcServer {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

#[derive(Debug, Deserialize)]
struct RpcRequest {
    tool: String,
    #[serde(default)]
    args: Value,
}

#[derive(Debug, Serialize)]
struct RpcResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn accept_loop(
    listener: UnixListener,
    limiter: Arc<SandboxRpcLimiter>,
    handler: Arc<dyn SandboxRpcHandler>,
) {
    loop {
        let Ok((stream, _addr)) = listener.accept().await else {
            break;
        };
        let limiter = Arc::clone(&limiter);
        let handler = Arc::clone(&handler);
        tokio::spawn(async move {
            let _ = handle_connection(stream, limiter, handler).await;
        });
    }
}

async fn handle_connection(
    stream: UnixStream,
    limiter: Arc<SandboxRpcLimiter>,
    handler: Arc<dyn SandboxRpcHandler>,
) -> Result<(), std::io::Error> {
    let mut reader = BufReader::new(stream);
    let mut request = Vec::new();
    reader.read_until(b'\n', &mut request).await?;
    let response = if request.len() > MAX_REQUEST_BYTES {
        RpcResponse {
            ok: false,
            result: None,
            error: Some("RPC request too large".to_string()),
        }
    } else if !limiter.try_acquire() {
        RpcResponse {
            ok: false,
            result: None,
            error: Some("sandbox RPC call budget exhausted".to_string()),
        }
    } else {
        dispatch_request(&request, handler).await
    };

    let mut stream = reader.into_inner();
    let payload = serde_json::to_vec(&response).expect("RPC response serializes");
    stream.write_all(&payload).await?;
    stream.write_all(b"\n").await?;
    Ok(())
}

async fn dispatch_request(request: &[u8], handler: Arc<dyn SandboxRpcHandler>) -> RpcResponse {
    let parsed = match serde_json::from_slice::<RpcRequest>(request) {
        Ok(parsed) => parsed,
        Err(error) => {
            return RpcResponse {
                ok: false,
                result: None,
                error: Some(format!("invalid RPC request: {error}")),
            };
        }
    };
    match handler.call(&parsed.tool, parsed.args).await {
        Ok(value) => RpcResponse {
            ok: true,
            result: Some(value),
            error: None,
        },
        Err(error) => RpcResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limiter_enforces_call_budget() {
        let limiter = SandboxRpcLimiter::new(1);
        assert!(limiter.try_acquire());
        assert!(!limiter.try_acquire());
    }
}
