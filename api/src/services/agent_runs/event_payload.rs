//! Bounded and redacted persistence envelope for run events.
//!
//! Every producer passes through this module so replay cannot expose secrets
//! or grow an event beyond the database and SSE resource contract.

use serde_json::Value;

use crate::agent::security::redact_sensitive_text;

const MAX_EVENT_PAYLOAD_BYTES: usize = 64 * 1024;

pub(super) fn sanitize_event_payload(mut payload: Value) -> Value {
    redact_json_strings(&mut payload);
    if serde_json::to_vec(&payload).is_ok_and(|bytes| bytes.len() > MAX_EVENT_PAYLOAD_BYTES) {
        truncated_event_envelope(&payload)
    } else {
        payload
    }
}

fn truncated_event_envelope(payload: &Value) -> Value {
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("error");
    let mut envelope = serde_json::Map::new();
    envelope.insert("type".to_string(), Value::String(event_type.to_string()));
    envelope.insert("truncated".to_string(), Value::Bool(true));
    for key in ["run_id", "call_id", "tool_name"] {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            envelope.insert(
                key.to_string(),
                Value::String(value.chars().take(512).collect()),
            );
        }
    }
    let notice = "Event payload exceeded the persisted size limit.";
    match event_type {
        "text_delta" => {
            envelope.insert("content".to_string(), Value::String(notice.to_string()));
        }
        "tool_call_start" => {
            envelope.insert("arguments".to_string(), Value::String(notice.to_string()));
        }
        "tool_call_finish" => {
            envelope.insert("result".to_string(), Value::String(notice.to_string()));
            envelope.insert("error".to_string(), Value::Null);
        }
        _ => {
            envelope.insert("message".to_string(), Value::String(notice.to_string()));
        }
    }
    Value::Object(envelope)
}

fn redact_json_strings(value: &mut Value) {
    match value {
        Value::String(text) => *text = redact_sensitive_text(text),
        Value::Array(items) => items.iter_mut().for_each(redact_json_strings),
        Value::Object(map) => map.values_mut().for_each(redact_json_strings),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_tool_result_keeps_only_a_safe_replay_envelope() {
        let payload = serde_json::json!({
            "type": "tool_call_finish",
            "call_id": "call-1",
            "result": "x".repeat(MAX_EVENT_PAYLOAD_BYTES),
            "secret": "sk-test-secret"
        });
        let sanitized = sanitize_event_payload(payload);
        assert_eq!(sanitized["truncated"], true);
        assert_eq!(sanitized["call_id"], "call-1");
        assert!(sanitized.get("secret").is_none());
    }
}
