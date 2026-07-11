//! LLM-free run recap and provenance-aware durable memory.
//!
//! Summaries describe execution history; memories are stable facts that may
//! affect future work. Automatic candidates remain pending review, while
//! keyword recall is bounded and failure-tolerant.

mod classification;
mod embedding;
mod projection;
mod ranking;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::security::{redact_sensitive_text, scan_for_threats, ThreatScope};
use crate::error::{AppError, AppResult};
use crate::models::runtime_memory::{
    AgentMemoryView, MemoriesResponse, MemoryEmbeddingSettingsView, MemorySearchQuery,
    RecentRecapResponse, ReviewMemoryRequest, UpdateMemoryEmbeddingSettings,
};
use crate::models::scope::ScopeFilter;
use crate::state::AppState;

use self::classification::{keywords, topic_key, validate_memory};
use self::embedding::{local_feature_embedding, vector_literal};
use self::projection::{memory_view, summary_view};
use self::ranking::reciprocal_rank_fusion;

/// Provenance and classification must be supplied together so callers cannot
/// accidentally create an unscoped or unattributed durable fact.
pub struct NewMemory<'a> {
    pub source_run_id: Option<Uuid>,
    pub source_decision_id: Option<Uuid>,
    pub agent_profile: &'a str,
    pub project_id: Option<Uuid>,
    pub memory_type: &'a str,
    pub origin: &'a str,
    pub content: &'a str,
    pub confidence: f64,
    pub sensitivity: &'a str,
}

