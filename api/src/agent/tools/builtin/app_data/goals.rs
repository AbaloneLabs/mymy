use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "goal_list",
        "goals_read",
        "List goals.",
        filter_schema(&["status", "type", "period"]),
        state,
        AppAction::GoalList,
    );
    register_tool(
        registry,
        "goal_get",
        "goals_read",
        "Get a goal by id.",
        id_schema("Goal id."),
        state,
        AppAction::GoalGet,
    );
    register_tool(
        registry,
        "goal_create",
        "goals_write",
        "Create a goal.",
        passthrough_schema(),
        state,
        AppAction::GoalCreate,
    );
    register_tool(
        registry,
        "goal_update",
        "goals_write",
        "Update a goal by id.",
        id_body_schema("Goal id."),
        state,
        AppAction::GoalUpdate,
    );
    register_tool(
        registry,
        "goal_delete",
        "goals_write",
        "Delete a goal by id.",
        id_schema("Goal id."),
        state,
        AppAction::GoalDelete,
    );
    register_tool(
        registry,
        "key_result_create",
        "goals_write",
        "Create a key result for a goal.",
        goal_id_body_schema(),
        state,
        AppAction::KeyResultCreate,
    );
    register_tool(
        registry,
        "key_result_update",
        "goals_write",
        "Update a key result.",
        serde_json::json!({"type":"object","properties":{"goalId":{"type":"string"},"id":{"type":"string"},"data":{"type":"object"}},"required":["goalId","id","data"]}),
        state,
        AppAction::KeyResultUpdate,
    );
    register_tool(
        registry,
        "key_result_delete",
        "goals_write",
        "Delete a key result.",
        serde_json::json!({"type":"object","properties":{"goalId":{"type":"string"},"id":{"type":"string"}},"required":["goalId","id"]}),
        state,
        AppAction::KeyResultDelete,
    );
}
