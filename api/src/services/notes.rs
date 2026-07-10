//! Note / wiki domain operations.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::note::{
    CreateNoteRequest, Note, NoteResponse, NotesResponse, UpdateNoteRequest,
};
use crate::models::scope::{ScopeFilter, WorkspaceScope};
use crate::services::audit::log_audit_safe;
use crate::services::versions::{
    compute_note_change_summary, create_version_checkpoint, delete_entity_versions,
    maybe_create_version, note_to_snapshot,
};
use crate::state::AppState;

/// A note / wiki entry row.
///
/// The `search_tsv` and `embedding` columns are server-managed and not read
/// into Rust.
#[derive(Debug, FromRow)]
struct NoteRow {
    id: Uuid,
    project_id: Option<Uuid>,
    title: String,
    content: String,
    tags: Vec<String>,
    pinned: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

/// Query params for GET /api/notes.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteQuery {
    /// Filter by project (null/absent = all notes including general).
    pub project_id: Option<String>,
    pub scope: Option<String>,
}

/// GET /api/notes
pub async fn list_notes(state: &AppState, q: NoteQuery) -> AppResult<NotesResponse> {
    let scope = ScopeFilter::parse(q.scope.as_deref(), q.project_id.as_deref())?;
    let rows = sqlx::query_as!(
        NoteRow,
        r#"SELECT id, project_id, title, content, tags, pinned,
                  created_at, updated_at
           FROM notes
           WHERE ($1::text = 'all'
              OR ($1 = 'general' AND project_id IS NULL)
              OR ($1 = 'project' AND project_id = $2))
           ORDER BY pinned DESC, updated_at DESC"#,
        scope.kind(),
        scope.project_id(),
    )
    .fetch_all(&state.db)
    .await?;

    let notes = rows.into_iter().map(row_to_note).collect();
    Ok(NotesResponse { notes })
}

/// GET /api/notes/search?q=...
///
/// Full-text search over title + content using the `search_tsv` tsvector
/// (maintained by the `notes_search_tsv` trigger). Ranks by ts_rank and
/// highlights the title.
pub async fn search_notes(state: &AppState, q: SearchQuery) -> AppResult<NotesResponse> {
    let term = q.q.trim();
    if term.is_empty() {
        return Ok(NotesResponse { notes: vec![] });
    }

    let scope = ScopeFilter::parse(q.scope.as_deref(), q.project_id.as_deref())?;
    // Build a websearch query (supports quoted phrases, OR, negation).
    let rows = sqlx::query_as!(
        NoteRow,
        r#"SELECT id, project_id, title, content, tags, pinned,
                  created_at, updated_at
           FROM notes
           WHERE search_tsv @@ websearch_to_tsquery('simple', $1)
             AND ($2::text = 'all'
               OR ($2 = 'general' AND project_id IS NULL)
               OR ($2 = 'project' AND project_id = $3))
           ORDER BY ts_rank(search_tsv, websearch_to_tsquery('simple', $1)) DESC,
                    pinned DESC, updated_at DESC"#,
        term,
        scope.kind(),
        scope.project_id(),
    )
    .fetch_all(&state.db)
    .await?;

    let notes = rows.into_iter().map(row_to_note).collect();
    Ok(NotesResponse { notes })
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub project_id: Option<String>,
    pub scope: Option<String>,
}

/// POST /api/notes
pub async fn create_note(state: &AppState, req: CreateNoteRequest) -> AppResult<NoteResponse> {
    let id = Uuid::new_v4();
    let project_uuid = req
        .project_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|err| AppError::BadRequest(format!("invalid projectId: {err}")))?;

    // content is NOT NULL in DB (default ''). Coerce absent content to an
    // empty string so a create request without content doesn't violate the
    // constraint.
    let content = req.content.unwrap_or_default();

    sqlx::query!(
        r#"INSERT INTO notes (id, project_id, title, content, tags, pinned)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
        id,
        project_uuid,
        req.title,
        content,
        &req.tags as &[String],
        req.pinned,
    )
    .execute(&state.db)
    .await?;

    let note = fetch_note(state, id).await?;
    log_audit_safe(
        &state.db,
        "user", "user",
        "create", "note",
        Some(&note.id),
        Some(serde_json::json!({ "after": { "title": note.title, "tags": note.tags, "pinned": note.pinned } })),
    ).await;

    // Capture the initial version #1 (always checkpoint on creation).
    let snapshot = note_to_snapshot(&note);
    if let Err(e) = create_version_checkpoint(
        &state.db,
        "note",
        id,
        &snapshot,
        "user",
        Some("user"),
        "Note created",
    )
    .await
    {
        tracing::warn!(error = ?e, note_id = %id, "failed to create initial version");
    }

    Ok(NoteResponse { note })
}