#[derive(Debug, Clone, FromRow)]
pub(super) struct MemoryRow {
    id: Uuid,
    source_run_id: Option<Uuid>,
    source_run_snapshot_id: Option<String>,
    source_decision_id: Option<Uuid>,
    agent_profile: String,
    project_id: Option<Uuid>,
    memory_type: String,
    origin: String,
    content: String,
    confidence: f64,
    status: String,
    sensitivity: String,
    valid_from: DateTime<Utc>,
    valid_until: Option<DateTime<Utc>>,
    superseded_by: Option<Uuid>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct EmbeddingSettingsRow {
    agent_profile: String,
    enabled: bool,
    provider: String,
    include_private: bool,
    include_financial: bool,
}

#[derive(Debug, FromRow)]
pub(super) struct SummaryRow {
    run_id: Uuid,
    agent_profile: String,
    project_id: Option<Uuid>,
    objective: String,
    outcome: String,
    summary_text: String,
    key_topics: Vec<String>,
    source_event_start: Option<i64>,
    source_event_end: Option<i64>,
    created_at: DateTime<Utc>,
}

pub fn spawn_run_summary(state: AppState, run_id: Uuid) {
    tokio::spawn(async move {
        if let Err(err) = summarize_run(&state, run_id).await {
            tracing::warn!(error = %err, %run_id, "post-run summary failed");
        }
    });
}

pub async fn summarize_run(state: &AppState, run_id: Uuid) -> AppResult<()> {
    let run = sqlx::query_as::<_, (String, Option<Uuid>, String, String)>(
        "SELECT agent_profile, project_id, objective, status FROM agent_runs WHERE id = $1",
    )
    .bind(run_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent run {run_id} not found")))?;
    let events = sqlx::query_as::<_, (i64, String, Value)>(
        "SELECT sequence, event_type, payload FROM agent_run_events WHERE run_id = $1 ORDER BY sequence",
    )
    .bind(run_id)
    .fetch_all(&state.db)
    .await?;
    let mut files = Vec::new();
    let mut entities = Vec::new();
    let mut failures = Vec::new();
    for (_, event_type, payload) in &events {
        if event_type == "tool_call_start" {
            if let Some(resource) = payload.get("resource_key").and_then(Value::as_str) {
                if resource.starts_with("file:") {
                    files.push(redact_sensitive_text(resource));
                }
                let effect = payload
                    .get("capability")
                    .and_then(|capability| capability.get("effect"))
                    .and_then(Value::as_str);
                if effect.is_some_and(|effect| effect != "read") {
                    entities.push(redact_sensitive_text(resource));
                }
            }
        }
        if event_type == "error" || event_type == "tool_outcome_unknown" {
            failures.push(redact_sensitive_text(
                payload
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or(event_type),
            ));
        }
    }
    files.sort();
    files.dedup();
    entities.sort();
    entities.dedup();
    failures.sort();
    failures.dedup();
    let decisions = sqlx::query_as::<_, (Uuid, String, String, Option<Value>)>(
        r#"SELECT id, kind, question, answer FROM decisions
           WHERE run_id = $1 ORDER BY created_at"#,
    )
    .bind(run_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|(id, kind, question, answer)| {
        serde_json::json!({
            "id": id,
            "kind": kind,
            "question": redact_sensitive_text(&question),
            "resolved": answer.is_some(),
        })
    })
    .collect::<Vec<_>>();
    let summary_text = format!(
        "Outcome: {}. Files touched: {}. Entities changed: {}. Decisions: {}. Failures: {}.",
        run.3,
        files.len(),
        entities.len(),
        decisions.len(),
        failures.len(),
    );
    let topics = keywords(&format!("{} {summary_text}", run.2), 16);
    let source_start = events.first().map(|event| event.0);
    let source_end = events.last().map(|event| event.0);
    sqlx::query(
        r#"INSERT INTO run_summaries
             (run_id, agent_profile, project_id, objective, outcome,
              files_touched, entities_changed, decisions, failures, key_topics,
              source_event_start, source_event_end, summary_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (run_id) DO UPDATE SET
             outcome = EXCLUDED.outcome,
             files_touched = EXCLUDED.files_touched,
             entities_changed = EXCLUDED.entities_changed,
             decisions = EXCLUDED.decisions,
             failures = EXCLUDED.failures,
             key_topics = EXCLUDED.key_topics,
             source_event_start = EXCLUDED.source_event_start,
             source_event_end = EXCLUDED.source_event_end,
             summary_text = EXCLUDED.summary_text"#,
    )
    .bind(run_id)
    .bind(&run.0)
    .bind(run.1)
    .bind(redact_sensitive_text(&run.2))
    .bind(&run.3)
    .bind(serde_json::to_value(files).unwrap_or_default())
    .bind(serde_json::to_value(entities).unwrap_or_default())
    .bind(serde_json::to_value(decisions).unwrap_or_default())
    .bind(serde_json::to_value(failures).unwrap_or_default())
    .bind(&topics)
    .bind(source_start)
    .bind(source_end)
    .bind(summary_text)
    .execute(&state.db)
    .await?;
    Ok(())
}

pub async fn create_memory(state: &AppState, memory: NewMemory<'_>) -> AppResult<AgentMemoryView> {
    validate_memory(
        memory.memory_type,
        memory.origin,
        memory.content,
        memory.sensitivity,
    )?;
    let content = memory.content.trim();
    let topic_key = topic_key(content);
    let initial_status = if memory.origin == "explicit_user" {
        "active"
    } else {
        "pending_review"
    };
    let mut tx = state.db.begin().await?;
    let conflicting = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM agent_memories
           WHERE agent_profile = $1 AND project_id IS NOT DISTINCT FROM $2
             AND memory_type = $3 AND topic_key = $4
             AND status IN ('active', 'pending_review', 'conflict')
             AND lower(content) <> lower($5)
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE"#,
    )
    .bind(memory.agent_profile)
    .bind(memory.project_id)
    .bind(memory.memory_type)
    .bind(&topic_key)
    .bind(content)
    .fetch_optional(&mut *tx)
    .await?;
    let status = if conflicting.is_some() {
        "conflict"
    } else {
        initial_status
    };
    if let Some(existing_id) = conflicting {
        sqlx::query("UPDATE agent_memories SET status = 'conflict' WHERE id = $1")
            .bind(existing_id)
            .execute(&mut *tx)
            .await?;
    }
    let source_snapshot = serde_json::json!({
        "runId": memory.source_run_id,
        "decisionId": memory.source_decision_id,
    });
    let row = sqlx::query_as::<_, MemoryRow>(
        r#"INSERT INTO agent_memories
             (source_run_id, source_decision_id, source_snapshot, agent_profile,
              project_id, memory_type, origin, content, topic_key, confidence,
              status, sensitivity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id, source_run_id,
                     source_snapshot ->> 'runId' AS source_run_snapshot_id,
                     source_decision_id, agent_profile,
                     project_id, memory_type, origin, content, confidence,
                     status, sensitivity, valid_from, valid_until,
                     superseded_by, created_at"#,
    )
    .bind(memory.source_run_id)
    .bind(memory.source_decision_id)
    .bind(source_snapshot)
    .bind(memory.agent_profile)
    .bind(memory.project_id)
    .bind(memory.memory_type)
    .bind(memory.origin)
    .bind(content)
    .bind(topic_key)
    .bind(memory.confidence.clamp(0.0, 1.0))
    .bind(status)
    .bind(memory.sensitivity)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    if let Err(err) = maybe_embed_memory(state, row.id, content, memory.sensitivity).await {
        tracing::warn!(error = %err, memory_id = %row.id, "local memory embedding failed");
    }
    Ok(memory_view(row))
}

pub async fn create_decision_memory(state: &AppState, decision_id: Uuid) -> AppResult<()> {
    let row = sqlx::query_as::<_, (Uuid, String, Option<Uuid>, String, Value)>(
        r#"SELECT d.run_id, r.agent_profile, r.project_id, d.question, d.answer
           FROM decisions d INNER JOIN agent_runs r ON r.id = d.run_id
           WHERE d.id = $1 AND d.status = 'resolved' AND d.answer IS NOT NULL"#,
    )
    .bind(decision_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((run_id, profile, project_id, question, answer)) = row else {
        return Ok(());
    };
    let content = format!(
        "Decision: {} => {}",
        redact_sensitive_text(&question),
        redact_sensitive_text(&answer.to_string())
    );
    if scan_for_threats(&content, ThreatScope::Strict).is_empty() {
        create_memory(
            state,
            NewMemory {
                source_run_id: Some(run_id),
                source_decision_id: Some(decision_id),
                agent_profile: &profile,
                project_id,
                memory_type: "decision",
                origin: "decision",
                content: &content,
                confidence: 0.9,
                sensitivity: "private",
            },
        )
        .await?;
    }
    Ok(())
}

pub async fn search_memories(
    state: &AppState,
    query: MemorySearchQuery,
) -> AppResult<MemoriesResponse> {
    if query.status.as_deref().is_some_and(|status| {
        !matches!(
            status,
            "pending_review" | "active" | "conflict" | "stale" | "superseded" | "deleted"
        )
    }) {
        return Err(AppError::BadRequest("invalid memory status".to_string()));
    }
    let scope = ScopeFilter::parse(query.scope.as_deref(), query.project_id.as_deref())?;
    let term = query.q.unwrap_or_default();
    let limit = query.limit.clamp(1, 200);
    let settings = match query.agent_profile.as_deref() {
        Some(profile) => embedding_settings_row(state, profile).await?,
        None => None,
    };
    let semantic_enabled =
        settings.as_ref().is_some_and(|value| value.enabled) && !term.trim().is_empty();
    if semantic_enabled {
        let settings = settings.as_ref().expect("semantic settings checked");
        let (keyword, semantic) = tokio::join!(
            keyword_memories(
                state,
                query.agent_profile.as_deref(),
                scope,
                query.status.as_deref(),
                term.trim(),
                limit,
            ),
            vector_memories(
                state,
                query.agent_profile.as_deref(),
                scope,
                query.status.as_deref(),
                term.trim(),
                settings,
                limit,
            )
        );
        let keyword = keyword.unwrap_or_else(|err| {
            tracing::warn!(error = %err, "keyword memory recall failed during hybrid search");
            Vec::new()
        });
        return match semantic {
            Ok(semantic) => Ok(MemoriesResponse {
                memories: reciprocal_rank_fusion(keyword, semantic, limit)
                    .into_iter()
                    .map(memory_view)
                    .collect(),
                search_mode: "hybrid_rrf".to_string(),
                embedding_provider: Some(settings.provider.clone()),
                remote_data_shared: false,
            }),
            Err(err) => {
                tracing::warn!(error = %err, "semantic memory recall failed; using keyword fallback");
                Ok(MemoriesResponse {
                    memories: keyword.into_iter().map(memory_view).collect(),
                    search_mode: "keyword_fallback".to_string(),
                    embedding_provider: Some(settings.provider.clone()),
                    remote_data_shared: false,
                })
            }
        };
    }
    let rows = keyword_memories(
        state,
        query.agent_profile.as_deref(),
        scope,
        query.status.as_deref(),
        term.trim(),
        limit,
    )
    .await
    .unwrap_or_else(|err| {
        tracing::warn!(error = %err, "keyword memory recall failed; returning empty fallback");
        Vec::new()
    });
    Ok(MemoriesResponse {
        memories: rows.into_iter().map(memory_view).collect(),
        search_mode: "keyword".to_string(),
        embedding_provider: None,
        remote_data_shared: false,
    })
}

async fn keyword_memories(
    state: &AppState,
    agent_profile: Option<&str>,
    scope: ScopeFilter,
    status: Option<&str>,
    term: &str,
    limit: i64,
) -> AppResult<Vec<MemoryRow>> {
    let mut tx = state.db.begin().await?;
    sqlx::query("SET LOCAL statement_timeout = '1500ms'")
        .execute(&mut *tx)
        .await?;
    let rows = sqlx::query_as::<_, MemoryRow>(
        r#"SELECT id, source_run_id,
                  source_snapshot ->> 'runId' AS source_run_snapshot_id,
                  source_decision_id, agent_profile,
                  project_id, memory_type, origin, content, confidence,
                  status, sensitivity, valid_from, valid_until,
                  superseded_by, created_at
           FROM agent_memories
           WHERE ($1::text IS NULL OR agent_profile = $1)
             AND ($2 = 'all'
                  OR ($2 = 'general' AND project_id IS NULL)
                  OR ($2 = 'project' AND project_id = $3))
             AND (($4::text IS NULL AND status <> 'deleted') OR status = $4)
             AND (btrim($5) = '' OR search_tsv @@ websearch_to_tsquery('simple', $5))
             AND (valid_until IS NULL OR valid_until > now())
           ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'conflict' THEN 1 ELSE 2 END,
                    ts_rank(search_tsv, websearch_to_tsquery('simple', NULLIF($5, ''))) DESC NULLS LAST,
                    created_at DESC
           LIMIT $6"#,
    )
    .bind(agent_profile)
    .bind(scope.kind())
    .bind(scope.project_id())
    .bind(status)
    .bind(term)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows)
}

async fn vector_memories(
    state: &AppState,
    agent_profile: Option<&str>,
    scope: ScopeFilter,
    status: Option<&str>,
    term: &str,
    settings: &EmbeddingSettingsRow,
    limit: i64,
) -> AppResult<Vec<MemoryRow>> {
    let vector = vector_literal(&local_feature_embedding(term));
    let mut tx = state.db.begin().await?;
    sqlx::query("SET LOCAL statement_timeout = '1500ms'")
        .execute(&mut *tx)
        .await?;
    let rows = sqlx::query_as::<_, MemoryRow>(
        r#"SELECT id, source_run_id,
                  source_snapshot ->> 'runId' AS source_run_snapshot_id,
                  source_decision_id, agent_profile,
                  project_id, memory_type, origin, content, confidence,
                  status, sensitivity, valid_from, valid_until,
                  superseded_by, created_at
           FROM agent_memories
           WHERE ($1::text IS NULL OR agent_profile = $1)
             AND ($2 = 'all'
                  OR ($2 = 'general' AND project_id IS NULL)
                  OR ($2 = 'project' AND project_id = $3))
             AND (($4::text IS NULL AND status <> 'deleted') OR status = $4)
             AND embedding IS NOT NULL
             AND (sensitivity = 'normal'
                  OR (sensitivity = 'private' AND $5)
                  OR (sensitivity = 'financial' AND $6))
             AND (valid_until IS NULL OR valid_until > now())
             AND (embedding <=> $7::vector) <= 0.70
           ORDER BY embedding <=> $7::vector
           LIMIT $8"#,
    )
    .bind(agent_profile)
    .bind(scope.kind())
    .bind(scope.project_id())
    .bind(status)
    .bind(settings.include_private)
    .bind(settings.include_financial)
    .bind(vector)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows)
}

pub async fn get_embedding_settings(
    state: &AppState,
    profile: &str,
) -> AppResult<MemoryEmbeddingSettingsView> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM native_agents WHERE profile = $1)",
    )
    .bind(profile)
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(AppError::NotFound(format!(
            "agent profile {profile} not found"
        )));
    }
    let row = embedding_settings_row(state, profile)
        .await?
        .unwrap_or_else(|| EmbeddingSettingsRow {
            agent_profile: profile.to_string(),
            enabled: false,
            provider: "local_feature_hash_v1".to_string(),
            include_private: false,
            include_financial: false,
        });
    Ok(embedding_settings_view(row))
}

