//! Calendar event domain operations.

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Deserialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::calendar::{
    CalendarEvent, CalendarEventResponse, CalendarEventsResponse, CreateCalendarEventRequest,
    UpdateCalendarEventRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

/// A calendar event row.
#[derive(Debug, FromRow)]
struct CalendarEventRow {
    id: Uuid,
    project_id: Option<Uuid>,
    title: String,
    description: Option<String>,
    start_date: DateTime<Utc>,
    end_date: Option<DateTime<Utc>>,
    all_day: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

/// Query params for GET /api/calendar/events.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventQuery {
    /// Filter by project (null/absent = all events including general).
    pub project_id: Option<String>,
    /// Optional month window: events overlapping [from, to).
    pub from: Option<String>,
    pub to: Option<String>,
}

/// GET /api/calendar/events
///
/// Returns calendar events, optionally filtered by project and/or a date range.
pub async fn list_events(state: &AppState, q: EventQuery) -> AppResult<CalendarEventsResponse> {
    let project_uuid = match q.project_id.as_deref() {
        Some(pid) => Some(
            Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}")))?,
        ),
        None => None,
    };
    let from_ts = q
        .from
        .as_deref()
        .map(parse_ts)
        .transpose()
        .map_err(|e| AppError::BadRequest(format!("invalid from: {e}")))?;
    let to_ts =
        q.to.as_deref()
            .map(parse_ts)
            .transpose()
            .map_err(|e| AppError::BadRequest(format!("invalid to: {e}")))?;

    // sqlx compile-time macros need distinct query strings per combination,
    // so we branch on (project, from, to) presence. We collapse to 4 cases:
    // (project + range), (project only), (range only), (none).
    let rows = match (project_uuid, from_ts, to_ts) {
        (Some(pid), Some(from), Some(to)) => {
            sqlx::query_as!(
                CalendarEventRow,
                r#"SELECT id, project_id, title, description, start_date, end_date,
                          all_day, created_at, updated_at
                   FROM calendar_events
                   WHERE project_id = $1 AND start_date >= $2 AND start_date < $3
                   ORDER BY start_date ASC"#,
                pid,
                from,
                to,
            )
            .fetch_all(&state.db)
            .await?
        }
        (Some(pid), _, _) => {
            sqlx::query_as!(
                CalendarEventRow,
                r#"SELECT id, project_id, title, description, start_date, end_date,
                          all_day, created_at, updated_at
                   FROM calendar_events
                   WHERE project_id = $1
                   ORDER BY start_date ASC"#,
                pid,
            )
            .fetch_all(&state.db)
            .await?
        }
        (None, Some(from), Some(to)) => {
            sqlx::query_as!(
                CalendarEventRow,
                r#"SELECT id, project_id, title, description, start_date, end_date,
                          all_day, created_at, updated_at
                   FROM calendar_events
                   WHERE start_date >= $1 AND start_date < $2
                   ORDER BY start_date ASC"#,
                from,
                to,
            )
            .fetch_all(&state.db)
            .await?
        }
        (None, _, _) => {
            sqlx::query_as!(
                CalendarEventRow,
                r#"SELECT id, project_id, title, description, start_date, end_date,
                          all_day, created_at, updated_at
                   FROM calendar_events
                   ORDER BY start_date ASC"#
            )
            .fetch_all(&state.db)
            .await?
        }
    };

    let events = rows.into_iter().map(row_to_event).collect();
    Ok(CalendarEventsResponse { events })
}

/// POST /api/calendar/events
pub async fn create_event(
    state: &AppState,
    req: CreateCalendarEventRequest,
) -> AppResult<CalendarEventResponse> {
    let id = Uuid::new_v4();
    let project_uuid = match req.project_id.as_deref() {
        Some(pid) => Some(
            Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}")))?,
        ),
        None => None,
    };
    let start = parse_ts(&req.start_date)
        .map_err(|e| AppError::BadRequest(format!("invalid startDate: {e}")))?;
    let end = match req.end_date.as_deref() {
        Some(e) => {
            Some(parse_ts(e).map_err(|e| AppError::BadRequest(format!("invalid endDate: {e}")))?)
        }
        None => None,
    };

    sqlx::query!(
        r#"INSERT INTO calendar_events
             (id, project_id, title, description, start_date, end_date, all_day)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        id,
        project_uuid,
        req.title,
        req.description.as_deref(),
        start,
        end,
        req.all_day,
    )
    .execute(&state.db)
    .await?;

    let row = fetch_event(state, id).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "calendar_event",
        Some(&row.id),
        Some(serde_json::json!({ "after": { "title": row.title } })),
    )
    .await;
    Ok(CalendarEventResponse { event: row })
}

