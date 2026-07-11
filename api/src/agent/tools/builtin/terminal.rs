//! Local terminal tool.
//!
//! Commands execute through the sandbox runner when it is configured. The
//! terminal toolset is exposed to native agents because workspace mutation and
//! development servers are core agent work.

use std::sync::Arc;

use super::BuiltinToolConfig;
use crate::agent::tools::{tool_schema, ToolCapability, ToolEntry, ToolRegistry};

mod command;
mod process_tools;
mod validation;

use command::TerminalTool;
use process_tools::{
    KillProcessTool, ListProcessesTool, ProcessToolContext, ReadProcessLogsTool, StopProcessTool,
};
use validation::allowed_roots;

pub(super) const MAX_OUTPUT_CHARS: usize = 16_000;
pub(super) const DEFAULT_TIMEOUT_SECS: u64 = 60;
pub(super) const MAX_TIMEOUT_SECS: u64 = 180;
pub(super) const MIN_PREVIEW_PORT: u64 = 1024;
pub(super) const MAX_PREVIEW_PORT: u64 = 65_535;
pub(super) const MAX_LABEL_CHARS: usize = 80;
pub(super) const MAX_PROCESS_ROWS: i64 = 50;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let process_context = ProcessToolContext {
        runner_url: config.sandbox_runner_url.clone(),
        db: config.db.clone(),
        agent_profile: config.agent_profile.clone(),
        project_id: config.project_id,
    };

    registry.register(ToolEntry {
        name: "terminal".to_string(),
        toolset: "processes_write".to_string(),
        schema: tool_schema(
            "terminal",
            "Execute a shell command in the agent sandbox. Drive mounts are read-only; use read_file, write_file, or patch_file for workspace content. Set background=true for long-running servers.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute. Direct Drive writes are unavailable; use file tools." },
                    "timeout": { "type": "integer", "minimum": 1, "maximum": MAX_TIMEOUT_SECS, "description": "Maximum seconds to wait." },
                    "workdir": { "type": "string", "description": "Optional working directory." },
                    "background": { "type": "boolean", "default": false, "description": "Start a managed background process instead of waiting for command completion." },
                    "port": { "type": "integer", "minimum": MIN_PREVIEW_PORT, "maximum": MAX_PREVIEW_PORT, "description": "Optional preview port for background servers." },
                    "label": { "type": "string", "description": "Optional preview/process label for background commands." }
                },
                "required": ["command"]
            }),
        ),
        capability: ToolCapability::process(),
        handler: Arc::new(TerminalTool {
            working_dir: config.working_dir.clone(),
            allowed_roots: allowed_roots(&config.working_dir, &config.allowed_roots),
            runner_url: config.sandbox_runner_url.clone(),
            db: config.db.clone(),
            agent_profile: config.agent_profile.clone(),
            project_id: config.project_id,
            preview_host: config.sandbox_preview_host.clone(),
            app_state: config.app_state.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "list_processes".to_string(),
        toolset: "processes_read".to_string(),
        schema: tool_schema(
            "list_processes",
            "List managed background processes for the current agent.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_PROCESS_ROWS }
                }
            }),
        ),
        capability: ToolCapability::read("process"),
        handler: Arc::new(ListProcessesTool {
            context: process_context.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "read_process_logs".to_string(),
        toolset: "processes_read".to_string(),
        schema: tool_schema(
            "read_process_logs",
            "Read logs and status for a managed background process.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Process id returned by terminal(background=true)." }
                },
                "required": ["id"]
            }),
        ),
        capability: ToolCapability::read("process").with_resource_argument("id"),
        handler: Arc::new(ReadProcessLogsTool {
            context: process_context.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "stop_process".to_string(),
        toolset: "processes_write".to_string(),
        schema: tool_schema(
            "stop_process",
            "Stop a managed background process owned by the current agent.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Process id returned by terminal(background=true)." }
                },
                "required": ["id"]
            }),
        ),
        capability: ToolCapability::process(),
        handler: Arc::new(StopProcessTool {
            context: process_context.clone(),
        }),
    });

    registry.register(ToolEntry {
        name: "kill_process".to_string(),
        toolset: "processes_write".to_string(),
        schema: tool_schema(
            "kill_process",
            "Force stop a managed background process owned by the current agent.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Process id returned by terminal(background=true)." }
                },
                "required": ["id"]
            }),
        ),
        capability: ToolCapability::process(),
        handler: Arc::new(KillProcessTool {
            context: process_context.clone(),
        }),
    });
}

#[cfg(test)]
mod tests;
