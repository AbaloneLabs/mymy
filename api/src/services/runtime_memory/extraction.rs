//! Incremental, local-only conversation memory extraction.
//!
//! The first release is deliberately conservative: only direct user
//! statements with explicit durable-intent markers become pending-review
//! candidates. Assistant text and tool output are context only and can never
//! promote themselves. Batches, leases, source ranges, and cursor advancement
//! make retries safe without sending conversation text to a remote model.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::agent::security::{redact_sensitive_text, scan_for_threats, ThreatScope};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::classification::{topic_key, validate_memory};
use super::{create_memory, NewMemory};

const EXTRACTOR_VERSION: &str = "mymy-conversation-explicit-v3";
const EXTRACTION_POLICY_VERSION: &str = "local-user-statements-v3";
const MESSAGE_BATCH_SIZE: i64 = 20;
const WORKER_BATCH_SIZE: usize = 8;
const LEASE_SECONDS: i64 = 30;

#[derive(Debug, FromRow)]
struct ExtractionSession {
    session_id: Uuid,
    agent_profile: String,
    settings_revision: i64,
    last_message_id: Option<Uuid>,
    last_message_created_at: Option<DateTime<Utc>>,
    conversation_revision: Option<i64>,
}

#[derive(Debug, FromRow)]
struct ExtractionBatch {
    id: Uuid,
    session_id: Uuid,
    agent_profile: String,
    first_message_id: Uuid,
    last_message_id: Uuid,
    conversation_revision: i64,
    settings_revision: i64,
    extractor_version: String,
    policy_version: String,
}

#[derive(Debug, FromRow)]
struct SourceMessage {
    id: Uuid,
    role: String,
    content: String,
    capture_excluded: bool,
}

struct Candidate {
    message_id: Uuid,
    memory_type: &'static str,
    content: String,
}

pub fn start_extraction_worker(state: Arc<AppState>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            if let Err(error) = run_extraction_pass(&state, WORKER_BATCH_SIZE).await {
                tracing::warn!(error = %error, "conversation memory extraction pass failed");
            }
        }
    })
}

pub(crate) async fn run_extraction_pass(state: &AppState, maximum: usize) -> AppResult<usize> {
    enqueue_batches(state, maximum).await?;
    let mut processed = 0;
    for _ in 0..maximum.min(100) {
        let Some(batch) = claim_batch(state).await? else {
            break;
        };
        match process_batch(state, &batch).await {
            Ok(()) => processed += 1,
            Err(error) => {
                release_failed_batch(state, batch.id, &error).await?;
            }
        }
    }
    Ok(processed)
}