/// PATCH /api/calendar/events/{id}
pub async fn update_event(
    state: &AppState,
    id: Uuid,
    req: UpdateCalendarEventRequest,
) -> AppResult<CalendarEventResponse> {
    // Verify existence.
    sqlx::query!(r#"SELECT 1 AS x FROM calendar_events WHERE id = $1"#, id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("event {id} not found")))?;

    let project_uuid = match req.project_id.as_deref() {
        Some(pid) => Some(
            Uuid::parse_str(pid)
                .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}")))?,
        ),
        None => None,
    };
    let start = match req.start_date.as_deref() {
        Some(s) => {
            Some(parse_ts(s).map_err(|e| AppError::BadRequest(format!("invalid startDate: {e}")))?)
        }
        None => None,
    };
    let end = match req.end_date.as_deref() {
        Some(e) => {
            Some(parse_ts(e).map_err(|e| AppError::BadRequest(format!("invalid endDate: {e}")))?)
        }
        None => None,
    };

    sqlx::query!(
        r#"UPDATE calendar_events SET
             project_id = COALESCE($2, project_id),
             title = COALESCE($3, title),
             description = COALESCE($4, description),
             start_date = COALESCE($5, start_date),
             end_date = COALESCE($6, end_date),
             all_day = COALESCE($7, all_day),
             updated_at = now()
           WHERE id = $1"#,
        id,
        project_uuid,
        req.title.as_deref(),
        req.description.as_deref(),
        start,
        end,
        req.all_day,
    )
    .execute(&state.db)
    .await?;

    let row = fetch_event(state, id).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "calendar_event",
        Some(&row.id),
        Some(serde_json::json!({ "after": { "title": row.title } })),
    )
    .await;
    Ok(CalendarEventResponse { event: row })
}

/// DELETE /api/calendar/events/{id}
pub async fn delete_event(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query!("DELETE FROM calendar_events WHERE id = $1", id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("event {id} not found")));
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "calendar_event",
        Some(&id.to_string()),
        Some(serde_json::json!({ "before": { "id": id.to_string() } })),
    )
    .await;
    Ok(true)
}

// ---- helpers ----

/// Fetch a single event row by id.
async fn fetch_event(state: &AppState, id: Uuid) -> AppResult<CalendarEvent> {
    let row = sqlx::query_as!(
        CalendarEventRow,
        r#"SELECT id, project_id, title, description, start_date, end_date,
                  all_day, created_at, updated_at
           FROM calendar_events WHERE id = $1"#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    Ok(row_to_event(row))
}

/// Convert a DB row to the API model.
fn row_to_event(row: CalendarEventRow) -> CalendarEvent {
    CalendarEvent {
        id: row.id.to_string(),
        project_id: row.project_id.map(|u| u.to_string()),
        title: row.title,
        description: row.description,
        start_date: row.start_date.to_rfc3339(),
        end_date: row.end_date.map(|t| t.to_rfc3339()),
        all_day: row.all_day,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

/// Parse a timestamp. Accepts RFC3339 (e.g. "2026-06-17T10:00:00Z") or a bare
/// date ("2026-06-17") which is interpreted as midnight UTC.
fn parse_ts(s: &str) -> Result<DateTime<Utc>, String> {
    // Try RFC3339 first.
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Ok(dt.with_timezone(&Utc));
    }
    // Try a bare date -> midnight UTC.
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        let dt = d.and_time(NaiveTime::from_hms_opt(0, 0, 0).unwrap());
        return Ok(DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc));
    }
    Err(format!("unrecognized timestamp: {s}"))
}
