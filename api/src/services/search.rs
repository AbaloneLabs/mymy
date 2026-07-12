//! OmniSearch domain operations.
//!
//! GET /api/search?q=...[&projectId=...][&limit=N]
//!
//! Searches notes, tasks, projects, calendar events, and chat (sessions +
//! messages) in parallel using each table's `search_tsv` tsvector. Results
//! are grouped by entity kind and capped at `limit` (default 5, max 20)
//! per group.

use axum::http::StatusCode;
use base64::Engine as _;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use sqlx::FromRow;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration as StdDuration;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::search::{
    SearchQuery, SearchResponse, SearchResultEvent, SearchResultKnowledge, SearchResultMessage,
    SearchResultNote, SearchResultProject, SearchResultTask, SearchResults, WorkspaceSearchDomain,
    WorkspaceSearchHit, WorkspaceSearchLocation, WorkspaceSearchPartialFailure,
    WorkspaceSearchRequest, WorkspaceSearchResponse, WorkspaceSearchScope,
    WorkspaceSearchScopeView,
};
use crate::state::AppState;

/// Default and clamp bounds for the per-group result limit.
const DEFAULT_LIMIT: i64 = 5;
const MAX_LIMIT: i64 = 20;
const WORKSPACE_SNAPSHOT_MAX_HITS: usize = 400;
const WORKSPACE_SNAPSHOT_TTL_MINUTES: i64 = 5;
const WORKSPACE_SNAPSHOT_MAX_DOMAINS: usize = 7;
const WORKSPACE_SNAPSHOT_MAX_PER_PRINCIPAL: i64 = 8;
const WORKSPACE_SNAPSHOT_MAX_GLOBAL: i64 = 256;
const WORKSPACE_SNAPSHOT_MAX_CREATED_PER_MINUTE: i64 = 20;
const WORKSPACE_SNAPSHOT_MAX_JSON_BYTES: usize = 1_048_576;
const WORKSPACE_RANKER_VERSION: &str = "workspace_search_lexical_v1";

/// GET /api/search
pub async fn search_all(state: &AppState, q: SearchQuery) -> AppResult<SearchResponse> {
    let term = q.q.trim();
    if term.is_empty() {
        return Ok(empty_response(String::new()));
    }

    let project_uuid = match q.project_id.as_deref() {
        Some(pid) => Some(
            Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}")))?,
        ),
        None => None,
    };

    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    // Run all entity searches concurrently.
    let (notes, tasks, projects, events, messages, knowledge) = tokio::join!(
        query_notes(&state.db, term, project_uuid, true, limit),
        query_tasks(&state.db, term, project_uuid, true, limit),
        query_projects(&state.db, term, limit),
        query_events(&state.db, term, project_uuid, true, limit),
        query_chat(&state.db, term, project_uuid, true, limit),
        query_knowledge(&state.db, term, limit),
    );

    let notes = notes?;
    let tasks = tasks?;
    let projects = projects?;
    let events = events?;
    let messages = messages?;
    let knowledge = knowledge?;

    let total = notes.len()
        + tasks.len()
        + projects.len()
        + events.len()
        + messages.len()
        + knowledge.len();

    Ok(SearchResponse {
        query: term.to_string(),
        results: SearchResults {
            notes,
            tasks,
            projects,
            events,
            messages,
            knowledge,
        },
        total,
    })
}

