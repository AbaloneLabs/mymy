//! Canonical artifact projection for chat sessions.
//!
//! Session links answer where an artifact is relevant; the Drive resource
//! answers where it is now. Keeping those queries separate prevents moves,
//! Wiki attachment changes, or another chat merely reading a file from
//! inventing a new session relationship.

use base64::Engine as _;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::artifact::{
    ArtifactOpenResponse, ArtifactWikiLink, ResourceProvenanceResponse, ResourceRunLinkView,
    RunArtifactView, RunProvenanceResponse, RunResourceEffectView, SessionArtifactSummary,
    SessionArtifactsQuery, SessionArtifactsResponse,
};
use crate::state::AppState;

#[derive(Debug, FromRow)]
struct ArtifactSummaryRow {
    id: Uuid,
    resource_id: Uuid,
    artifact_type: String,
    title: String,
    mime_type: String,
    lifecycle_state: String,
    lifecycle_sequence: i64,
    relationship_kind: String,
    producing_agent: Option<String>,
    current_path: Option<String>,
    last_activity_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct RunEffectRow {
    id: Uuid,
    resource_id: Uuid,
    artifact_id: Option<Uuid>,
    effect_kind: String,
    before_reference: Option<String>,
    after_reference: Option<String>,
    observed_revision: Option<String>,
    resource_sequence: i64,
    lifecycle_state: String,
    current_path: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct RunArtifactRow {
    id: Uuid,
    resource_id: Uuid,
    title: String,
    artifact_type: String,
    mime_type: String,
    lifecycle_state: String,
    lifecycle_sequence: i64,
    current_path: Option<String>,
}

#[derive(Debug, FromRow)]
struct ResourceRunLinkRow {
    run_id: Uuid,
    session_id: Option<Uuid>,
    agent_profile: String,
    effect_kind: String,
    resource_sequence: i64,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactCursor {
    version: u8,
    session_id: Uuid,
    last_activity_at: DateTime<Utc>,
    id: Uuid,
}

pub async fn list_session_artifacts(
    state: &AppState,
    session_id: Uuid,
    query: SessionArtifactsQuery,
) -> AppResult<SessionArtifactsResponse> {
    if !(1..=100).contains(&query.limit) {
        return Err(AppError::BadRequest(
            "artifact limit must be between 1 and 100".to_string(),
        ));
    }
    let cursor = query.cursor.as_deref().map(decode_cursor).transpose()?;
    if cursor
        .as_ref()
        .is_some_and(|cursor| cursor.session_id != session_id || cursor.version != 1)
    {
        return Err(AppError::BadRequest(
            "artifact cursor does not match the session".to_string(),
        ));
    }
    let mut rows = sqlx::query_as::<_, ArtifactSummaryRow>(
        r#"SELECT a.id, a.resource_id, a.artifact_type, a.title, a.mime_type,
                  a.lifecycle_state, a.lifecycle_sequence, l.relationship_kind,
                  r.agent_profile AS producing_agent, dr.current_path,
                  l.last_activity_at
           FROM session_artifact_links l
           INNER JOIN artifacts a ON a.id = l.artifact_id
           INNER JOIN drive_resources dr ON dr.id = a.resource_id
           LEFT JOIN agent_runs r ON r.id = a.origin_run_id
           WHERE l.session_id = $1
             AND ($2::timestamptz IS NULL OR
                  (l.last_activity_at, a.id) < ($2::timestamptz, $3::uuid))
           ORDER BY l.last_activity_at DESC, a.id DESC
           LIMIT $4"#,
    )
    .bind(session_id)
    .bind(cursor.as_ref().map(|cursor| cursor.last_activity_at))
    .bind(cursor.as_ref().map(|cursor| cursor.id))
    .bind(query.limit + 1)
    .fetch_all(&state.db)
    .await?;
    let has_more = rows.len() > query.limit as usize;
    if has_more {
        rows.pop();
    }
    let next_cursor = if has_more {
        rows.last()
            .map(|row| {
                encode_cursor(ArtifactCursor {
                    version: 1,
                    session_id,
                    last_activity_at: row.last_activity_at,
                    id: row.id,
                })
            })
            .transpose()?
    } else {
        None
    };
    let mut artifacts = Vec::with_capacity(rows.len());
    for row in rows {
        let wiki_links = wiki_links(state, row.resource_id, row.current_path.as_deref()).await?;
        artifacts.push(SessionArtifactSummary {
            id: row.id.to_string(),
            resource_id: row.resource_id.to_string(),
            artifact_type: row.artifact_type,
            title: row.title,
            mime_type: row.mime_type,
            lifecycle_state: row.lifecycle_state,
            lifecycle_sequence: row.lifecycle_sequence,
            relationship_kind: row.relationship_kind,
            producing_agent: row.producing_agent,
            current_path: row.current_path,
            wiki_links,
            last_activity_at: row.last_activity_at.to_rfc3339(),
        });
    }
    Ok(SessionArtifactsResponse {
        artifacts,
        next_cursor,
    })
}

pub async fn resolve_artifact_open(
    state: &AppState,
    artifact_id: Uuid,
) -> AppResult<ArtifactOpenResponse> {
    let row = sqlx::query_as::<_, (Uuid, String, String, Option<String>, i64)>(
        r#"SELECT a.resource_id, a.mime_type, dr.lifecycle_state,
                  dr.current_path, a.lifecycle_sequence
           FROM artifacts a
           INNER JOIN drive_resources dr ON dr.id = a.resource_id
           WHERE a.id = $1"#,
    )
    .bind(artifact_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("artifact not found".to_string()))?;
    if row.2 != "active" {
        return Err(AppError::Conflict(format!(
            "artifact is not openable while its lifecycle state is {}",
            row.2
        )));
    }
    let path = row
        .3
        .ok_or_else(|| AppError::Conflict("artifact has no active Drive path".to_string()))?;
    state
        .workspace_content
        .ensure_not_quarantined(state, &path)
        .await?;
    Ok(ArtifactOpenResponse {
        artifact_id: artifact_id.to_string(),
        resource_id: row.0.to_string(),
        path,
        mime_type: row.1,
        lifecycle_sequence: row.4,
    })
}

pub async fn list_run_provenance(
    state: &AppState,
    run_id: Uuid,
) -> AppResult<RunProvenanceResponse> {
    crate::services::agent_runs::get_run(state, run_id).await?;
    let effects = sqlx::query_as::<_, RunEffectRow>(
        r#"SELECT e.id, e.resource_id, a.id AS artifact_id, e.effect_kind,
                  e.before_reference, e.after_reference, e.observed_revision,
                  e.resource_sequence, dr.lifecycle_state, dr.current_path,
                  e.created_at
           FROM run_resource_effects e
           INNER JOIN drive_resources dr ON dr.id = e.resource_id
           LEFT JOIN artifacts a ON a.resource_id = e.resource_id
           WHERE e.run_id = $1
           ORDER BY e.created_at, e.id
           LIMIT 1000"#,
    )
    .bind(run_id)
    .fetch_all(&state.db)
    .await?;
    let artifacts = sqlx::query_as::<_, RunArtifactRow>(
        r#"SELECT DISTINCT ON (a.id)
                  a.id, a.resource_id, a.title, a.artifact_type, a.mime_type,
                  a.lifecycle_state, a.lifecycle_sequence, dr.current_path
           FROM run_resource_effects e
           INNER JOIN artifacts a ON a.resource_id = e.resource_id
           INNER JOIN drive_resources dr ON dr.id = a.resource_id
           WHERE e.run_id = $1
           ORDER BY a.id, e.created_at DESC"#,
    )
    .bind(run_id)
    .fetch_all(&state.db)
    .await?;
    Ok(RunProvenanceResponse {
        effects: effects
            .into_iter()
            .map(|row| RunResourceEffectView {
                id: row.id.to_string(),
                resource_id: row.resource_id.to_string(),
                artifact_id: row.artifact_id.map(|id| id.to_string()),
                effect_kind: row.effect_kind,
                before_reference: row.before_reference,
                after_reference: row.after_reference,
                observed_revision: row.observed_revision,
                resource_sequence: row.resource_sequence,
                lifecycle_state: row.lifecycle_state,
                current_path: row.current_path,
                created_at: row.created_at.to_rfc3339(),
            })
            .collect(),
        artifacts: artifacts
            .into_iter()
            .map(|row| RunArtifactView {
                id: row.id.to_string(),
                resource_id: row.resource_id.to_string(),
                title: row.title,
                artifact_type: row.artifact_type,
                mime_type: row.mime_type,
                lifecycle_state: row.lifecycle_state,
                lifecycle_sequence: row.lifecycle_sequence,
                current_path: row.current_path,
            })
            .collect(),
    })
}

/// Return bounded reverse links from one stable resource to still-existing
/// Runs. Objectives and message content are deliberately omitted: callers
/// navigate to the Run surface, which remains the authority for its details.
pub async fn list_resource_provenance(
    state: &AppState,
    resource_id: Uuid,
) -> AppResult<ResourceProvenanceResponse> {
    let (lifecycle_state, current_path) = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT lifecycle_state, current_path FROM drive_resources WHERE id = $1",
    )
    .bind(resource_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("resource not found".to_string()))?;
    let rows = sqlx::query_as::<_, ResourceRunLinkRow>(
        r#"SELECT DISTINCT ON (e.run_id)
                  e.run_id, r.session_id, e.agent_profile, e.effect_kind,
                  e.resource_sequence, e.created_at
           FROM run_resource_effects e
           INNER JOIN agent_runs r ON r.id = e.run_id
           WHERE e.resource_id = $1
             AND e.run_id IS NOT NULL
             AND e.agent_profile IS NOT NULL
           ORDER BY e.run_id, e.created_at DESC, e.id DESC"#,
    )
    .bind(resource_id)
    .fetch_all(&state.db)
    .await?;
    let mut runs = rows
        .into_iter()
        .map(|row| ResourceRunLinkView {
            run_id: row.run_id.to_string(),
            session_id: row.session_id.map(|id| id.to_string()),
            agent_profile: row.agent_profile,
            effect_kind: row.effect_kind,
            resource_sequence: row.resource_sequence,
            created_at: row.created_at.to_rfc3339(),
        })
        .collect::<Vec<_>>();
    runs.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.run_id.cmp(&left.run_id))
    });
    runs.truncate(50);
    Ok(ResourceProvenanceResponse {
        resource_id: resource_id.to_string(),
        lifecycle_state,
        current_path,
        runs,
    })
}

async fn wiki_links(
    state: &AppState,
    resource_id: Uuid,
    current_path: Option<&str>,
) -> AppResult<Vec<ArtifactWikiLink>> {
    let rows = sqlx::query_as::<_, (Uuid, String)>(
        r#"SELECT knowledge_id, title
           FROM knowledge_resources
           WHERE status = 'linked'
             AND (drive_resource_id = $1 OR
                  (drive_resource_id IS NULL AND $2::text IS NOT NULL AND resource_ref = $2))
           ORDER BY updated_at DESC, id
           LIMIT 20"#,
    )
    .bind(resource_id)
    .bind(current_path)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(knowledge_id, title)| ArtifactWikiLink {
            knowledge_id: knowledge_id.to_string(),
            title,
        })
        .collect())
}

fn encode_cursor(cursor: ArtifactCursor) -> AppResult<String> {
    let bytes = serde_json::to_vec(&cursor)
        .map_err(|error| AppError::Internal(format!("artifact cursor encode failed: {error}")))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_cursor(value: &str) -> AppResult<ArtifactCursor> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| AppError::BadRequest("invalid artifact cursor".to_string()))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::BadRequest("invalid artifact cursor".to_string()))
}
