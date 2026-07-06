use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "agent_list",
        "agents_read",
        "List native agents.",
        empty_schema(),
        state,
        AppAction::AgentList,
    );
    register_tool(
        registry,
        "agent_create",
        "agents_write",
        "Create a native agent.",
        passthrough_schema(),
        state,
        AppAction::AgentCreate,
    );
    register_tool(
        registry,
        "agent_update",
        "agents_write",
        "Update a native agent by profile.",
        serde_json::json!({"type":"object","properties":{"profile":{"type":"string"},"data":{"type":"object"}},"required":["profile","data"]}),
        state,
        AppAction::AgentUpdate,
    );
    register_tool(
        registry,
        "agent_delete",
        "agents_write",
        "Delete a native agent by profile.",
        serde_json::json!({"type":"object","properties":{"profile":{"type":"string"}},"required":["profile"]}),
        state,
        AppAction::AgentDelete,
    );
}