async fn enqueue_batches(state: &AppState, maximum: usize) -> AppResult<usize> {
    let sessions = sqlx::query_as::<_, ExtractionSession>(
        r#"SELECT s.id AS session_id, s.profile AS agent_profile,
                  settings.settings_revision, cursor.last_message_id,
                  cursor.last_message_created_at, cursor.conversation_revision
           FROM chat_sessions s
           INNER JOIN memory_runtime_settings settings
             ON settings.agent_profile = s.profile
            AND settings.inferred_extraction_enabled
           LEFT JOIN memory_extraction_cursors cursor
             ON cursor.session_id = s.id AND cursor.agent_profile = s.profile
           WHERE s.deleting_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM memory_extraction_batches pending
               WHERE pending.session_id = s.id
                 AND pending.agent_profile = s.profile
                 AND pending.state IN ('queued', 'processing', 'failed')
             )
             AND EXISTS (
               SELECT 1 FROM chat_messages m
               WHERE m.session_id = s.id
                 AND (cursor.last_message_created_at IS NULL OR
                      (m.created_at, m.id) >
                      (cursor.last_message_created_at, cursor.last_message_id))
             )
           ORDER BY s.updated_at, s.id
           LIMIT $1"#,
    )
    .bind(maximum.min(100) as i64)
    .fetch_all(&state.db)
    .await?;
    let mut queued = 0;
    for session in sessions {
        let messages = sqlx::query_as::<_, (Uuid, DateTime<Utc>, String, String)>(
            r#"SELECT id, created_at, role, content FROM chat_messages
               WHERE session_id = $1
                 AND ($2::timestamptz IS NULL OR
                      (created_at, id) > ($2::timestamptz, $3::uuid))
               ORDER BY created_at, id
               LIMIT $4"#,
        )
        .bind(session.session_id)
        .bind(session.last_message_created_at)
        .bind(session.last_message_id)
        .bind(MESSAGE_BATCH_SIZE)
        .fetch_all(&state.db)
        .await?;
        let (Some(first), Some(last)) = (messages.first(), messages.last()) else {
            continue;
        };
        for message in messages.iter().filter(|message| {
            message.2 == "user" && contains_negative_capture_directive(&message.3)
        }) {
            sqlx::query(
                r#"INSERT INTO memory_capture_exclusions
                     (session_id, agent_profile, source_message_id,
                      source_message_created_at, reason_code, policy_version)
                   VALUES ($1, $2, $3, $4, 'user_negative_capture', $5)
                   ON CONFLICT (session_id, agent_profile, source_message_id)
                   DO NOTHING"#,
            )
            .bind(session.session_id)
            .bind(&session.agent_profile)
            .bind(message.0)
            .bind(message.1)
            .bind(EXTRACTION_POLICY_VERSION)
            .execute(&state.db)
            .await?;
        }
        let result = sqlx::query(
            r#"INSERT INTO memory_extraction_batches
                 (session_id, agent_profile, first_message_id, last_message_id,
                  conversation_revision, extractor_version, policy_version,
                  settings_revision, state)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued')
               ON CONFLICT DO NOTHING"#,
        )
        .bind(session.session_id)
        .bind(&session.agent_profile)
        .bind(first.0)
        .bind(last.0)
        .bind(session.conversation_revision.unwrap_or(1))
        .bind(EXTRACTOR_VERSION)
        .bind(EXTRACTION_POLICY_VERSION)
        .bind(session.settings_revision)
        .execute(&state.db)
        .await?;
        queued += result.rows_affected() as usize;
    }
    Ok(queued)
}

async fn claim_batch(state: &AppState) -> AppResult<Option<ExtractionBatch>> {
    let owner = Uuid::new_v4().to_string();
    Ok(sqlx::query_as::<_, ExtractionBatch>(
        r#"WITH candidate AS (
             SELECT id FROM memory_extraction_batches
             WHERE next_attempt_at <= now()
               AND (state IN ('queued', 'failed') OR
                    (state = 'processing' AND lease_expires_at < now()))
             ORDER BY created_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           UPDATE memory_extraction_batches batch
           SET state = 'processing', attempt_count = attempt_count + 1,
               lease_owner = $1,
               lease_expires_at = now() + make_interval(secs => $2),
               updated_at = now(), last_error_code = NULL
           FROM candidate
           WHERE batch.id = candidate.id
           RETURNING batch.id, batch.session_id, batch.agent_profile,
                     batch.first_message_id, batch.last_message_id,
                     batch.conversation_revision, batch.settings_revision,
                     batch.extractor_version, batch.policy_version"#,
    )
    .bind(owner)
    .bind(LEASE_SECONDS)
    .fetch_optional(&state.db)
    .await?)
}

