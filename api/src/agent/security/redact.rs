//! Secret redaction for tool outputs and logs.
//!
//! The redactor favors false positives over leaks. It does not try to prove a
//! token is valid; it masks strings that have the shape of common credentials
//! before they are returned to the model or browser.

use regex::{Regex, RegexSet};
use serde::{Deserialize, Serialize};
use std::fmt::Write as _;
use std::sync::{Arc, OnceLock, RwLock};

use tracing::{Event, Subscriber};
use tracing_subscriber::fmt::format::{FormatEvent, FormatFields, Writer};
use tracing_subscriber::fmt::FmtContext;
use tracing_subscriber::registry::LookupSpan;

#[derive(Clone, Eq, PartialEq)]
pub struct SecretString(Arc<str>);

impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        Self(Arc::from(value.into()))
    }

    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn reveal(&self) -> &str {
        self.expose()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl std::fmt::Debug for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("***REDACTED***")
    }
}

impl std::fmt::Display for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("***REDACTED***")
    }
}

impl Serialize for SecretString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str("***REDACTED***")
    }
}

impl<'de> Deserialize<'de> for SecretString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer).map(Self::new)
    }
}

struct RedactionPattern {
    regex: Regex,
    replacement: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub struct RedactionConfig {
    pub enabled: bool,
}

impl RedactionConfig {
    pub fn snapshot() -> Self {
        // Redaction is an import-time safety invariant, not a runtime switch.
        // Environment toggles may exist for diagnostics in other systems, but
        // the agent should never downgrade once this module is loaded.
        let _ = std::env::var("MYMY_REDACT_SECRETS");
        Self { enabled: true }
    }
}

pub fn redact_terminal_output(value: &str) -> String {
    redact_sensitive_text(value)
}

pub fn redact_sensitive_text(value: &str) -> String {
    if !redaction_config().enabled {
        return value.to_string();
    }
    let mut redacted = value.to_string();
    if vendor_prefix_set().is_match(&redacted) {
        redacted = vendor_token_regex()
            .replace_all(&redacted, |captures: &regex::Captures<'_>| {
                mask_secret(captures.get(0).map_or("", |m| m.as_str()))
            })
            .to_string();
    }
    for pattern in compiled_patterns() {
        redacted = pattern
            .regex
            .replace_all(&redacted, pattern.replacement)
            .to_string();
    }
    for secret in registered_secrets()
        .read()
        .expect("secret registry lock")
        .iter()
    {
        if !secret.is_empty() {
            redacted = redacted.replace(secret, &mask_secret(secret));
        }
    }
    redacted
}

pub fn register_secret(value: &str) {
    if value.chars().count() < 8 {
        return;
    }
    let mut secrets = registered_secrets().write().expect("secret registry lock");
    if !secrets.iter().any(|secret| secret == value) {
        secrets.push(value.to_string());
    }
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

fn registered_secrets() -> &'static RwLock<Vec<String>> {
    static SECRETS: OnceLock<RwLock<Vec<String>>> = OnceLock::new();
    SECRETS.get_or_init(|| RwLock::new(Vec::new()))
}

fn redaction_config() -> &'static RedactionConfig {
    static CONFIG: OnceLock<RedactionConfig> = OnceLock::new();
    CONFIG.get_or_init(RedactionConfig::snapshot)
}