pub async fn update_embedding_settings(
    state: &AppState,
    profile: &str,
    request: UpdateMemoryEmbeddingSettings,
) -> AppResult<MemoryEmbeddingSettingsView> {
    let row = sqlx::query_as::<_, EmbeddingSettingsRow>(
        r#"INSERT INTO memory_embedding_settings
             (agent_profile, enabled, provider, include_private, include_financial)
           VALUES ($1, $2, 'local_feature_hash_v1', $3, $4)
           ON CONFLICT (agent_profile) DO UPDATE SET
             enabled = EXCLUDED.enabled,
             provider = EXCLUDED.provider,
             include_private = EXCLUDED.include_private,
             include_financial = EXCLUDED.include_financial,
             updated_at = now()
           RETURNING agent_profile, enabled, provider,
                     include_private, include_financial"#,
    )
    .bind(profile)
    .bind(request.enabled)
    .bind(request.include_private)
    .bind(request.include_financial)
    .fetch_one(&state.db)
    .await?;
    refresh_profile_embeddings(state, &row).await?;
    Ok(embedding_settings_view(row))
}

async fn embedding_settings_row(
    state: &AppState,
    profile: &str,
) -> AppResult<Option<EmbeddingSettingsRow>> {
    Ok(sqlx::query_as::<_, EmbeddingSettingsRow>(
        r#"SELECT agent_profile, enabled, provider,
                  include_private, include_financial
           FROM memory_embedding_settings WHERE agent_profile = $1"#,
    )
    .bind(profile)
    .fetch_optional(&state.db)
    .await?)
}

