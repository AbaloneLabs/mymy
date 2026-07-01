//! Anthropic native messages provider.
//!
//! Implements Anthropic's Messages API (`POST /v1/messages`), which uses
//! a different wire format from OpenAI:
//!
//! - System prompt is a top-level `system` parameter, not a message.
//! - Tool definitions use `input_schema` instead of `parameters`.
//! - Tool calls are content blocks (`type: "tool_use"`), not a separate
//!   `tool_calls` array.
//! - Tool results are user messages with `type: "tool_result"` blocks.
//! - Streaming uses typed SSE events (`message_start`, `content_block_start`,
//!   `content_block_delta`, `content_block_stop`, `message_delta`,
//!   `message_stop`).
//!
//! Wire format reference: https://docs.anthropic.com/en/api/messages
//!
//! Ported from Hermes `agent/transports/anthropic.py`, simplified:
//! - No prompt caching markers (deferred to Phase 17)
//! - No extended thinking signature replay (deferred)
//! - Single API key (no credential pool)

use async_trait::async_trait;
use futures::stream::BoxStream;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

use super::types::{FinishReason, ModelInfo, StreamDelta, Usage};
use super::{
    map_http_error, parse_retry_after, Message, MessageRole, ProviderConfig, ProviderError,
    ToolSchema,
};

// ============================================================
// Provider implementation
// ============================================================

pub struct AnthropicProvider {
    config: ProviderConfig,
    http: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(config: ProviderConfig, http: reqwest::Client) -> Self {
        Self { config, http }
    }

    fn messages_url(&self) -> String {
        format!("{}/messages", self.config.base_url.trim_end_matches('/'))
    }

    fn models_url(&self) -> String {
        format!("{}/models", self.config.base_url.trim_end_matches('/'))
    }

    fn auth_headers(&self) -> Result<HeaderMap, ProviderError> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        // Anthropic uses `x-api-key` header, not Bearer.
        headers.insert(
            "x-api-key",
            HeaderValue::from_str(&self.config.api_key)
                .map_err(|_| ProviderError::Auth("invalid API key characters".into()))?,
        );
        // Required version header.
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        Ok(headers)
    }
}

#[async_trait]
impl super::LlmProvider for AnthropicProvider {
    async fn stream(
        &self,
        system_prompt: &str,
        messages: &[Message],
        tools: &[ToolSchema],
    ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
        let body = MessagesRequest::build(
            &self.config.model,
            self.config.max_tokens,
            system_prompt,
            messages,
            tools,
        );

        let response = self
            .http
            .post(self.messages_url())
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
        let stream = parse_anthropic_sse(byte_stream);
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

        let listing: AnthropicModelsResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::InvalidResponse(format!("models parse error: {e}")))?;

        Ok(listing
            .data
            .into_iter()
            .map(|m| ModelInfo {
                display_name: m.display_name.unwrap_or_else(|| m.id.clone()),
                id: m.id,
                is_curated: false,
            })
            .collect())
    }
}

// ============================================================
// Request body construction
// ============================================================

/// Anthropic Messages API request body.
#[derive(Debug, Serialize)]
struct MessagesRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    stream: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<AnthropicTool>,
}

/// Anthropic message format.
///
/// Content is always an array of blocks (text, tool_use, tool_result).
/// Anthropic does not use a simple `content: "string"` — even plain text
/// is `[{"type":"text","text":"..."}]`.
#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: &'static str,
    content: Vec<ContentBlock>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
    },
}

/// Anthropic tool definition.
///
/// Uses `input_schema` instead of OpenAI's `parameters`.
#[derive(Debug, Serialize)]
struct AnthropicTool {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    input_schema: serde_json::Value,
}

impl MessagesRequest {
    fn build(
        model: &str,
        max_tokens: u32,
        system_prompt: &str,
        messages: &[Message],
        tools: &[ToolSchema],
    ) -> Self {
        let anthropic_messages: Vec<AnthropicMessage> = messages
            .iter()
            .filter(|m| m.role != MessageRole::System) // system is top-level
            .map(convert_message)
            .collect();

        let anthropic_tools: Vec<AnthropicTool> = tools
            .iter()
            .map(|t| AnthropicTool {
                name: t.function.name.clone(),
                description: t.function.description.clone(),
                input_schema: t.function.parameters.clone(),
            })
            .collect();

        MessagesRequest {
            model: model.to_string(),
            messages: anthropic_messages,
            max_tokens,
            system: if system_prompt.is_empty() {
                None
            } else {
                Some(system_prompt.to_string())
            },
            stream: true,
            tools: anthropic_tools,
        }
    }
}

