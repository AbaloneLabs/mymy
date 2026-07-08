use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::scheduler::{CronJob, JobMode};

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
pub struct InstantiateBlueprintRequest {
    #[serde(default)]
    pub values: Value,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
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
pub struct CreateCronJobRequest {
    pub title: String,
    pub prompt: String,
    pub schedule: String,
    #[serde(default)]
    pub mode: Option<JobMode>,
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCronJobRequest {
    pub title: Option<String>,
    pub prompt: Option<String>,
    pub schedule: Option<String>,
    pub mode: Option<JobMode>,
    pub max_runs: Option<Option<u32>>,
    pub enabled: Option<bool>,
    pub skills: Option<Vec<String>>,
    pub context_from: Option<Option<Vec<String>>>,
    pub wake_agent: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CronResultsQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
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