fn embedding_settings_view(row: EmbeddingSettingsRow) -> MemoryEmbeddingSettingsView {
    MemoryEmbeddingSettingsView {
        agent_profile: row.agent_profile,
        enabled: row.enabled,
        provider: row.provider,
        include_private: row.include_private,
        include_financial: row.include_financial,
        remote_data_shared: false,
        disclosure: "Local feature hashing runs inside mymy; no memory content is sent to a remote provider."
            .to_string(),
    }
}

async fn maybe_embed_memory(
    state: &AppState,
    memory_id: Uuid,
    content: &str,
    sensitivity: &str,
) -> AppResult<()> {
    let profile =
        sqlx::query_scalar::<_, String>("SELECT agent_profile FROM agent_memories WHERE id = $1")
            .bind(memory_id)
            .fetch_one(&state.db)
            .await?;
    let Some(settings) = embedding_settings_row(state, &profile).await? else {
        return Ok(());
    };
    if settings.enabled && sensitivity_allowed(&settings, sensitivity) {
        write_embedding(state, memory_id, content, &settings.provider).await?;
    }
    Ok(())
}

async fn refresh_profile_embeddings(
    state: &AppState,
    settings: &EmbeddingSettingsRow,
) -> AppResult<()> {
    if !settings.enabled {
        sqlx::query(
            "UPDATE agent_memories SET embedding = NULL, embedding_provider = NULL, embedded_at = NULL WHERE agent_profile = $1",
        )
        .bind(&settings.agent_profile)
        .execute(&state.db)
        .await?;
        return Ok(());
    }
    sqlx::query(
        r#"UPDATE agent_memories
           SET embedding = NULL, embedding_provider = NULL, embedded_at = NULL
           WHERE agent_profile = $1
             AND (sensitivity = 'private' AND NOT $2
                  OR sensitivity = 'financial' AND NOT $3)"#,
    )
    .bind(&settings.agent_profile)
    .bind(settings.include_private)
    .bind(settings.include_financial)
    .execute(&state.db)
    .await?;
    let rows = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"SELECT id, content, sensitivity FROM agent_memories
           WHERE agent_profile = $1 AND status <> 'deleted'"#,
    )
    .bind(&settings.agent_profile)
    .fetch_all(&state.db)
    .await?;
    for (id, content, sensitivity) in rows {
        if sensitivity_allowed(settings, &sensitivity) {
            write_embedding(state, id, &content, &settings.provider).await?;
        }
    }
    Ok(())
}

