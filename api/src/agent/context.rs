//! Context window management for native agent conversations.
//!
//! This module keeps long conversations below a conservative threshold before
//! provider calls fail with context-window errors. The first implementation
//! uses deterministic pruning and summarization so the agent loop can compress
//! without making a second LLM call or nesting provider streams. A later phase
//! can replace the deterministic middle summary with a model-generated one.

use crate::agent::providers::types::Usage;
use crate::agent::providers::{Message, MessageRole};

#[derive(Debug, Clone)]
pub struct ContextConfig {
    pub context_length: u32,
    pub max_tokens: u32,
    pub threshold_percent: f32,
    pub protect_first_n: usize,
    pub protect_last_n: usize,
}

impl Default for ContextConfig {
    fn default() -> Self {
        Self {
            context_length: 128_000,
            max_tokens: 16_384,
            threshold_percent: 0.50,
            protect_first_n: 3,
            protect_last_n: 20,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ContextManager {
    config: ContextConfig,
    threshold_tokens: u32,
    last_prompt_tokens: u32,
    compression_count: u32,
}

impl ContextManager {
    pub fn new(config: ContextConfig) -> Self {
        let effective_window = config.context_length.saturating_sub(config.max_tokens);
        let threshold_tokens = (effective_window as f32 * config.threshold_percent) as u32;
        Self {
            config,
            threshold_tokens,
            last_prompt_tokens: 0,
            compression_count: 0,
        }
    }

    pub fn for_model(model: &str, max_tokens: u32) -> Self {
        Self::new(ContextConfig {
            context_length: context_length_for_model(model),
            max_tokens,
            ..Default::default()
        })
    }

    pub fn update_usage(&mut self, usage: &Usage) {
        if usage.prompt_tokens > 0 {
            self.last_prompt_tokens = usage.prompt_tokens;
        }
    }

    pub fn should_compress(&self, messages: &[Message], system_prompt: &str) -> bool {
        let tokens = if self.last_prompt_tokens > 0 {
            self.last_prompt_tokens
        } else {
            estimate_conversation_tokens(messages, system_prompt)
        };
        tokens >= self.threshold_tokens
    }

    pub fn compress(&mut self, messages: &mut Vec<Message>) -> bool {
        self.compression_count = self.compression_count.saturating_add(1);
        let mut changed = prune_tool_results(messages, self.config.protect_last_n) > 0;
        if summarize_middle(
            messages,
            self.config.protect_first_n,
            self.config.protect_last_n,
        ) {
            changed = true;
        }
        self.last_prompt_tokens = 0;
        changed
    }
}

pub fn estimate_tokens(text: &str) -> u32 {
    let char_count = text.chars().count() as u32;
    if char_count == 0 {
        return 0;
    }
    let cjk_ratio = count_cjk_chars(text) as f32 / char_count as f32;
    let chars_per_token = if cjk_ratio > 0.30 { 2.0 } else { 4.0 };
    (char_count as f32 / chars_per_token).ceil() as u32
}

pub fn estimate_message_tokens(message: &Message) -> u32 {
    let mut total = 4;
    if let Some(content) = &message.content {
        total += estimate_tokens(content);
    }
    for call in &message.tool_calls {
        total += estimate_tokens(&call.name);
        total += estimate_tokens(&call.arguments);
    }
    if let Some(id) = &message.tool_call_id {
        total += estimate_tokens(id);
    }
    total
}

pub fn estimate_conversation_tokens(messages: &[Message], system_prompt: &str) -> u32 {
    estimate_tokens(system_prompt) + messages.iter().map(estimate_message_tokens).sum::<u32>()
}

pub fn context_length_for_model(model: &str) -> u32 {
    let lower = model.to_lowercase();
    if lower.contains("gpt-4.1") || lower.contains("gemini-1.5") || lower.contains("gemini-2") {
        return 1_000_000;
    }
    if lower.contains("claude")
        || lower.contains("o1")
        || lower.contains("o3")
        || lower.contains("o4")
    {
        return 200_000;
    }
    if lower.contains("gpt-4o") || lower.contains("gpt-4-turbo") {
        return 128_000;
    }
    if lower.contains("gpt-4") {
        return 8_192;
    }
    128_000
}

pub fn prune_tool_results(messages: &mut [Message], protect_last_n: usize) -> usize {
    let protect_from = messages.len().saturating_sub(protect_last_n);
    let mut pruned = 0;
    for message in &mut messages[..protect_from] {
        if message.role != MessageRole::Tool {
            continue;
        }
        let Some(content) = message.content.as_deref() else {
            continue;
        };
        let summary = summarize_tool_result(content);
        if summary.len() < content.len() {
            message.content = Some(summary);
            pruned += 1;
        }
    }
    pruned
}

fn summarize_middle(
    messages: &mut Vec<Message>,
    protect_first_n: usize,
    protect_last_n: usize,
) -> bool {
    let head_end = protect_first_n.min(messages.len());
    let tail_start = messages.len().saturating_sub(protect_last_n);
    if head_end >= tail_start {
        return false;
    }

    let middle = &messages[head_end..tail_start];
    let summary = build_deterministic_summary(middle);
    let mut compressed = Vec::with_capacity(head_end + 1 + messages.len() - tail_start);
    compressed.extend_from_slice(&messages[..head_end]);
    compressed.push(Message::assistant(summary));
    compressed.extend_from_slice(&messages[tail_start..]);
    *messages = compressed;
    true
}

fn build_deterministic_summary(messages: &[Message]) -> String {
    let mut user_count = 0;
    let mut assistant_count = 0;
    let mut tool_count = 0;
    let mut snippets = Vec::new();
    for message in messages {
        match message.role {
            MessageRole::User => user_count += 1,
            MessageRole::Assistant => assistant_count += 1,
            MessageRole::Tool => tool_count += 1,
            MessageRole::System => {}
        }
        if let Some(content) = &message.content {
            let trimmed = content.trim();
            if !trimmed.is_empty() && snippets.len() < 5 {
                snippets.push(trimmed.chars().take(180).collect::<String>());
            }
        }
    }
    format!(
        "[Conversation summary: {} messages compressed; user={}, assistant={}, tool={}]\n{}",
        messages.len(),
        user_count,
        assistant_count,
        tool_count,
        snippets.join("\n")
    )
}

fn summarize_tool_result(content: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(exit_code) = value.get("exit_code") {
            let stdout_lines = value
                .get("stdout")
                .and_then(|value| value.as_str())
                .map(str::lines)
                .map(Iterator::count)
                .unwrap_or(0);
            return format!(
                "[pruned tool result] exit_code={exit_code}, stdout_lines={stdout_lines}"
            );
        }
        if let Some(total_lines) = value.get("total_lines") {
            return format!("[pruned file result] total_lines={total_lines}");
        }
    }
    let preview: String = content.chars().take(200).collect();
    format!("[pruned tool result] {preview}")
}

fn count_cjk_chars(text: &str) -> usize {
    text.chars()
        .filter(|ch| {
            matches!(
                *ch as u32,
                0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF
            )
        })
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cjk_text_uses_denser_token_estimate() {
        assert!(estimate_tokens("안녕하세요안녕하세요") >= estimate_tokens("hellohello"));
    }

    #[test]
    fn context_length_handles_known_models() {
        assert_eq!(context_length_for_model("claude-sonnet-4-5"), 200_000);
        assert_eq!(context_length_for_model("gpt-4"), 8_192);
    }

    #[test]
    fn tool_result_pruning_replaces_old_tool_content() {
        let stdout = "line\n".repeat(500);
        let mut messages = vec![Message::tool_result(
            "call_1",
            serde_json::json!({"stdout":stdout,"exit_code":0}).to_string(),
        )];
        assert_eq!(prune_tool_results(&mut messages, 0), 1);
        assert!(messages[0].content.as_deref().unwrap().contains("pruned"));
    }
}
