//! OpenAI-compatible chat/completions provider.
//!
//! This single implementation covers ~95% of LLM providers because most
//! (OpenRouter, Ollama, Groq, Together, Mistral, DeepSeek, vLLM, LM Studio)
//! expose an OpenAI-compatible `/chat/completions` endpoint.
//!
//! Wire format reference: https://platform.openai.com/docs/api-reference/chat
//!
//! ## Streaming
//!
//! Uses Server-Sent Events (`text/event-stream`). Each `data:` line is a
//! JSON chunk. The stream terminates with `data: [DONE]`.
//!
//! Tool calls arrive as incremental fragments across multiple chunks:
//! the first chunk has the call `id` + function `name`, subsequent chunks
//! append to `arguments`. We reassemble these into [`StreamDelta`] events.
//!
//! Ported from Hermes `agent/transports/chat_completions.py`, simplified:
//! - No credential pool (single key per provider instance)
//! - No prompt caching markers (deferred to Phase 17)
//! - No reasoning content extraction for DeepSeek (added per-provider as needed)

use async_trait::async_trait;
use futures::stream::BoxStream;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

use super::types::{FinishReason, ModelInfo, StreamDelta, Usage};
use super::{map_http_error, parse_retry_after, ProviderConfig, ProviderError, ToolSchema};

// ============================================================
// Provider implementation
// ============================================================

pub struct OpenAiProvider {
    config: ProviderConfig,
    http: reqwest::Client,
}

impl OpenAiProvider {
    pub fn new(config: ProviderConfig, http: reqwest::Client) -> Self {
        Self { config, http }
    }

    /// Build the full chat/completions URL.
    ///
    /// `base_url` may or may not have a trailing slash; we normalize.
    fn completions_url(&self) -> String {
        format!(
            "{}/chat/completions",
            self.config.base_url.trim_end_matches('/')
        )
    }

    /// Build the models listing URL.
    fn models_url(&self) -> String {
        format!("{}/models", self.config.base_url.trim_end_matches('/'))
    }

    fn auth_headers(&self) -> Result<HeaderMap, ProviderError> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let auth = format!("Bearer {}", self.config.api_key);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&auth)
                .map_err(|_| ProviderError::Auth("invalid API key characters".into()))?,
        );
        Ok(headers)
    }
}

#[async_trait]
impl super::LlmProvider for OpenAiProvider {
    async fn stream(
        &self,
        system_prompt: &str,
        messages: &[super::Message],
        tools: &[ToolSchema],
    ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
        let body = ChatCompletionsRequest::build(
            &self.config.model,
            self.config.max_tokens,
            system_prompt,
            messages,
            tools,
        );

        let response = self
            .http
            .post(self.completions_url())
            .headers(self.auth_headers()?)
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let retry_after = parse_retry_after(response.headers());
            let body = response.text().await.unwrap_or_default();
            return Err(map_http_error(status, body, retry_after));
        }

        let byte_stream = response.bytes_stream();
        let stream = parse_sse_stream(byte_stream);
        Ok(Box::pin(stream))
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let response = self
            .http
            .get(self.models_url())
            .headers(self.auth_headers()?)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::HttpStatus { status, body });
        }

        let listing: ModelsListResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::InvalidResponse(format!("models parse error: {e}")))?;

        Ok(listing
            .data
            .into_iter()
            .map(|m| ModelInfo {
                display_name: m.id.clone(),
                id: m.id,
                is_curated: false,
            })
            .collect())
    }
}

// ============================================================
// Request body construction
// ============================================================

/// OpenAI chat/completions request body.
///
/// Built from the canonical [`Message`] list. Tool definitions are
/// included only when the caller provides them (empty slice → omitted).
#[derive(Debug, Serialize)]
struct ChatCompletionsRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    stream: bool,
    /// Tool definitions. Omitted entirely when empty (some providers
    /// reject an empty `tools` array).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<ToolSchema>,
    /// Required for tool calling with streaming: returns tool call deltas.
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
}

#[derive(Debug, Serialize)]
struct StreamOptions {
    /// Include `usage` in the final stream chunk.
    include_usage: bool,
}

