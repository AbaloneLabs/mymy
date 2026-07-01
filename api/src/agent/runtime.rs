//! Runtime optimization primitives.
//!
//! These helpers are intentionally provider-agnostic. They let transports add
//! prompt-cache breakpoints, parse provider rate-limit headers, rotate through
//! multiple credentials, and scrub thinking blocks without changing the agent
//! loop's public contract.

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::agent::security::SecretString;

pub const CACHE_BREAKPOINT: &str = "\n\n<!-- mymy-cache-breakpoint: volatile-below -->\n\n";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RateLimitBucket {
    pub limit: Option<u64>,
    pub remaining: Option<u64>,
    pub reset_after_secs: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RateLimitState {
    pub requests_per_minute: RateLimitBucket,
    pub requests_per_hour: RateLimitBucket,
    pub tokens_per_minute: RateLimitBucket,
    pub tokens_per_hour: RateLimitBucket,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SelectionStrategy {
    LeastUsed,
    RoundRobin,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialStatus {
    Ok,
    Exhausted { reset_at: DateTime<Utc> },
    Dead,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PooledCredential {
    pub label: String,
    pub api_key: SecretString,
    pub status: CredentialStatus,
    pub request_count: u64,
}

#[derive(Debug, Clone)]
pub struct CredentialPool {
    entries: Vec<PooledCredential>,
    strategy: SelectionStrategy,
    cursor: usize,
}

impl CredentialPool {
    pub fn new(entries: Vec<PooledCredential>, strategy: SelectionStrategy) -> Self {
        Self {
            entries,
            strategy,
            cursor: 0,
        }
    }

    pub fn acquire(&mut self, now: DateTime<Utc>) -> Option<PooledCredential> {
        refresh_cooldowns(&mut self.entries, now);
        let index = match self.strategy {
            SelectionStrategy::LeastUsed => self
                .entries
                .iter()
                .enumerate()
                .filter(|(_, entry)| matches!(entry.status, CredentialStatus::Ok))
                .min_by_key(|(_, entry)| entry.request_count)
                .map(|(idx, _)| idx),
            SelectionStrategy::RoundRobin => {
                let len = self.entries.len();
                (0..len).find_map(|offset| {
                    let idx = (self.cursor + offset) % len;
                    matches!(self.entries[idx].status, CredentialStatus::Ok).then_some(idx)
                })
            }
        }?;
        self.entries[index].request_count = self.entries[index].request_count.saturating_add(1);
        self.cursor = (index + 1) % self.entries.len().max(1);
        Some(self.entries[index].clone())
    }

    pub fn mark_exhausted(&mut self, label: &str, cooldown_secs: u64, now: DateTime<Utc>) {
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.label == label) {
            entry.status = CredentialStatus::Exhausted {
                reset_at: now + Duration::seconds(cooldown_secs as i64),
            };
        }
    }
}

pub fn apply_cache_breakpoint(stable_prefix: &str, volatile_suffix: &str) -> String {
    if volatile_suffix.trim().is_empty() {
        stable_prefix.trim().to_string()
    } else {
        format!(
            "{}{}{}",
            stable_prefix.trim_end(),
            CACHE_BREAKPOINT,
            volatile_suffix.trim_start()
        )
    }
}

pub fn parse_rate_limit_headers(headers: &HashMap<String, String>) -> RateLimitState {
    let lower = headers
        .iter()
        .map(|(key, value)| (key.to_ascii_lowercase(), value.clone()))
        .collect::<HashMap<_, _>>();
    RateLimitState {
        requests_per_minute: bucket(&lower, "requests", ""),
        requests_per_hour: bucket(&lower, "requests", "-1h"),
        tokens_per_minute: bucket(&lower, "tokens", ""),
        tokens_per_hour: bucket(&lower, "tokens", "-1h"),
    }
}

pub fn scrub_thinking_blocks(content: &str) -> String {
    let re = regex::Regex::new(r"(?is)<think>.*?</think>").expect("thinking regex compiles");
    re.replace_all(content, "").trim().to_string()
}

fn bucket(headers: &HashMap<String, String>, kind: &str, suffix: &str) -> RateLimitBucket {
    RateLimitBucket {
        limit: parse_header(headers, &format!("x-ratelimit-limit-{kind}{suffix}")),
        remaining: parse_header(headers, &format!("x-ratelimit-remaining-{kind}{suffix}")),
        reset_after_secs: parse_header(headers, &format!("x-ratelimit-reset-{kind}{suffix}")),
    }
}

fn parse_header(headers: &HashMap<String, String>, key: &str) -> Option<u64> {
    headers.get(key).and_then(|value| value.parse().ok())
}

fn refresh_cooldowns(entries: &mut [PooledCredential], now: DateTime<Utc>) {
    for entry in entries {
        if matches!(
            entry.status,
            CredentialStatus::Exhausted { reset_at } if reset_at <= now
        ) {
            entry.status = CredentialStatus::Ok;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rate_limit_headers() {
        let headers = HashMap::from([
            ("x-ratelimit-limit-requests".to_string(), "100".to_string()),
            (
                "x-ratelimit-remaining-requests".to_string(),
                "42".to_string(),
            ),
        ]);
        let state = parse_rate_limit_headers(&headers);
        assert_eq!(state.requests_per_minute.limit, Some(100));
        assert_eq!(state.requests_per_minute.remaining, Some(42));
    }

    #[test]
    fn cache_breakpoint_separates_stable_and_volatile_prompt() {
        let prompt = apply_cache_breakpoint("stable", "volatile");
        assert!(prompt.contains(CACHE_BREAKPOINT.trim()));
        assert!(prompt.starts_with("stable"));
        assert!(prompt.ends_with("volatile"));
    }

    #[test]
    fn credential_pool_rotates_round_robin_and_cooldowns() {
        let mut pool = CredentialPool::new(
            vec![
                PooledCredential {
                    label: "a".to_string(),
                    api_key: SecretString::new("sk-a"),
                    status: CredentialStatus::Ok,
                    request_count: 0,
                },
                PooledCredential {
                    label: "b".to_string(),
                    api_key: SecretString::new("sk-b"),
                    status: CredentialStatus::Ok,
                    request_count: 0,
                },
            ],
            SelectionStrategy::RoundRobin,
        );
        let now = Utc::now();
        assert_eq!(pool.acquire(now).unwrap().label, "a");
        pool.mark_exhausted("b", 60, now);
        assert_eq!(pool.acquire(now).unwrap().label, "a");
    }

    #[test]
    fn thinking_blocks_are_removed() {
        assert_eq!(scrub_thinking_blocks("a <think>secret</think> b"), "a  b");
    }
}
