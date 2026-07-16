use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::scheduler::{
    default_max_runtime_seconds, default_max_tool_calls, default_max_total_tokens, CronJob,
};

use super::blueprints::CronBlueprint;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobsResponse {
    pub jobs: Vec<CronJob>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronStatusResponse {
    pub scheduler_running: bool,
    pub active_jobs: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    pub ticker_alive: bool,
    pub ticker_firing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_age_secs: Option<i64>,
    pub timezone: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronResultsResponse {
    pub results: Vec<CronResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronBlueprintsResponse {
    pub blueprints: Vec<CronBlueprint>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct InstantiateBlueprintRequest {
    #[serde(default)]
    pub values: Value,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub agent_profile: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronResult {
    pub id: String,
    pub job_id: String,
    pub job_title: String,
    pub mode: String,
    pub status: String,
    pub output: String,
    pub output_path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct CreateCronJobRequest {
    pub title: String,
    pub prompt: String,
    pub schedule: String,
    #[serde(default)]
    pub max_runs: Option<u32>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub context_from: Option<Vec<String>>,
    #[serde(default = "default_wake_agent")]
    pub wake_agent: bool,
    #[serde(default)]
    pub agent_profile: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default = "default_session_policy")]
    pub session_policy: String,
    #[serde(default = "default_catch_up_policy")]
    pub catch_up_policy: String,
    #[serde(default = "default_retry_policy")]
    pub retry_policy: String,
    #[serde(default = "default_max_tool_calls")]
    pub max_tool_calls: u32,
    #[serde(default = "default_max_runtime_seconds")]
    pub max_runtime_seconds: u32,
    #[serde(default = "default_max_total_tokens")]
    pub max_total_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct UpdateCronJobRequest {
    pub title: Option<String>,
    pub prompt: Option<String>,
    pub schedule: Option<String>,
    pub max_runs: Option<Option<u32>>,
    pub enabled: Option<bool>,
    pub skills: Option<Vec<String>>,
    pub context_from: Option<Option<Vec<String>>>,
    pub wake_agent: Option<bool>,
    pub agent_profile: Option<Option<String>>,
    pub project_id: Option<Option<String>>,
    pub session_policy: Option<String>,
    pub catch_up_policy: Option<String>,
    pub retry_policy: Option<String>,
    pub max_tool_calls: Option<u32>,
    pub max_runtime_seconds: Option<u32>,
    pub max_total_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct CronResultsQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantinedCronJobsResponse {
    pub jobs: Vec<QuarantinedCronJobSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantinedCronJobSummary {
    pub id: String,
    pub legacy_job_id: String,
    pub title: String,
    pub was_enabled: bool,
    pub quarantine_reason: String,
    pub quarantined_at: String,
    pub prior_result_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_result_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantinedCronJobDetailResponse {
    pub job: QuarantinedCronJobSummary,
    pub original_definition: Value,
}

#[derive(Debug, Serialize)]
pub struct QuarantinedCronJobDeleteResponse {
    pub success: bool,
}

fn default_enabled() -> bool {
    true
}

fn default_limit() -> i64 {
    50
}

fn default_wake_agent() -> bool {
    true
}

fn default_session_policy() -> String {
    "reuse".to_string()
}

fn default_catch_up_policy() -> String {
    "latest".to_string()
}

fn default_retry_policy() -> String {
    "safe".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_request_rejects_removed_no_agent_mode() {
        let request = serde_json::from_value::<CreateCronJobRequest>(serde_json::json!({
            "title": "Job",
            "prompt": "Do work",
            "schedule": "every 1h",
            "mode": "no_agent"
        }));

        assert!(request.is_err());
    }

    #[test]
    fn update_request_rejects_any_legacy_mode_field() {
        let request = serde_json::from_value::<UpdateCronJobRequest>(serde_json::json!({
            "mode": "agent"
        }));

        assert!(request.is_err());
    }

    #[test]
    fn normal_agent_job_request_needs_no_mode() {
        let request = serde_json::from_value::<CreateCronJobRequest>(serde_json::json!({
            "title": "Job",
            "prompt": "Do work",
            "schedule": "every 1h"
        }))
        .unwrap();

        assert_eq!(request.title, "Job");
        assert_eq!(request.max_tool_calls, 100);
        assert_eq!(request.max_runtime_seconds, 1_800);
        assert_eq!(request.max_total_tokens, 200_000);
    }
}
