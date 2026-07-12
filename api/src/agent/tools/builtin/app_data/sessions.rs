use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "session_list",
        "sessions_read",
        "List chat sessions. Optionally filter by profile or projectId.",
        serde_json::json!({
            "type":"object",
            "properties":{
                "profile":{"type":"string","description":"Optional agent profile identifier."},
                "scope":{"type":"string","enum":["all","general","project"],"description":"Session scope: all permitted sessions, general sessions, or one project."},
                "projectId":{"type":"string","description":"Project UUID required when scope is project."}
            }
        }),
        state,
        AppAction::SessionList,
    );
    register_tool(
        registry,
        "session_read",
        "sessions_read",
        "Read messages from a chat session by id.",
        id_schema("Session id."),
        state,
        AppAction::SessionRead,
    );
}
