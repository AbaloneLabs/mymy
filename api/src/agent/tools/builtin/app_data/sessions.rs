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
                "profile":{"type":"string"},
                "projectId":{"type":"string"}
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