async fn process_batch(state: &AppState, batch: &ExtractionBatch) -> AppResult<()> {
    if batch.extractor_version != EXTRACTOR_VERSION
        || batch.policy_version != EXTRACTION_POLICY_VERSION
    {
        // A rolling deployment may leave admitted batches from an older
        // extraction contract. Skipping and advancing the cursor preserves the
        // no-surprise-backfill rule instead of reinterpreting old work under a
        // new classifier.
        return complete_batch(state, batch, "skipped", 0, 0).await;
    }
    let settings = sqlx::query_as::<_, (bool, i64)>(
        r#"SELECT inferred_extraction_enabled, settings_revision
           FROM memory_runtime_settings WHERE agent_profile = $1"#,
    )
    .bind(&batch.agent_profile)
    .fetch_optional(&state.db)
    .await?;
    let Some((enabled, current_settings_revision)) = settings else {
        return complete_batch(state, batch, "skipped", 0, 0).await;
    };
    if !enabled {
        return complete_batch(state, batch, "skipped", 0, 0).await;
    }
    if current_settings_revision != batch.settings_revision {
        return complete_batch(state, batch, "skipped", 0, 0).await;
    }
    let messages = source_messages(state, batch).await?;
    if contains_temporal_cancellation(&messages) {
        sqlx::query(
            r#"UPDATE agent_memories
               SET status = 'stale', valid_until = COALESCE(valid_until, now()),
                   lifecycle_revision = lifecycle_revision + 1
               WHERE source_session_id = $1
                 AND agent_profile = $2
                 AND memory_type = 'temporal'
                 AND origin = 'conversation_inferred'
                 AND status = 'active'"#,
        )
        .bind(batch.session_id)
        .bind(&batch.agent_profile)
        .execute(&state.db)
        .await?;
    }
    let candidates = extract_candidates(&messages);
    let project_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT project_id FROM chat_sessions WHERE id = $1 AND deleting_at IS NULL",
    )
    .bind(batch.session_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Conflict("source session is being deleted".to_string()))?;
    let mut committed = 0;
    for candidate in &candidates {
        create_memory(
            state,
            NewMemory {
                source_run_id: None,
                source_decision_id: None,
                source_session_id: Some(batch.session_id),
                source_message_start: Some(candidate.message_id),
                source_message_end: Some(candidate.message_id),
                extraction_batch_id: Some(batch.id),
                agent_profile: &batch.agent_profile,
                project_id,
                memory_type: candidate.memory_type,
                origin: "conversation_inferred",
                content: &candidate.content,
                confidence: 0.75,
                sensitivity: "private",
            },
        )
        .await?;
        committed += 1;
    }
    complete_batch(state, batch, "committed", candidates.len(), committed).await
}

async fn source_messages(
    state: &AppState,
    batch: &ExtractionBatch,
) -> AppResult<Vec<SourceMessage>> {
    Ok(sqlx::query_as::<_, SourceMessage>(
        r#"WITH bounds AS (
             SELECT
               (SELECT created_at FROM chat_messages WHERE id = $2) AS first_at,
               (SELECT created_at FROM chat_messages WHERE id = $3) AS last_at
           )
           SELECT m.id, m.role, m.content,
                  EXISTS (
                    SELECT 1 FROM memory_capture_exclusions exclusion
                    WHERE exclusion.session_id = m.session_id
                      AND exclusion.agent_profile = $4
                      AND exclusion.source_message_id = m.id
                  ) AS capture_excluded
           FROM chat_messages m CROSS JOIN bounds
           WHERE m.session_id = $1
             AND (m.created_at, m.id) >= (bounds.first_at, $2)
             AND (m.created_at, m.id) <= (bounds.last_at, $3)
           ORDER BY m.created_at, m.id"#,
    )
    .bind(batch.session_id)
    .bind(batch.first_message_id)
    .bind(batch.last_message_id)
    .bind(&batch.agent_profile)
    .fetch_all(&state.db)
    .await?)
}

