use super::super::types::ToolCall;
use super::super::{FunctionSchema, Message, MessageRole, ToolSchema};
use super::models::AnthropicModelsResponse;
use super::request::{convert_message, ContentBlock, MessagesRequest};
use super::sse::{map_stop_reason, parse_anthropic_sse};
use crate::agent::providers::types::{FinishReason, StreamDelta};
use crate::agent::runtime::CACHE_BREAKPOINT;
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
    let system = body.system.as_ref().unwrap();
    assert_eq!(system[0].text, "Be helpful.");
    assert!(body.messages.is_empty());
}

#[test]
fn cache_breakpoint_adds_anthropic_cache_control() {
    let body = MessagesRequest::build(
        "claude-sonnet-4-5",
        1024,
        &format!("stable{CACHE_BREAKPOINT}volatile"),
        &[],
        &[],
    );
    let system = body.system.as_ref().unwrap();
    assert_eq!(system.len(), 2);
    assert_eq!(system[0].text, "stable");
    assert!(system[0].cache_control.is_some());
    assert_eq!(system[1].text, "volatile");
    assert!(system[1].cache_control.is_none());
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
fn provider_visible_tool_contract_preserves_canonical_constraints() {
    let parameters = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "target": {
                "description": "One exact target.",
                "oneOf": [
                    {"type": "string", "minLength": 1},
                    {"type": "integer", "minimum": 1}
                ]
            }
        },
        "required": ["target"]
    });
    let tool = ToolSchema {
        tool_type: "function".to_string(),
        function: FunctionSchema {
            name: "contract_probe".to_string(),
            description: Some("Probe provider contract lowering.".to_string()),
            parameters: parameters.clone(),
        },
    };
    let body = MessagesRequest::build("claude-sonnet-4-5", 1024, "", &[], &[tool]);
    let value = serde_json::to_value(body).unwrap();
    assert_eq!(value["tools"][0]["input_schema"], parameters);
    assert_eq!(
        value["tools"][0]["description"],
        "Probe provider contract lowering."
    );
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
        if let StreamDelta::Text(text) = delta {
            texts.push(text);
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
