use super::super::ToolSchema;
use super::curated::curated_models;
use super::models::ModelsListResponse;
use super::request::ChatCompletionsRequest;
use super::sse::{parse_finish_reason, parse_sse_stream};
use crate::agent::providers::types::{FinishReason, StreamDelta};
use crate::agent::providers::{Message, MessageRole};
use futures::StreamExt;

#[test]
fn curated_openai_for_openai_host() {
    let models = curated_models("https://api.openai.com/v1");
    assert!(models.iter().any(|model| model.id == "gpt-4o"));
    assert!(models.iter().all(|model| model.is_curated));
}

#[test]
fn curated_anthropic_for_anthropic_host() {
    let models = curated_models("https://api.anthropic.com/v1");
    assert!(models.iter().any(|model| model.id.contains("claude")));
}

#[test]
fn curated_ollama_for_localhost() {
    let models = curated_models("http://localhost:11434/v1");
    assert!(models.iter().any(|model| model.id == "llama3.1"));
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
        if let StreamDelta::Text(text) = delta {
            texts.push(text);
        }
    }
    assert_eq!(texts, vec!["Hello", " world"]);
}

#[tokio::test]
async fn sse_parser_handles_reasoning_content() {
    use bytes::Bytes;
    let raw = b"data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking\"}}]}\n\ndata: [DONE]\n\n";
    let chunks: Vec<Result<Bytes, reqwest::Error>> = vec![Ok(Bytes::from_static(raw))];
    let stream = parse_sse_stream(futures::stream::iter(chunks));
    futures::pin_mut!(stream);

    let mut reasoning = Vec::new();
    while let Some(Ok(delta)) = stream.next().await {
        if let StreamDelta::Reasoning(text) = delta {
            reasoning.push(text);
        }
    }
    assert_eq!(reasoning, vec!["thinking"]);
}

#[tokio::test]
async fn sse_parser_handles_split_chunks() {
    use bytes::Bytes;
    let part1 = b"data: {\"choices\":[{\"delta\":{\"conte";
    let part2 = b"nt\":\"Hi\"}}]}\n\ndata: [DONE]\n\n";
    let chunks: Vec<Result<Bytes, reqwest::Error>> =
        vec![Ok(Bytes::from_static(part1)), Ok(Bytes::from_static(part2))];
    let stream = parse_sse_stream(futures::stream::iter(chunks));
    futures::pin_mut!(stream);

    let mut texts = Vec::new();
    while let Some(Ok(delta)) = stream.next().await {
        if let StreamDelta::Text(text) = delta {
            texts.push(text);
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
    assert!(matches!(
        &events[0],
        StreamDelta::ToolCallStart { index: 0, id, name } if id == "call_1" && name == "read_file"
    ));
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
fn request_body_merges_historical_system_messages_at_the_front() {
    let messages = vec![
        Message::user("First request"),
        Message {
            role: MessageRole::System,
            content: Some("Historical policy".to_string()),
            tool_calls: Vec::new(),
            tool_call_id: None,
        },
        Message::assistant("First response"),
        Message {
            role: MessageRole::System,
            content: Some("Later policy".to_string()),
            tool_calls: Vec::new(),
            tool_call_id: None,
        },
    ];

    let body = ChatCompletionsRequest::build("gpt-4o", 1024, "Current policy", &messages, &[]);

    assert_eq!(
        body.messages
            .iter()
            .map(|message| message.role)
            .collect::<Vec<_>>(),
        vec!["system", "user", "assistant"]
    );
    assert_eq!(
        body.messages[0].content.as_deref(),
        Some("Current policy\n\nHistorical policy\n\nLater policy")
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
        function: super::super::FunctionSchema {
            name: "contract_probe".to_string(),
            description: Some("Probe provider contract lowering.".to_string()),
            parameters: parameters.clone(),
        },
    };
    let body = ChatCompletionsRequest::build("gpt-4o", 1024, "", &[], &[tool]);
    let value = serde_json::to_value(body).unwrap();
    assert_eq!(value["tools"][0]["function"]["parameters"], parameters);
    assert_eq!(
        value["tools"][0]["function"]["description"],
        "Probe provider contract lowering."
    );
}

#[test]
fn models_list_response_parses() {
    let json = r#"{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}"#;
    let parsed: ModelsListResponse = serde_json::from_str(json).unwrap();
    assert_eq!(parsed.data.len(), 2);
    assert_eq!(parsed.data[0].id, "gpt-4o");
}
