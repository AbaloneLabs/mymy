//! Semantic Decision content validation.

use serde_json::Value;

use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};

use super::DecisionRow;

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

pub(super) fn validate_prompt_not_secret(question: &str, choices: &[String]) -> AppResult<()> {
    let serialized = serde_json::json!({
        "question": question,
        "choices": choices,
    })
    .to_string();
    if redact_sensitive_text(&serialized) != serialized {
        return Err(AppError::BadRequest(
            "Decision questions and choices cannot contain credentials; use a non-sensitive description"
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_prompt_rejects_credentials_before_persistence() {
        let error = validate_prompt_not_secret(
            "Should I use sk-abcdefghijklmnop for this request?",
            &["yes".to_string(), "no".to_string()],
        )
        .unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }
}
