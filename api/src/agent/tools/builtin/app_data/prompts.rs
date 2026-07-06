use super::*;

pub(super) fn register(
    registry: &mut ToolRegistry,
    state: &Arc<AppState>,
    agent_profile: Option<String>,
) {
    register_tool(
        registry,
        "get_agent_prompts",
        "prompts_read",
        "Read this agent's AGENTS.md and SOUL.md prompt files.",
        serde_json::json!({"type":"object","properties":{}}),
        state,
        AppAction::GetAgentPrompts {
            agent_profile: agent_profile.clone(),
        },
    );
    register_tool(
        registry,
        "update_agent_prompts",
        "prompts_write",
        "Update this agent's AGENTS.md and/or SOUL.md prompt files.",
        serde_json::json!({
            "type":"object",
            "properties":{
                "agentsMd":{"type":"string"},
                "soulMd":{"type":"string"}
            }
        }),
        state,
        AppAction::UpdateAgentPrompts { agent_profile },
    );
}
