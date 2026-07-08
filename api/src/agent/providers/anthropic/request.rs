use serde::Serialize;

use super::super::{Message, MessageRole, ToolSchema};
use crate::agent::runtime::CACHE_BREAKPOINT;

/// Anthropic Messages API request body.
#[derive(Debug, Serialize)]
pub(super) struct MessagesRequest {
    model: String,
    pub(super) messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) system: Option<Vec<SystemBlock>>,
    stream: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(super) tools: Vec<AnthropicTool>,
}

#[derive(Debug, Serialize)]
pub(super) struct SystemBlock {
    #[serde(rename = "type")]
    block_type: &'static str,
    pub(super) text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) cache_control: Option<CacheControl>,
}

#[derive(Debug, Serialize)]
pub(super) struct CacheControl {
    #[serde(rename = "type")]
    control_type: &'static str,
}

/// Anthropic message format.
///
/// Content is always an array of blocks (text, tool_use, tool_result).
/// Anthropic does not use a simple `content: "string"`; even plain text
/// is `[{"type":"text","text":"..."}]`.
#[derive(Debug, Serialize)]
pub(super) struct AnthropicMessage {
    pub(super) role: &'static str,
    pub(super) content: Vec<ContentBlock>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub(super) enum ContentBlock {
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
pub(super) struct AnthropicTool {
    pub(super) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    pub(super) input_schema: serde_json::Value,
}

impl MessagesRequest {
    pub(super) fn build(
        model: &str,
        max_tokens: u32,
        system_prompt: &str,
        messages: &[Message],
        tools: &[ToolSchema],
    ) -> Self {
        let anthropic_messages: Vec<AnthropicMessage> = messages
            .iter()
            .filter(|message| message.role != MessageRole::System)
            .map(convert_message)
            .collect();

        let anthropic_tools: Vec<AnthropicTool> = tools
            .iter()
            .map(|tool| AnthropicTool {
                name: tool.function.name.clone(),
                description: tool.function.description.clone(),
                input_schema: tool.function.parameters.clone(),
            })
            .collect();

        MessagesRequest {
            model: model.to_string(),
            messages: anthropic_messages,
            max_tokens,
            system: if system_prompt.is_empty() {
                None
            } else {
                Some(system_blocks(system_prompt))
            },
            stream: true,
            tools: anthropic_tools,
        }
    }
}

fn system_blocks(system_prompt: &str) -> Vec<SystemBlock> {
    if let Some((stable, volatile)) = system_prompt.split_once(CACHE_BREAKPOINT) {
        let mut blocks = Vec::new();
        if !stable.trim().is_empty() {
            blocks.push(SystemBlock {
                block_type: "text",
                text: stable.trim_end().to_string(),
                cache_control: Some(CacheControl {
                    control_type: "ephemeral",
                }),
            });
        }
        if !volatile.trim().is_empty() {
            blocks.push(SystemBlock {
                block_type: "text",
                text: volatile.trim_start().to_string(),
                cache_control: None,
            });
        }
        return blocks;
    }

    vec![SystemBlock {
        block_type: "text",
        text: system_prompt.to_string(),
        cache_control: None,
    }]
}

/// Convert a canonical [`Message`] to Anthropic's format.
///
/// Key differences from OpenAI:
/// - Assistant tool calls become `tool_use` content blocks.
/// - Tool results become user messages with `tool_result` blocks.
/// - Plain text content is wrapped in a `text` block.
pub(super) fn convert_message(message: &Message) -> AnthropicMessage {
    let role = match message.role {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::Tool => "user",
        MessageRole::System => "user",
    };

    let mut blocks = Vec::new();

    if message.role == MessageRole::Tool {
        if let Some(call_id) = &message.tool_call_id {
            blocks.push(ContentBlock::ToolResult {
                tool_use_id: call_id.clone(),
                content: message.content.clone().unwrap_or_default(),
            });
        }
        return AnthropicMessage {
            role,
            content: blocks,
        };
    }

    if let Some(text) = &message.content {
        if !text.is_empty() {
            blocks.push(ContentBlock::Text { text: text.clone() });
        }
    }

    for tool_call in &message.tool_calls {
        let input: serde_json::Value = serde_json::from_str(&tool_call.arguments)
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        blocks.push(ContentBlock::ToolUse {
            id: tool_call.id.clone(),
            name: tool_call.name.clone(),
            input,
        });
    }

    AnthropicMessage {
        role,
        content: blocks,
    }
}
