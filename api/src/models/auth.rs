//! Request/response models for auth (PIN) endpoints.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct PinVerifyRequest {
    pub pin: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinVerifyResponse {
    pub valid: bool,
    pub authenticated: bool,
    /// Opaque browser-storage namespace for the authenticated server session.
    /// This is derived from, but cannot be used in place of, the HttpOnly
    /// session token.
    pub recovery_scope_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LogoutResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize)]
pub struct PinChangeRequest {
    pub current: String,
    pub next: String,
}

#[derive(Debug, Serialize)]
pub struct PinChangeResponse {
    pub success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatusResponse {
    pub initialized: bool,
    pub authenticated: bool,
    pub recovery_scope_id: Option<String>,
}
