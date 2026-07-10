use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "note_list",
        "notes_read",
        "List notes.",
        filter_schema(&["scope", "projectId"]),
        state,
        AppAction::NoteList,
    );
    register_tool(
        registry,
        "note_search",
        "notes_read",
        "Search notes.",
        serde_json::json!({
            "type":"object",
            "properties":{
                "q":{"type":"string"},
                "scope":{"type":"string","enum":["all","general","project"]},
                "projectId":{"type":"string"}
            },
            "required":["q"]
        }),
        state,
        AppAction::NoteSearch,
    );
    register_tool(
        registry,
        "note_create",
        "notes_write",
        "Create a note.",
        passthrough_schema(),
        state,
        AppAction::NoteCreate,
    );
    register_tool(
        registry,
        "note_update",
        "notes_write",
        "Update a note by id.",
        id_body_schema("Note id."),
        state,
        AppAction::NoteUpdate,
    );
    register_tool(
        registry,
        "note_delete",
        "notes_write",
        "Delete a note by id.",
        id_schema("Note id."),
        state,
        AppAction::NoteDelete,
    );
}