fn vendor_prefix_patterns() -> &'static [&'static str] {
    &[
        r"sk-proj-[A-Za-z0-9_\-]{8,}",
        r"sk-ant-[A-Za-z0-9_\-]{8,}",
        r"sk-[A-Za-z0-9_\-]{12,}",
        r"sk_live_[A-Za-z0-9_\-]{8,}",
        r"rk_live_[A-Za-z0-9_\-]{8,}",
        r"github_pat_[A-Za-z0-9_]{20,}",
        r"ghp_[A-Za-z0-9_]{20,}",
        r"gho_[A-Za-z0-9_]{20,}",
        r"ghu_[A-Za-z0-9_]{20,}",
        r"ghs_[A-Za-z0-9_]{20,}",
        r"ghr_[A-Za-z0-9_]{20,}",
        r"glpat-[A-Za-z0-9_\-]{20,}",
        r"xoxb-[A-Za-z0-9\-]{10,}",
        r"xoxp-[A-Za-z0-9\-]{10,}",
        r"xoxa-[A-Za-z0-9\-]{10,}",
        r"xoxr-[A-Za-z0-9\-]{10,}",
        r"xoxs-[A-Za-z0-9\-]{10,}",
        r"AKIA[0-9A-Z]{16}",
        r"ASIA[0-9A-Z]{16}",
        r"AIza[0-9A-Za-z_\-]{20,}",
        r"ya29\.[A-Za-z0-9_\-]{20,}",
        r"SG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}",
        r"SK[0-9a-fA-F]{32}",
        r"key-[A-Za-z0-9]{20,}",
        r"npm_[A-Za-z0-9_\-]{20,}",
        r"pypi-[A-Za-z0-9_\-]{20,}",
        r"hf_[A-Za-z0-9_\-]{20,}",
        r"lin_api_[A-Za-z0-9_\-]{20,}",
        r"secret_[A-Za-z0-9_\-]{20,}",
        r"pcsk_[A-Za-z0-9_\-]{20,}",
        r"sbp_[A-Za-z0-9_\-]{20,}",
        r"sntrys_[A-Za-z0-9_\-]{20,}",
        r"vercel_[A-Za-z0-9_\-]{20,}",
        r"dapi[A-Za-z0-9_\-]{20,}",
    ]
}

fn vendor_prefix_set() -> &'static RegexSet {
    static SET: OnceLock<RegexSet> = OnceLock::new();
    SET.get_or_init(|| RegexSet::new(vendor_prefix_patterns()).expect("vendor regex set compiles"))
}

fn vendor_token_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(&format!(
            r"(?i)\b(?:{})\b",
            vendor_prefix_patterns().join("|")
        ))
        .expect("vendor token regex compiles")
    })
}

fn compiled_patterns() -> &'static [RedactionPattern] {
    static PATTERNS: OnceLock<Vec<RedactionPattern>> = OnceLock::new();
    PATTERNS
        .get_or_init(|| {
            [
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

#[derive(Debug, Default)]
pub struct RedactingFormatter;

impl<S, N> FormatEvent<S, N> for RedactingFormatter
where
    S: Subscriber + for<'span> LookupSpan<'span>,
    N: for<'writer> FormatFields<'writer> + 'static,
{
    fn format_event(
        &self,
        _ctx: &FmtContext<'_, S, N>,
        writer: Writer<'_>,
        event: &Event<'_>,
    ) -> std::fmt::Result {
        let metadata = event.metadata();
        let mut visitor = EventVisitor::default();
        event.record(&mut visitor);

        let mut line = String::new();
        write!(
            &mut line,
            "{} {} {}",
            metadata.level(),
            metadata.target(),
            visitor.finish()
        )?;
        let mut writer = writer;
        writeln!(writer, "{}", redact_sensitive_text(line.trim_end()))
    }
}

#[derive(Default)]
struct EventVisitor {
    fields: Vec<String>,
}

impl EventVisitor {
    fn finish(self) -> String {
        self.fields.join(" ")
    }
}

impl tracing::field::Visit for EventVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.fields.push(format!("{}={value:?}", field.name()));
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.fields.push(format!("{}={value}", field.name()));
    }

    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.fields.push(format!("{}={value}", field.name()));
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.fields.push(format!("{}={value}", field.name()));
    }

    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        self.fields.push(format!("{}={value}", field.name()));
    }
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
        assert_eq!(format!("{secret:?}"), "***REDACTED***");
        assert_eq!(secret.to_string(), "***REDACTED***");
        assert_eq!(secret.expose(), "sk-secret-value");
        let cloned = secret.clone();
        assert!(Arc::ptr_eq(&secret.0, &cloned.0));
    }

    #[test]
    fn vendor_tokens_are_masked_with_prefix_and_suffix() {
        let redacted = redact_sensitive_text("sk-proj-abcdef123456");
        assert!(redacted.contains("sk-p...3456"));
        assert!(!redacted.contains("abcdef123456"));
    }

    #[test]
    fn runtime_registered_secret_is_masked() {
        register_secret("plain-secret-value");
        let redacted = redact_sensitive_text("plain-secret-value");
        assert_eq!(redacted, "plai...alue");
    }

    #[test]
    fn env_toggle_does_not_disable_redaction() {
        std::env::set_var("MYMY_REDACT_SECRETS", "false");
        let redacted = redact_sensitive_text("api_key: secret123");
        std::env::remove_var("MYMY_REDACT_SECRETS");
        assert!(redacted.contains("[REDACTED]"));
    }
}
