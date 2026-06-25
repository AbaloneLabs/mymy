//! OmniSearch domain operations.
//!
//! GET /api/search?q=...[&projectId=...][&limit=N]
//!
//! Searches notes, tasks, projects, calendar events, and chat (sessions +
//! messages) in parallel using each table's `search_tsv` tsvector. Results
//! are grouped by entity kind and capped at `limit` (default 5, max 20)
//! per group.

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::search::{
    SearchQuery, SearchResponse, SearchResultEvent, SearchResultKnowledge, SearchResultMessage,
    SearchResultNote, SearchResultProject, SearchResultTask, SearchResults,
};
use crate::state::AppState;

/// Default and clamp bounds for the per-group result limit.
const DEFAULT_LIMIT: i64 = 5;
const MAX_LIMIT: i64 = 20;

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
        query_notes(&state.db, term, project_uuid, limit),
        query_tasks(&state.db, term, project_uuid, limit),
        query_projects(&state.db, term, limit),
        query_events(&state.db, term, project_uuid, limit),
        query_chat(&state.db, term, project_uuid, limit),
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
    limit: i64,
) -> AppResult<Vec<SearchResultNote>> {
    let rows = match project {
        Some(pid) => {
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
}

async fn query_tasks(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    limit: i64,
) -> AppResult<Vec<SearchResultTask>> {
    let rows = match project {
        Some(pid) => {
            sqlx::query_as!(
                TaskSearchRow,
                r#"SELECT id, title, status, priority, project_id, due_date
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
        None => {
            sqlx::query_as!(
                TaskSearchRow,
                r#"SELECT id, title, status, priority, project_id, due_date
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
        })
        .collect())
}

#[derive(Debug, FromRow)]
struct ProjectSearchRow {
    id: Uuid,
    name: String,
    description: Option<String>,
    status: String,
}

async fn query_projects(
    db: &sqlx::PgPool,
    term: &str,
    limit: i64,
) -> AppResult<Vec<SearchResultProject>> {
    // Projects are not project-scoped, so no projectId filter applies.
    let rows = sqlx::query_as!(
        ProjectSearchRow,
        r#"SELECT id, name, description, status
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
}

async fn query_events(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    limit: i64,
) -> AppResult<Vec<SearchResultEvent>> {
    let rows = match project {
        Some(pid) => {
            sqlx::query_as!(
                EventSearchRow,
                r#"SELECT id, title, start_date, end_date, project_id
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
        None => {
            sqlx::query_as!(
                EventSearchRow,
                r#"SELECT id, title, start_date, end_date, project_id
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
    project_id: Option<Uuid>,
    created_at: DateTime<Utc>,
}

/// Search chat sessions (by title) and chat messages (by content), then
/// merge both into a single `messages` group discriminated by `entity_type`.
async fn query_chat(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    limit: i64,
) -> AppResult<Vec<SearchResultMessage>> {
    let (sessions, messages) = tokio::join!(
        query_chat_sessions(db, term, project, limit),
        query_chat_messages(db, term, project, limit),
    );

    let mut out: Vec<SearchResultMessage> = Vec::new();
    out.extend(sessions?.into_iter().map(|r| SearchResultMessage {
        entity_type: "chatSession".to_string(),
        id: r.id.to_string(),
        title: r.title.unwrap_or_default(),
        session_id: None,
        project_id: r.project_id.map(|u| u.to_string()),
        updated_at: r.updated_at.to_rfc3339(),
    }));
    out.extend(messages?.into_iter().map(|r| SearchResultMessage {
        entity_type: "chatMessage".to_string(),
        id: r.id.to_string(),
        title: truncate(r.content.as_deref().unwrap_or(""), 120),
        session_id: Some(r.session_id.to_string()),
        project_id: r.project_id.map(|u| u.to_string()),
        updated_at: r.created_at.to_rfc3339(),
    }));
    Ok(out)
}

async fn query_chat_sessions(
    db: &sqlx::PgPool,
    term: &str,
    project: Option<Uuid>,
    limit: i64,
) -> AppResult<Vec<ChatSessionSearchRow>> {
    let rows = match project {
        Some(pid) => {
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
    limit: i64,
) -> AppResult<Vec<ChatMessageSearchRow>> {
    // Join chat_sessions to scope by project_id and expose it in the result.
    let rows = match project {
        Some(pid) => {
            sqlx::query_as!(
                ChatMessageSearchRow,
                r#"SELECT m.id, m.session_id, LEFT(m.content, 300) AS content,
                          s.project_id, m.created_at
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
        None => {
            sqlx::query_as!(
                ChatMessageSearchRow,
                r#"SELECT m.id, m.session_id, LEFT(m.content, 300) AS content,
                          s.project_id, m.created_at
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
}
