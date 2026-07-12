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

mod action;
mod agents;
mod arguments;
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
mod workspace_search;

use action::AppAction;
use execution::AppDataTool;

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
    workspace_search::register(registry, config);
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
    let capability = action.capability();
    registry.register(ToolEntry {
        name: name.to_string(),
        toolset: toolset.to_string(),
        schema: tool_schema(name, description, parameters),
        capability,
        handler: Arc::new(AppDataTool {
            state: state.clone(),
            action,
        }),
    });
}

fn empty_schema() -> Value {
    serde_json::json!({"type":"object","properties":{}})
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
        .map(|field| {
            let description = match *field {
                "status" => "Optional domain status filter.",
                "type" => "Optional domain type filter.",
                "period" => "Optional goal period filter.",
                "scope" => "Optional result scope defined by this tool.",
                "projectId" => "Optional project UUID used to scope results.",
                "from" => "Optional inclusive RFC3339 start instant.",
                "to" => "Optional inclusive RFC3339 end instant.",
                "q" => "Search text to match against domain content.",
                "nodeType" => "Optional Knowledge node type filter.",
                "parentId" => "Optional parent Knowledge node UUID.",
                "category" => "Optional category filter.",
                "startDate" => "Optional inclusive start date in YYYY-MM-DD format.",
                "endDate" => "Optional inclusive end date in YYYY-MM-DD format.",
                "accountId" => "Optional investment account UUID.",
                "assetId" => "Optional investment asset UUID.",
                "positionId" => "Optional investment position UUID.",
                "kind" => "Optional domain kind filter.",
                other => return ((*field).to_string(), serde_json::json!({"type":"string","description":format!("Optional `{other}` filter for this domain.")})),
            };
            (
                (*field).to_string(),
                serde_json::json!({"type":"string","description":description}),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    serde_json::json!({"type":"object","properties":properties})
}

fn record_schema(fields: &[&str], required: &[&str]) -> Value {
    let properties = fields
        .iter()
        .map(|field| ((*field).to_string(), app_field_schema(field)))
        .collect::<serde_json::Map<_, _>>();
    serde_json::json!({
        "type":"object",
        "properties":properties,
        "required":required,
        "additionalProperties":false
    })
}

fn id_body_schema(description: &str, fields: &[&str]) -> Value {
    let mut data = record_schema(fields, &[]);
    data["description"] = serde_json::json!("Patch fields for this record.");
    serde_json::json!({
        "type":"object",
        "properties":{
            "id":{"type":"string","description":description},
            "data":data
        },
        "required":["id","data"],
        "additionalProperties":false
    })
}

fn goal_id_body_schema(fields: &[&str], required: &[&str]) -> Value {
    let mut data = record_schema(fields, required);
    data["description"] = serde_json::json!("Key Result fields to create or update.");
    serde_json::json!({
        "type":"object",
        "properties":{
            "goalId":{"type":"string","description":"Owning goal UUID."},
            "data":data
        },
        "required":["goalId","data"],
        "additionalProperties":false
    })
}

fn goal_and_id_body_schema(fields: &[&str]) -> Value {
    let mut data = record_schema(fields, &[]);
    data["description"] = serde_json::json!("Key Result patch fields.");
    serde_json::json!({
        "type":"object",
        "properties":{
            "goalId":{"type":"string","description":"Owning goal UUID."},
            "id":{"type":"string","description":"Key Result UUID."},
            "data":data
        },
        "required":["goalId","id","data"],
        "additionalProperties":false
    })
}

fn app_field_schema(field: &str) -> Value {
    let description = match field {
        "profile" => "Stable native-agent profile identifier.",
        "name" => "Human-readable name.",
        "role" => "Optional agent role label.",
        "description" => "Optional human-readable description.",
        "title" => "Human-readable title.",
        "type" => "Domain-specific record type.",
        "period" => "Goal reporting period.",
        "status" => "Domain-specific lifecycle status.",
        "projectId" => "Optional owning project UUID; null removes project scope when supported.",
        "parentId" => {
            "Optional parent Knowledge UUID; null moves the node to the root when supported."
        }
        "nodeType" => "Knowledge node type: article or category.",
        "slug" => "Optional URL-safe Knowledge slug.",
        "content" => "Record content text.",
        "excerpt" => "Optional short Knowledge summary.",
        "startDate" => "RFC3339 event start instant.",
        "endDate" => "Optional RFC3339 event end instant.",
        "dueDate" => "Optional RFC3339 task due instant.",
        "priority" => "Task priority label.",
        "currency" => "ISO 4217 currency code.",
        "category" => "Optional finance category.",
        "date" => "Optional RFC3339 transaction instant; defaults to now on create.",
        "institution" => "Optional financial institution name.",
        "notes" => "Optional private notes.",
        "symbol" => "Investment asset ticker or stable symbol.",
        "assetType" => "Optional investment asset class.",
        "exchange" => "Optional exchange or market identifier.",
        "sector" => "Optional investment sector label.",
        "accountId" => "Optional investment account UUID.",
        "assetId" => "Investment asset UUID.",
        "openedAt" => "Optional RFC3339 position-open instant.",
        "positionId" => "Investment position UUID.",
        "recordedAt" => "Optional RFC3339 valuation or cashflow instant.",
        "flowType" => "Investment cashflow type.",
        "command" => "Sandbox command to start.",
        "cwd" => "Optional workspace-relative process working directory.",
        "label" => "Optional process display label.",
        _ => "Domain request field documented by the corresponding service contract.",
    };
    match field {
        "allDay" | "pinned" => serde_json::json!({
            "type":"boolean",
            "description": if field == "allDay" { "Whether the calendar event spans whole local days." } else { "Whether the note is pinned." }
        }),
        "sortOrder" | "amount" | "quantityMicro" | "costBasisAmount" | "unitPriceAmount"
        | "marketValueAmount" | "targetPriceAmount" | "port" => {
            serde_json::json!({"type":"integer","description":description})
        }
        "targetValue" | "currentValue" => {
            serde_json::json!({"type":"number","description":"Numeric Key Result progress value."})
        }
        "tags" => serde_json::json!({
            "type":"array",
            "description":"Record tags.",
            "items":{"type":"string","description":"One tag value."}
        }),
        "financeDefinition" => serde_json::json!({
            "type":["object","null"],
            "description":"Optional structured finance KPI definition.",
            "additionalProperties":true
        }),
        "toolPermissions" => serde_json::json!({
            "type":"array",
            "description":"Complete native-agent domain permission overrides.",
            "items":{
                "type":"object",
                "description":"One domain permission override.",
                "properties":{
                    "domain":{"type":"string","description":"Native-agent tool domain."},
                    "access":{"type":"string","enum":["access","read_only","denied"],"description":"Granted access level for this domain."}
                },
                "required":["domain","access"],
                "additionalProperties":false
            }
        }),
        "projectId" | "parentId" | "accountId" => serde_json::json!({
            "type":["string","null"],
            "description":description
        }),
        _ => serde_json::json!({"type":"string","description":description}),
    }
}
