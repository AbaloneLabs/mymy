//! Agent system instance model — mirrors frontend `AgentSystemInstance`.
//!
//! See: web/src/types/index.ts (AgentSystemInstance interface)

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentSystemType {
    Hermes,
    Openclaw,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DiscoverySource {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionType {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstanceStatus {
    Connected,
    Disconnected,
    Pending,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSystemInstance {
    pub id: String,
    pub r#type: AgentSystemType,
    pub label: String,
    pub enabled: bool,
    pub source: DiscoverySource,
    pub connection: ConnectionType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_cli_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_profile_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_agents: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<InstanceStatus>,
}

#[derive(Debug, Serialize)]
pub struct AgentSystemsResponse {
    pub instances: Vec<AgentSystemInstance>,
}

#[derive(Debug, Serialize)]
pub struct AgentSystemResponse {
    pub instance: AgentSystemInstance,
}

/// Payload for creating a new manual instance.
#[derive(Debug, Deserialize)]
pub struct CreateAgentSystemRequest {
    pub r#type: AgentSystemType,
    pub label: String,
    pub enabled: Option<bool>,
    pub connection: ConnectionType,
    pub cli_path: Option<String>,
    pub profile_dir: Option<String>,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub ssh_user: Option<String>,
    pub remote_cli_path: Option<String>,
    pub remote_profile_dir: Option<String>,
}

/// Payload for patching an instance.
#[derive(Debug, Deserialize)]
pub struct UpdateAgentSystemRequest {
    pub label: Option<String>,
    pub enabled: Option<bool>,
    pub connection: Option<ConnectionType>,
    pub cli_path: Option<String>,
    pub profile_dir: Option<String>,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub ssh_user: Option<String>,
    pub remote_cli_path: Option<String>,
    pub remote_profile_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeleteResponse {
    pub success: bool,
}

#[derive(Debug, Serialize)]
pub struct DiscoverResponse {
    pub instances: Vec<AgentSystemInstance>,
}