fn sensitivity_allowed(settings: &EmbeddingSettingsRow, sensitivity: &str) -> bool {
    sensitivity == "normal"
        || (sensitivity == "private" && settings.include_private)
        || (sensitivity == "financial" && settings.include_financial)
}

async fn write_embedding(
    state: &AppState,
    memory_id: Uuid,
    content: &str,
    provider: &str,
) -> AppResult<()> {
    let vector = vector_literal(&local_feature_embedding(content));
    sqlx::query(
        r#"UPDATE agent_memories
           SET embedding = $2::vector, embedding_provider = $3, embedded_at = now()
           WHERE id = $1"#,
    )
    .bind(memory_id)
    .bind(vector)
    .bind(provider)
    .execute(&state.db)
    .await?;
    Ok(())
}

pub async fn recent_recap(
    state: &AppState,
    profile: Option<&str>,
    scope: ScopeFilter,
    query: Option<&str>,
    limit: i64,
) -> AppResult<RecentRecapResponse> {
    let rows = sqlx::query_as::<_, SummaryRow>(
        r#"SELECT run_id, agent_profile, project_id, objective, outcome,
                  summary_text, key_topics, source_event_start,
                  source_event_end, created_at
           FROM run_summaries
           WHERE ($1::text IS NULL OR agent_profile = $1)
             AND ($2 = 'all'
                  OR ($2 = 'general' AND project_id IS NULL)
                  OR ($2 = 'project' AND project_id = $3))
             AND ($4::text IS NULL OR search_tsv @@ websearch_to_tsquery('simple', $4))
           ORDER BY created_at DESC LIMIT $5"#,
    )
    .bind(profile)
    .bind(scope.kind())
    .bind(scope.project_id())
    .bind(query.filter(|value| !value.trim().is_empty()))
    .bind(limit.clamp(1, 100))
    .fetch_all(&state.db)
    .await?;
    Ok(RecentRecapResponse {
        summaries: rows.into_iter().map(summary_view).collect(),
    })
}

