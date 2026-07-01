//! Secret redaction for tool outputs and logs.
//!
//! The redactor favors false positives over leaks. It does not try to prove a
//! token is valid; it masks strings that have the shape of common credentials
//! before they are returned to the model or browser.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Clone, Eq, PartialEq)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl std::fmt::Display for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl Serialize for SecretString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str("[REDACTED]")
    }
}

impl<'de> Deserialize<'de> for SecretString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer).map(Self)
    }
}

struct RedactionPattern {
    regex: Regex,
    replacement: &'static str,
}

pub fn redact_terminal_output(value: &str) -> String {
    redact_sensitive_text(value)
}

pub fn redact_sensitive_text(value: &str) -> String {
    let mut redacted = value.to_string();
    for pattern in compiled_patterns() {
        redacted = pattern
            .regex
            .replace_all(&redacted, pattern.replacement)
            .to_string();
    }
    redacted
}

pub fn mask_secret(value: &str) -> String {
    let char_count = value.chars().count();
    if char_count <= 8 {
        return "***".to_string();
    }
    let prefix: String = value.chars().take(4).collect();
    let suffix: String = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}...{suffix}")
}

fn compiled_patterns() -> &'static [RedactionPattern] {
    static PATTERNS: OnceLock<Vec<RedactionPattern>> = OnceLock::new();
    PATTERNS
        .get_or_init(|| {
            [
                (r"(?i)\b(sk-[A-Za-z0-9_\-]{12,}|sk_live_[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9\-]{10,}|AIza[0-9A-Za-z_\-]{20,}|AKIA[0-9A-Z]{16}|ya29\.[A-Za-z0-9_\-]{20,}|glpat-[A-Za-z0-9_\-]{20,}|npm_[A-Za-z0-9_\-]{20,})\b", "[REDACTED]"),
                (r#"(?i)\b((?:[A-Z0-9_]*_)?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd|private[_-]?key)\s*[:=]\s*)[^\s'";,]+"#, "$1[REDACTED]"),
                (r"(?im)^(\s*(?:api[_\.-]?key|access[_\.-]?token|refresh[_\.-]?token|token|secret|password|passwd|pwd|private[_\.-]?key)\s*[:=]\s*)[^\r\n]+", "$1[REDACTED]"),
                (r"(?i)\b((?:authorization|cookie|set-cookie|x-api-key)\s*:\s*)[^\r\n]+", "$1[REDACTED]"),
                (r"(?i)([?&](?:access_token|refresh_token|api_key|token|secret|password|key)=)[^&#\s]+", "$1[REDACTED]"),
                (r"(?i)(://[^:/\s]+:)[^@\s/]+(@)", "$1[REDACTED]$2"),
            ]
            .into_iter()
            .map(|(pattern, replacement)| RedactionPattern {
                regex: Regex::new(pattern).expect("redaction regex compiles"),
                replacement,
            })
            .collect()
        })
        .as_slice()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_env_assignments_and_tokens() {
        let text = "OPENAI_API_KEY=sk-abcdefghijklmnop\nplain=ok";
        let redacted = redact_sensitive_text(text);
        assert!(redacted.contains("[REDACTED]"));
        assert!(!redacted.contains("abcdefghijklmnop"));
    }

    #[test]
    fn masks_short_and_long_values() {
        assert_eq!(mask_secret("abcd"), "***");
        assert_eq!(mask_secret("abcdefghijkl"), "abcd...ijkl");
    }

    #[test]
    fn secret_string_never_formats_raw_value() {
        let secret = SecretString::new("sk-secret-value");
        assert_eq!(format!("{secret:?}"), "[REDACTED]");
        assert_eq!(secret.to_string(), "[REDACTED]");
        assert_eq!(secret.expose(), "sk-secret-value");
    }
}
