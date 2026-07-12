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
                "q":{"type":"string","description":"Text to match in permitted note titles and content."},
                "scope":{"type":"string","enum":["all","general","project"],"description":"Search all permitted notes, general notes, or one project."},
                "projectId":{"type":"string","description":"Project UUID required when scope is project."}
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
        record_schema(
            &["projectId", "title", "content", "tags", "pinned"],
            &["title"],
        ),
        state,
        AppAction::NoteCreate,
    );
    register_tool(
        registry,
        "note_update",
        "notes_write",
        "Update a note by id.",
        id_body_schema(
            "Note id.",
            &["projectId", "title", "content", "tags", "pinned"],
        ),
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
