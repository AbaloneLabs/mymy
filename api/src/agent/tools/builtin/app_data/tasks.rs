use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "task_list",
        "tasks_read",
        "List tasks.",
        filter_schema(&["scope", "projectId", "status"]),
        state,
        AppAction::TaskList,
    );
    register_tool(
        registry,
        "task_create",
        "tasks_write",
        "Create a task.",
        passthrough_schema(),
        state,
        AppAction::TaskCreate,
    );
    register_tool(
        registry,
        "task_update",
        "tasks_write",
        "Update a task by id.",
        id_body_schema("Task id."),
        state,
        AppAction::TaskUpdate,
    );
    register_tool(
        registry,
        "task_delete",
        "tasks_write",
        "Delete a task by id.",
        id_schema("Task id."),
        state,
        AppAction::TaskDelete,
    );
    register_tool(
        registry,
        "task_link_run",
        "tasks_write",
        "Explicitly associate the current durable run with a task before working on it.",
        id_schema("Task id."),
        state,
        AppAction::TaskLink,
    );
}
