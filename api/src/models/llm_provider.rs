//! LLM provider model — mirrors frontend `LlmProvider`.

use serde::{Deserialize, Serialize};

use crate::agent::providers::ApiFormat;

/// A configured LLM provider instance, as returned by the API.
///
/// The API key is always masked in this struct — never expose the raw key.
#[derive(Debug, Clone, Serialize)]
pub struct LlmProvider {
    pub id: String,
    pub label: String,
    /// Wire format: "openai", "anthropic", or "auto".
    pub api_format: String,
    pub base_url: String,
    /// Masked hint of the API key, e.g. `sk-...7a2b`.
    pub api_key_hint: String,
    pub model: String,
    pub max_tokens: i32,
    pub is_default: bool,
    pub enabled: bool,
    pub preset: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LlmProvidersResponse {
    pub providers: Vec<LlmProvider>,
}

#[derive(Debug, Serialize)]
pub struct LlmProviderResponse {
    pub provider: LlmProvider,
}

/// Payload for creating a new provider.
#[derive(Debug, Deserialize)]
pub struct CreateLlmProviderRequest {
    pub label: String,
    pub api_format: ApiFormatOption,
    pub base_url: String,
    /// Raw API key — encrypted before DB storage.
    pub api_key: String,
    pub model: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: i32,
    pub preset: Option<String>,
}

/// Payload for patching a provider.
///
/// `api_key` is optional: if `None`, the existing key is preserved.
#[derive(Debug, Deserialize)]
pub struct UpdateLlmProviderRequest {
    pub label: Option<String>,
    pub api_format: Option<ApiFormatOption>,
    pub base_url: Option<String>,
    /// If provided, re-encrypt and replace the stored key.
    /// If `None`, keep the existing key.
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub max_tokens: Option<i32>,
    pub enabled: Option<bool>,
}

/// Wire format option, accepts "auto" in addition to concrete formats.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiFormatOption {
    Openai,
    Anthropic,
    /// Auto-detect from base_url/model.
    Auto,
}

impl ApiFormatOption {
    /// Convert to the DB string representation.
    pub fn as_db_str(&self) -> &'static str {
        match self {
            ApiFormatOption::Openai => "openai",
            ApiFormatOption::Anthropic => "anthropic",
            ApiFormatOption::Auto => "auto",
        }
    }

    /// Convert to the provider config's `Option<ApiFormat>`.
    /// `Auto` maps to `None` (resolve at runtime).
    pub fn api_format(&self) -> Option<ApiFormat> {
        match self {
            ApiFormatOption::Openai => Some(ApiFormat::Openai),
            ApiFormatOption::Anthropic => Some(ApiFormat::Anthropic),
            ApiFormatOption::Auto => None,
        }
    }
}

/// Parse a DB api_format string into the option enum.
pub fn parse_api_format_option(s: &str) -> ApiFormatOption {
    match s {
        "anthropic" => ApiFormatOption::Anthropic,
        "auto" => ApiFormatOption::Auto,
        _ => ApiFormatOption::Openai,
    }
}

#[derive(Debug, Serialize)]
pub struct DeleteLlmProviderResponse {
    pub success: bool,
}

#[derive(Debug, Serialize)]
pub struct SetDefaultResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCredential {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_at: Option<String>,
    pub request_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct AgentCredentialsResponse {
    pub credentials: Vec<AgentCredential>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRateLimitStatus {
    pub provider_id: String,
    pub label: String,
    pub credentials: Vec<CredentialRateLimitStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRateLimitStatus {
    pub credential_id: Option<String>,
    pub label: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_after_secs: Option<i64>,
    pub request_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitStatusResponse {
    pub providers: Vec<ProviderRateLimitStatus>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgentCredentialRequest {
    pub label: String,
    pub api_key: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentCredentialRequest {
    pub status: Option<String>,
}

// ---- Model fetch (GET /models proxy) ----

/// Request body for fetching models from a provider.
///
/// Accepts raw credentials so it works before the provider is saved.
#[derive(Debug, Deserialize)]
pub struct FetchModelsRequest {
    pub base_url: String,
    pub api_key: String,
    pub api_format: ApiFormatOption,
}

/// A single model entry.
#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    /// Model identifier (e.g. "gpt-4o", "claude-sonnet-4-5-20250514").
    pub id: String,
    /// Human-readable name. Falls back to `id` if not provided.
    pub display_name: String,
    /// `true` if this entry came from the curated offline fallback list.
    pub is_curated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelListSource {
    Live,
    Curated,
    Error,
}

#[derive(Debug, Serialize)]
pub struct FetchModelsResponse {
    pub models: Vec<ModelInfo>,
    pub source: ModelListSource,
}

/// Response from the connection test endpoint.
#[derive(Debug, Serialize)]
pub struct TestConnectionResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Latency in milliseconds (only on success).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
}

fn default_max_tokens() -> i32 {
    16384
}
