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
        record_schema(
            &["title", "description", "type", "period", "status"],
            &["title"],
        ),
        state,
        AppAction::GoalCreate,
    );
    register_tool(
        registry,
        "goal_update",
        "goals_write",
        "Update a goal by id.",
        id_body_schema(
            "Goal id.",
            &["title", "description", "type", "period", "status"],
        ),
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
        goal_id_body_schema(
            &[
                "title",
                "kpiType",
                "targetValue",
                "currentValue",
                "unit",
                "financeDefinition",
            ],
            &["title"],
        ),
        state,
        AppAction::KeyResultCreate,
    );
    register_tool(
        registry,
        "key_result_update",
        "goals_write",
        "Update a key result.",
        goal_and_id_body_schema(&[
            "title",
            "kpiType",
            "targetValue",
            "currentValue",
            "unit",
            "financeDefinition",
        ]),
        state,
        AppAction::KeyResultUpdate,
    );
    register_tool(
        registry,
        "key_result_delete",
        "goals_write",
        "Delete a key result.",
        serde_json::json!({"type":"object","properties":{"goalId":{"type":"string","description":"Owning goal UUID."},"id":{"type":"string","description":"Key Result UUID."}},"required":["goalId","id"]}),
        state,
        AppAction::KeyResultDelete,
    );
}
