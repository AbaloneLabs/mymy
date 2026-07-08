use serde::Deserialize;

use super::super::types::{FinishReason, StreamDelta, Usage};
use super::super::ProviderError;

/// Anthropic SSE uses typed events: `event: <type>\ndata: <json>`.
///
/// Event types we care about:
/// - `message_start`: initial message metadata
/// - `content_block_start`: new content block (text or tool_use)
/// - `content_block_delta`: incremental content
/// - `content_block_stop`: block finished
/// - `message_delta`: finish reason + usage
/// - `message_stop`: stream end
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
    fn from(usage: UsageDto) -> Self {
        Usage {
            prompt_tokens: usage.input_tokens,
            completion_tokens: usage.output_tokens,
            total_tokens: usage.input_tokens + usage.output_tokens,
        }
    }
}

/// Map Anthropic's `stop_reason` to our canonical [`FinishReason`].
pub(super) fn map_stop_reason(value: &str) -> FinishReason {
    match value {
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
/// We only need the `data:` lines because they contain the type tag.
pub(super) fn parse_anthropic_sse(
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

                let payload = match line.strip_prefix("data:") {
                    Some(payload) => payload.trim(),
                    None => continue,
                };

                if payload == "[DONE]" || payload.is_empty() {
                    continue;
                }

                let event: AnthropicEvent = match serde_json::from_str(payload) {
                    Ok(event) => event,
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
