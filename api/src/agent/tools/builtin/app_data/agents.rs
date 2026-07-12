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
        record_schema(&["profile", "name", "role", "description"], &["name"]),
        state,
        AppAction::AgentCreate,
    );
    register_tool(
        registry,
        "agent_update",
        "agents_write",
        "Update a native agent by profile.",
        {
            let mut data = record_schema(&["name", "role", "description", "toolPermissions"], &[]);
            data["description"] = serde_json::json!("Native-agent fields to update.");
            serde_json::json!({"type":"object","properties":{"profile":{"type":"string","description":"Stable native-agent profile identifier."},"data":data},"required":["profile","data"],"additionalProperties":false})
        },
        state,
        AppAction::AgentUpdate,
    );
    register_tool(
        registry,
        "agent_delete",
        "agents_write",
        "Delete a native agent by profile.",
        serde_json::json!({"type":"object","properties":{"profile":{"type":"string","description":"Stable native-agent profile identifier."}},"required":["profile"]}),
        state,
        AppAction::AgentDelete,
    );
}