/// OpenAI message format.
///
/// System messages become `role: "system"`. Tool results use
/// `role: "tool"` with `tool_call_id`. Assistant tool calls are
/// serialized as `tool_calls` array.
#[derive(Debug, Serialize)]
struct OpenAiMessage {
    role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tool_calls: Vec<OpenAiToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

/// Assistant-side tool call in OpenAI format (nested under `function`).
#[derive(Debug, Serialize)]
struct OpenAiToolCall {
    id: String,
    #[serde(rename = "type")]
    call_type: &'static str,
    function: OpenAiFunction,
}

#[derive(Debug, Serialize)]
struct OpenAiFunction {
    name: String,
    arguments: String,
}

impl ChatCompletionsRequest {
    fn build(
        model: &str,
        max_tokens: u32,
        system_prompt: &str,
        messages: &[super::Message],
        tools: &[ToolSchema],
    ) -> Self {
        let mut openai_messages = Vec::with_capacity(messages.len() + 1);

        // System prompt is always messages[0] in OpenAI format.
        if !system_prompt.is_empty() {
            openai_messages.push(OpenAiMessage {
                role: "system",
                content: Some(system_prompt.to_string()),
                tool_calls: Vec::new(),
                tool_call_id: None,
            });
        }

        for msg in messages {
            openai_messages.push(OpenAiMessage {
                role: match msg.role {
                    super::MessageRole::System => "system",
                    super::MessageRole::User => "user",
                    super::MessageRole::Assistant => "assistant",
                    super::MessageRole::Tool => "tool",
                },
                content: msg.content.clone(),
                tool_calls: msg
                    .tool_calls
                    .iter()
                    .map(|tc| OpenAiToolCall {
                        id: tc.id.clone(),
                        call_type: "function",
                        function: OpenAiFunction {
                            name: tc.name.clone(),
                            arguments: tc.arguments.clone(),
                        },
                    })
                    .collect(),
                tool_call_id: msg.tool_call_id.clone(),
            });
        }

        ChatCompletionsRequest {
            model: model.to_string(),
            messages: openai_messages,
            max_tokens: Some(max_tokens),
            stream: true,
            tools: tools.to_vec(),
            // Always request usage in the stream so we can track token costs.
            stream_options: Some(StreamOptions {
                include_usage: true,
            }),
        }
    }
}

// ============================================================
// SSE response parsing
// ============================================================

/// A single streaming chunk from OpenAI.
#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
    #[serde(default)]
    usage: Option<UsageDto>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: Delta,
    #[serde(default, rename = "finish_reason")]
    finish_reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<DeltaToolCall>,
}

#[derive(Debug, Deserialize)]
struct DeltaToolCall {
    index: usize,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<DeltaFunction>,
}

#[derive(Debug, Default, Deserialize)]
struct DeltaFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UsageDto {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
    #[serde(default)]
    total_tokens: u32,
}

impl From<UsageDto> for Usage {
    fn from(u: UsageDto) -> Self {
        Usage {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
        }
    }
}

/// Map OpenAI's `finish_reason` string to our canonical enum.
fn parse_finish_reason(s: &str) -> FinishReason {
    match s {
        "stop" => FinishReason::Stop,
        "tool_calls" | "function_call" => FinishReason::ToolCalls,
        "length" => FinishReason::Length,
        "content_filter" => FinishReason::ContentFilter,
        _ => FinishReason::Stop,
    }
}