pub async fn review_memory(
    state: &AppState,
    id: Uuid,
    request: ReviewMemoryRequest,
) -> AppResult<AgentMemoryView> {
    let status = match request.action.as_str() {
        "approve" => "active",
        "stale" => "stale",
        "delete" => "deleted",
        _ => {
            return Err(AppError::BadRequest(
                "memory action must be approve, stale, or delete".to_string(),
            ))
        }
    };
    let mut tx = state.db.begin().await?;
    let target = sqlx::query_as::<_, (String, Option<Uuid>, String, String)>(
        r#"SELECT agent_profile, project_id, memory_type, topic_key
           FROM agent_memories WHERE id = $1 AND status <> 'superseded' FOR UPDATE"#,
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("memory {id} not found")))?;
    if status == "active" {
        sqlx::query(
            r#"UPDATE agent_memories
               SET status = 'superseded', superseded_by = $1, reviewed_at = now()
               WHERE id <> $1 AND agent_profile = $2
                 AND project_id IS NOT DISTINCT FROM $3
                 AND memory_type = $4 AND topic_key = $5
                 AND status IN ('active', 'pending_review', 'conflict')"#,
        )
        .bind(id)
        .bind(&target.0)
        .bind(target.1)
        .bind(&target.2)
        .bind(&target.3)
        .execute(&mut *tx)
        .await?;
    }
    let row = sqlx::query_as::<_, MemoryRow>(
        r#"UPDATE agent_memories SET status = $2, reviewed_at = now()
           WHERE id = $1
           RETURNING id, source_run_id,
                     source_snapshot ->> 'runId' AS source_run_snapshot_id,
                     source_decision_id, agent_profile,
                     project_id, memory_type, origin, content, confidence,
                     status, sensitivity, valid_from, valid_until,
                     superseded_by, created_at"#,
    )
    .bind(id)
    .bind(status)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(memory_view(row))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "./migrations")]
    async fn recall_scope_is_strict_and_deleted_source_remains_identifiable(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents
                 (profile, name, drive_path, sandbox_status)
               VALUES ('memory-test', 'Memory test',
                       '/drive/agents/memory-test', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let embedding_settings = get_embedding_settings(&state, "memory-test").await.unwrap();
        assert!(!embedding_settings.enabled);
        let project_a = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO projects (name, drive_slug, drive_path)
               VALUES ('Memory A', 'memory-a', '/drive/projects/memory-a') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let project_b = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO projects (name, drive_slug, drive_path)
               VALUES ('Memory B', 'memory-b', '/drive/projects/memory-b') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let source_run_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO agent_runs
                 (agent_profile, trigger_type, objective, prompt_version)
               VALUES ('memory-test', 'wake', 'Memory source', 'test') RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let general = create_memory(
            &state,
            NewMemory {
                source_run_id: Some(source_run_id),
                source_decision_id: None,
                agent_profile: "memory-test",
                project_id: None,
                memory_type: "fact",
                origin: "explicit_user",
                content: "General memory boundary",
                confidence: 1.0,
                sensitivity: "normal",
            },
        )
        .await
        .unwrap();
        let project_a_memory = create_memory(
            &state,
            NewMemory {
                source_run_id: None,
                source_decision_id: None,
                agent_profile: "memory-test",
                project_id: Some(project_a),
                memory_type: "fact",
                origin: "explicit_user",
                content: "Project alpha boundary",
                confidence: 1.0,
                sensitivity: "normal",
            },
        )
        .await
        .unwrap();
        create_memory(
            &state,
            NewMemory {
                source_run_id: None,
                source_decision_id: None,
                agent_profile: "memory-test",
                project_id: Some(project_b),
                memory_type: "fact",
                origin: "explicit_user",
                content: "Project beta boundary",
                confidence: 1.0,
                sensitivity: "normal",
            },
        )
        .await
        .unwrap();

        let general_results = search_memories(
            &state,
            MemorySearchQuery {
                q: None,
                agent_profile: Some("memory-test".to_string()),
                scope: Some("general".to_string()),
                project_id: None,
                status: Some("active".to_string()),
                limit: 20,
            },
        )
        .await
        .unwrap();
        assert_eq!(general_results.memories.len(), 1);
        assert_eq!(general_results.memories[0].id, general.id);

        let project_results = search_memories(
            &state,
            MemorySearchQuery {
                q: None,
                agent_profile: Some("memory-test".to_string()),
                scope: Some("project".to_string()),
                project_id: Some(project_a.to_string()),
                status: Some("active".to_string()),
                limit: 20,
            },
        )
        .await
        .unwrap();
        assert_eq!(project_results.memories.len(), 1);
        assert_eq!(project_results.memories[0].id, project_a_memory.id);

        let all_results = search_memories(
            &state,
            MemorySearchQuery {
                q: None,
                agent_profile: Some("memory-test".to_string()),
                scope: Some("all".to_string()),
                project_id: None,
                status: Some("active".to_string()),
                limit: 20,
            },
        )
        .await
        .unwrap();
        assert_eq!(all_results.memories.len(), 3);

        sqlx::query("DELETE FROM agent_runs WHERE id = $1")
            .bind(source_run_id)
            .execute(&pool)
            .await
            .unwrap();
        let orphan = search_memories(
            &state,
            MemorySearchQuery {
                q: Some("General memory boundary".to_string()),
                agent_profile: Some("memory-test".to_string()),
                scope: Some("general".to_string()),
                project_id: None,
                status: Some("active".to_string()),
                limit: 20,
            },
        )
        .await
        .unwrap()
        .memories
        .into_iter()
        .next()
        .unwrap();
        assert!(orphan.source_run_id.is_none());
        assert_eq!(
            orphan.source_run_snapshot_id.as_deref(),
            Some(source_run_id.to_string().as_str())
        );
    }

    #[test]
    fn local_feature_embedding_improves_paraphrase_relevance() {
        let query = local_feature_embedding("Finish work items before reporting success");
        let relevant = local_feature_embedding("Complete every task before saying the job is done");
        let irrelevant = local_feature_embedding("Use a blue theme for calendar widgets");

        assert!(cosine(&query, &relevant) > cosine(&query, &irrelevant) + 0.15);
    }

    #[test]
    fn embedding_is_deterministic_and_normalized() {
        let first = local_feature_embedding("PostgreSQL migration convention");
        let second = local_feature_embedding("PostgreSQL migration convention");
        let norm = first
            .iter()
            .map(|component| component * component)
            .sum::<f32>()
            .sqrt();

        assert_eq!(first, second);
        assert!((norm - 1.0).abs() < 0.0001);
    }

    fn cosine(left: &[f32], right: &[f32]) -> f32 {
        left.iter()
            .zip(right)
            .map(|(left, right)| left * right)
            .sum()
    }

    fn test_config() -> crate::config::Config {
        crate::config::Config {
            database_url: String::new(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: std::env::temp_dir(),
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
}
