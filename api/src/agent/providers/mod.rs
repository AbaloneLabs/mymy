//! LLM provider abstraction layer.
//!
//! Ported from Hermes's transport layer (`agent/transports/`), simplified
//! for Rust. Two wire formats cover ~95% of real-world providers:
//!
//! 1. **OpenAI-compatible** — `chat/completions` + SSE streaming
//! 2. **Anthropic native** — `messages` API + typed SSE events
//!
//! Design rationale: Hermes separates transport (wire format) from client
//! (credential lifecycle). mymy merges them because we don't need credential
//! pools or cross-provider client reuse — each provider instance owns its
//! config and HTTP client.

pub mod anthropic;
pub mod openai;
pub mod types;

use std::time::Duration;

use async_trait::async_trait;
use futures::stream::BoxStream;
use serde::{Deserialize, Serialize};

pub use types::{StreamDelta, ToolCall};

// ============================================================
// Provider trait
// ============================================================

/// Canonical message in OpenAI format.
///
/// All provider implementations convert from this to their native format.
/// This is the lingua franca of the agent loop — it never leaks
/// provider-specific fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: MessageRole,
    /// Text content. May be empty when the message is a tool call or result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// Tool calls from the assistant (OpenAI format).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    /// Tool call ID this message responds to (for `role: "tool"` messages).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

/// Tool definition in OpenAI format.
///
/// Provider implementations convert to their native format (e.g. Anthropic
/// uses `input_schema` instead of `parameters`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSchema {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionSchema,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionSchema {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// JSON Schema for the function parameters.
    pub parameters: serde_json::Value,
}

// ============================================================
// Provider error
// ============================================================

/// Errors from LLM provider API calls.
///
/// The agent loop (Phase 2) uses these to decide retry behavior.
#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum ProviderError {
    #[error("authentication failed: {0}")]
    Auth(String),

    #[error("rate limited: retry after {retry_after_secs:?}s")]
    RateLimited { retry_after_secs: Option<u64> },

    #[error("invalid response from provider: {0}")]
    InvalidResponse(String),

    #[error("network error: {0}")]
    Network(String),

    #[error("provider returned error {status}: {body}")]
    HttpStatus { status: u16, body: String },

    #[error("stream ended unexpectedly")]
    StreamEnded,
}

impl ProviderError {
    /// True if this error is retryable (rate limit or transient network).
    ///
    /// Used by the agent loop (Phase 2) to decide whether to back off
    /// and retry the request.
    #[allow(dead_code)]
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            ProviderError::RateLimited { .. } | ProviderError::Network(_)
        )
    }
}

// ============================================================
// Config
// ============================================================

/// User-facing wire format selector.
///
/// Stored on every provider config entry in the `llm_providers` table.
/// The user explicitly chooses which wire format to use, with auto-detect
/// as a fallback (`None`).
///
/// Design decision: Hermes supports 6 `api_mode`s (chat_completions,
/// anthropic_messages, bedrock_converse, codex_responses, codex_app_server,
/// plus MoA). mymy collapses these to 2 formats because:
/// - Bedrock (SigV4) and Codex (responses API) are niche and complex
/// - MoA is advanced and deferred
/// - A simple hostname + model prefix check covers 100% of auto-detection
/// - The explicit override removes all ambiguity for edge cases
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiFormat {
    /// OpenAI-compatible chat/completions wire format.
    /// Covers: OpenAI, OpenRouter, Ollama, Groq, Together, Mistral,
    /// DeepSeek, vLLM, LM Studio, and any /v1/chat/completions endpoint.
    Openai,

    /// Anthropic native messages wire format.
    /// Covers: Anthropic direct, and OpenRouter/Bedrock Claude models
    /// that benefit from the native tool-use format.
    Anthropic,
}

/// Internal resolved format (never `None` after resolution).
///
/// This is what the factory uses to pick the concrete provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiMode {
    Openai,
    Anthropic,
}

/// Configuration for a single LLM provider instance.
///
/// Built from a decrypted DB row (see `services::llm_providers::resolve_runtime_config`).
/// This is the live, in-memory config consumed by `create_provider()`.
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    /// Explicit wire format. `None` = auto-detect from base_url/model.
    ///
    /// The DB stores `'openai'`, `'anthropic'`, or `'auto'`. The `'auto'`
    /// value maps to `None` here, meaning resolution happens at runtime.
    pub api_format: Option<ApiFormat>,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
}

impl ProviderConfig {
    /// Resolve the effective wire format: explicit override → auto-detect.
    ///
    /// Ported from `determine_api_mode` in `hermes_cli/providers.py:533-575`,
    /// simplified to 2 formats.
    pub fn resolved_mode(&self) -> ApiMode {
        resolve_api_format(self)
    }
}

/// Auto-detect the wire format from base_url and model name.
///
/// Resolution order:
/// 1. Explicit user override (the common case)
/// 2. Hostname match (`api.anthropic.com`)
/// 3. Model name prefix (`claude-*` and not OpenRouter)
/// 4. Default: OpenAI-compatible
fn resolve_api_format(config: &ProviderConfig) -> ApiMode {
    // 1. Explicit user override wins.
    if let Some(format) = config.api_format {
        return match format {
            ApiFormat::Openai => ApiMode::Openai,
            ApiFormat::Anthropic => ApiMode::Anthropic,
        };
    }

    // 2. Auto-detect from base_url hostname.
    let host = hostname_of(&config.base_url);
    if host == "api.anthropic.com" || config.base_url.ends_with("/anthropic") {
        return ApiMode::Anthropic;
    }

    // 3. Auto-detect from model name.
    if config.model.starts_with("claude-") && !host.contains("openrouter") {
        return ApiMode::Anthropic;
    }

    // 4. Default: OpenAI-compatible.
    ApiMode::Openai
}

