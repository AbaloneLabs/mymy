use super::*;

pub(super) fn register(
    registry: &mut ToolRegistry,
    state: &Arc<AppState>,
    agent_profile: Option<String>,
) {
    register_tool(
        registry,
        "process_list",
        "processes_read",
        "List sandbox processes for this agent.",
        serde_json::json!({"type":"object","properties":{"projectId":{"type":"string","description":"Optional project UUID used to filter processes."}}}),
        state,
        AppAction::ProcessList {
            agent_profile: agent_profile.clone(),
        },
    );
    register_tool(
        registry,
        "process_start",
        "processes_write",
        "Start a sandbox process for this agent.",
        record_schema(
            &["projectId", "command", "cwd", "port", "label"],
            &["command"],
        ),
        state,
        AppAction::ProcessStart {
            agent_profile: agent_profile.clone(),
        },
    );
    register_tool(
        registry,
        "process_logs",
        "processes_read",
        "Read sandbox process logs by id.",
        id_schema("Process id."),
        state,
        AppAction::ProcessLogs,
    );
    register_tool(
        registry,
        "process_stop",
        "processes_write",
        "Stop a sandbox process by id.",
        id_schema("Process id."),
        state,
        AppAction::ProcessStop,
    );
    register_tool(
        registry,
        "process_kill",
        "processes_write",
        "Force stop a sandbox process by id.",
        id_schema("Process id."),
        state,
        AppAction::ProcessKill,
    );
}
