//! Settings domain models — mirror frontend `AppSettings`, `GitSystemConfig`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    En,
    Ko,
    Zh,
    Ja,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitSystemType {
    Github,
    Gitlab,
    Gitea,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitSystemConfig {
    pub r#type: GitSystemType,
    pub enabled: bool,
    pub host: String,
    pub port: i32,
    pub ssh_alias: String,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub language: Language,
    pub agent_systems: Vec<crate::models::agent_system::AgentSystemInstance>,
    pub git_systems: HashMap<String, GitSystemConfig>,
}

#[derive(Debug, Serialize)]
pub struct SettingsResponse {
    pub settings: AppSettings,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub language: Option<Language>,
    pub git_systems: Option<HashMap<String, GitSystemConfig>>,
}
