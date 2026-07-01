//! Built-in native agent tools.

mod file;
mod terminal;
mod web;

use std::path::PathBuf;

use super::ToolRegistry;

#[derive(Debug, Clone)]
pub struct BuiltinToolConfig {
    pub working_dir: PathBuf,
}

impl BuiltinToolConfig {
    pub fn new(working_dir: PathBuf) -> Self {
        Self { working_dir }
    }
}

pub fn register_all(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    file::register(registry, config);
    terminal::register(registry, config);
    web::register(registry);
}

pub fn register_safe_defaults(registry: &mut ToolRegistry) {
    registry.enable_toolset("file_read");
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
