//! Request/response models for auth (PIN) endpoints.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct PinVerifyRequest {
    pub pin: String,
}

#[derive(Debug, Serialize)]
pub struct PinVerifyResponse {
    pub valid: bool,
    pub authenticated: bool,
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
pub struct AuthStatusResponse {
    pub initialized: bool,
    pub authenticated: bool,
}
