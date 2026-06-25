//! Agent operational data models — Hermes cron jobs, scheduler status,
//! and gateway status.
//!
//! These mirror the frontend types in web/src/types/index.ts.
//! All data is read-only (queried from the Hermes CLI at request time,
//! never stored in mymy's PostgreSQL).

use serde::{Deserialize, Serialize};

/// A single Hermes cron job, parsed from `hermes cron list` output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJob {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub schedule: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deliver: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run: Option<String>,
    pub paused: bool,
}

/// Cron scheduler status, parsed from `hermes cron status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronStatus {
    pub scheduler_running: bool,
    pub active_jobs: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Combined response for the cron endpoint (jobs + scheduler status).
#[derive(Debug, Serialize)]
pub struct CronResponse {
    pub jobs: Vec<CronJob>,
    pub status: CronStatus,
}

/// Gateway / model status for the Overview tab.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Response for the status endpoint.
#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub gateway: GatewayStatus,
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/// A single Hermes chat session, parsed from `hermes sessions list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_active: Option<String>,
}

/// Response for the sessions endpoint.
#[derive(Debug, Serialize)]
pub struct SessionsResponse {
    pub sessions: Vec<SessionInfo>,
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/// A single installed Hermes skill, parsed from `hermes skills list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Response for the skills endpoint.
#[derive(Debug, Serialize)]
pub struct SkillsResponse {
    pub skills: Vec<SkillInfo>,
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/// Hermes memory provider status + built-in memory content.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    /// Active external provider name, if any (e.g. "mem0").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Whether the built-in memory (USER.md) is active (always true).
    pub builtin_active: bool,
    /// Installed but not necessarily active memory plugins.
    pub installed_plugins: Vec<String>,
    /// Raw content of `~/.hermes/memories/USER.md`, if present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_memory: Option<String>,
}

/// Response for the memory endpoint.
#[derive(Debug, Serialize)]
pub struct MemoryResponse {
    pub memory: MemoryInfo,
}

// ---------------------------------------------------------------------------
// Identity (SOUL.md)
// ---------------------------------------------------------------------------

/// Hermes agent identity, parsed from `~/.hermes/SOUL.md`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityInfo {
    /// Agent name extracted from the markdown (e.g. "Aria").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Agent role extracted from the markdown (e.g. "Orchestrator").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Full raw markdown content of SOUL.md.
    pub content: String,
}

/// Response for the identity endpoint.
#[derive(Debug, Serialize)]
pub struct IdentityResponse {
    pub identity: IdentityInfo,
}

// ---------------------------------------------------------------------------
// Environment (hermes status)
// ---------------------------------------------------------------------------

/// An API key status entry from `hermes status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub name: String,
    pub configured: bool,
    /// Masked key fragment or "(not set)" detail.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// An auth provider status entry from `hermes status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProviderStatus {
    pub name: String,
    pub logged_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Full Hermes environment status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub python: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub api_keys: Vec<ApiKeyStatus>,
    pub auth_providers: Vec<AuthProviderStatus>,
}

/// Response for the environment endpoint.
#[derive(Debug, Serialize)]
pub struct EnvironmentResponse {
    pub environment: EnvironmentInfo,
}
