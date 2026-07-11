//! Durable-memory classification and stable topic identity.
//!
//! Promotion is deliberately stricter than transient context: a durable fact
//! must have explicit provenance, a supported sensitivity, and contain neither
//! secrets nor instruction-shaped untrusted content.

use std::collections::HashSet;

use sha2::{Digest, Sha256};

use crate::agent::security::{redact_sensitive_text, scan_for_threats, ThreatScope};
use crate::error::{AppError, AppResult};

const MAX_MEMORY_CHARS: usize = 4_000;

pub(super) fn validate_memory(
    memory_type: &str,
    origin: &str,
    content: &str,
    sensitivity: &str,
) -> AppResult<()> {
    let content = content.trim();
    if content.is_empty() || content.chars().count() > MAX_MEMORY_CHARS {
        return Err(AppError::BadRequest(format!(
            "memory content must contain 1 to {MAX_MEMORY_CHARS} characters"
        )));
    }
    if !matches!(
        memory_type,
        "preference" | "convention" | "decision" | "fact"
    ) || !matches!(origin, "explicit_user" | "agent_proposed" | "decision")
        || !matches!(sensitivity, "normal" | "private" | "financial")
    {
        return Err(AppError::BadRequest(
            "invalid memory classification".to_string(),
        ));
    }
    if redact_sensitive_text(content) != content {
        return Err(AppError::BadRequest(
            "credentials and secrets cannot be stored as durable memory".to_string(),
        ));
    }
    if !scan_for_threats(content, ThreatScope::Strict).is_empty() {
        return Err(AppError::BadRequest(
            "instruction-like untrusted content cannot be promoted to durable memory".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn keywords(value: &str, limit: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    value
        .split(|character: char| {
            !character.is_alphanumeric() && character != '_' && character != '-'
        })
        .map(str::trim)
        .filter(|word| word.chars().count() > 1)
        .map(str::to_lowercase)
        .filter(|word| seen.insert(word.clone()))
        .take(limit)
        .collect()
}

pub(super) fn topic_key(content: &str) -> String {
    let topics = keywords(content, 5).join(":");
    let mut hasher = Sha256::new();
    hasher.update(topics.as_bytes());
    hex::encode(hasher.finalize())
}
