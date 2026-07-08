use crate::agent::providers::{ApiMode, ProviderConfig};
use crate::models::llm_provider::ModelInfo;

pub(super) fn curated_models(config: &ProviderConfig) -> Vec<ModelInfo> {
    let mode = config.resolved_mode();
    let ids: &[&str] = match mode {
        ApiMode::Openai => {
            let host = config.base_url.to_lowercase();
            if host.contains("ollama") || host.contains("localhost:11434") {
                &CURATED_OLLAMA
            } else if host.contains("groq") {
                &CURATED_GROQ
            } else if host.contains("deepseek") {
                &CURATED_DEEPSEEK
            } else {
                &CURATED_OPENAI
            }
        }
        ApiMode::Anthropic => &CURATED_ANTHROPIC,
    };

    ids.iter()
        .map(|id| ModelInfo {
            id: id.to_string(),
            display_name: id.to_string(),
            is_curated: true,
        })
        .collect()
}

const CURATED_OPENAI: [&str; 6] = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "o1",
    "o1-mini",
    "o3-mini",
];

const CURATED_ANTHROPIC: [&str; 3] = [
    "claude-sonnet-4-5-20250514",
    "claude-opus-4-20250514",
    "claude-haiku-3-5-20241022",
];

const CURATED_OLLAMA: [&str; 5] = ["llama3", "llama3.1", "qwen2.5", "mistral", "phi3"];

const CURATED_GROQ: [&str; 3] = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b",
];

const CURATED_DEEPSEEK: [&str; 2] = ["deepseek-chat", "deepseek-reasoner"];
