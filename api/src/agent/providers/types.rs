//! Core types shared across all LLM provider implementations.
//!
//! These types are the canonical, provider-agnostic representation of
//! LLM request/response data. Every concrete provider (OpenAI, Anthropic)
//! converts its native wire format into these types. The agent loop
//! (Phase 2) consumes *only* these types — it never sees provider-specific
//! fields, which keeps the loop portable across providers.
//!
//! Design rationale:
//! - `FinishReason` uses the OpenAI vocabulary as the canonical set because
//!   it is the most expressive (Anthropic maps onto it).
//! - `ToolCall` stores raw JSON arguments as a string because the agent
//!   loop parses them lazily per-tool, avoiding premature deserialization.
//! - `StreamDelta` is a sum type so the agent loop can pattern-match on
//!   exactly one event kind per iteration without ambiguity.
//!
//! NOTE: Several types here (`ProviderResponse`, `StreamDelta` variants,
//! `ModelListSource`, `ModelListResponse`) are not yet consumed by the
//! agent loop (Phase 2). They are part of the Phase 1 type contract and
//! are allowed as dead code until Phase 2 lands.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

// ============================================================
// Finish reason
// ============================================================

/// Why the model stopped generating.
///
/// Uses OpenAI's vocabulary as the canonical set. Anthropic's
/// `stop_reason` values are mapped onto these variants in
/// `anthropic.rs` (see `ANTHROPIC_STOP_REASON_MAP`).
///
/// The agent loop (Phase 2) branches on this: `ToolCalls` triggers
/// tool execution, `Stop` ends the turn, `Length`/`ContentFilter`
/// surfaces an error to the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    /// The model finished naturally (stop token or end of thought).
    Stop,
    /// The model requested one or more tool calls.
    ToolCalls,
    /// The response hit the `max_tokens` limit.
    Length,
    /// The provider's content filter triggered.
    ContentFilter,
}

// ============================================================
// Tool call
// ============================================================

/// A single tool/function call requested by the model.
///
/// `arguments` is stored as a raw JSON string (not pre-parsed) because:
/// 1. The agent loop (Phase 2) deserializes it into the specific tool's
///    parameter struct, which varies per tool.
/// 2. It preserves the exact bytes the model emitted, useful for
///    debugging malformed tool calls.
/// 3. It avoids a double-deserialize (provider → Value → tool struct).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// Provider-assigned ID for this call (e.g. `call_abc123`).
    /// Used to correlate the tool result message back to this call.
    pub id: String,
    /// The function/tool name to invoke.
    pub name: String,
    /// JSON-encoded arguments string. May be `"{}"` for no-arg tools.
    pub arguments: String,
}

// ============================================================
// Token usage
// ============================================================

/// Token usage reported by the provider for a single completion.
///
/// All providers report at least prompt + completion tokens. Some
/// (OpenAI o-series, Anthropic) report cached/reasoning tokens — those
/// are tracked here but are informational only.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    /// Sum of prompt + completion. Computed by the provider.
    pub total_tokens: u32,
}

// ============================================================
// Full response (non-streaming aggregate)
// ============================================================

/// The complete, assembled response from a single model turn.
///
/// Built by the agent loop from a stream of [`StreamDelta`]s. This is
/// what gets persisted to the chat history and inspected for tool calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderResponse {
    /// Concatenated text content (may be empty if only tool calls).
    pub content: String,
    /// Tool calls the model requested (empty if `finish_reason != ToolCalls`).
    pub tool_calls: Vec<ToolCall>,
    /// Why generation stopped.
    pub finish_reason: FinishReason,
    /// Chain-of-thought / reasoning text (extended thinking models only).
    ///
    /// Separated from `content` so the UI can render it differently
    /// (collapsed, muted). Empty for models that don't produce it.
    #[serde(default)]
    pub reasoning: String,
    /// Token usage for this turn.
    pub usage: Usage,
}

// ============================================================
// Streaming delta
// ============================================================

/// A single event in the streaming response.
///
/// The agent loop consumes these one at a time. The stream is ordered:
/// text deltas arrive first, then tool call deltas (start → argument
/// fragments → done), then the final usage/finish reason.
///
/// A single enum keeps provider streams simple to normalize and inspect.
#[derive(Debug, Clone)]
pub enum StreamDelta {
    /// A fragment of text content to append.
    Text(String),

    /// Start of a new tool call. The agent loop allocates a buffer.
    ToolCallStart {
        index: usize,
        id: String,
        name: String,
    },

    /// A fragment of JSON arguments for the tool call at `index`.
    ToolCallArguments {
        index: usize,
        /// Raw JSON fragment string (concatenate, then parse once at end).
        fragment: String,
    },

    /// The model finished generating. Contains the final reason + usage.
    Finish { reason: FinishReason, usage: Usage },

    /// A fragment of reasoning/chain-of-thought text (extended thinking).
    Reasoning(String),
}

// ============================================================
// Model listing (settings UI)
// ============================================================

/// A single model returned by the provider's `GET /models` endpoint,
/// or from the curated fallback preset.
///
/// Used by the settings UI (`ModelSelect.tsx`) to populate the model
/// dropdown. The `is_curated` flag distinguishes live API results
/// from offline fallback entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// The model identifier to send in API requests (e.g. `gpt-4o`).
    pub id: String,
    /// Human-readable name for display. Falls back to `id` if the
    /// provider doesn't return a display name.
    pub display_name: String,
    /// `true` if this entry came from the hardcoded curated preset
    /// (offline fallback), `false` if from the live API.
    pub is_curated: bool,
}

/// Where the model list came from, for UI feedback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelListSource {
    /// Live API call to `GET /models` succeeded.
    Live,
    /// API call failed; returned the curated preset instead.
    Curated,
    /// Both failed; user must type a model name manually.
    Error,
}

/// Response payload for `POST /api/llm-providers/models`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelListResponse {
    pub models: Vec<ModelInfo>,
    pub source: ModelListSource,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finish_reason_serializes_snake_case() {
        let json = serde_json::to_string(&FinishReason::ToolCalls).unwrap();
        assert_eq!(json, "\"tool_calls\"");
        let parsed: FinishReason = serde_json::from_str("\"tool_calls\"").unwrap();
        assert_eq!(parsed, FinishReason::ToolCalls);
    }

    #[test]
    fn tool_call_round_trips() {
        let call = ToolCall {
            id: "call_abc".to_string(),
            name: "read_file".to_string(),
            arguments: r#"{"path":"/tmp/x"}"#.to_string(),
        };
        let json = serde_json::to_string(&call).unwrap();
        let parsed: ToolCall = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "call_abc");
        assert_eq!(parsed.name, "read_file");
        assert_eq!(parsed.arguments, r#"{"path":"/tmp/x"}"#);
    }

    #[test]
    fn usage_defaults_to_zero() {
        let u = Usage::default();
        assert_eq!(u.prompt_tokens, 0);
        assert_eq!(u.completion_tokens, 0);
        assert_eq!(u.total_tokens, 0);
    }

    #[test]
    fn model_info_serializes() {
        let info = ModelInfo {
            id: "gpt-4o".to_string(),
            display_name: "gpt-4o".to_string(),
            is_curated: true,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"is_curated\":true"));
    }

    #[test]
    fn model_list_source_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&ModelListSource::Live).unwrap(),
            "\"live\""
        );
        assert_eq!(
            serde_json::to_string(&ModelListSource::Curated).unwrap(),
            "\"curated\""
        );
        assert_eq!(
            serde_json::to_string(&ModelListSource::Error).unwrap(),
            "\"error\""
        );
    }
}
