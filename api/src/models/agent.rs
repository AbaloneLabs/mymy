//! Agent domain model — mirrors the frontend `Agent` type exactly.
//!
//! See: web/src/types/index.ts (Agent interface)

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Active,
    Idle,
    Offline,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentSource {
    Native,
    Hermes,
    Openclaw,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentModel {
    Qwen,
    Openai,
    Anthropic,
    Local,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub profile: String,
    pub name: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: AgentStatus,
    pub source: AgentSource,
    pub model: AgentModel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_path: Option<String>,
    pub drive_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_uid: Option<i32>,
    pub sandbox_status: SandboxStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_active_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SandboxStatus {
    Pending,
    Ready,
    Reconciling,
    Failed,
}

#[derive(Debug, Serialize)]
pub struct AgentsResponse {
    pub agents: Vec<Agent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRequest {
    #[serde(default)]
    pub profile: Option<String>,
    pub name: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AgentResponse {
    pub agent: Agent,
}

#[derive(Debug, Serialize)]
pub struct DeleteAgentResponse {
    pub success: bool,
}