/// Extract the hostname from a URL string (best-effort, no full parser).
fn hostname_of(url: &str) -> &str {
    let after_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    let after_scheme = after_scheme.unwrap_or(url);
    match after_scheme.find('/') {
        Some(idx) => &after_scheme[..idx],
        None => after_scheme,
    }
}

// ============================================================
// HTTP error helpers (shared by both providers)
// ============================================================

/// Parse the `Retry-After` header (seconds) if present.
///
/// Both OpenAI and Anthropic return this on 429 responses. The agent
/// loop (Phase 2) uses it for backoff timing.
pub(crate) fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
}

/// Map an HTTP error status + body to a typed [`ProviderError`].
///
/// - 401/403 → Auth (bad key)
/// - 429 → RateLimited (with retry-after)
/// - other → HttpStatus (raw body for debugging)
pub(crate) fn map_http_error(status: u16, body: String, retry_after: Option<u64>) -> ProviderError {
    match status {
        401 | 403 => ProviderError::Auth(format!("HTTP {status}: {}", truncate(&body, 200))),
        429 => ProviderError::RateLimited {
            retry_after_secs: retry_after,
        },
        _ => ProviderError::HttpStatus { status, body },
    }
}

/// Truncate a string to `max` chars, appending `…` if cut.
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

// ============================================================
// Provider trait
// ============================================================

/// Trait abstracting LLM providers.
///
/// Ported from Hermes's `ProviderTransport` (`base.py:16-89`), merged with
/// client lifecycle. The single `stream()` method handles both streaming
/// chat completions and tool calling.
///
/// `system_prompt` is passed separately because providers handle it
/// differently: OpenAI puts it in `messages[0]`, Anthropic uses a separate
/// `system` parameter.
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Stream a chat completion.
    ///
    /// Returns a stream of [`StreamDelta`]s. The caller (agent loop)
    /// assembles them into a [`ProviderResponse`].
    async fn stream(
        &self,
        system_prompt: &str,
        messages: &[Message],
        tools: &[ToolSchema],
    ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError>;

    /// Fetch the list of available models from the provider's `GET /models`.
    ///
    /// Used by the settings UI to populate the model dropdown.
    async fn list_models(&self) -> Result<Vec<types::ModelInfo>, ProviderError>;
}

/// Factory: create a provider from config.
///
/// Uses the resolved wire format (explicit override or auto-detect) to
/// pick the concrete implementation.
pub fn create_provider(config: &ProviderConfig) -> Box<dyn LlmProvider> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .expect("reqwest client should build");

    match config.resolved_mode() {
        ApiMode::Openai => Box::new(openai::OpenAiProvider::new(config.clone(), http)),
        ApiMode::Anthropic => Box::new(anthropic::AnthropicProvider::new(config.clone(), http)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_openai_format_resolves_to_openai() {
        let config = ProviderConfig {
            api_format: Some(ApiFormat::Openai),
            base_url: "https://api.anthropic.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            max_tokens: 1024,
        };
        assert_eq!(config.resolved_mode(), ApiMode::Openai);
    }

    #[test]
    fn explicit_anthropic_format_resolves_to_anthropic() {
        let config = ProviderConfig {
            api_format: Some(ApiFormat::Anthropic),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4o".to_string(),
            max_tokens: 1024,
        };
        assert_eq!(config.resolved_mode(), ApiMode::Anthropic);
    }

    #[test]
    fn auto_detect_anthropic_hostname() {
        let config = ProviderConfig {
            api_format: None,
            base_url: "https://api.anthropic.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "anything".to_string(),
            max_tokens: 1024,
        };
        assert_eq!(config.resolved_mode(), ApiMode::Anthropic);
    }

    #[test]
    fn auto_detect_claude_model_prefix() {
        let config = ProviderConfig {
            api_format: None,
            base_url: "https://custom-proxy.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "claude-sonnet-4-5-20250514".to_string(),
            max_tokens: 1024,
        };
        assert_eq!(config.resolved_mode(), ApiMode::Anthropic);
    }

    #[test]
    fn auto_detect_openrouter_claude_stays_openai() {
        let config = ProviderConfig {
            api_format: None,
            base_url: "https://openrouter.ai/api/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            max_tokens: 1024,
        };
        assert_eq!(config.resolved_mode(), ApiMode::Openai);
    }

    #[test]
    fn auto_detect_defaults_to_openai() {
        let config = ProviderConfig {
            api_format: None,
            base_url: "https://api.groq.com/openai/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "llama-3.3-70b".to_string(),
            max_tokens: 1024,
        };
        assert_eq!(config.resolved_mode(), ApiMode::Openai);
    }

    #[test]
    fn hostname_extraction_strips_path() {
        assert_eq!(hostname_of("https://api.openai.com/v1"), "api.openai.com");
        assert_eq!(
            hostname_of("https://api.anthropic.com/v1"),
            "api.anthropic.com"
        );
        assert_eq!(hostname_of("http://localhost:11434/v1"), "localhost:11434");
        assert_eq!(hostname_of("https://openrouter.ai/api/v1"), "openrouter.ai");
    }
}
