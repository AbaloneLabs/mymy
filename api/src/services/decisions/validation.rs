//! Decision answer and immutable-action validation.

use serde_json::{Map, Value};

use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};

use super::target::hash_value;
use super::DecisionRow;

const REVIEW_MAX_DEPTH: usize = 8;
const REVIEW_MAX_ITEMS: usize = 50;
const REVIEW_MAX_STRING_CHARS: usize = 500;

/// Build the browser-visible approval payload without returning credentials.
///
/// The durable row retains the exact canonical action for hashing and
/// execution. This projection is only a review surface: sensitive values are
/// replaced server-side so CSS, accessibility APIs, copy actions, and browser
/// traces never receive plaintext merely to hide it later.
pub(super) fn approval_review_projection(action: &Value) -> Value {
    project_review_value(None, action, 0)
}

fn project_review_value(key: Option<&str>, value: &Value, depth: usize) -> Value {
    if key.is_some_and(is_sensitive_key) || value_contains_secret(value) {
        return serde_json::json!({
            "redacted": true,
            "kind": "credential",
            "display": "[REDACTED]"
        });
    }
    if depth >= REVIEW_MAX_DEPTH {
        return serde_json::json!({"truncated": true, "reason": "depth_limit"});
    }
    match value {
        Value::Object(object) => {
            let mut projected = Map::new();
            for (index, (name, child)) in object.iter().enumerate() {
                if index >= REVIEW_MAX_ITEMS {
                    projected.insert(
                        "_reviewOmittedFields".to_string(),
                        Value::from(object.len() - REVIEW_MAX_ITEMS),
                    );
                    break;
                }
                projected.insert(
                    name.clone(),
                    project_review_value(Some(name), child, depth + 1),
                );
            }
            Value::Object(projected)
        }
        Value::Array(items) => {
            let mut projected = items
                .iter()
                .take(REVIEW_MAX_ITEMS)
                .map(|item| project_review_value(None, item, depth + 1))
                .collect::<Vec<_>>();
            if items.len() > REVIEW_MAX_ITEMS {
                projected.push(serde_json::json!({
                    "omittedItems": items.len() - REVIEW_MAX_ITEMS
                }));
            }
            Value::Array(projected)
        }
        Value::String(text) => Value::String(text.chars().take(REVIEW_MAX_STRING_CHARS).collect()),
        primitive => primitive.clone(),
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    [
        "apikey",
        "accesstoken",
        "refreshtoken",
        "authtoken",
        "authorization",
        "bearertoken",
        "password",
        "passphrase",
        "privatekey",
        "secret",
        "clientsecret",
        "credential",
        "cookie",
        "sessiontoken",
        "recoverycode",
        "pin",
    ]
    .iter()
    .any(|candidate| normalized == *candidate || normalized.ends_with(candidate))
}

fn value_contains_secret(value: &Value) -> bool {
    let Value::String(text) = value else {
        return false;
    };
    redact_sensitive_text(text) != text.as_str()
}

pub(super) fn validate_answer_not_secret(answer: &Value) -> AppResult<()> {
    let serialized = answer.to_string();
    if redact_sensitive_text(&serialized) != serialized {
        return Err(AppError::BadRequest(
            "Decision answers cannot contain credentials or instruction-like secret payloads; use Settings credentials instead"
                .to_string(),
        ));
    }
    Ok(())
}

pub(super) fn validate_choice(decision: &DecisionRow, answer: &Value) -> AppResult<()> {
    let Some(choices) = decision
        .choices
        .as_array()
        .filter(|choices| !choices.is_empty())
    else {
        return Ok(());
    };
    if !choices.iter().any(|choice| choice == answer) {
        return Err(AppError::BadRequest(
            "decision answer is not one of the available choices".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn validate_proposed_action_hash(decision: &DecisionRow) -> AppResult<()> {
    let Some(action) = &decision.proposed_action else {
        return Ok(());
    };
    let expected = decision.proposed_action_hash.as_deref().ok_or_else(|| {
        AppError::Conflict("approval is missing its proposed action hash".to_string())
    })?;
    let actual = hash_value(action).map_err(AppError::Internal)?;
    if actual != expected {
        return Err(AppError::Conflict(
            "proposed action changed after approval was requested".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_projection_redacts_sensitive_values_before_browser_serialization() {
        let raw = serde_json::json!({
            "target": "/drive/shared/report.md",
            "apiKey": "sk-live-secret-value",
            "nested": {"authorization": "Bearer private-token"},
            "effect": "update"
        });
        let projected = approval_review_projection(&raw);
        let serialized = projected.to_string();

        assert_eq!(projected["target"], "/drive/shared/report.md");
        assert_eq!(projected["effect"], "update");
        assert_eq!(projected["apiKey"]["redacted"], true);
        assert_eq!(projected["nested"]["authorization"]["redacted"], true);
        assert!(!serialized.contains("sk-live-secret-value"));
        assert!(!serialized.contains("private-token"));
    }
}
