//! Calendar event HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::calendar::{
    CalendarEventResponse, CalendarEventsResponse, CreateCalendarEventRequest,
    UpdateCalendarEventRequest,
};
use crate::models::project::DeleteResponse;
use crate::services::calendar::{self as calendar_service, EventQuery};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/calendar/events", get(list_events).post(create_event))
        .route(
            "/api/calendar/events/{id}",
            patch(update_event).delete(delete_event),
        )
}

pub async fn list_events(
    State(state): State<Arc<AppState>>,
    Query(q): Query<EventQuery>,
) -> AppResult<Json<CalendarEventsResponse>> {
    Ok(Json(calendar_service::list_events(&state, q).await?))
}

pub async fn create_event(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateCalendarEventRequest>,
) -> AppResult<Json<CalendarEventResponse>> {
    Ok(Json(calendar_service::create_event(&state, req).await?))
}

pub async fn update_event(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateCalendarEventRequest>,
) -> AppResult<Json<CalendarEventResponse>> {
    Ok(Json(calendar_service::update_event(&state, id, req).await?))
}

pub async fn delete_event(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = calendar_service::delete_event(&state, id).await?;
    Ok(Json(DeleteResponse { success }))
}
