//! Shared Hermes ops types.

use serde::Deserialize;

/// Errors that can occur during a Hermes ops query.
#[derive(Debug, thiserror::Error)]
pub enum OpsError {
    #[error("hermes CLI not found or failed to spawn: {0}")]
    CliNotFound(String),
    #[error("hermes command timed out (no response within 15s)")]
    Timeout,
    #[error("io error: {0}")]
    Io(String),
    /// The hermes CLI exited with a non-zero status.
    #[error("hermes CLI failed: {0}")]
    HermesFailed(String),
}

#[derive(Debug, Deserialize)]
pub(super) struct GatewayStateFile {
    pub gateway_state: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ConfigModel {
    pub default: Option<String>,
    pub provider: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ConfigRoot {
    pub model: Option<ConfigModel>,
}