/// Parse the SSE byte stream into [`StreamDelta`] events.
///
/// SSE framing: lines separated by `\n`, data prefixed with `data: `.
/// The stream ends with `data: [DONE]`.
///
/// We buffer partial lines (a chunk boundary may split a `data:` line)
/// and emit deltas for each complete JSON object.
fn parse_sse_stream(
    byte_stream: impl futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + 'static,
) -> impl futures::Stream<Item = Result<StreamDelta, ProviderError>> + Send {
    async_stream::try_stream! {
        use futures::StreamExt as _;

        let mut byte_stream = Box::pin(byte_stream);
        let mut buffer = String::new();

        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = chunk_result.map_err(|e| ProviderError::Network(e.to_string()))?;
            buffer.push_str(std::str::from_utf8(&chunk).unwrap_or_default());

            // Process complete lines.
            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                // SSE lines are `data: <payload>` or event markers.
                let payload = match line.strip_prefix("data:") {
                    Some(p) => p.trim(),
                    None => continue,
                };

                if payload == "[DONE]" {
                    return;
                }

                let chunk: StreamChunk = match serde_json::from_str(payload) {
                    Ok(c) => c,
                    Err(_) => continue, // skip malformed lines
                };

                for choice in chunk.choices {
                    // Text content delta.
                    if let Some(text) = choice.delta.content {
                        if !text.is_empty() {
                            yield StreamDelta::Text(text);
                        }
                    }

                    // Tool call deltas.
                    for tc in choice.delta.tool_calls {
                        if let Some(id) = tc.id.clone() {
                            // Some providers send id only on the first chunk.
                            if !id.is_empty() {
                                let name = tc
                                    .function
                                    .as_ref()
                                    .and_then(|f| f.name.clone())
                                    .unwrap_or_default();
                                yield StreamDelta::ToolCallStart {
                                    index: tc.index,
                                    id,
                                    name,
                                };
                            }
                        }
                        if let Some(func) = tc.function {
                            if let Some(args) = func.arguments {
                                if !args.is_empty() {
                                    yield StreamDelta::ToolCallArguments {
                                        index: tc.index,
                                        fragment: args,
                                    };
                                }
                            }
                        }
                    }

                    // Finish reason.
                    if let Some(reason) = choice.finish_reason {
                        yield StreamDelta::Finish {
                            reason: parse_finish_reason(&reason),
                            usage: Usage::default(),
                        };
                    }
                }

                // Usage comes in a separate final chunk (with stream_options).
                if let Some(usage) = chunk.usage {
                    yield StreamDelta::Finish {
                        reason: FinishReason::Stop,
                        usage: usage.into(),
                    };
                }
            }
        }
    }
}

// ============================================================
// Models listing response
// ============================================================

#[derive(Debug, Deserialize)]
struct ModelsListResponse {
    data: Vec<ModelsListEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelsListEntry {
    id: String,
}

// ============================================================
// Curated model presets (offline fallback)
// ============================================================

/// Hardcoded common models for each provider family.
///
/// Used by the settings UI when the live `GET /models` call fails
/// (offline, auth error, provider doesn't support listing). These are
/// not exhaustive — just the most commonly used models at time of writing.
#[allow(dead_code)]
pub fn curated_models(base_url: &str) -> Vec<ModelInfo> {
    let host = base_url
        .strip_prefix("https://")
        .or_else(|| base_url.strip_prefix("http://"))
        .unwrap_or(base_url);
    let host = match host.find('/') {
        Some(idx) => &host[..idx],
        None => host,
    };

    let ids: &[&str] = if host.contains("anthropic") {
        CURATED_ANTHROPIC
    } else if host.contains("localhost") || host.contains("ollama") {
        CURATED_OLLAMA
    } else if host.contains("groq") {
        CURATED_GROQ
    } else {
        // Default to OpenAI-family presets for api.openai.com and unknown hosts.
        CURATED_OPENAI
    };

    ids.iter()
        .map(|id| ModelInfo {
            id: id.to_string(),
            display_name: id.to_string(),
            is_curated: true,
        })
        .collect()
}

#[allow(dead_code)]
const CURATED_OPENAI: &[&str] = &[
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4.1",
    "gpt-4.1-mini",
    "o1",
    "o1-mini",
    "o3-mini",
];

#[allow(dead_code)]
const CURATED_ANTHROPIC: &[&str] = &[
    "claude-sonnet-4-5-20250514",
    "claude-opus-4-20250514",
    "claude-haiku-3-5-20241022",
    "claude-3-7-sonnet-20250219",
];

#[allow(dead_code)]
const CURATED_OLLAMA: &[&str] = &["llama3.1", "llama3", "qwen2.5", "mistral", "phi3", "gemma2"];

#[allow(dead_code)]
const CURATED_GROQ: &[&str] = &[
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
];

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;

    #[test]
    fn curated_openai_for_openai_host() {
        let models = curated_models("https://api.openai.com/v1");
        assert!(models.iter().any(|m| m.id == "gpt-4o"));
        assert!(models.iter().all(|m| m.is_curated));
    }

    #[test]
    fn curated_anthropic_for_anthropic_host() {
        let models = curated_models("https://api.anthropic.com/v1");
        assert!(models.iter().any(|m| m.id.contains("claude")));
    }

    #[test]
    fn curated_ollama_for_localhost() {
        let models = curated_models("http://localhost:11434/v1");
        assert!(models.iter().any(|m| m.id == "llama3.1"));
    }

