//! Pure run-budget parsing and accounting.
//!
//! Authorization JSON remains an external contract, but the loop should not
//! repeatedly interpret it at each dispatch site. Parsing it once gives model
//! turns, parallel tools, and delegated children the same inclusive limits.

use std::time::{Duration, Instant};

use serde_json::Value;

use crate::agent::execution::ToolExecutionContext;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct RunBudget {
    max_tool_calls: Option<u32>,
    max_runtime: Option<Duration>,
    max_total_tokens: Option<u32>,
}

impl RunBudget {
    pub(super) fn from_context(context: Option<&ToolExecutionContext>) -> Self {
        let budget = context.map(|value| &value.authorization.budget);
        Self {
            max_tool_calls: read_u32(budget, "maxToolCalls"),
            max_runtime: budget
                .and_then(|value| value.get("maxRuntimeSeconds"))
                .and_then(Value::as_u64)
                .map(Duration::from_secs),
            max_total_tokens: read_u32(budget, "maxTotalTokens"),
        }
    }

    pub(super) fn token_limit_reached(self, total: u32) -> bool {
        self.max_total_tokens.is_some_and(|limit| total >= limit)
    }

    pub(super) fn token_limit_exceeded(self, total: u32) -> bool {
        self.max_total_tokens.is_some_and(|limit| total > limit)
    }

    pub(super) fn runtime_limit_reached(self, started_at: Instant) -> bool {
        self.max_runtime
            .is_some_and(|limit| started_at.elapsed() >= limit)
    }

    pub(super) fn tool_batch_fits(self, completed: u32, batch_size: usize) -> bool {
        self.max_tool_calls.is_none_or(|limit| {
            completed.saturating_add(u32::try_from(batch_size).unwrap_or(u32::MAX)) <= limit
        })
    }

    pub(super) fn tool_limit_reached(self, completed: u32) -> bool {
        self.max_tool_calls.is_some_and(|limit| completed >= limit)
    }

    pub(super) fn remaining_tools(self, completed: u32) -> Option<u32> {
        self.max_tool_calls
            .map(|limit| limit.saturating_sub(completed))
    }

    pub(super) fn remaining_tokens(self, consumed: u32) -> Option<u32> {
        self.max_total_tokens
            .map(|limit| limit.saturating_sub(consumed))
    }
}

fn read_u32(budget: Option<&Value>, key: &str) -> Option<u32> {
    budget
        .and_then(|value| value.get(key))
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

pub(super) fn allocate_child_budget(total: u32, count: u32, position: u32) -> u32 {
    if count == 0 {
        return 0;
    }
    total / count + u32::from(position < total % count)
}

#[cfg(test)]
mod tests {
    use super::allocate_child_budget;

    #[test]
    fn child_allocation_preserves_the_parent_total() {
        let allocations = (0..5)
            .map(|position| allocate_child_budget(17, 5, position))
            .collect::<Vec<_>>();
        assert_eq!(allocations, vec![4, 4, 3, 3, 3]);
        assert_eq!(allocations.into_iter().sum::<u32>(), 17);
    }
}
