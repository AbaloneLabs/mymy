//! Calendar event model — mirrors frontend `CalendarEvent`.
//!
//! See: web/src/types/index.ts (CalendarEvent interface)

use serde::{Deserialize, Serialize};

/// A calendar event, optionally linked to a project.
///
/// Serialized as camelCase to match the frontend `CalendarEvent` interface
/// (projectId, startDate, endDate, allDay, createdAt, updatedAt).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub start_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    pub all_day: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct CalendarEventsResponse {
    pub events: Vec<CalendarEvent>,
}

#[derive(Debug, Serialize)]
pub struct CalendarEventResponse {
    pub event: CalendarEvent,
}

/// Payload for creating a new calendar event.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCalendarEventRequest {
    pub project_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub start_date: String,
    pub end_date: Option<String>,
    #[serde(default)]
    pub all_day: bool,
}

/// Payload for patching a calendar event (all fields optional).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCalendarEventRequest {
    pub project_id: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub all_day: Option<bool>,
}