/// Convert a canonical [`Message`] to Anthropic's format.
///
/// Key differences from OpenAI:
/// - Assistant tool calls become `tool_use` content blocks.
/// - Tool results become user messages with `tool_result` blocks.
/// - Plain text content is wrapped in a `text` block.
fn convert_message(msg: &Message) -> AnthropicMessage {
    let role = match msg.role {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        // Tool results are sent as user messages in Anthropic format.
        MessageRole::Tool => "user",
        MessageRole::System => "user", // filtered out above, but safe default
    };

    let mut blocks = Vec::new();

    // Tool result message.
    if msg.role == MessageRole::Tool {
        if let Some(call_id) = &msg.tool_call_id {
            blocks.push(ContentBlock::ToolResult {
                tool_use_id: call_id.clone(),
                content: msg.content.clone().unwrap_or_default(),
            });
        }
        return AnthropicMessage {
            role,
            content: blocks,
        };
    }

    // Text content.
    if let Some(text) = &msg.content {
        if !text.is_empty() {
            blocks.push(ContentBlock::Text { text: text.clone() });
        }
    }

    // Assistant tool calls → tool_use blocks.
    for tc in &msg.tool_calls {
        let input: serde_json::Value = serde_json::from_str(&tc.arguments)
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        blocks.push(ContentBlock::ToolUse {
            id: tc.id.clone(),
            name: tc.name.clone(),
            input,
        });
    }

    AnthropicMessage {
        role,
        content: blocks,
    }
}

// ============================================================
// SSE response parsing (typed events)
// ============================================================

