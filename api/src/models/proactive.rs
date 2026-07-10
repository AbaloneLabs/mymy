//! Transport models for opt-in proactive discovery.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveSettings {
    pub agent_profile: String,
    pub enabled: bool,
    pub quiet_start_hour: i16,
    pub quiet_end_hour: i16,
    pub daily_run_budget: i32,
    pub max_tool_calls: i32,
    pub max_runtime_seconds: i32,
    pub max_total_tokens: i32,
    pub cooldown_hours: i32,
    pub idle_fallback_days: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateProactiveSettings {
    pub enabled: Option<bool>,
    pub quiet_start_hour: Option<i16>,
    pub quiet_end_hour: Option<i16>,
    pub daily_run_budget: Option<i32>,
    pub max_tool_calls: Option<i32>,
    pub max_runtime_seconds: Option<i32>,
    pub max_total_tokens: Option<i32>,
    pub cooldown_hours: Option<i32>,
    pub idle_fallback_days: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveCandidate {
    pub id: String,
    pub agent_profile: String,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub kind: String,
    pub reason: String,
    pub score: f64,
    pub status: String,
    pub run_id: Option<String>,
    pub cooldown_until: Option<String>,
    pub discovered_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveSettingsResponse {
    pub settings: ProactiveSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveCandidatesResponse {
    pub candidates: Vec<ProactiveCandidate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveCandidatesQuery {
    pub agent_profile: Option<String>,
    pub status: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    100
}
