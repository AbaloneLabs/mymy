use serde::Deserialize;

use super::super::types::{FinishReason, StreamDelta, Usage};
use super::super::ProviderError;

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
    reasoning_content: Option<String>,
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
    fn from(usage: UsageDto) -> Self {
        Usage {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
        }
    }
}

/// Map OpenAI's `finish_reason` string to our canonical enum.
pub(super) fn parse_finish_reason(value: &str) -> FinishReason {
    match value {
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
pub(super) fn parse_sse_stream(
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

                if payload == "[DONE]" {
                    return;
                }

                let chunk: StreamChunk = match serde_json::from_str(payload) {
                    Ok(chunk) => chunk,
                    Err(_) => continue,
                };

                for choice in chunk.choices {
                    if let Some(text) = choice.delta.content {
                        if !text.is_empty() {
                            yield StreamDelta::Text(text);
                        }
                    }
                    if let Some(text) = choice.delta.reasoning_content {
                        if !text.is_empty() {
                            yield StreamDelta::Reasoning(text);
                        }
                    }

                    for tool_call in choice.delta.tool_calls {
                        if let Some(id) = tool_call.id.clone() {
                            if !id.is_empty() {
                                let name = tool_call
                                    .function
                                    .as_ref()
                                    .and_then(|function| function.name.clone())
                                    .unwrap_or_default();
                                yield StreamDelta::ToolCallStart {
                                    index: tool_call.index,
                                    id,
                                    name,
                                };
                            }
                        }
                        if let Some(function) = tool_call.function {
                            if let Some(args) = function.arguments {
                                if !args.is_empty() {
                                    yield StreamDelta::ToolCallArguments {
                                        index: tool_call.index,
                                        fragment: args,
                                    };
                                }
                            }
                        }
                    }

                    if let Some(reason) = choice.finish_reason {
                        yield StreamDelta::Finish {
                            reason: parse_finish_reason(&reason),
                            usage: Usage::default(),
                        };
                    }
                }

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
