//! MoA preset API models.
//!
//! Presets store orchestration settings and LLM provider IDs, but never contain
//! API keys or resolved credentials. Runtime provider construction remains in
//! the chat service so credential rotation and rate-limit handling stay on the
//! same path as normal single-provider turns.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoaPreset {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub proposer_provider_ids: Vec<String>,
    pub aggregator_provider_id: String,
    pub max_concurrent: i32,
    pub aggregation_prompt: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoaProviderRef {
    pub id: String,
    pub label: String,
    pub model: String,
}

#[derive(Debug, Serialize)]
pub struct MoaPresetsResponse {
    pub presets: Vec<MoaPreset>,
}

#[derive(Debug, Serialize)]
pub struct MoaPresetResponse {
    pub preset: MoaPreset,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMoaPresetResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMoaPresetRequest {
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub proposer_provider_ids: Vec<String>,
    pub aggregator_provider_id: String,
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent: i32,
    #[serde(default = "default_aggregation_prompt")]
    pub aggregation_prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMoaPresetRequest {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub proposer_provider_ids: Option<Vec<String>>,
    pub aggregator_provider_id: Option<String>,
    pub max_concurrent: Option<i32>,
    pub aggregation_prompt: Option<String>,
}

fn default_enabled() -> bool {
    true
}

fn default_max_concurrent() -> i32 {
    3
}

fn default_aggregation_prompt() -> String {
    "Synthesize the proposer outputs into one final answer.".to_string()
}