/// PATCH /api/notes/{id}
pub async fn update_note(
    state: &AppState,
    id: Uuid,
    req: UpdateNoteRequest,
) -> AppResult<NoteResponse> {
    // Read the pre-update state (for change summary + version checkpoint).
    let old_note = fetch_note(state, id).await?;

    let project_scope = req.project_id.workspace_scope()?;
    let project_present = project_scope.is_some();
    let project_uuid = project_scope.and_then(|scope| match scope {
        WorkspaceScope::General => None,
        WorkspaceScope::Project(id) => Some(id),
    });

    // COALESCE PATCH. tags and pinned use a sentinel approach: since
    // COALESCE can't distinguish "not provided" from "null/empty", we
    // branch on Option presence for those.
    if let Some(tags) = &req.tags {
        sqlx::query!(
            r#"UPDATE notes SET
                 project_id = CASE WHEN $2 THEN $3 ELSE project_id END,
                 title = COALESCE($4, title),
                 content = COALESCE($5, content),
                 tags = $6,
                 pinned = COALESCE($7, pinned),
                 updated_at = now()
               WHERE id = $1"#,
            id,
            project_present,
            project_uuid,
            req.title.as_deref(),
            req.content.as_deref(),
            tags as &[String],
            req.pinned,
        )
        .execute(&state.db)
        .await?;
    } else {
        sqlx::query!(
            r#"UPDATE notes SET
                 project_id = CASE WHEN $2 THEN $3 ELSE project_id END,
                 title = COALESCE($4, title),
                 content = COALESCE($5, content),
                 pinned = COALESCE($6, pinned),
                 updated_at = now()
               WHERE id = $1"#,
            id,
            project_present,
            project_uuid,
            req.title.as_deref(),
            req.content.as_deref(),
            req.pinned,
        )
        .execute(&state.db)
        .await?;
    }

    let note = fetch_note(state, id).await?;
    log_audit_safe(
        &state.db,
        "user", "user",
        "update", "note",
        Some(&note.id),
        Some(serde_json::json!({ "after": { "title": note.title, "tags": note.tags, "pinned": note.pinned } })),
    ).await;

    // Conditionally create a version checkpoint (5-min coalescing window).
    // The snapshot reflects the post-update state.
    let snapshot = note_to_snapshot(&note);
    let summary = compute_note_change_summary(&old_note, &note);
    if let Err(e) = maybe_create_version(
        &state.db,
        "note",
        id,
        &snapshot,
        "user",
        Some("user"),
        &summary,
    )
    .await
    {
        tracing::warn!(error = ?e, note_id = %id, "failed to create version checkpoint");
    }

    Ok(NoteResponse { note })
}

/// DELETE /api/notes/{id}
pub async fn delete_note(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query!("DELETE FROM notes WHERE id = $1", id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("note {id} not found")));
    }

    // Application-level cascade: clear this note's version history.
    if let Err(e) = delete_entity_versions(&state.db, "note", id).await {
        tracing::warn!(error = ?e, note_id = %id, "failed to delete note versions");
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "note",
        Some(&id.to_string()),
        Some(serde_json::json!({ "before": { "id": id.to_string() } })),
    )
    .await;
    Ok(true)
}

// ---- helpers ----

async fn fetch_note(state: &AppState, id: Uuid) -> AppResult<Note> {
    let row = sqlx::query_as!(
        NoteRow,
        r#"SELECT id, project_id, title, content, tags, pinned,
                  created_at, updated_at
           FROM notes WHERE id = $1"#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    Ok(row_to_note(row))
}

fn row_to_note(row: NoteRow) -> Note {
    Note {
        id: row.id.to_string(),
        project_id: row.project_id.map(|u| u.to_string()),
        title: row.title,
        content: row.content,
        tags: row.tags,
        pinned: row.pinned,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}
