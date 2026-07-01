//! Runtime optimization primitives.
//!
//! These helpers are intentionally provider-agnostic. They let transports add
//! prompt-cache breakpoints, parse provider rate-limit headers, rotate through
//! multiple credentials, and scrub thinking blocks without changing the agent
//! loop's public contract.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use futures::{stream, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};

use crate::agent::providers::types::StreamDelta;
use crate::agent::providers::{LlmProvider, Message, ProviderError, ToolSchema};
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

impl RateLimitState {
    pub fn is_throttled(&self) -> bool {
        self.buckets()
            .iter()
            .any(|bucket| bucket.remaining == Some(0) && bucket.reset_after_secs.unwrap_or(0) > 0)
    }

    pub fn soonest_recovery_secs(&self) -> Option<u64> {
        self.buckets()
            .into_iter()
            .filter(|bucket| bucket.remaining == Some(0))
            .filter_map(|bucket| bucket.reset_after_secs)
            .min()
    }

    pub fn record_usage(&mut self, requests: u64, tokens: u64) {
        self.requests_per_minute.consume(requests);
        self.requests_per_hour.consume(requests);
        self.tokens_per_minute.consume(tokens);
        self.tokens_per_hour.consume(tokens);
    }

    fn buckets(&self) -> [&RateLimitBucket; 4] {
        [
            &self.requests_per_minute,
            &self.requests_per_hour,
            &self.tokens_per_minute,
            &self.tokens_per_hour,
        ]
    }
}