/// Anthropic SSE uses typed events: `event: <type>\ndata: <json>`.
///
/// Event types we care about:
/// - `message_start` — initial message metadata
/// - `content_block_start` — new content block (text or tool_use)
/// - `content_block_delta` — incremental content
/// - `content_block_stop` — block finished
/// - `message_delta` — finish reason + usage
/// - `message_stop` — stream end
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
enum AnthropicEvent {
    #[serde(rename = "message_start")]
    MessageStart {
        #[serde(default)]
        message: Option<MessageStartData>,
    },
    #[serde(rename = "content_block_start")]
    ContentBlockStart {
        index: usize,
        content_block: ContentBlockStart,
    },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta {
        index: usize,
        delta: ContentBlockDelta,
    },
    #[serde(rename = "content_block_stop")]
    ContentBlockStop { index: usize },
    #[serde(rename = "message_delta")]
    MessageDelta {
        #[serde(default)]
        delta: Option<MessageDeltaBody>,
        #[serde(default)]
        usage: Option<UsageDto>,
    },
    #[serde(rename = "message_stop")]
    MessageStop,
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MessageStartData {
    #[serde(default)]
    usage: Option<UsageDto>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
enum ContentBlockStart {
    #[serde(rename = "text")]
    Text {
        #[serde(default)]
        text: String,
    },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        input: serde_json::Value,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ContentBlockDelta {
    #[serde(rename = "text_delta")]
    TextDelta { text: String },
    #[serde(rename = "input_json_delta")]
    InputJsonDelta { partial_json: String },
}

#[derive(Debug, Deserialize)]
struct MessageDeltaBody {
    #[serde(default, rename = "stop_reason")]
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UsageDto {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
}

impl From<UsageDto> for Usage {
    fn from(u: UsageDto) -> Self {
        Usage {
            prompt_tokens: u.input_tokens,
            completion_tokens: u.output_tokens,
            total_tokens: u.input_tokens + u.output_tokens,
        }
    }
}

/// Map Anthropic's `stop_reason` to our canonical [`FinishReason`].
fn map_stop_reason(s: &str) -> FinishReason {
    match s {
        "end_turn" | "stop_sequence" => FinishReason::Stop,
        "tool_use" => FinishReason::ToolCalls,
        "max_tokens" => FinishReason::Length,
        _ => FinishReason::Stop,
    }
}

/// Parse Anthropic's typed SSE stream.
///
/// Unlike OpenAI's single `data:` lines, Anthropic sends pairs:
/// ```text
/// event: content_block_delta
/// data: {"type":"content_block_delta",...}
/// ```
/// We only need the `data:` lines (they contain the type tag), so we
/// skip `event:` lines.
fn parse_anthropic_sse(
    byte_stream: impl futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + 'static,
) -> impl futures::Stream<Item = Result<StreamDelta, ProviderError>> + Send {
    async_stream::try_stream! {
        use futures::StreamExt as _;

        let mut byte_stream = Box::pin(byte_stream);
        let mut buffer = String::new();

        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = chunk_result.map_err(|e| ProviderError::Network(e.to_string()))?;
            buffer.push_str(std::str::from_utf8(&chunk).unwrap_or_default());

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                // Skip `event:` lines — the type is in the JSON payload.
                let payload = match line.strip_prefix("data:") {
                    Some(p) => p.trim(),
                    None => continue,
                };

                if payload == "[DONE]" || payload.is_empty() {
                    continue;
                }

                let event: AnthropicEvent = match serde_json::from_str(payload) {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                match event {
                    AnthropicEvent::ContentBlockStart { index, content_block } => {
                        match content_block {
                            ContentBlockStart::Text { text } => {
                                if !text.is_empty() {
                                    yield StreamDelta::Text(text);
                                }
                            }
                            ContentBlockStart::ToolUse { id, name, .. } => {
                                yield StreamDelta::ToolCallStart { index, id, name };
                            }
                        }
                    }
                    AnthropicEvent::ContentBlockDelta { index, delta } => {
                        match delta {
                            ContentBlockDelta::TextDelta { text } => {
                                yield StreamDelta::Text(text);
                            }
                            ContentBlockDelta::InputJsonDelta { partial_json } => {
                                yield StreamDelta::ToolCallArguments {
                                    index,
                                    fragment: partial_json,
                                };
                            }
                        }
                    }
                    AnthropicEvent::MessageDelta { delta: Some(body), usage } => {
                        if let Some(reason) = &body.stop_reason {
                            yield StreamDelta::Finish {
                                reason: map_stop_reason(reason),
                                usage: usage.map(Usage::from).unwrap_or_default(),
                            };
                        }
                    }
                    AnthropicEvent::MessageStop => {
                        return;
                    }
                    _ => {}
                }
            }
        }
    }
}

// ============================================================
// Models listing response
// ============================================================

#[derive(Debug, Deserialize)]
struct AnthropicModelsResponse {
    data: Vec<AnthropicModelEntry>,
}

#[derive(Debug, Deserialize)]
struct AnthropicModelEntry {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::super::types::ToolCall;
    use super::super::FunctionSchema;
    use super::*;
    use futures::StreamExt;

    #[test]
    fn converts_simple_user_message() {
        let msg = Message {
            role: MessageRole::User,
            content: Some("Hello".to_string()),
            tool_calls: Vec::new(),
            tool_call_id: None,
        };
        let converted = convert_message(&msg);
        assert_eq!(converted.role, "user");
        assert_eq!(converted.content.len(), 1);
        match &converted.content[0] {
            ContentBlock::Text { text } => assert_eq!(text, "Hello"),
            _ => panic!("expected text block"),
        }
    }

    #[test]
    fn converts_assistant_tool_call() {
        let msg = Message {
            role: MessageRole::Assistant,
            content: Some("Let me check".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_1".to_string(),
                name: "read_file".to_string(),
                arguments: r#"{"path":"/tmp"}"#.to_string(),
            }],
            tool_call_id: None,
        };
        let converted = convert_message(&msg);
        assert_eq!(converted.role, "assistant");
        // text block + tool_use block
        assert_eq!(converted.content.len(), 2);
        match &converted.content[1] {
            ContentBlock::ToolUse { id, name, input } => {
                assert_eq!(id, "call_1");
                assert_eq!(name, "read_file");
                assert_eq!(input["path"], "/tmp");
            }
            _ => panic!("expected tool_use block"),
        }
    }

    #[test]
    fn converts_tool_result_to_user_message() {
        let msg = Message {
            role: MessageRole::Tool,
            content: Some("file contents".to_string()),
            tool_calls: Vec::new(),
            tool_call_id: Some("call_1".to_string()),
        };
        let converted = convert_message(&msg);
        // Tool results become user messages in Anthropic format.
        assert_eq!(converted.role, "user");
        match &converted.content[0] {
            ContentBlock::ToolResult {
                tool_use_id,
                content,
            } => {
                assert_eq!(tool_use_id, "call_1");
                assert_eq!(content, "file contents");
            }
            _ => panic!("expected tool_result block"),
        }
    }

    #[test]
    fn system_prompt_is_top_level() {
        let body = MessagesRequest::build("claude-sonnet-4-5", 1024, "Be helpful.", &[], &[]);
        assert_eq!(body.system.as_deref(), Some("Be helpful."));
        // No system message in the messages array.
        assert!(body.messages.is_empty());
    }

    #[test]
    fn empty_system_prompt_omitted() {
        let body = MessagesRequest::build("claude-sonnet-4-5", 1024, "", &[], &[]);
        assert!(body.system.is_none());
    }

    #[test]
    fn tools_use_input_schema() {
        let tool = ToolSchema {
            tool_type: "function".to_string(),
            function: FunctionSchema {
                name: "read_file".to_string(),
                description: Some("Read".to_string()),
                parameters: serde_json::json!({"type": "object"}),
            },
        };
        let body = MessagesRequest::build("claude-sonnet-4-5", 1024, "", &[], &[tool]);
        assert_eq!(body.tools[0].name, "read_file");
        assert_eq!(body.tools[0].input_schema["type"], "object");
    }

    #[test]
    fn stop_reason_mapping() {
        assert_eq!(map_stop_reason("end_turn"), FinishReason::Stop);
        assert_eq!(map_stop_reason("tool_use"), FinishReason::ToolCalls);
        assert_eq!(map_stop_reason("max_tokens"), FinishReason::Length);
    }

    #[tokio::test]
    async fn sse_parser_text_streaming() {
        use bytes::Bytes;
        let raw = b"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
        let chunks: Vec<Result<Bytes, reqwest::Error>> = vec![Ok(Bytes::from_static(raw))];
        let stream = parse_anthropic_sse(futures::stream::iter(chunks));
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
    async fn sse_parser_tool_use_start() {
        use bytes::Bytes;
        let raw = b"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"read_file\",\"input\":{}}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\\\"/x\\\"}\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
        let chunks: Vec<Result<Bytes, reqwest::Error>> = vec![Ok(Bytes::from_static(raw))];
        let stream = parse_anthropic_sse(futures::stream::iter(chunks));
        futures::pin_mut!(stream);

        let mut events = Vec::new();
        while let Some(Ok(delta)) = stream.next().await {
            events.push(delta);
        }
        assert!(matches!(
            &events[0],
            StreamDelta::ToolCallStart { index: 1, id, name } if id == "toolu_1" && name == "read_file"
        ));
        assert!(matches!(
            &events[1],
            StreamDelta::ToolCallArguments { fragment, .. } if fragment.contains("/x")
        ));
    }

    #[tokio::test]
    async fn sse_parser_finish_reason() {
        use bytes::Bytes;
        let raw = b"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
        let chunks: Vec<Result<Bytes, reqwest::Error>> = vec![Ok(Bytes::from_static(raw))];
        let stream = parse_anthropic_sse(futures::stream::iter(chunks));
        futures::pin_mut!(stream);

        let mut finish = None;
        while let Some(Ok(delta)) = stream.next().await {
            if let StreamDelta::Finish { reason, usage } = delta {
                finish = Some((reason, usage));
            }
        }
        let (reason, usage) = finish.expect("should have finish");
        assert_eq!(reason, FinishReason::ToolCalls);
        assert_eq!(usage.prompt_tokens, 10);
        assert_eq!(usage.completion_tokens, 5);
    }

    #[test]
    fn models_response_parses_display_name() {
        let json =
            r#"{"data":[{"id":"claude-sonnet-4-5-20250514","display_name":"Claude Sonnet 4.5"}]}"#;
        let parsed: AnthropicModelsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(
            parsed.data[0].display_name.as_deref(),
            Some("Claude Sonnet 4.5")
        );
    }
}