/// Shared permission-scoped discovery over the current database-native domains.
///
/// Agent domain permission filtering happens before this function is called
/// and is revalidated by the tool handler. Browser callers authenticate as the
/// local owner and bind their principal key to the current auth session. This
/// layer owns explicit project scope, normalized cross-domain result metadata,
/// deterministic ranking, and safe partial failures for both surfaces.
pub async fn workspace_search(
    state: &AppState,
    request: WorkspaceSearchRequest,
    current_project_id: Option<Uuid>,
    principal_key: &str,
    permission_fingerprint: &str,
) -> AppResult<WorkspaceSearchResponse> {
    let search_semaphore = state.workspace_search_semaphore();
    let _search_permit = tokio::time::timeout(
        StdDuration::from_millis(250),
        search_semaphore.acquire_owned(),
    )
    .await
    .map_err(|_| AppError::ServiceUnavailable("workspace search capacity is busy".to_string()))?
    .map_err(|_| AppError::ServiceUnavailable("workspace search is shutting down".to_string()))?;
    let term = request.query.trim();
    if term.is_empty() || term.chars().count() > 512 {
        return Err(AppError::BadRequest(
            "workspace search query must contain between 1 and 512 characters".to_string(),
        ));
    }
    if request.domains.is_empty() || request.domains.len() > WORKSPACE_SNAPSHOT_MAX_DOMAINS {
        return Err(AppError::BadRequest(format!(
            "workspace search requires between 1 and {WORKSPACE_SNAPSHOT_MAX_DOMAINS} domains"
        )));
    }
    let mut unique_domains = std::collections::HashSet::new();
    if !request
        .domains
        .iter()
        .all(|domain| unique_domains.insert(*domain))
    {
        return Err(AppError::BadRequest(
            "workspace search domains must be unique".to_string(),
        ));
    }
    if !(1..=20).contains(&request.limit) {
        return Err(AppError::BadRequest(
            "workspace search limit must be between 1 and 20".to_string(),
        ));
    }
    if matches!(
        request.scope,
        WorkspaceSearchScope::CurrentProject | WorkspaceSearchScope::CurrentPlusGlobal
    ) && current_project_id.is_none()
    {
        return Err(AppError::BadRequest(
            "the requested workspace search scope requires a current project".to_string(),
        ));
    }

    let request_hash = workspace_request_hash(&request, current_project_id)?;
    if let Some(cursor) = request.cursor.as_deref() {
        return continue_workspace_search(
            state,
            &request,
            current_project_id,
            principal_key,
            permission_fingerprint,
            &request_hash,
            cursor,
        )
        .await;
    }

    let query_project = match request.scope {
        WorkspaceSearchScope::AllPermitted => None,
        WorkspaceSearchScope::CurrentProject | WorkspaceSearchScope::CurrentPlusGlobal => {
            current_project_id
        }
    };
    let include_global = !matches!(request.scope, WorkspaceSearchScope::CurrentProject);
    let fetch_limit = 100;
    let wants = |domain| request.domains.contains(&domain);
    let (notes, tasks, sessions, knowledge, drive, projects, calendar) = tokio::join!(
        async {
            if wants(WorkspaceSearchDomain::Notes) {
                tokio::time::timeout(
                    StdDuration::from_millis(750),
                    query_notes(&state.db, term, query_project, include_global, fetch_limit),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(AppError::ServiceUnavailable(
                        "workspace search adapter timed out".to_string(),
                    ))
                })
            } else {
                Ok(Vec::new())
            }
        },
        async {
            if wants(WorkspaceSearchDomain::Tasks) {
                tokio::time::timeout(
                    StdDuration::from_millis(750),
                    query_tasks(&state.db, term, query_project, include_global, fetch_limit),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(AppError::ServiceUnavailable(
                        "workspace search adapter timed out".to_string(),
                    ))
                })
            } else {
                Ok(Vec::new())
            }
        },
        async {
            if wants(WorkspaceSearchDomain::Sessions) {
                tokio::time::timeout(
                    StdDuration::from_millis(750),
                    query_chat(&state.db, term, query_project, include_global, fetch_limit),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(AppError::ServiceUnavailable(
                        "workspace search adapter timed out".to_string(),
                    ))
                })
            } else {
                Ok(Vec::new())
            }
        },
        async {
            if wants(WorkspaceSearchDomain::Knowledge)
                && !matches!(request.scope, WorkspaceSearchScope::CurrentProject)
            {
                tokio::time::timeout(
                    StdDuration::from_millis(750),
                    query_knowledge(&state.db, term, fetch_limit),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(AppError::ServiceUnavailable(
                        "workspace search adapter timed out".to_string(),
                    ))
                })
            } else {
                Ok(Vec::new())
            }
        },
        async {
            if wants(WorkspaceSearchDomain::Drive) {
                tokio::time::timeout(
                    StdDuration::from_millis(750),
                    query_drive_documents(
                        &state.db,
                        term,
                        request.scope,
                        current_project_id,
                        fetch_limit,
                    ),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(AppError::ServiceUnavailable(
                        "workspace search adapter timed out".to_string(),
                    ))
                })
            } else {
                Ok(Vec::new())
            }
        },
        async {
            if wants(WorkspaceSearchDomain::Projects) {
                tokio::time::timeout(
                    StdDuration::from_millis(750),
                    query_projects(&state.db, term, fetch_limit),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(AppError::ServiceUnavailable(
                        "workspace search adapter timed out".to_string(),
                    ))
                })
            } else {
                Ok(Vec::new())
            }
        },
        async {
            if wants(WorkspaceSearchDomain::Calendar) {
                tokio::time::timeout(
                    StdDuration::from_millis(750),
                    query_events(&state.db, term, query_project, include_global, fetch_limit),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(AppError::ServiceUnavailable(
                        "workspace search adapter timed out".to_string(),
                    ))
                })
            } else {
                Ok(Vec::new())
            }
        },
    );

    let mut hits = Vec::new();
    let mut partial_failures = Vec::new();
    match notes {
        Ok(rows) => hits.extend(rows.into_iter().filter_map(|row| {
            if !scope_allows_project(
                &request.scope,
                current_project_id,
                row.project_id.as_deref(),
            ) {
                return None;
            }
            let (score, reasons) = rank_text(term, &row.title, &row.preview);
            Some(WorkspaceSearchHit {
                domain: "notes".to_string(),
                resource_kind: "note".to_string(),
                stable_id: row.id.clone(),
                title: row.title,
                snippet: non_empty(row.preview),
                project_id: row.project_id,
                scope: "project_or_global".to_string(),
                lifecycle_state: "active".to_string(),
                freshness: Some(row.updated_at.clone()),
                evidence_role: "unknown".to_string(),
                source_link: serde_json::json!({"kind":"note","id":row.id}),
                locations: Vec::new(),
                normalized_score: score,
                reason_codes: reasons,
                revision: Some(row.updated_at),
            })
        })),
        Err(_) => partial_failures.push(WorkspaceSearchPartialFailure {
            domain: "notes".to_string(),
            code: "adapter_failed".to_string(),
        }),
    }
    match tasks {
        Ok(rows) => hits.extend(rows.into_iter().filter_map(|row| {
            if !scope_allows_project(
                &request.scope,
                current_project_id,
                row.project_id.as_deref(),
            ) {
                return None;
            }
            let (score, reasons) = rank_text(term, &row.title, "");
            Some(WorkspaceSearchHit {
                domain: "tasks".to_string(),
                resource_kind: "task".to_string(),
                stable_id: row.id.clone(),
                title: row.title,
                snippet: Some(format!("status={} priority={}", row.status, row.priority)),
                project_id: row.project_id,
                scope: "project_or_global".to_string(),
                lifecycle_state: "active".to_string(),
                freshness: row.due_date.clone(),
                evidence_role: "unknown".to_string(),
                source_link: serde_json::json!({"kind":"task","id":row.id}),
                locations: Vec::new(),
                normalized_score: score,
                reason_codes: reasons,
                revision: Some(row.updated_at),
            })
        })),
        Err(_) => partial_failures.push(WorkspaceSearchPartialFailure {
            domain: "tasks".to_string(),
            code: "adapter_failed".to_string(),
        }),
    }
    match sessions {
        Ok(rows) => hits.extend(rows.into_iter().filter_map(|row| {
            if !scope_allows_project(
                &request.scope,
                current_project_id,
                row.project_id.as_deref(),
            ) {
                return None;
            }
            let (score, reasons) = rank_text(term, &row.title, "");
            let stable_id = row.session_id.clone().unwrap_or_else(|| row.id.clone());
            let evidence_role = match row.author_role.as_deref() {
                Some("user") => "user_asserted",
                Some("assistant") => "system_generated",
                _ => "unknown",
            };
            Some(WorkspaceSearchHit {
                domain: "sessions".to_string(),
                resource_kind: if row.entity_type == "chatMessage" {
                    "chat_message".to_string()
                } else {
                    "chat_session".to_string()
                },
                stable_id: row.id,
                title: row.title,
                snippet: None,
                project_id: row.project_id,
                scope: "project_or_global".to_string(),
                lifecycle_state: "active".to_string(),
                freshness: Some(row.updated_at.clone()),
                evidence_role: evidence_role.to_string(),
                source_link: serde_json::json!({"kind":"chat_session","id":stable_id}),
                locations: Vec::new(),
                normalized_score: score,
                reason_codes: reasons,
                revision: Some(row.updated_at),
            })
        })),
        Err(_) => partial_failures.push(WorkspaceSearchPartialFailure {
            domain: "sessions".to_string(),
            code: "adapter_failed".to_string(),
        }),
    }
    match knowledge {
        Ok(rows) => hits.extend(rows.into_iter().map(|row| {
            let (score, reasons) = rank_text(term, &row.title, &row.preview);
            WorkspaceSearchHit {
                domain: "knowledge".to_string(),
                resource_kind: if row.node_type == "article" {
                    "knowledge_article".to_string()
                } else {
                    "knowledge_category".to_string()
                },
                stable_id: row.id.clone(),
                title: row.title,
                snippet: non_empty(row.preview),
                project_id: None,
                scope: "organization".to_string(),
                lifecycle_state: if row.status == "published" {
                    "published".to_string()
                } else {
                    "draft".to_string()
                },
                freshness: Some(row.updated_at.clone()),
                evidence_role: "external_source_claim".to_string(),
                source_link: serde_json::json!({"kind":"knowledge","id":row.id}),
                locations: Vec::new(),
                normalized_score: score,
                reason_codes: reasons,
                revision: Some(row.updated_at),
            }
        })),
        Err(_) => partial_failures.push(WorkspaceSearchPartialFailure {
            domain: "knowledge".to_string(),
            code: "adapter_failed".to_string(),
        }),
    }
    let mut drive_locations = HashMap::new();
    if let Ok(rows) = &drive {
        let resource_ids = rows.iter().map(|row| row.resource_id).collect::<Vec<_>>();
        if !resource_ids.is_empty() {
            match query_drive_locations(
                &state.db,
                &resource_ids,
                wants(WorkspaceSearchDomain::Knowledge),
                wants(WorkspaceSearchDomain::Sessions),
            )
            .await
            {
                Ok(locations) => drive_locations = locations,
                Err(_) => partial_failures.push(WorkspaceSearchPartialFailure {
                    domain: "drive".to_string(),
                    code: "location_adapter_failed".to_string(),
                }),
            }
        }
    }
    match drive {
        Ok(rows) => hits.extend(rows.into_iter().map(|row| {
            let snippet = search_snippet(&row.content_text, term, 180);
            let (score, reasons) = rank_text(
                term,
                &row.title,
                &format!("{} {}", row.current_path, snippet.as_deref().unwrap_or("")),
            );
            let source_link = serde_json::json!({
                "kind": "drive",
                "resourceId": row.resource_id,
                "path": row.current_path,
                "mimeType": row.mime_type,
            });
            let mut locations = vec![WorkspaceSearchLocation {
                kind: "drive".to_string(),
                label: source_link
                    .get("path")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                source_link: source_link.clone(),
            }];
            locations.extend(drive_locations.remove(&row.resource_id).unwrap_or_default());
            WorkspaceSearchHit {
                domain: "drive".to_string(),
                resource_kind: "drive_file".to_string(),
                stable_id: row.resource_id.to_string(),
                title: row.title,
                snippet,
                project_id: row.project_id.map(|id| id.to_string()),
                scope: "project_or_global".to_string(),
                lifecycle_state: "active".to_string(),
                freshness: Some(row.updated_at.to_rfc3339()),
                evidence_role: "external_source_claim".to_string(),
                source_link,
                locations,
                normalized_score: score,
                reason_codes: reasons,
                revision: Some(row.resource_sequence.to_string()),
            }
        })),
        Err(_) => partial_failures.push(WorkspaceSearchPartialFailure {
            domain: "drive".to_string(),
            code: "adapter_failed".to_string(),
        }),
    }
    match projects {
        Ok(rows) => hits.extend(rows.into_iter().map(|row| {
            let (score, reasons) = rank_text(
                term,
                &row.name,
                row.description.as_deref().unwrap_or_default(),
            );
            WorkspaceSearchHit {
                domain: "projects".to_string(),
                resource_kind: "project".to_string(),
                stable_id: row.id.clone(),
                title: row.name,
                snippet: row.description,
                // Projects are workspace containers rather than content owned
                // by another project, so they remain visible as global
                // navigation hits under current-plus-global scope.
                project_id: None,
                scope: "workspace".to_string(),
                lifecycle_state: row.status,
                freshness: Some(row.updated_at.clone()),
                evidence_role: "unknown".to_string(),
                source_link: serde_json::json!({"kind":"project","id":row.id}),
                locations: Vec::new(),
                normalized_score: score,
                reason_codes: reasons,
                revision: Some(row.updated_at),
            }
        })),
        Err(_) => partial_failures.push(WorkspaceSearchPartialFailure {
            domain: "projects".to_string(),
            code: "adapter_failed".to_string(),
        }),
    }
    match calendar {
        Ok(rows) => hits.extend(rows.into_iter().filter_map(|row| {
            if !scope_allows_project(
                &request.scope,
                current_project_id,
                row.project_id.as_deref(),
            ) {
                return None;
            }
            let (score, reasons) = rank_text(term, &row.title, "");
            Some(WorkspaceSearchHit {
                domain: "calendar".to_string(),
                resource_kind: "calendar_event".to_string(),
                stable_id: row.id.clone(),
                title: row.title,
                snippet: Some(match row.end_date.as_deref() {
                    Some(end) => format!("{} – {end}", row.start_date),
                    None => row.start_date.clone(),
                }),
                project_id: row.project_id,
                scope: "project_or_global".to_string(),
                lifecycle_state: "active".to_string(),
                freshness: Some(row.start_date),
                evidence_role: "unknown".to_string(),
                source_link: serde_json::json!({"kind":"calendar_event","id":row.id}),
                locations: Vec::new(),
                normalized_score: score,
                reason_codes: reasons,
                revision: Some(row.updated_at),
            })
        })),
        Err(_) => partial_failures.push(WorkspaceSearchPartialFailure {
            domain: "calendar".to_string(),
            code: "adapter_failed".to_string(),
        }),
    }
    hits.sort_by(|left, right| {
        right
            .normalized_score
            .total_cmp(&left.normalized_score)
            .then_with(|| left.domain.cmp(&right.domain))
            .then_with(|| left.stable_id.cmp(&right.stable_id))
    });
    hits.truncate(WORKSPACE_SNAPSHOT_MAX_HITS);
    let scope = match request.scope {
        WorkspaceSearchScope::CurrentProject => WorkspaceSearchScopeView::CurrentProject,
        WorkspaceSearchScope::CurrentPlusGlobal => WorkspaceSearchScopeView::CurrentPlusGlobal,
        WorkspaceSearchScope::AllPermitted => WorkspaceSearchScopeView::AllPermitted,
    };
    let page_size = request.limit as usize;
    let page = hits.iter().take(page_size).cloned().collect::<Vec<_>>();
    let (next_cursor, snapshot_expires_at) = if hits.len() > page_size {
        let expires_at = Utc::now() + ChronoDuration::minutes(WORKSPACE_SNAPSHOT_TTL_MINUTES);
        let cursor = store_workspace_snapshot(
            state,
            WorkspaceSnapshotStore {
                principal_key,
                permission_fingerprint,
                request_hash: &request_hash,
                scope: &scope,
                hits: &hits,
                partial_failures: &partial_failures,
                expires_at,
                next_offset: page_size,
            },
        )
        .await?;
        (Some(cursor), Some(expires_at.to_rfc3339()))
    } else {
        (None, None)
    };
    Ok(WorkspaceSearchResponse {
        ranker_version: WORKSPACE_RANKER_VERSION,
        scope,
        hits: page,
        partial_failures,
        next_cursor,
        snapshot_expires_at,
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshotCursor {
    version: u8,
    snapshot_id: Uuid,
    token: Uuid,
    offset: usize,
}

fn workspace_request_hash(
    request: &WorkspaceSearchRequest,
    current_project_id: Option<Uuid>,
) -> AppResult<String> {
    let mut domains = request.domains.clone();
    domains.sort();
    let normalized_query = request
        .query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let bytes = serde_json::to_vec(&serde_json::json!({
        "version": 1,
        "query": normalized_query,
        "domains": domains,
        "scope": request.scope,
        "limit": request.limit,
        "projectId": current_project_id,
        "rankerVersion": WORKSPACE_RANKER_VERSION,
    }))
    .map_err(|error| AppError::Internal(format!("search request binding failed: {error}")))?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

struct WorkspaceSnapshotStore<'a> {
    principal_key: &'a str,
    permission_fingerprint: &'a str,
    request_hash: &'a str,
    scope: &'a WorkspaceSearchScopeView,
    hits: &'a [WorkspaceSearchHit],
    partial_failures: &'a [WorkspaceSearchPartialFailure],
    expires_at: DateTime<Utc>,
    next_offset: usize,
}

async fn store_workspace_snapshot(
    state: &AppState,
    snapshot: WorkspaceSnapshotStore<'_>,
) -> AppResult<String> {
    let hits = serde_json::to_value(snapshot.hits).map_err(|error| {
        AppError::Internal(format!("search snapshot serialization failed: {error}"))
    })?;
    let partial_failures = serde_json::to_value(snapshot.partial_failures).map_err(|error| {
        AppError::Internal(format!("search failure serialization failed: {error}"))
    })?;
    let stored_bytes = serde_json::to_vec(&(&hits, &partial_failures))
        .map_err(|error| AppError::Internal(format!("search snapshot sizing failed: {error}")))?
        .len();
    if stored_bytes > WORKSPACE_SNAPSHOT_MAX_JSON_BYTES {
        return Err(AppError::PayloadTooLarge(
            "workspace search snapshot exceeds its storage budget".to_string(),
        ));
    }

    // Serialize snapshot admission so concurrent abandoned cursor chains
    // cannot race past the global/per-principal budgets. The lock is scoped to
    // this transaction and does not contain query or principal content.
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(0x6d79_6d79_7372_6368_i64)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM workspace_search_snapshots WHERE expires_at <= now()")
        .execute(&mut *tx)
        .await?;
    let (global_count, principal_count, recent_count) = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"SELECT
             COUNT(*)::bigint,
             COUNT(*) FILTER (WHERE principal_key = $1)::bigint,
             COUNT(*) FILTER (
               WHERE principal_key = $1
                 AND created_at > now() - interval '1 minute'
             )::bigint
           FROM workspace_search_snapshots"#,
    )
    .bind(snapshot.principal_key)
    .fetch_one(&mut *tx)
    .await?;
    if global_count >= WORKSPACE_SNAPSHOT_MAX_GLOBAL
        || principal_count >= WORKSPACE_SNAPSHOT_MAX_PER_PRINCIPAL
        || recent_count >= WORKSPACE_SNAPSHOT_MAX_CREATED_PER_MINUTE
    {
        return Err(AppError::Coded {
            code: "workspace_search_capacity",
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "Workspace search continuation capacity is busy; restart shortly.".to_string(),
            retryable: true,
        });
    }
    let snapshot_id = Uuid::new_v4();
    let token = Uuid::new_v4();
    let token_hash = hex::encode(Sha256::digest(token.as_bytes()));
    let scope = serde_json::to_value(snapshot.scope)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .ok_or_else(|| AppError::Internal("search scope serialization failed".to_string()))?;
    sqlx::query(
        r#"INSERT INTO workspace_search_snapshots
             (id, token_hash, principal_key, permission_fingerprint,
              request_hash, scope, hits, partial_failures, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
    )
    .bind(snapshot_id)
    .bind(token_hash)
    .bind(snapshot.principal_key)
    .bind(snapshot.permission_fingerprint)
    .bind(snapshot.request_hash)
    .bind(scope)
    .bind(hits)
    .bind(partial_failures)
    .bind(snapshot.expires_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    encode_workspace_cursor(&WorkspaceSnapshotCursor {
        version: 1,
        snapshot_id,
        token,
        offset: snapshot.next_offset,
    })
}

async fn continue_workspace_search(
    state: &AppState,
    request: &WorkspaceSearchRequest,
    current_project_id: Option<Uuid>,
    principal_key: &str,
    permission_fingerprint: &str,
    request_hash: &str,
    cursor_value: &str,
) -> AppResult<WorkspaceSearchResponse> {
    let cursor = decode_workspace_cursor(cursor_value)?;
    if cursor.version != 1
        || cursor.offset == 0
        || cursor.offset % request.limit as usize != 0
        || cursor.offset >= WORKSPACE_SNAPSHOT_MAX_HITS
    {
        return Err(workspace_cursor_restart());
    }
    let row = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            String,
            serde_json::Value,
            serde_json::Value,
            DateTime<Utc>,
        ),
    >(
        r#"SELECT token_hash, principal_key, permission_fingerprint,
                  request_hash, scope, hits, partial_failures, expires_at
           FROM workspace_search_snapshots WHERE id = $1"#,
    )
    .bind(cursor.snapshot_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(workspace_cursor_restart)?;
    let token_hash = hex::encode(Sha256::digest(cursor.token.as_bytes()));
    if row.0 != token_hash
        || row.1 != principal_key
        || row.2 != permission_fingerprint
        || row.3 != request_hash
        || row.7 <= Utc::now()
    {
        return Err(workspace_cursor_restart());
    }
    let hits: Vec<WorkspaceSearchHit> = serde_json::from_value(row.5)
        .map_err(|_| AppError::Internal("stored search snapshot is invalid".to_string()))?;
    let partial_failures: Vec<WorkspaceSearchPartialFailure> = serde_json::from_value(row.6)
        .map_err(|_| AppError::Internal("stored search failures are invalid".to_string()))?;
    if cursor.offset >= hits.len() {
        return Err(workspace_cursor_restart());
    }
    let end = (cursor.offset + request.limit as usize).min(hits.len());
    let page = hits[cursor.offset..end].to_vec();
    if !workspace_page_is_current(state, request, current_project_id, &page).await? {
        return Err(AppError::coded(
            "workspace_search_cursor_stale",
            StatusCode::CONFLICT,
            "Workspace search changed while paging; restart the search.",
        ));
    }
    let next_cursor = if end < hits.len() {
        Some(encode_workspace_cursor(&WorkspaceSnapshotCursor {
            offset: end,
            ..cursor
        })?)
    } else {
        None
    };
    let scope: WorkspaceSearchScopeView = serde_json::from_value(Value::String(row.4))
        .map_err(|_| AppError::Internal("stored search scope is invalid".to_string()))?;
    Ok(WorkspaceSearchResponse {
        ranker_version: WORKSPACE_RANKER_VERSION,
        scope,
        hits: page,
        partial_failures,
        next_cursor,
        snapshot_expires_at: Some(row.7.to_rfc3339()),
    })
}

fn encode_workspace_cursor(cursor: &WorkspaceSnapshotCursor) -> AppResult<String> {
    let bytes = serde_json::to_vec(cursor)
        .map_err(|error| AppError::Internal(format!("search cursor encode failed: {error}")))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_workspace_cursor(value: &str) -> AppResult<WorkspaceSnapshotCursor> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| workspace_cursor_restart())?;
    serde_json::from_slice(&bytes).map_err(|_| workspace_cursor_restart())
}

fn workspace_cursor_restart() -> AppError {
    AppError::coded(
        "workspace_search_cursor_restart",
        StatusCode::CONFLICT,
        "Workspace search cursor is invalid or expired; restart the search.",
    )
}

async fn workspace_page_is_current(
    state: &AppState,
    request: &WorkspaceSearchRequest,
    current_project_id: Option<Uuid>,
    hits: &[WorkspaceSearchHit],
) -> AppResult<bool> {
    for hit in hits {
        if !scope_allows_project(
            &request.scope,
            current_project_id,
            hit.project_id.as_deref(),
        ) || !workspace_hit_revision_is_current(state, hit).await?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn workspace_hit_revision_is_current(
    state: &AppState,
    hit: &WorkspaceSearchHit,
) -> AppResult<bool> {
    let Ok(id) = Uuid::parse_str(&hit.stable_id) else {
        return Ok(false);
    };
    let revision = match (hit.domain.as_str(), hit.resource_kind.as_str()) {
        ("notes", _) => {
            sqlx::query_scalar::<_, DateTime<Utc>>("SELECT updated_at FROM notes WHERE id = $1")
                .bind(id)
                .fetch_optional(&state.db)
                .await?
                .map(|value| value.to_rfc3339())
        }
        ("tasks", _) => {
            sqlx::query_scalar::<_, DateTime<Utc>>("SELECT updated_at FROM tasks WHERE id = $1")
                .bind(id)
                .fetch_optional(&state.db)
                .await?
                .map(|value| value.to_rfc3339())
        }
        ("sessions", "chat_message") => sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT created_at FROM chat_messages WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .map(|value| value.to_rfc3339()),
        ("sessions", "chat_session") => sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT updated_at FROM chat_sessions WHERE id = $1 AND deleting_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .map(|value| value.to_rfc3339()),
        ("knowledge", _) => sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT updated_at FROM knowledge_articles WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .map(|value| value.to_rfc3339()),
        ("projects", "project") => {
            sqlx::query_scalar::<_, DateTime<Utc>>("SELECT updated_at FROM projects WHERE id = $1")
                .bind(id)
                .fetch_optional(&state.db)
                .await?
                .map(|value| value.to_rfc3339())
        }
        ("calendar", "calendar_event") => sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT updated_at FROM calendar_events WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .map(|value| value.to_rfc3339()),
        ("drive", "drive_file") => sqlx::query_scalar::<_, i64>(
            r#"SELECT current_revision + lifecycle_revision
               FROM drive_resources
               WHERE id = $1 AND lifecycle_state = 'active'"#,
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .map(|value| value.to_string()),
        _ => None,
    };
    Ok(revision.as_deref() == hit.revision.as_deref())
}

fn scope_allows_project(
    scope: &WorkspaceSearchScope,
    current_project_id: Option<Uuid>,
    result_project_id: Option<&str>,
) -> bool {
    match scope {
        WorkspaceSearchScope::AllPermitted => true,
        WorkspaceSearchScope::CurrentPlusGlobal => result_project_id
            .and_then(|id| Uuid::parse_str(id).ok())
            .is_none_or(|id| Some(id) == current_project_id),
        WorkspaceSearchScope::CurrentProject => result_project_id
            .and_then(|id| Uuid::parse_str(id).ok())
            .is_some_and(|id| Some(id) == current_project_id),
    }
}

fn rank_text(term: &str, title: &str, snippet: &str) -> (f64, Vec<String>) {
    let term = term.to_lowercase();
    let title = title.to_lowercase();
    let snippet = snippet.to_lowercase();
    if title == term {
        (1.0, vec!["exact_title".to_string()])
    } else if title.contains(&term) {
        (0.85, vec!["title_match".to_string()])
    } else if snippet.contains(&term) {
        (0.65, vec!["content_match".to_string()])
    } else {
        (0.5, vec!["lexical_match".to_string()])
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn search_snippet(content: &str, term: &str, maximum: usize) -> Option<String> {
    if content.is_empty() || !content.to_lowercase().contains(&term.to_lowercase()) {
        return None;
    }
    Some(truncate(content, maximum))
}

#[derive(Debug, FromRow)]
struct DriveSearchRow {
    resource_id: Uuid,
    current_path: String,
    title: String,
    mime_type: String,
    content_text: String,
    resource_sequence: i64,
    project_id: Option<Uuid>,
    updated_at: DateTime<Utc>,
}

async fn query_drive_documents(
    db: &sqlx::PgPool,
    term: &str,
    scope: WorkspaceSearchScope,
    current_project_id: Option<Uuid>,
    limit: i64,
) -> AppResult<Vec<DriveSearchRow>> {
    let scope = match scope {
        WorkspaceSearchScope::CurrentProject => "current_project",
        WorkspaceSearchScope::CurrentPlusGlobal => "current_plus_global",
        WorkspaceSearchScope::AllPermitted => "all_permitted",
    };
    Ok(sqlx::query_as::<_, DriveSearchRow>(
        r#"SELECT d.resource_id, dr.current_path,
                  COALESCE(a.title, regexp_replace(dr.current_path, '^.*/', '')) AS title,
                  d.mime_type, d.content_text, d.resource_sequence,
                  project_scope.project_id, dr.updated_at
           FROM drive_search_documents d
           INNER JOIN drive_resources dr ON dr.id = d.resource_id
           LEFT JOIN artifacts a ON a.resource_id = dr.id
           LEFT JOIN LATERAL (
             SELECT p.id AS project_id
             FROM projects p
             WHERE dr.current_path = p.drive_path
                OR dr.current_path LIKE p.drive_path || '/%'
             ORDER BY char_length(p.drive_path) DESC, p.id
             LIMIT 1
           ) project_scope ON true
           WHERE dr.lifecycle_state = 'active'
             AND dr.kind = 'file'
             AND (
               d.search_tsv @@ websearch_to_tsquery('simple', $1)
               OR position(lower($1) in lower(dr.current_path)) > 0
               OR position(lower($1) in lower(COALESCE(a.title, ''))) > 0
               OR position(lower($1) in lower(d.content_text)) > 0
             )
             AND (
               $2 = 'all_permitted'
               OR ($2 = 'current_project' AND project_scope.project_id = $3)
               OR ($2 = 'current_plus_global' AND
                   (project_scope.project_id = $3 OR project_scope.project_id IS NULL))
             )
           ORDER BY ts_rank(d.search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                    dr.updated_at DESC, d.resource_id
           LIMIT $4"#,
    )
    .bind(term)
    .bind(scope)
    .bind(current_project_id)
    .bind(limit)
    .fetch_all(db)
    .await?)
}

#[derive(Debug, FromRow)]
struct DriveWikiLocationRow {
    resource_id: Uuid,
    knowledge_id: Uuid,
    title: String,
}

#[derive(Debug, FromRow)]
struct DriveSessionLocationRow {
    resource_id: Uuid,
    session_id: Uuid,
    title: Option<String>,
}

async fn query_drive_locations(
    db: &sqlx::PgPool,
    resource_ids: &[Uuid],
    include_knowledge: bool,
    include_sessions: bool,
) -> AppResult<HashMap<Uuid, Vec<WorkspaceSearchLocation>>> {
    let mut locations = HashMap::<Uuid, Vec<WorkspaceSearchLocation>>::new();
    if include_knowledge {
        let rows = sqlx::query_as::<_, DriveWikiLocationRow>(
            r#"SELECT resource_id, knowledge_id, title
               FROM (
                 SELECT kr.drive_resource_id AS resource_id,
                        kr.knowledge_id, kr.title,
                        row_number() OVER (
                          PARTITION BY kr.drive_resource_id
                          ORDER BY kr.updated_at DESC, kr.id
                        ) AS position
                 FROM knowledge_resources kr
                 INNER JOIN knowledge_articles ka ON ka.id = kr.knowledge_id
                 WHERE kr.drive_resource_id = ANY($1)
                   AND kr.status = 'linked'
               ) visible
               WHERE position <= 20
               ORDER BY resource_id, position"#,
        )
        .bind(resource_ids)
        .fetch_all(db)
        .await?;
        for row in rows {
            locations
                .entry(row.resource_id)
                .or_default()
                .push(WorkspaceSearchLocation {
                    kind: "knowledge".to_string(),
                    label: Some(row.title),
                    source_link: serde_json::json!({
                        "kind": "knowledge",
                        "id": row.knowledge_id,
                    }),
                });
        }
    }
    if include_sessions {
        let rows = sqlx::query_as::<_, DriveSessionLocationRow>(
            r#"SELECT resource_id, session_id, title
               FROM (
                 SELECT a.resource_id, l.session_id, cs.title,
                        row_number() OVER (
                          PARTITION BY a.resource_id
                          ORDER BY l.last_activity_at DESC, l.session_id
                        ) AS position
                 FROM artifacts a
                 INNER JOIN session_artifact_links l ON l.artifact_id = a.id
                 INNER JOIN chat_sessions cs ON cs.id = l.session_id
                 WHERE a.resource_id = ANY($1)
                   AND cs.deleting_at IS NULL
               ) visible
               WHERE position <= 20
               ORDER BY resource_id, position"#,
        )
        .bind(resource_ids)
        .fetch_all(db)
        .await?;
        for row in rows {
            locations
                .entry(row.resource_id)
                .or_default()
                .push(WorkspaceSearchLocation {
                    kind: "chat_session".to_string(),
                    label: row.title,
                    source_link: serde_json::json!({
                        "kind": "chat_session",
                        "id": row.session_id,
                    }),
                });
        }
    }
    Ok(locations)
}

const DRIVE_SEARCH_EXTRACTOR_VERSION: &str = "mymy-drive-text-v1";
const DRIVE_SEARCH_MAX_TEXT_BYTES: u64 = 1_000_000;
const DRIVE_SEARCH_MAX_DOCX_BYTES: u64 = 32 * 1024 * 1024;

pub async fn index_drive_search_resource(state: &AppState, resource_id: Uuid) -> AppResult<()> {
    let row = sqlx::query_as::<_, (String, String, Option<String>, i64)>(
        r#"SELECT kind, lifecycle_state, current_path,
                  current_revision + lifecycle_revision
           FROM drive_resources WHERE id = $1"#,
    )
    .bind(resource_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((kind, lifecycle, Some(logical_path), sequence)) = row else {
        sqlx::query("DELETE FROM drive_search_documents WHERE resource_id = $1")
            .bind(resource_id)
            .execute(&state.db)
            .await?;
        return Ok(());
    };
    if kind != "file" || lifecycle != "active" {
        sqlx::query("DELETE FROM drive_search_documents WHERE resource_id = $1")
            .bind(resource_id)
            .execute(&state.db)
            .await?;
        return Ok(());
    }
    state
        .workspace_content
        .ensure_not_quarantined(state, &logical_path)
        .await?;
    let resolved =
        crate::services::drive::resolve_drive_path(&state.config.agent_data_dir, &logical_path)?;
    let metadata = tokio::fs::metadata(&resolved.physical_path).await?;
    if !metadata.is_file() {
        sqlx::query("DELETE FROM drive_search_documents WHERE resource_id = $1")
            .bind(resource_id)
            .execute(&state.db)
            .await?;
        return Ok(());
    }
    let mime_type = crate::services::drive::mime_type_for_path(&resolved.physical_path).to_string();
    let extension = Path::new(&logical_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (content_text, extraction_status) = if matches!(
        extension.as_str(),
        "txt" | "md" | "markdown" | "json" | "csv" | "tsv" | "yaml" | "yml" | "toml"
    ) && metadata.len() <= DRIVE_SEARCH_MAX_TEXT_BYTES
    {
        match tokio::fs::read(&resolved.physical_path).await {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(text) => (text, "content"),
                Err(_) => (String::new(), "failed"),
            },
            Err(_) => (String::new(), "failed"),
        }
    } else if extension == "docx" && metadata.len() <= DRIVE_SEARCH_MAX_DOCX_BYTES {
        match crate::services::drive::read_file(state, &logical_path).await {
            Ok(file) if !file.content.is_empty() => (file.content, "content"),
            Ok(_) => (String::new(), "metadata_only"),
            Err(_) => (String::new(), "failed"),
        }
    } else {
        (String::new(), "unsupported")
    };
    sqlx::query(
        r#"INSERT INTO drive_search_documents
             (resource_id, resource_sequence, mime_type, content_text,
              extraction_status, extractor_version, content_policy_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (resource_id) DO UPDATE SET
             resource_sequence = EXCLUDED.resource_sequence,
             mime_type = EXCLUDED.mime_type,
             content_text = EXCLUDED.content_text,
             extraction_status = EXCLUDED.extraction_status,
             extractor_version = EXCLUDED.extractor_version,
             content_policy_version = EXCLUDED.content_policy_version,
             indexed_at = now()
           WHERE drive_search_documents.resource_sequence <= EXCLUDED.resource_sequence"#,
    )
    .bind(resource_id)
    .bind(sequence)
    .bind(mime_type)
    .bind(content_text)
    .bind(extraction_status)
    .bind(DRIVE_SEARCH_EXTRACTOR_VERSION)
    .bind(crate::services::content_safety::CONTENT_POLICY_VERSION)
    .execute(&state.db)
    .await?;
    Ok(())
}

#[derive(Debug, FromRow)]
struct SearchOutboxRow {
    id: i64,
    resource_id: Uuid,
    event_kind: String,
}

pub async fn reconcile_drive_search_index(state: &AppState, maximum: usize) -> AppResult<usize> {
    let maximum = maximum.min(10_000) as i64;
    let events = sqlx::query_as::<_, SearchOutboxRow>(
        r#"SELECT o.id, o.resource_id, o.event_kind
           FROM resource_outbox o
           LEFT JOIN resource_outbox_deliveries d
             ON d.consumer = 'drive_search_v1' AND d.outbox_id = o.id
           WHERE d.outbox_id IS NULL
           ORDER BY o.id
           LIMIT $1"#,
    )
    .bind(maximum)
    .fetch_all(&state.db)
    .await?;
    let mut processed = 0;
    for event in events {
        if event.event_kind != "resource_prefix_moved" {
            index_drive_search_resource(state, event.resource_id).await?;
        }
        sqlx::query(
            r#"INSERT INTO resource_outbox_deliveries(consumer, outbox_id)
               VALUES ('drive_search_v1', $1) ON CONFLICT DO NOTHING"#,
        )
        .bind(event.id)
        .execute(&state.db)
        .await?;
        processed += 1;
    }
    if processed < maximum as usize {
        let missing = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT dr.id
               FROM drive_resources dr
               LEFT JOIN drive_search_documents d ON d.resource_id = dr.id
               WHERE dr.lifecycle_state = 'active' AND dr.kind = 'file'
                 AND d.resource_id IS NULL
               ORDER BY dr.updated_at, dr.id
               LIMIT $1"#,
        )
        .bind(maximum - processed as i64)
        .fetch_all(&state.db)
        .await?;
        for resource_id in missing {
            index_drive_search_resource(state, resource_id).await?;
            processed += 1;
        }
    }
    Ok(processed)
}

// ============================================================
// Per-entity search queries
// ============================================================

#[derive(Debug, FromRow)]
struct NoteSearchRow {
    id: Uuid,
    title: String,
    content: Option<String>,
    project_id: Option<Uuid>,
    updated_at: DateTime<Utc>,
}

async fn query_notes(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    include_global: bool,
    limit: i64,
) -> AppResult<Vec<SearchResultNote>> {
    let rows = match project {
        Some(pid) if include_global => {
            sqlx::query_as!(
                NoteSearchRow,
                r#"SELECT id, LEFT(content, 300) AS content, title, project_id, updated_at
                   FROM notes
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND (project_id = $2 OR project_id IS NULL)
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            updated_at DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        Some(pid) => {
            sqlx::query_as!(
                NoteSearchRow,
                r#"SELECT id, LEFT(content, 300) AS content, title, project_id, updated_at
                   FROM notes
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND project_id = $2
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            updated_at DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        None => {
            sqlx::query_as!(
                NoteSearchRow,
                r#"SELECT id, LEFT(content, 300) AS content, title, project_id, updated_at
                   FROM notes
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            updated_at DESC
                   LIMIT $2"#,
                term,
                limit,
            )
            .fetch_all(db)
            .await?
        }
    };

    Ok(rows
        .into_iter()
        .map(|r| SearchResultNote {
            id: r.id.to_string(),
            title: r.title,
            preview: truncate(r.content.as_deref().unwrap_or(""), 150),
            project_id: r.project_id.map(|u| u.to_string()),
            updated_at: r.updated_at.to_rfc3339(),
        })
        .collect())
}

#[derive(Debug, FromRow)]
struct TaskSearchRow {
    id: Uuid,
    title: String,
    status: String,
    priority: String,
    project_id: Option<Uuid>,
    due_date: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
}

async fn query_tasks(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    include_global: bool,
    limit: i64,
) -> AppResult<Vec<SearchResultTask>> {
    let rows = match project {
        Some(pid) if include_global => {
            sqlx::query_as!(
                TaskSearchRow,
                r#"SELECT id, title, status, priority, project_id, due_date, updated_at
                   FROM tasks
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND (project_id = $2 OR project_id IS NULL)
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            updated_at DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        Some(pid) => {
            sqlx::query_as!(
                TaskSearchRow,
                r#"SELECT id, title, status, priority, project_id, due_date, updated_at
                   FROM tasks
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND project_id = $2
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            updated_at DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        None => {
            sqlx::query_as!(
                TaskSearchRow,
                r#"SELECT id, title, status, priority, project_id, due_date, updated_at
                   FROM tasks
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            updated_at DESC
                   LIMIT $2"#,
                term,
                limit,
            )
            .fetch_all(db)
            .await?
        }
    };

    Ok(rows
        .into_iter()
        .map(|r| SearchResultTask {
            id: r.id.to_string(),
            title: r.title,
            status: r.status,
            priority: r.priority,
            project_id: r.project_id.map(|u| u.to_string()),
            due_date: r.due_date.map(|d| d.to_rfc3339()),
            updated_at: r.updated_at.to_rfc3339(),
        })
        .collect())
}

#[derive(Debug, FromRow)]
struct ProjectSearchRow {
    id: Uuid,
    name: String,
    description: Option<String>,
    status: String,
    updated_at: DateTime<Utc>,
}

async fn query_projects(
    db: &sqlx::PgPool,
    term: &str,
    limit: i64,
) -> AppResult<Vec<SearchResultProject>> {
    // Projects are not project-scoped, so no projectId filter applies.
    let rows = sqlx::query_as!(
        ProjectSearchRow,
        r#"SELECT id, name, description, status, updated_at
           FROM projects
           WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
           ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                    updated_at DESC
           LIMIT $2"#,
        term,
        limit,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| SearchResultProject {
            id: r.id.to_string(),
            name: r.name,
            description: r.description,
            status: r.status,
            updated_at: r.updated_at.to_rfc3339(),
        })
        .collect())
}

#[derive(Debug, FromRow)]
struct KnowledgeSearchRow {
    id: Uuid,
    title: String,
    content: Option<String>,
    node_type: String,
    status: String,
    updated_at: DateTime<Utc>,
}

/// Search knowledge base articles (title + content). Knowledge is
/// organization-wide, so no project scope filter applies.
async fn query_knowledge(
    db: &sqlx::PgPool,
    term: &str,
    limit: i64,
) -> AppResult<Vec<SearchResultKnowledge>> {
    let rows = sqlx::query_as!(
        KnowledgeSearchRow,
        r#"SELECT id, LEFT(content, 300) AS content, title, node_type, status, updated_at
           FROM knowledge_articles
           WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
           ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                    updated_at DESC
           LIMIT $2"#,
        term,
        limit,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| SearchResultKnowledge {
            id: r.id.to_string(),
            title: r.title,
            preview: truncate(r.content.as_deref().unwrap_or(""), 150),
            node_type: r.node_type,
            status: r.status,
            updated_at: r.updated_at.to_rfc3339(),
        })
        .collect())
}

#[derive(Debug, FromRow)]
struct EventSearchRow {
    id: Uuid,
    title: String,
    start_date: DateTime<Utc>,
    end_date: Option<DateTime<Utc>>,
    project_id: Option<Uuid>,
    updated_at: DateTime<Utc>,
}

async fn query_events(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    include_global: bool,
    limit: i64,
) -> AppResult<Vec<SearchResultEvent>> {
    let rows = match project {
        Some(pid) if include_global => {
            sqlx::query_as!(
                EventSearchRow,
                r#"SELECT id, title, start_date, end_date, project_id, updated_at
                   FROM calendar_events
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND (project_id = $2 OR project_id IS NULL)
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            start_date DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        Some(pid) => {
            sqlx::query_as!(
                EventSearchRow,
                r#"SELECT id, title, start_date, end_date, project_id, updated_at
                   FROM calendar_events
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND project_id = $2
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            start_date DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        None => {
            sqlx::query_as!(
                EventSearchRow,
                r#"SELECT id, title, start_date, end_date, project_id, updated_at
                   FROM calendar_events
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            start_date DESC
                   LIMIT $2"#,
                term,
                limit,
            )
            .fetch_all(db)
            .await?
        }
    };

    Ok(rows
        .into_iter()
        .map(|r| SearchResultEvent {
            id: r.id.to_string(),
            title: r.title,
            start_date: r.start_date.to_rfc3339(),
            end_date: r.end_date.map(|d| d.to_rfc3339()),
            project_id: r.project_id.map(|u| u.to_string()),
            updated_at: r.updated_at.to_rfc3339(),
        })
        .collect())
}

#[derive(Debug, FromRow)]
struct ChatSessionSearchRow {
    id: Uuid,
    title: Option<String>,
    project_id: Option<Uuid>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct ChatMessageSearchRow {
    id: Uuid,
    session_id: Uuid,
    content: Option<String>,
    role: String,
    project_id: Option<Uuid>,
    created_at: DateTime<Utc>,
}

/// Search chat sessions (by title) and chat messages (by content), then
/// merge both into a single `messages` group discriminated by `entity_type`.
async fn query_chat(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    include_global: bool,
    limit: i64,
) -> AppResult<Vec<SearchResultMessage>> {
    let (sessions, messages) = tokio::join!(
        query_chat_sessions(db, term, project, include_global, limit),
        query_chat_messages(db, term, project, include_global, limit),
    );

    let mut out: Vec<SearchResultMessage> = Vec::new();
    out.extend(sessions?.into_iter().map(|r| SearchResultMessage {
        entity_type: "chatSession".to_string(),
        id: r.id.to_string(),
        title: r.title.unwrap_or_default(),
        session_id: None,
        project_id: r.project_id.map(|u| u.to_string()),
        author_role: None,
        updated_at: r.updated_at.to_rfc3339(),
    }));
    out.extend(messages?.into_iter().map(|r| SearchResultMessage {
        entity_type: "chatMessage".to_string(),
        id: r.id.to_string(),
        title: truncate(r.content.as_deref().unwrap_or(""), 120),
        session_id: Some(r.session_id.to_string()),
        project_id: r.project_id.map(|u| u.to_string()),
        author_role: Some(r.role),
        updated_at: r.created_at.to_rfc3339(),
    }));
    Ok(out)
}

async fn query_chat_sessions(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    include_global: bool,
    limit: i64,
) -> AppResult<Vec<ChatSessionSearchRow>> {
    let rows = match project {
        Some(pid) if include_global => {
            sqlx::query_as!(
                ChatSessionSearchRow,
                r#"SELECT id, title, project_id, updated_at
                   FROM chat_sessions
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND (project_id = $2 OR project_id IS NULL)
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            updated_at DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        Some(pid) => {
            sqlx::query_as!(
                ChatSessionSearchRow,
                r#"SELECT id, title, project_id, updated_at
                   FROM chat_sessions
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND project_id = $2
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            updated_at DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        None => {
            sqlx::query_as!(
                ChatSessionSearchRow,
                r#"SELECT id, title, project_id, updated_at
                   FROM chat_sessions
                   WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
                   ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            updated_at DESC
                   LIMIT $2"#,
                term,
                limit,
            )
            .fetch_all(db)
            .await?
        }
    };
    Ok(rows)
}

async fn query_chat_messages(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    include_global: bool,
    limit: i64,
) -> AppResult<Vec<ChatMessageSearchRow>> {
    // Join chat_sessions to scope by project_id and expose it in the result.
    let rows = match project {
        Some(pid) if include_global => {
            sqlx::query_as!(
                ChatMessageSearchRow,
                r#"SELECT m.id, m.session_id, LEFT(m.content, 300) AS content,
                          m.role, s.project_id, m.created_at
                   FROM chat_messages m
                   JOIN chat_sessions s ON s.id = m.session_id
                   WHERE m.search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND (s.project_id = $2 OR s.project_id IS NULL)
                   ORDER BY ts_rank(m.search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            m.created_at DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        Some(pid) => {
            sqlx::query_as!(
                ChatMessageSearchRow,
                r#"SELECT m.id, m.session_id, LEFT(m.content, 300) AS content,
                          m.role, s.project_id, m.created_at
                   FROM chat_messages m
                   JOIN chat_sessions s ON s.id = m.session_id
                   WHERE m.search_tsv @@ websearch_to_tsquery('simple', $1)
                     AND s.project_id = $2
                   ORDER BY ts_rank(m.search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            m.created_at DESC
                   LIMIT $3"#,
                term,
                pid,
                limit,
            )
            .fetch_all(db)
            .await?
        }
        None => {
            sqlx::query_as!(
                ChatMessageSearchRow,
                r#"SELECT m.id, m.session_id, LEFT(m.content, 300) AS content,
                          m.role, s.project_id, m.created_at
                   FROM chat_messages m
                   JOIN chat_sessions s ON s.id = m.session_id
                   WHERE m.search_tsv @@ websearch_to_tsquery('simple', $1)
                   ORDER BY ts_rank(m.search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                            m.created_at DESC
                   LIMIT $2"#,
                term,
                limit,
            )
            .fetch_all(db)
            .await?
        }
    };
    Ok(rows)
}

// ============================================================
// Helpers
// ============================================================

/// Truncate `s` to at most `max_chars` unicode chars, appending an ellipsis
/// when truncation occurs.
fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let truncated: String = s.chars().take(max_chars).collect();
    // Collapse trailing newlines/whitespace before adding the ellipsis.
    format!("{}…", truncated.trim_end())
}

/// Build an empty search response (used for blank queries).
fn empty_response(query: String) -> SearchResponse {
    SearchResponse {
        query,
        results: SearchResults {
            notes: vec![],
            tasks: vec![],
            projects: vec![],
            events: vec![],
            messages: vec![],
            knowledge: vec![],
        },
        total: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> crate::config::Config {
        crate::config::Config {
            database_url: String::new(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: std::env::temp_dir()
                .join(format!("mymy-search-test-{}", Uuid::new_v4())),
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

    async fn commit_search_file(state: &AppState, path: &str, content: &str, key: &str) {
        let outcome = state
            .workspace_content
            .admit_bytes(
                state,
                crate::services::workspace_content::AdmissionRequest {
                    desired_path: path.to_string(),
                    file_name: Path::new(path)
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .to_string(),
                    origin: crate::models::content_security::ContentOrigin::UserUpload,
                    actor: crate::services::workspace_content::AdmissionActor::system(),
                    expected_fingerprint: None,
                    allow_overwrite: false,
                    enqueue_s3_sync: false,
                    operation_key: Some(key.to_string()),
                    artifact: None,
                },
                content.as_bytes(),
            )
            .await
            .unwrap();
        assert!(matches!(
            outcome,
            crate::services::workspace_content::AdmissionOutcome::Committed { .. }
        ));
    }

    #[test]
    fn truncate_keeps_short_text_unchanged() {
        assert_eq!(truncate("short text", 20), "short text");
    }

    #[test]
    fn truncate_respects_character_boundaries() {
        assert_eq!(truncate("abc 가나다", 5), "abc 가…");
    }

    #[test]
    fn truncate_trims_trailing_whitespace_before_ellipsis() {
        assert_eq!(truncate("hello   world", 8), "hello…");
    }

    #[test]
    fn empty_response_has_all_groups_empty() {
        let response = empty_response("".to_string());
        assert_eq!(response.total, 0);
        assert!(response.results.notes.is_empty());
        assert!(response.results.tasks.is_empty());
        assert!(response.results.projects.is_empty());
        assert!(response.results.events.is_empty());
        assert!(response.results.messages.is_empty());
        assert!(response.results.knowledge.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn workspace_search_keeps_project_scope_explicit_and_results_normalized(
        pool: sqlx::PgPool,
    ) {
        let state = AppState::new(pool.clone(), test_config());
        let project_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO projects (name, drive_slug, drive_path) VALUES ('Search project', 'search-project', '/drive/projects/search-project') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO notes (project_id, title, content) VALUES ($1, 'alpha project note', 'bounded project evidence')")
            .bind(project_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO notes (title, content) VALUES ('alpha global note', 'bounded global evidence')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO knowledge_articles (title, slug, content, status) VALUES ('alpha organization article', 'alpha-organization-article', 'bounded organization evidence', 'published')")
            .execute(&pool)
            .await
            .unwrap();

        let current = workspace_search(
            &state,
            WorkspaceSearchRequest {
                query: "alpha".to_string(),
                domains: vec![
                    WorkspaceSearchDomain::Notes,
                    WorkspaceSearchDomain::Knowledge,
                ],
                scope: WorkspaceSearchScope::CurrentProject,
                limit: 20,
                cursor: None,
            },
            Some(project_id),
            "search-test-agent",
            "permissions-v1",
        )
        .await
        .unwrap();
        assert_eq!(current.hits.len(), 1);
        assert_eq!(current.hits[0].title, "alpha project note");
        assert_eq!(current.hits[0].domain, "notes");
        assert!(current.partial_failures.is_empty());

        let plus_global = workspace_search(
            &state,
            WorkspaceSearchRequest {
                query: "alpha".to_string(),
                domains: vec![
                    WorkspaceSearchDomain::Notes,
                    WorkspaceSearchDomain::Knowledge,
                ],
                scope: WorkspaceSearchScope::CurrentPlusGlobal,
                limit: 20,
                cursor: None,
            },
            Some(project_id),
            "search-test-agent",
            "permissions-v1",
        )
        .await
        .unwrap();
        assert_eq!(plus_global.hits.len(), 3);
        assert!(plus_global
            .hits
            .iter()
            .any(|hit| hit.title == "alpha global note"));
        assert!(plus_global.hits.iter().any(|hit| {
            hit.domain == "knowledge"
                && hit.lifecycle_state == "published"
                && hit.evidence_role == "external_source_claim"
        }));
        assert!(plus_global.hits.iter().all(|hit| {
            !hit.stable_id.is_empty()
                && !hit.reason_codes.is_empty()
                && (0.0..=1.0).contains(&hit.normalized_score)
        }));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn workspace_search_preserves_message_evidence_roles(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        sqlx::query(
            r#"INSERT INTO native_agents(profile, name, drive_path, sandbox_status)
               VALUES ('evidence-search', 'Evidence search',
                       '/drive/agents/evidence-search', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO chat_sessions(agent_id, profile, title)
               VALUES ('evidence-search', 'evidence-search', 'Evidence role session')
               RETURNING id"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO chat_messages(session_id, role, content) VALUES
               ($1, 'user', 'epistemic-marker direct assertion'),
               ($1, 'assistant', 'epistemic-marker generated restatement')"#,
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();

        let response = workspace_search(
            &state,
            WorkspaceSearchRequest {
                query: "epistemic-marker".to_string(),
                domains: vec![WorkspaceSearchDomain::Sessions],
                scope: WorkspaceSearchScope::AllPermitted,
                limit: 20,
                cursor: None,
            },
            None,
            "evidence-search",
            "permissions-v1",
        )
        .await
        .unwrap();
        let roles = response
            .hits
            .iter()
            .filter(|hit| hit.resource_kind == "chat_message")
            .map(|hit| hit.evidence_role.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(roles.len(), 2);
        assert!(roles.contains("user_asserted"));
        assert!(roles.contains("system_generated"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn shared_adapters_preserve_user_project_and_calendar_coverage(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        let current_project = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO projects(name, drive_slug, drive_path) VALUES ('scope alpha current', 'scope-alpha-current', '/drive/projects/scope-alpha-current') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let other_project = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO projects(name, drive_slug, drive_path) VALUES ('scope alpha other', 'scope-alpha-other', '/drive/projects/scope-alpha-other') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        for (project_id, title) in [
            (Some(current_project), "scope alpha current event"),
            (None, "scope alpha global event"),
            (Some(other_project), "scope alpha hidden event"),
        ] {
            sqlx::query(
                "INSERT INTO calendar_events(project_id, title, start_date) VALUES ($1, $2, now())",
            )
            .bind(project_id)
            .bind(title)
            .execute(&pool)
            .await
            .unwrap();
        }

        let response = workspace_search(
            &state,
            WorkspaceSearchRequest {
                query: "scope alpha".to_string(),
                domains: vec![
                    WorkspaceSearchDomain::Projects,
                    WorkspaceSearchDomain::Calendar,
                ],
                scope: WorkspaceSearchScope::CurrentPlusGlobal,
                limit: 20,
                cursor: None,
            },
            Some(current_project),
            "user:local-owner-v1:test-session",
            "user-omnisearch-domains-v1",
        )
        .await
        .unwrap();

        assert_eq!(
            response
                .hits
                .iter()
                .filter(|hit| hit.domain == "projects")
                .count(),
            2
        );
        let calendar_titles = response
            .hits
            .iter()
            .filter(|hit| hit.domain == "calendar")
            .map(|hit| hit.title.as_str())
            .collect::<Vec<_>>();
        assert_eq!(calendar_titles.len(), 2);
        assert!(calendar_titles.contains(&"scope alpha current event"));
        assert!(calendar_titles.contains(&"scope alpha global event"));
        assert!(!calendar_titles.contains(&"scope alpha hidden event"));
        assert!(response.hits.iter().all(|hit| hit.revision.is_some()));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn workspace_snapshot_admission_is_bounded_per_principal(pool: sqlx::PgPool) {
        let state = AppState::new(pool.clone(), test_config());
        for index in 0..2 {
            sqlx::query("INSERT INTO notes(title, content) VALUES ($1, 'capacity evidence')")
                .bind(format!("capacity alpha {index}"))
                .execute(&pool)
                .await
                .unwrap();
        }
        let request = || WorkspaceSearchRequest {
            query: "capacity alpha".to_string(),
            domains: vec![WorkspaceSearchDomain::Notes],
            scope: WorkspaceSearchScope::AllPermitted,
            limit: 1,
            cursor: None,
        };
        for _ in 0..WORKSPACE_SNAPSHOT_MAX_PER_PRINCIPAL {
            let page = workspace_search(
                &state,
                request(),
                None,
                "bounded-principal",
                "permission-v1",
            )
            .await
            .unwrap();
            assert!(page.next_cursor.is_some());
        }
        let error = workspace_search(
            &state,
            request(),
            None,
            "bounded-principal",
            "permission-v1",
        )
        .await
        .unwrap_err();
        assert!(matches!(
            error,
            AppError::Coded {
                code: "workspace_search_capacity",
                ..
            }
        ));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn workspace_search_cursor_is_repeatable_permission_bound_and_stale_safe(
        pool: sqlx::PgPool,
    ) {
        let state = AppState::new(pool.clone(), test_config());
        for index in 0..3 {
            sqlx::query("INSERT INTO notes (title, content) VALUES ($1, $2)")
                .bind(format!("cursor alpha {index}"))
                .bind(format!("snapshot evidence {index}"))
                .execute(&pool)
                .await
                .unwrap();
        }
        let request = |cursor: Option<String>| WorkspaceSearchRequest {
            query: "cursor alpha".to_string(),
            domains: vec![WorkspaceSearchDomain::Notes],
            scope: WorkspaceSearchScope::AllPermitted,
            limit: 1,
            cursor,
        };
        let first = workspace_search(&state, request(None), None, "cursor-agent", "permission-a")
            .await
            .unwrap();
        assert_eq!(first.hits.len(), 1);
        let cursor = first.next_cursor.unwrap();
        let second = workspace_search(
            &state,
            request(Some(cursor.clone())),
            None,
            "cursor-agent",
            "permission-a",
        )
        .await
        .unwrap();
        let repeated = workspace_search(
            &state,
            request(Some(cursor.clone())),
            None,
            "cursor-agent",
            "permission-a",
        )
        .await
        .unwrap();
        assert_eq!(second.hits[0].stable_id, repeated.hits[0].stable_id);

        let permission_error = workspace_search(
            &state,
            request(Some(cursor.clone())),
            None,
            "cursor-agent",
            "permission-b",
        )
        .await
        .unwrap_err();
        assert!(matches!(
            permission_error,
            AppError::Coded {
                code: "workspace_search_cursor_restart",
                ..
            }
        ));

        sqlx::query("UPDATE notes SET updated_at = now() + interval '1 second' WHERE id = $1")
            .bind(Uuid::parse_str(&second.hits[0].stable_id).unwrap())
            .execute(&pool)
            .await
            .unwrap();
        let stale_error = workspace_search(
            &state,
            request(Some(cursor)),
            None,
            "cursor-agent",
            "permission-a",
        )
        .await
        .unwrap_err();
        assert!(matches!(
            stale_error,
            AppError::Coded {
                code: "workspace_search_cursor_stale",
                ..
            }
        ));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn drive_search_uses_stable_index_scope_and_lifecycle(pool: sqlx::PgPool) {
        let config = test_config();
        let data_dir = config.agent_data_dir.clone();
        for relative in [
            "drive/projects/index-project",
            "drive/projects/other-project",
            "drive/shared",
        ] {
            std::fs::create_dir_all(data_dir.join(relative)).unwrap();
        }
        let state = AppState::new(pool.clone(), config);
        let project_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO projects(name, drive_slug, drive_path) VALUES ('Index project', 'index-project', '/drive/projects/index-project') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO projects(name, drive_slug, drive_path) VALUES ('Other project', 'other-project', '/drive/projects/other-project')",
        )
        .execute(&pool)
        .await
        .unwrap();
        commit_search_file(
            &state,
            "/drive/projects/index-project/report.md",
            "federatedneedle current project evidence",
            "search-index-project",
        )
        .await;
        commit_search_file(
            &state,
            "/drive/shared/global.md",
            "federatedneedle global evidence",
            "search-index-global",
        )
        .await;
        commit_search_file(
            &state,
            "/drive/projects/other-project/hidden.md",
            "federatedneedle other project evidence",
            "search-index-other",
        )
        .await;
        assert!(reconcile_drive_search_index(&state, 100).await.unwrap() >= 3);
        let report_resource_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM drive_resources WHERE current_path = '/drive/projects/index-project/report.md'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let knowledge_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO knowledge_articles(title, slug, content, status) VALUES ('Linked location', 'linked-location', '', 'published') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO knowledge_resources
                 (knowledge_id, resource_ref, drive_resource_id, title)
               VALUES ($1, '/drive/projects/index-project/report.md', $2, 'Report wiki location')"#,
        )
        .bind(knowledge_id)
        .bind(report_resource_id)
        .execute(&pool)
        .await
        .unwrap();

        let search = |scope, cursor| WorkspaceSearchRequest {
            query: "federatedneedle".to_string(),
            domains: vec![WorkspaceSearchDomain::Drive],
            scope,
            limit: 20,
            cursor,
        };
        let current = workspace_search(
            &state,
            search(WorkspaceSearchScope::CurrentProject, None),
            Some(project_id),
            "drive-search-agent",
            "permissions-drive",
        )
        .await
        .unwrap();
        assert_eq!(current.hits.len(), 1);
        assert!(current.hits[0]
            .source_link
            .get("path")
            .and_then(Value::as_str)
            .unwrap()
            .contains("index-project"));

        let plus_global = workspace_search(
            &state,
            search(WorkspaceSearchScope::CurrentPlusGlobal, None),
            Some(project_id),
            "drive-search-agent",
            "permissions-drive",
        )
        .await
        .unwrap();
        assert_eq!(plus_global.hits.len(), 2);
        let project_report = plus_global
            .hits
            .iter()
            .find(|hit| hit.stable_id == report_resource_id.to_string())
            .unwrap();
        assert_eq!(project_report.locations.len(), 1);
        assert!(!plus_global.hits.iter().any(|hit| {
            hit.source_link
                .get("path")
                .and_then(Value::as_str)
                .is_some_and(|path| path.contains("other-project"))
        }));

        let with_knowledge_location = workspace_search(
            &state,
            WorkspaceSearchRequest {
                query: "federatedneedle".to_string(),
                domains: vec![
                    WorkspaceSearchDomain::Drive,
                    WorkspaceSearchDomain::Knowledge,
                ],
                scope: WorkspaceSearchScope::CurrentPlusGlobal,
                limit: 20,
                cursor: None,
            },
            Some(project_id),
            "drive-search-agent",
            "permissions-drive-and-knowledge",
        )
        .await
        .unwrap();
        let merged_report = with_knowledge_location
            .hits
            .iter()
            .find(|hit| hit.stable_id == report_resource_id.to_string())
            .unwrap();
        assert_eq!(merged_report.locations.len(), 2);
        assert_eq!(merged_report.locations[1].kind, "knowledge");
        assert_eq!(
            merged_report.locations[1].source_link["id"],
            knowledge_id.to_string()
        );

        crate::services::drive::delete_path(
            &state,
            "/drive/projects/index-project/report.md",
            Some("search-index-trash"),
            None,
        )
        .await
        .unwrap();
        reconcile_drive_search_index(&state, 100).await.unwrap();
        let after_trash = workspace_search(
            &state,
            search(WorkspaceSearchScope::CurrentProject, None),
            Some(project_id),
            "drive-search-agent",
            "permissions-drive",
        )
        .await
        .unwrap();
        assert!(after_trash.hits.is_empty());
        let _ = std::fs::remove_dir_all(data_dir);
    }
}