    #[test]
    fn finish_reason_mapping() {
        assert_eq!(parse_finish_reason("stop"), FinishReason::Stop);
        assert_eq!(parse_finish_reason("tool_calls"), FinishReason::ToolCalls);
        assert_eq!(parse_finish_reason("length"), FinishReason::Length);
        assert_eq!(
            parse_finish_reason("content_filter"),
            FinishReason::ContentFilter
        );
        assert_eq!(parse_finish_reason("unknown"), FinishReason::Stop);
    }

    #[tokio::test]
    async fn sse_parser_handles_text_and_done() {
        use bytes::Bytes;
        let raw = b"data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\ndata: [DONE]\n\n";
        let chunks: Vec<Result<Bytes, reqwest::Error>> = vec![Ok(Bytes::from_static(raw))];
        let stream = parse_sse_stream(futures::stream::iter(chunks));
        futures::pin_mut!(stream);

        let mut texts = Vec::new();
        while let Some(Ok(delta)) = stream.next().await {
            if let StreamDelta::Text(t) = delta {
                texts.push(t);
            }
        }
        assert_eq!(texts, vec!["Hello", " world"]);
    }

    #[tokio::test]
    async fn sse_parser_handles_split_chunks() {
        use bytes::Bytes;
        // A single `data:` line split across two byte chunks.
        let part1 = b"data: {\"choices\":[{\"delta\":{\"conte";
        let part2 = b"nt\":\"Hi\"}}]}\n\ndata: [DONE]\n\n";
        let chunks: Vec<Result<Bytes, reqwest::Error>> =
            vec![Ok(Bytes::from_static(part1)), Ok(Bytes::from_static(part2))];
        let stream = parse_sse_stream(futures::stream::iter(chunks));
        futures::pin_mut!(stream);

        let mut texts = Vec::new();
        while let Some(Ok(delta)) = stream.next().await {
            if let StreamDelta::Text(t) = delta {
                texts.push(t);
            }
        }
        assert_eq!(texts, vec!["Hi"]);
    }

    #[tokio::test]
    async fn sse_parser_assembles_tool_call_fragments() {
        use bytes::Bytes;
        let raw = b"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"read_file\",\"arguments\":\"\"}}]}}]}\n\ndata: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"path\\\":\\\"/tmp\\\"}\"}}]}}]}\n\ndata: [DONE]\n\n";
        let chunks: Vec<Result<Bytes, reqwest::Error>> = vec![Ok(Bytes::from_static(raw))];
        let stream = parse_sse_stream(futures::stream::iter(chunks));
        futures::pin_mut!(stream);

        let mut events = Vec::new();
        while let Some(Ok(delta)) = stream.next().await {
            events.push(delta);
        }
        // First event: ToolCallStart
        assert!(matches!(
            &events[0],
            StreamDelta::ToolCallStart { index: 0, id, name } if id == "call_1" && name == "read_file"
        ));
        // Second event: ToolCallArguments
        assert!(matches!(
            &events[1],
            StreamDelta::ToolCallArguments { index: 0, fragment } if fragment.contains("/tmp")
        ));
    }

    #[test]
    fn request_body_includes_system_prompt() {
        let body = ChatCompletionsRequest::build("gpt-4o", 1024, "You are helpful.", &[], &[]);
        assert_eq!(body.messages[0].role, "system");
        assert_eq!(
            body.messages[0].content.as_deref(),
            Some("You are helpful.")
        );
    }

    #[test]
    fn request_body_omits_empty_tools() {
        let body = ChatCompletionsRequest::build("gpt-4o", 1024, "", &[], &[]);
        let json = serde_json::to_string(&body).unwrap();
        assert!(!json.contains("\"tools\""));
    }

    #[test]
    fn request_body_includes_tools_when_provided() {
        let tool = ToolSchema {
            tool_type: "function".to_string(),
            function: super::super::FunctionSchema {
                name: "read_file".to_string(),
                description: Some("Read a file".to_string()),
                parameters: serde_json::json!({"type": "object"}),
            },
        };
        let body = ChatCompletionsRequest::build("gpt-4o", 1024, "", &[], &[tool]);
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("\"read_file\""));
    }

    #[test]
    fn models_list_response_parses() {
        let json = r#"{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}"#;
        let parsed: ModelsListResponse = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.data.len(), 2);
        assert_eq!(parsed.data[0].id, "gpt-4o");
    }
}
