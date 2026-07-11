//! Decision answer and immutable-action validation.

use serde_json::Value;

use crate::agent::security::redact_sensitive_text;
use crate::error::{AppError, AppResult};

use super::target::hash_value;
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
