//! Pure assembly of normalized provider deltas into one agent turn.
//!
//! Providers may split tool calls and finish metadata differently. This state
//! machine absorbs those ordering differences and emits only redacted display
//! deltas plus a provider-independent completed turn for loop policy.

use std::collections::BTreeMap;

use crate::agent::providers::types::{FinishReason, StreamDelta, ToolCall, Usage};
use crate::agent::security::redact_sensitive_text;

pub(super) enum TurnEffect {
    Text(String),
    Reasoning(String),
    None,
}

pub(super) struct CompletedTurn {
    pub content: String,
    pub reasoning: String,
    pub finish_reason: FinishReason,
    pub usage: Usage,
    pub tool_calls: Vec<ToolCall>,
}

pub(super) struct TurnAccumulator {
    content: String,
    reasoning: String,
    finish_reason: FinishReason,
    finish_seen: bool,
    usage: Usage,
    tool_calls: BTreeMap<usize, ToolCall>,
}

impl TurnAccumulator {
    pub fn new() -> Self {
        Self {
            content: String::new(),
            reasoning: String::new(),
            finish_reason: FinishReason::Stop,
            finish_seen: false,
            usage: Usage::default(),
            tool_calls: BTreeMap::new(),
        }
    }

    pub fn apply(&mut self, delta: StreamDelta) -> TurnEffect {
        match delta {
            StreamDelta::Text(text) => {
                let text = redact_sensitive_text(&text);
                self.content.push_str(&text);
                TurnEffect::Text(text)
            }
            StreamDelta::Reasoning(text) => {
                let text = redact_sensitive_text(&text);
                self.reasoning.push_str(&text);
                TurnEffect::Reasoning(text)
            }
            StreamDelta::ToolCallStart { index, id, name } => {
                self.tool_calls.insert(
                    index,
                    ToolCall {
                        id,
                        name,
                        arguments: String::new(),
                    },
                );
                TurnEffect::None
            }
            StreamDelta::ToolCallArguments { index, fragment } => {
                self.tool_calls
                    .entry(index)
                    .or_insert_with(|| ToolCall {
                        id: format!("call_{index}"),
                        name: String::new(),
                        arguments: String::new(),
                    })
                    .arguments
                    .push_str(&fragment);
                TurnEffect::None
            }
            StreamDelta::Finish {
                reason,
                usage: delta_usage,
            } => {
                if delta_usage.total_tokens > 0
                    || delta_usage.prompt_tokens > 0
                    || delta_usage.completion_tokens > 0
                {
                    self.usage = delta_usage;
                }
                if !self.finish_seen || reason != FinishReason::Stop {
                    self.finish_reason = reason;
                    self.finish_seen = true;
                }
                TurnEffect::None
            }
        }
    }

    pub fn complete(self) -> CompletedTurn {
        CompletedTurn {
            content: self.content,
            reasoning: self.reasoning,
            finish_reason: self.finish_reason,
            usage: self.usage,
            tool_calls: self.tool_calls.into_values().collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assembles_fragmented_calls_in_provider_index_order() {
        let mut turn = TurnAccumulator::new();
        turn.apply(StreamDelta::ToolCallArguments {
            index: 1,
            fragment: "{\"b\":".to_string(),
        });
        turn.apply(StreamDelta::ToolCallStart {
            index: 0,
            id: "first".to_string(),
            name: "read_file".to_string(),
        });
        turn.apply(StreamDelta::ToolCallArguments {
            index: 1,
            fragment: "2}".to_string(),
        });

        let completed = turn.complete();
        assert_eq!(completed.tool_calls[0].id, "first");
        assert_eq!(completed.tool_calls[1].id, "call_1");
        assert_eq!(completed.tool_calls[1].arguments, "{\"b\":2}");
    }

    #[test]
    fn non_stop_finish_reason_is_not_erased_by_trailing_stop_metadata() {
        let mut turn = TurnAccumulator::new();
        turn.apply(StreamDelta::Finish {
            reason: FinishReason::ToolCalls,
            usage: Usage::default(),
        });
        turn.apply(StreamDelta::Finish {
            reason: FinishReason::Stop,
            usage: Usage::default(),
        });
        assert_eq!(turn.complete().finish_reason, FinishReason::ToolCalls);
    }
}
