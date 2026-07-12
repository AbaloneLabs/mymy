use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "calendar_list",
        "calendar_read",
        "List calendar events.",
        filter_schema(&["projectId", "from", "to"]),
        state,
        AppAction::CalendarList,
    );
    register_tool(
        registry,
        "calendar_create",
        "calendar_write",
        "Create a calendar event.",
        record_schema(
            &[
                "projectId",
                "title",
                "description",
                "startDate",
                "endDate",
                "allDay",
            ],
            &["title", "startDate"],
        ),
        state,
        AppAction::CalendarCreate,
    );
    register_tool(
        registry,
        "calendar_update",
        "calendar_write",
        "Update a calendar event by id.",
        id_body_schema(
            "Calendar event id.",
            &[
                "projectId",
                "title",
                "description",
                "startDate",
                "endDate",
                "allDay",
            ],
        ),
        state,
        AppAction::CalendarUpdate,
    );
    register_tool(
        registry,
        "calendar_delete",
        "calendar_write",
        "Delete a calendar event by id.",
        id_schema("Calendar event id."),
        state,
        AppAction::CalendarDelete,
    );
}
