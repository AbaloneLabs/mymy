//! Built-in native agent tools.

mod agent_tools;
mod code_exec;
mod cron;
mod extensions;
mod file;
mod mcp;
mod memory;
mod skills;
mod terminal;
mod web;

use std::path::PathBuf;

use sqlx::PgPool;

use super::ToolRegistry;

#[derive(Debug, Clone)]
pub struct BuiltinToolConfig {
    pub working_dir: PathBuf,
    pub agent_data_dir: PathBuf,
    pub session_id: Option<uuid::Uuid>,
    pub db: Option<PgPool>,
}

impl BuiltinToolConfig {
    pub fn for_session(
        working_dir: PathBuf,
        agent_data_dir: PathBuf,
        session_id: uuid::Uuid,
        db: PgPool,
    ) -> Self {
        Self {
            working_dir,
            agent_data_dir,
            session_id: Some(session_id),
            db: Some(db),
        }
    }
}

pub fn register_all(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    file::register(registry, config);
    agent_tools::register(registry, config);
    code_exec::register(registry, config);
    mcp::register(registry, config);
    extensions::register(registry, config);
    cron::register(registry, config);
    memory::register(registry, config);
    skills::register(registry, config);
    terminal::register(registry, config);
    web::register(registry);
}

pub fn register_safe_defaults(registry: &mut ToolRegistry) {
    registry.enable_toolset("file_read");
    registry.enable_toolset("memory");
    registry.enable_toolset("cron");
    registry.enable_toolset("todo");
    registry.enable_toolset("clarify");
    registry.enable_toolset("session_search");
    registry.enable_toolset("mcp");
    registry.enable_toolset("extensions");
    registry.enable_toolset("runtime");
    registry.enable_toolset("skills");
    registry.enable_toolset("web");
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated: String = value.chars().take(max_chars).collect();
    truncated.push_str("\n[truncated]");
    truncated
}
