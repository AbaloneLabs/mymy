//! App data CRUD tools for native agents.
//!
//! These tools present mymy's user-facing domain model directly to the agent.
//! They intentionally do not mention HTTP routes, database tables, or storage
//! internals; the handler delegates to the same service functions used by the
//! web API so validation, defaults, and audit behavior remain consistent.

use std::sync::Arc;

use serde_json::Value;

use super::BuiltinToolConfig;
use crate::agent::tools::{tool_schema, ToolEntry, ToolRegistry};
use crate::state::AppState;

mod agents;
mod calendar;
mod drive;
mod execution;
mod finance;
mod goals;
mod investments;
mod knowledge;
mod notes;
mod processes;
mod prompts;
mod sessions;
mod tasks;

use execution::{AppAction, AppDataTool};

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let Some(state) = config.app_state.clone() else {
        return;
    };
    let agent_profile = config.agent_profile.clone();
    prompts::register(registry, &state, agent_profile.clone());
    sessions::register(registry, &state);
    goals::register(registry, &state);
    calendar::register(registry, &state);
    tasks::register(registry, &state);
    knowledge::register(registry, &state);
    notes::register(registry, &state);
    drive::register(registry, &state);
    processes::register(registry, &state, agent_profile);
    finance::register(registry, &state);
    investments::register(registry, &state);
    agents::register(registry, &state);
}

fn register_tool(
    registry: &mut ToolRegistry,
    name: &str,
    toolset: &str,
    description: &str,
    parameters: Value,
    state: &Arc<AppState>,
    action: AppAction,
) {
    registry.register(ToolEntry {
        name: name.to_string(),
        toolset: toolset.to_string(),
        schema: tool_schema(name, description, parameters),
        handler: Arc::new(AppDataTool {
            state: state.clone(),
            action,
        }),
    });
}

fn empty_schema() -> Value {
    serde_json::json!({"type":"object","properties":{}})
}

fn passthrough_schema() -> Value {
    serde_json::json!({"type":"object","additionalProperties":true})
}

fn id_schema(description: &str) -> Value {
    serde_json::json!({
        "type":"object",
        "properties":{"id":{"type":"string","description":description}},
        "required":["id"]
    })
}

fn path_schema(required: bool) -> Value {
    let mut schema = serde_json::json!({
        "type":"object",
        "properties":{"path":{"type":"string","description":"A /drive/... logical path."}}
    });
    if required {
        schema["required"] = serde_json::json!(["path"]);
    }
    schema
}

fn filter_schema(fields: &[&str]) -> Value {
    let properties = fields
        .iter()
        .map(|field| ((*field).to_string(), serde_json::json!({"type":"string"})))
        .collect::<serde_json::Map<_, _>>();
    serde_json::json!({"type":"object","properties":properties})
}

fn id_body_schema(description: &str) -> Value {
    serde_json::json!({
        "type":"object",
        "properties":{
            "id":{"type":"string","description":description},
            "data":{"type":"object","description":"Patch fields for this record."}
        },
        "required":["id","data"]
    })
}

fn goal_id_body_schema() -> Value {
    serde_json::json!({
        "type":"object",
        "properties":{
            "goalId":{"type":"string"},
            "data":{"type":"object"}
        },
        "required":["goalId","data"]
    })
}