impl RateLimitBucket {
    fn consume(&mut self, amount: u64) {
        if let Some(remaining) = self.remaining.as_mut() {
            *remaining = remaining.saturating_sub(amount);
        }
    }
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

#[derive(Clone)]
pub struct MoaParticipant {
    pub label: String,
    pub provider: Arc<dyn LlmProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoaConfig {
    pub max_concurrent: usize,
    pub aggregation_prompt: String,
}

impl Default for MoaConfig {
    fn default() -> Self {
        Self {
            max_concurrent: 3,
            aggregation_prompt: "Synthesize the proposer outputs into one final answer."
                .to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoaProposerOutput {
    pub label: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoaResult {
    pub proposer_outputs: Vec<MoaProposerOutput>,
    pub aggregated: String,
}

pub async fn run_moa_turn(
    system_prompt: &str,
    messages: &[Message],
    tools: &[ToolSchema],
    proposers: Vec<MoaParticipant>,
    aggregator: MoaParticipant,
    config: MoaConfig,
) -> Result<MoaResult, ProviderError> {
    let max_concurrent = config.max_concurrent.max(1);
    let system_prompt = system_prompt.to_string();
    let messages = messages.to_vec();
    let tools = tools.to_vec();

    let proposer_outputs = stream::iter(proposers.into_iter().map(|participant| {
        let system_prompt = system_prompt.clone();
        let messages = messages.clone();
        let tools = tools.clone();
        async move {
            let content = collect_text(
                participant.provider.as_ref(),
                &system_prompt,
                &messages,
                &tools,
            )
            .await?;
            Ok::<_, ProviderError>(MoaProposerOutput {
                label: participant.label,
                content,
            })
        }
    }))
    .buffer_unordered(max_concurrent)
    .try_collect::<Vec<_>>()
    .await?;

    let mut aggregate_messages = messages;
    aggregate_messages.push(Message::user(build_aggregation_prompt(
        &config.aggregation_prompt,
        &proposer_outputs,
    )));
    let aggregated = collect_text(
        aggregator.provider.as_ref(),
        &system_prompt,
        &aggregate_messages,
        &[],
    )
    .await?;

    Ok(MoaResult {
        proposer_outputs,
        aggregated,
    })
}

async fn collect_text(
    provider: &dyn LlmProvider,
    system_prompt: &str,
    messages: &[Message],
    tools: &[ToolSchema],
) -> Result<String, ProviderError> {
    let mut stream = provider.stream(system_prompt, messages, tools).await?;
    let mut text = String::new();
    while let Some(delta) = stream.next().await {
        match delta? {
            StreamDelta::Text(fragment) => text.push_str(&fragment),
            StreamDelta::Reasoning(_)
            | StreamDelta::ToolCallStart { .. }
            | StreamDelta::ToolCallArguments { .. }
            | StreamDelta::Finish { .. } => {}
        }
    }
    Ok(scrub_thinking_blocks(&text))
}

fn build_aggregation_prompt(instruction: &str, proposer_outputs: &[MoaProposerOutput]) -> String {
    let mut prompt = format!("{instruction}\n\nProposer outputs:");
    for output in proposer_outputs {
        prompt.push_str(&format!("\n\n[{}]\n{}", output.label, output.content));
    }
    prompt
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration as StdDuration;

    use async_trait::async_trait;
    use futures::stream::BoxStream;

    use crate::agent::providers::types::{FinishReason, ModelInfo, Usage};

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
    fn rate_limit_state_reports_throttle_and_usage() {
        let mut state = RateLimitState {
            requests_per_minute: RateLimitBucket {
                limit: Some(10),
                remaining: Some(1),
                reset_after_secs: Some(30),
            },
            tokens_per_minute: RateLimitBucket {
                limit: Some(100),
                remaining: Some(0),
                reset_after_secs: Some(10),
            },
            ..RateLimitState::default()
        };
        assert!(state.is_throttled());
        assert_eq!(state.soonest_recovery_secs(), Some(10));
        state.record_usage(1, 10);
        assert_eq!(state.requests_per_minute.remaining, Some(0));
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

    struct FakeProvider {
        text: String,
        delay_ms: u64,
        active: Arc<AtomicUsize>,
        max_seen: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl LlmProvider for FakeProvider {
        async fn stream(
            &self,
            _system_prompt: &str,
            messages: &[Message],
            _tools: &[ToolSchema],
        ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
            let active = Arc::clone(&self.active);
            let max_seen = Arc::clone(&self.max_seen);
            let delay_ms = self.delay_ms;
            let text = if self.text == "aggregate" {
                messages
                    .last()
                    .and_then(|message| message.content.clone())
                    .unwrap_or_default()
            } else {
                self.text.clone()
            };
            Ok(Box::pin(async_stream::stream! {
                let now_active = active.fetch_add(1, Ordering::SeqCst) + 1;
                max_seen.fetch_max(now_active, Ordering::SeqCst);
                tokio::time::sleep(StdDuration::from_millis(delay_ms)).await;
                yield Ok(StreamDelta::Text(text));
                active.fetch_sub(1, Ordering::SeqCst);
                yield Ok(StreamDelta::Finish {
                    reason: FinishReason::Stop,
                    usage: Usage::default(),
                });
            }))
        }

        async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
            Ok(Vec::new())
        }
    }

    fn fake_participant(
        label: &str,
        text: &str,
        active: Arc<AtomicUsize>,
        max_seen: Arc<AtomicUsize>,
    ) -> MoaParticipant {
        MoaParticipant {
            label: label.to_string(),
            provider: Arc::new(FakeProvider {
                text: text.to_string(),
                delay_ms: 10,
                active,
                max_seen,
            }),
        }
    }

    #[tokio::test]
    async fn moa_collects_three_proposers_and_aggregates() {
        let active = Arc::new(AtomicUsize::new(0));
        let max_seen = Arc::new(AtomicUsize::new(0));
        let proposers = vec![
            fake_participant("a", "alpha", Arc::clone(&active), Arc::clone(&max_seen)),
            fake_participant("b", "beta", Arc::clone(&active), Arc::clone(&max_seen)),
            fake_participant("c", "gamma", Arc::clone(&active), Arc::clone(&max_seen)),
        ];
        let aggregator = fake_participant("agg", "aggregate", active, max_seen);
        let result = run_moa_turn(
            "system",
            &[Message::user("question")],
            &[],
            proposers,
            aggregator,
            MoaConfig {
                max_concurrent: 3,
                aggregation_prompt: "combine".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(result.proposer_outputs.len(), 3);
        assert!(result.aggregated.contains("alpha"));
        assert!(result.aggregated.contains("beta"));
        assert!(result.aggregated.contains("gamma"));
    }

    #[tokio::test]
    async fn moa_respects_max_concurrent() {
        let active = Arc::new(AtomicUsize::new(0));
        let max_seen = Arc::new(AtomicUsize::new(0));
        let proposers = (0..5)
            .map(|idx| {
                fake_participant(
                    &format!("p{idx}"),
                    "proposal",
                    Arc::clone(&active),
                    Arc::clone(&max_seen),
                )
            })
            .collect::<Vec<_>>();
        let aggregator = fake_participant("agg", "aggregate", active, Arc::clone(&max_seen));
        let _ = run_moa_turn(
            "system",
            &[Message::user("question")],
            &[],
            proposers,
            aggregator,
            MoaConfig {
                max_concurrent: 2,
                aggregation_prompt: "combine".to_string(),
            },
        )
        .await
        .unwrap();
        assert!(max_seen.load(Ordering::SeqCst) <= 2);
    }
}
