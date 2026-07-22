use serde::Serialize;

use super::super::{Message, MessageRole, ToolSchema};
use crate::agent::runtime::CACHE_BREAKPOINT;

/// OpenAI chat/completions request body.
///
/// Built from the canonical [`Message`] list. Tool definitions are
/// included only when the caller provides them (empty slice -> omitted).
#[derive(Debug, Serialize)]
pub(super) struct ChatCompletionsRequest {
    model: String,
    pub(super) messages: Vec<OpenAiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    stream: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<ToolSchema>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
}

#[derive(Debug, Serialize)]
struct StreamOptions {
    include_usage: bool,
}

/// OpenAI message format.
///
/// System messages become `role: "system"`. Tool results use
/// `role: "tool"` with `tool_call_id`. Assistant tool calls are
/// serialized as `tool_calls` array.
#[derive(Debug, Serialize)]
pub(super) struct OpenAiMessage {
    pub(super) role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) content: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tool_calls: Vec<OpenAiToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

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
    pub(super) fn build(
        model: &str,
        max_tokens: u32,
        system_prompt: &str,
        messages: &[Message],
        tools: &[ToolSchema],
    ) -> Self {
        let mut system_contents = Vec::new();
        let mut conversation_messages = Vec::with_capacity(messages.len());

        if !system_prompt.is_empty() {
            system_contents.push(system_prompt.replace(CACHE_BREAKPOINT, "\n\n"));
        }

        for message in messages {
            if message.role == MessageRole::System {
                if let Some(content) = message.content.as_deref().filter(|value| !value.is_empty())
                {
                    system_contents.push(content.replace(CACHE_BREAKPOINT, "\n\n"));
                }
                continue;
            }

            conversation_messages.push(OpenAiMessage {
                role: match message.role {
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                    MessageRole::Tool => "tool",
                    MessageRole::System => unreachable!("system messages are normalized above"),
                },
                content: message.content.clone(),
                tool_calls: message
                    .tool_calls
                    .iter()
                    .map(|tool_call| OpenAiToolCall {
                        id: tool_call.id.clone(),
                        call_type: "function",
                        function: OpenAiFunction {
                            name: tool_call.name.clone(),
                            arguments: tool_call.arguments.clone(),
                        },
                    })
                    .collect(),
                tool_call_id: message.tool_call_id.clone(),
            });
        }

        // vLLM-backed OpenAI-compatible endpoints commonly use strict Jinja
        // templates that reject system messages after the first position. A
        // single provider-boundary normalization keeps the canonical history
        // provider-neutral while guaranteeing the strongest compatible wire
        // invariant for both current and previously persisted system context.
        let mut openai_messages = Vec::with_capacity(conversation_messages.len() + 1);
        if !system_contents.is_empty() {
            openai_messages.push(OpenAiMessage {
                role: "system",
                content: Some(system_contents.join("\n\n")),
                tool_calls: Vec::new(),
                tool_call_id: None,
            });
        }
        openai_messages.extend(conversation_messages);

        ChatCompletionsRequest {
            model: model.to_string(),
            messages: openai_messages,
            max_tokens: Some(max_tokens),
            stream: true,
            tools: tools.to_vec(),
            stream_options: Some(StreamOptions {
                include_usage: true,
            }),
        }
    }
}
