use super::super::types::ModelInfo;

/// Hardcoded common models for each provider family.
///
/// Used by tests and as a provider-local fallback reference. Product-facing
/// curated model selection currently lives in `services::llm_providers`.
#[allow(dead_code)]
pub(super) fn curated_models(base_url: &str) -> Vec<ModelInfo> {
    let host = base_url
        .strip_prefix("https://")
        .or_else(|| base_url.strip_prefix("http://"))
        .unwrap_or(base_url);
    let host = match host.find('/') {
        Some(idx) => &host[..idx],
        None => host,
    };

    let ids: &[&str] = if host.contains("anthropic") {
        CURATED_ANTHROPIC
    } else if host.contains("localhost") || host.contains("ollama") {
        CURATED_OLLAMA
    } else if host.contains("groq") {
        CURATED_GROQ
    } else {
        CURATED_OPENAI
    };

    ids.iter()
        .map(|id| ModelInfo {
            id: id.to_string(),
            display_name: id.to_string(),
            is_curated: true,
        })
        .collect()
}

#[allow(dead_code)]
const CURATED_OPENAI: &[&str] = &[
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4.1",
    "gpt-4.1-mini",
    "o1",
    "o1-mini",
    "o3-mini",
];

#[allow(dead_code)]
const CURATED_ANTHROPIC: &[&str] = &[
    "claude-sonnet-4-5-20250514",
    "claude-opus-4-20250514",
    "claude-haiku-3-5-20241022",
    "claude-3-7-sonnet-20250219",
];

#[allow(dead_code)]
const CURATED_OLLAMA: &[&str] = &["llama3.1", "llama3", "qwen2.5", "mistral", "phi3", "gemma2"];

#[allow(dead_code)]
const CURATED_GROQ: &[&str] = &[
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
];