fn extract_candidates(messages: &[SourceMessage]) -> Vec<Candidate> {
    let mut seen_topics = HashSet::new();
    let mut candidates = Vec::new();
    let temporal_cancelled = contains_temporal_cancellation(messages);
    for message in messages.iter().filter(|message| message.role == "user") {
        if message.capture_excluded || contains_negative_capture_directive(&message.content) {
            continue;
        }
        for sentence in message
            .content
            .split(['\n', '.', '!', '?'])
            .map(str::trim)
            .filter(|sentence| !sentence.is_empty())
        {
            let normalized = sentence.to_lowercase();
            if is_quoted_forwarded_or_hypothetical(&normalized) {
                continue;
            }
            let temporal_commitment = has_temporal_commitment(&normalized);
            if (!has_durable_intent(&normalized) && !temporal_commitment)
                || sentence.chars().count() > 500
            {
                continue;
            }
            let content = redact_sensitive_text(sentence);
            if content != sentence || !scan_for_threats(&content, ThreatScope::Strict).is_empty() {
                continue;
            }
            let memory_type = if temporal_commitment {
                "temporal"
            } else {
                classify_candidate(&normalized)
            };
            if temporal_cancelled && memory_type == "temporal" {
                continue;
            }
            if validate_memory(memory_type, "conversation_inferred", &content, "private").is_err() {
                continue;
            }
            if seen_topics.insert(topic_key(&content)) {
                candidates.push(Candidate {
                    message_id: message.id,
                    memory_type,
                    content,
                });
            }
            if candidates.len() >= 5 {
                return candidates;
            }
        }
    }
    candidates
}

fn is_quoted_forwarded_or_hypothetical(value: &str) -> bool {
    let trimmed = value.trim_start();
    if trimmed
        .chars()
        .next()
        .is_some_and(|character| matches!(character, '>' | '"' | '\'' | '“' | '‘'))
    {
        return true;
    }
    [
        "he said",
        "she said",
        "they said",
        "you said",
        "assistant said",
        "forwarded message",
        "quoted message",
        "someone said",
        "if i ",
        "maybe i ",
        "i might ",
        "그가 말",
        "그녀가 말",
        "그들이 말",
        "네가 말",
        "에이전트가 말",
        "전달받은",
        "인용한",
        "만약 내가",
        "아마 나는",
    ]
    .iter()
    .any(|marker| value.contains(marker))
}

