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
    pub tool_permissions: Vec<AgentToolPermission>,
    pub llm_settings: AgentLlmSettingsView,
}

/// Effective LLM configuration alongside the optional agent-owned overrides.
/// Provider credentials and endpoint details stay behind the provider service;
/// agent APIs expose only identifiers and labels needed for configuration UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentLlmSettingsView {
    pub inherits_global: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_provider_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_provider_enabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateAgentLlmSettings {
    #[serde(default)]
    pub provider_id: Option<uuid::Uuid>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolDomain {
    Prompts,
    Memory,
    Sessions,
    Goals,
    Calendar,
    Tasks,
    Knowledge,
    Notes,
    Drive,
    Processes,
    Finance,
    Investments,
    Agents,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolAccess {
    Access,
    ReadOnly,
    Denied,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolPermission {
    pub domain: AgentToolDomain,
    pub access: AgentToolAccess,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tool_permissions: Option<Vec<AgentToolPermission>>,
    #[serde(default)]
    pub llm_settings: Option<UpdateAgentLlmSettings>,
}

#[derive(Debug, Serialize)]
pub struct AgentResponse {
    pub agent: Agent,
}

#[derive(Debug, Serialize)]
pub struct DeleteAgentResponse {
    pub success: bool,
}