fn contains_negative_capture_directive(value: &str) -> bool {
    let normalized = value.to_lowercase();
    [
        "do not remember",
        "don't remember",
        "dont remember",
        "do not save this to memory",
        "don't save this to memory",
        "forget this message",
        "기억하지 마",
        "기억하지마",
        "기억하지 말아",
        "메모리에 저장하지 마",
        "메모리에 저장하지마",
        "이 메시지는 잊어",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn contains_temporal_cancellation(messages: &[SourceMessage]) -> bool {
    messages
        .iter()
        .filter(|message| message.role == "user" && !message.capture_excluded)
        .map(|message| message.content.to_lowercase())
        .any(|value| {
            [
                "it was cancelled",
                "it is cancelled",
                "cancel that",
                "no longer scheduled",
                "일정 취소",
                "취소됐",
                "취소되었",
                "그건 취소",
                "더 이상 예정",
            ]
            .iter()
            .any(|marker| value.contains(marker))
        })
}

fn has_temporal_commitment(value: &str) -> bool {
    let uncertain = [
        "might",
        "maybe",
        "perhaps",
        "could ",
        "considering",
        "if ",
        "아마",
        "수도 있",
        "할까",
        "생각 중",
        "검토 중",
        "만약",
    ];
    let delegated_reminder = ["remind me", "set a reminder", "알려줘", "리마인드"];
    if uncertain.iter().any(|marker| value.contains(marker))
        || delegated_reminder
            .iter()
            .any(|marker| value.contains(marker))
    {
        return false;
    }
    let commitment = [
        "i will ",
        "i'll ",
        "i am going to ",
        "deadline is ",
        "is due ",
        "scheduled for ",
        "하기로 했",
        "하겠습니다",
        "할게",
        "보낼게",
        "제출할게",
        "마감은",
        "예정입니다",
    ]
    .iter()
    .any(|marker| value.contains(marker));
    let time_anchor = [
        "today",
        "tomorrow",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "next week",
        " by ",
        " at ",
        "오늘",
        "내일",
        "월요일",
        "화요일",
        "수요일",
        "목요일",
        "금요일",
        "토요일",
        "일요일",
        "다음 주",
        "까지",
        "시에",
    ]
    .iter()
    .any(|marker| value.contains(marker));
    commitment && time_anchor
}

fn has_durable_intent(value: &str) -> bool {
    [
        "remember that",
        "please remember",
        "i prefer",
        "my preference",
        "always use",
        "from now on",
        "기억해",
        "기억해줘",
        "기억해 주세요",
        "선호해",
        "선호합니다",
        "앞으로",
        "항상",
        "내 이름은",
        "제 이름은",
    ]
    .iter()
    .any(|marker| value.contains(marker))
}

fn classify_candidate(value: &str) -> &'static str {
    if value.contains("prefer") || value.contains("선호") {
        "preference"
    } else if value.contains("until")
        || value.contains("from now")
        || value.contains("까지")
        || value.contains("부터")
    {
        "temporal"
    } else if value.contains("always") || value.contains("항상") || value.contains("앞으로") {
        "convention"
    } else {
        "fact"
    }
}

async fn complete_batch(
    state: &AppState,
    batch: &ExtractionBatch,
    state_name: &str,
    candidate_count: usize,
    committed_count: usize,
) -> AppResult<()> {
    let last_created_at = sqlx::query_scalar::<_, DateTime<Utc>>(
        "SELECT created_at FROM chat_messages WHERE id = $1",
    )
    .bind(batch.last_message_id)
    .fetch_one(&state.db)
    .await?;
    let mut tx = state.db.begin().await?;
    let completed = sqlx::query(
        r#"UPDATE memory_extraction_batches
           SET state = $2, candidate_count = $3, committed_count = $4,
               completed_at = now(), lease_owner = NULL, lease_expires_at = NULL,
               updated_at = now(), last_error_code = NULL
           WHERE id = $1 AND state = 'processing' AND settings_revision = $5"#,
    )
    .bind(batch.id)
    .bind(state_name)
    .bind(i32::try_from(candidate_count).unwrap_or(i32::MAX))
    .bind(i32::try_from(committed_count).unwrap_or(i32::MAX))
    .bind(batch.settings_revision)
    .execute(&mut *tx)
    .await?;
    if completed.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(());
    }
    sqlx::query(
        r#"INSERT INTO memory_extraction_cursors
             (session_id, agent_profile, last_message_id,
              last_message_created_at, conversation_revision)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id, agent_profile) DO UPDATE SET
             last_message_id = EXCLUDED.last_message_id,
             last_message_created_at = EXCLUDED.last_message_created_at,
             conversation_revision = memory_extraction_cursors.conversation_revision + 1,
             updated_at = now()
           WHERE memory_extraction_cursors.conversation_revision <= $5"#,
    )
    .bind(batch.session_id)
    .bind(&batch.agent_profile)
    .bind(batch.last_message_id)
    .bind(last_created_at)
    .bind(batch.conversation_revision)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn release_failed_batch(state: &AppState, batch_id: Uuid, error: &AppError) -> AppResult<()> {
    tracing::warn!(%batch_id, error = %error, "memory extraction batch will retry");
    sqlx::query(
        r#"UPDATE memory_extraction_batches
           SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
               next_attempt_at = now() + make_interval(secs => LEAST(3600, power(2, LEAST(attempt_count, 10))::int)),
               last_error_code = 'extraction_failed', updated_at = now()
           WHERE id = $1"#,
    )
    .bind(batch_id)
    .execute(&state.db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temporal_parser_prefers_confirmed_commitments_and_detects_cancellation() {
        let confirmed = vec![SourceMessage {
            id: Uuid::new_v4(),
            role: "user".to_string(),
            content: "I will send the report Friday".to_string(),
            capture_excluded: false,
        }];
        let uncertain = vec![SourceMessage {
            id: Uuid::new_v4(),
            role: "user".to_string(),
            content: "I might send the report Friday".to_string(),
            capture_excluded: false,
        }];
        let reminder = vec![SourceMessage {
            id: Uuid::new_v4(),
            role: "user".to_string(),
            content: "Remind me to send the report Friday".to_string(),
            capture_excluded: false,
        }];
        let cancelled = vec![SourceMessage {
            id: Uuid::new_v4(),
            role: "user".to_string(),
            content: "It was cancelled".to_string(),
            capture_excluded: false,
        }];

        assert_eq!(extract_candidates(&confirmed)[0].memory_type, "temporal");
        assert!(extract_candidates(&uncertain).is_empty());
        assert!(extract_candidates(&reminder).is_empty());
        assert!(contains_temporal_cancellation(&cancelled));
    }

    #[test]
    fn deterministic_extraction_corpus_rejects_non_user_and_uncertain_claims() {
        let cases = [
            ("I prefer concise Korean reports", Some("preference")),
            ("Please remember my tax year starts in April", Some("fact")),
            ("Always use ISO dates", Some("convention")),
            ("I will send the report Friday", Some("temporal")),
            ("앞으로 보고서는 간결하게 작성해줘", Some("convention")),
            ("저는 간결한 한국어 보고서를 선호합니다", Some("preference")),
            ("금요일까지 보고서를 제출할게", Some("temporal")),
            ("I might send the report Friday", None),
            ("Maybe I prefer short reports", None),
            ("If I prefer blue, remember that", None),
            ("He said I prefer concise reports", None),
            ("You said I prefer concise reports", None),
            ("Forwarded message: I prefer concise reports", None),
            ("> I prefer concise reports", None),
            ("\"I prefer concise reports\"", None),
            ("그가 말했어: 나는 간결한 보고서를 선호해", None),
            ("에이전트가 말했어: 앞으로 ISO 날짜를 써", None),
            ("아마 나는 간결한 보고서를 선호할지도 몰라", None),
            ("Remind me to send the report Friday", None),
            ("오늘은 비가 온다", None),
        ];
        let mut accepted = 0usize;
        let mut true_positive = 0usize;
        for (content, expected_type) in cases {
            let messages = vec![SourceMessage {
                id: Uuid::new_v4(),
                role: "user".to_string(),
                content: content.to_string(),
                capture_excluded: false,
            }];
            let candidates = extract_candidates(&messages);
            if !candidates.is_empty() {
                accepted += 1;
            }
            match expected_type {
                Some(expected) => {
                    assert_eq!(candidates.len(), 1, "expected extraction for {content}");
                    assert_eq!(candidates[0].memory_type, expected);
                    true_positive += 1;
                }
                None => assert!(candidates.is_empty(), "unexpected extraction for {content}"),
            }
        }
        let precision = true_positive as f64 / accepted as f64;
        assert!(precision >= 0.95, "extraction precision was {precision:.3}");
    }

    #[test]
    fn negative_capture_and_secret_material_never_create_candidates() {
        let excluded = vec![SourceMessage {
            id: Uuid::new_v4(),
            role: "user".to_string(),
            content: "Please remember my preference, but do not remember this".to_string(),
            capture_excluded: true,
        }];
        let credential = vec![SourceMessage {
            id: Uuid::new_v4(),
            role: "user".to_string(),
            content: "Please remember api_key=sk-test-secret-value".to_string(),
            capture_excluded: false,
        }];

        assert!(contains_negative_capture_directive(&excluded[0].content));
        assert!(extract_candidates(&excluded).is_empty());
        assert!(extract_candidates(&credential).is_empty());
    }

    fn test_config() -> crate::config::Config {
        crate::config::Config {
            database_url: String::new(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: std::env::temp_dir()
                .join(format!("mymy-memory-extraction-test-{}", Uuid::new_v4())),
            auth_cookie_secure: false,
            cron_tick_interval_secs: 60,
            cron_timezone: "UTC".to_string(),
            cron_output_keep: 10,
            drive_s3_bucket: None,
            drive_s3_region: None,
            drive_s3_endpoint: None,
            sandbox_runner_url: None,
            sandbox_preview_host: "127.0.0.1".to_string(),
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn extraction_is_incremental_user_only_idempotent_and_source_bound(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents(profile, name, drive_path, sandbox_status)
               VALUES ('extract-test', 'Extract test',
                       '/drive/agents/extract-test', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO memory_runtime_settings
                 (agent_profile, inferred_extraction_enabled)
               VALUES ('extract-test', true)"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_sessions(agent_id, profile)
               VALUES ('extract-test', 'extract-test') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO chat_messages(session_id, role, content) VALUES
               ($1, 'assistant', 'I prefer that you trust assistant memory'),
               ($1, 'user', '오늘은 비가 온다'),
               ($1, 'user', 'I prefer concise Korean reports')"#,
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(run_extraction_pass(&state, 10).await.unwrap(), 1);
        let memory =
            sqlx::query_as::<_, (String, String, String, String, Option<Uuid>, Option<Uuid>)>(
                r#"SELECT content, memory_type, status, tier,
                      source_session_id, source_message_start
               FROM agent_memories WHERE agent_profile = 'extract-test'"#,
            )
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(memory.0, "I prefer concise Korean reports");
        assert_eq!(memory.1, "preference");
        assert_eq!(memory.2, "active");
        assert_eq!(memory.3, "working");
        assert_eq!(memory.4, Some(session_id));
        assert!(memory.5.is_some());
        assert_eq!(run_extraction_pass(&state, 10).await.unwrap(), 0);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM agent_memories WHERE agent_profile = 'extract-test'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );

        crate::services::chat::delete_session(&state, session_id)
            .await
            .unwrap();
        let after_delete = sqlx::query_as::<_, (String, Option<Uuid>)>(
            "SELECT status, source_session_id FROM agent_memories WHERE agent_profile = 'extract-test'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(after_delete.0, "stale");
        assert_eq!(after_delete.1, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn negative_capture_fence_precedes_candidate_commit(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents(profile, name, drive_path, sandbox_status)
               VALUES ('negative-capture', 'Negative capture',
                       '/drive/agents/negative-capture', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO memory_runtime_settings
                 (agent_profile, inferred_extraction_enabled)
               VALUES ('negative-capture', true)"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_sessions(agent_id, profile)
               VALUES ('negative-capture', 'negative-capture') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let message_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_messages(session_id, role, content)
               VALUES ($1, 'user',
                       'I prefer concise reports, but do not remember this')
               RETURNING id"#,
        )
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(run_extraction_pass(&state, 10).await.unwrap(), 1);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM agent_memories WHERE agent_profile = 'negative-capture'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, Uuid>(
                r#"SELECT source_message_id FROM memory_capture_exclusions
                   WHERE session_id = $1 AND agent_profile = 'negative-capture'"#,
            )
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            message_id
        );
        assert_eq!(run_extraction_pass(&state, 10).await.unwrap(), 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn setting_transitions_skip_history_and_disabled_turns(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents(profile, name, drive_path, sandbox_status)
               VALUES ('transition-test', 'Transition test',
                       '/drive/agents/transition-test', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_sessions(agent_id, profile)
               VALUES ('transition-test', 'transition-test') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chat_messages(session_id, role, content) VALUES ($1, 'user', 'Please remember historical text')",
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();

        let settings =
            crate::services::runtime_memory::get_runtime_settings(&state, "transition-test")
                .await
                .unwrap();
        crate::services::runtime_memory::update_runtime_settings(
            &state,
            "transition-test",
            crate::models::runtime_memory::UpdateMemoryRuntimeSettings {
                automatic_recall_enabled: true,
                inferred_extraction_enabled: true,
                semantic_indexing_enabled: false,
                expected_settings_revision: settings.settings_revision,
            },
        )
        .await
        .unwrap();
        assert_eq!(run_extraction_pass(&state, 10).await.unwrap(), 0);

        sqlx::query(
            "INSERT INTO chat_messages(session_id, role, content) VALUES ($1, 'user', 'Please remember new enabled text')",
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(run_extraction_pass(&state, 10).await.unwrap(), 1);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT content FROM agent_memories WHERE agent_profile = 'transition-test'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "Please remember new enabled text"
        );

        let settings =
            crate::services::runtime_memory::get_runtime_settings(&state, "transition-test")
                .await
                .unwrap();
        crate::services::runtime_memory::update_runtime_settings(
            &state,
            "transition-test",
            crate::models::runtime_memory::UpdateMemoryRuntimeSettings {
                automatic_recall_enabled: true,
                inferred_extraction_enabled: false,
                semantic_indexing_enabled: false,
                expected_settings_revision: settings.settings_revision,
            },
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chat_messages(session_id, role, content) VALUES ($1, 'user', 'Please remember disabled text')",
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();
        let settings =
            crate::services::runtime_memory::get_runtime_settings(&state, "transition-test")
                .await
                .unwrap();
        crate::services::runtime_memory::update_runtime_settings(
            &state,
            "transition-test",
            crate::models::runtime_memory::UpdateMemoryRuntimeSettings {
                automatic_recall_enabled: true,
                inferred_extraction_enabled: true,
                semantic_indexing_enabled: false,
                expected_settings_revision: settings.settings_revision,
            },
        )
        .await
        .unwrap();
        assert_eq!(run_extraction_pass(&state, 10).await.unwrap(), 0);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM agent_memories WHERE agent_profile = 'transition-test'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn rolling_worker_skips_old_extractor_batches_without_reinterpreting_them(
        pool: sqlx::PgPool,
    ) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents(profile, name, drive_path, sandbox_status)
               VALUES ('rolling-extract', 'Rolling extract',
                       '/drive/agents/rolling-extract', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO memory_runtime_settings
               (agent_profile, inferred_extraction_enabled)
               VALUES ('rolling-extract', true)"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_sessions(agent_id, profile)
               VALUES ('rolling-extract', 'rolling-extract') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let message_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_messages(session_id, role, content)
               VALUES ($1, 'user', 'I prefer text that old code would reinterpret')
               RETURNING id"#,
        )
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO memory_extraction_batches
               (session_id, agent_profile, first_message_id, last_message_id,
                conversation_revision, extractor_version, policy_version,
                settings_revision, state)
               VALUES ($1, 'rolling-extract', $2, $2, 1,
                       'mymy-conversation-explicit-v1',
                       'local-user-statements-v1', 1, 'queued')"#,
        )
        .bind(session_id)
        .bind(message_id)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(run_extraction_pass(&state, 1).await.unwrap(), 1);
        assert_eq!(run_extraction_pass(&state, 1).await.unwrap(), 0);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM agent_memories WHERE agent_profile = 'rolling-extract'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, Option<Uuid>>(
                r#"SELECT last_message_id FROM memory_extraction_cursors
                   WHERE session_id = $1 AND agent_profile = 'rolling-extract'"#,
            )
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            Some(message_id)
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn later_cancellation_makes_inferred_temporal_memory_ineligible(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents(profile, name, drive_path, sandbox_status)
               VALUES ('temporal-test', 'Temporal test',
                       '/drive/agents/temporal-test', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO memory_runtime_settings
                 (agent_profile, inferred_extraction_enabled)
               VALUES ('temporal-test', true)"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_sessions(agent_id, profile)
               VALUES ('temporal-test', 'temporal-test') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chat_messages(session_id, role, content) VALUES ($1, 'user', 'I will send the report Friday')",
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(run_extraction_pass(&state, 10).await.unwrap(), 1);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT status FROM agent_memories WHERE agent_profile = 'temporal-test'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "active"
        );

        sqlx::query(
            "INSERT INTO chat_messages(session_id, role, content) VALUES ($1, 'user', 'It was cancelled')",
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(run_extraction_pass(&state, 10).await.unwrap(), 1);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT status FROM agent_memories WHERE agent_profile = 'temporal-test'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "stale"
        );
    }
}
