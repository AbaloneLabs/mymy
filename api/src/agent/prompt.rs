//! System prompt assembly for native chat sessions.
//!
//! The prompt is assembled from stable identity, tool guidance, local context
//! files, optional memory files, and volatile session metadata. Missing files
//! are simply omitted; that keeps unimplemented integrations visibly empty
//! instead of inventing sample content.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct PromptConfig {
    pub soul_md_path: Option<PathBuf>,
    pub working_dir: PathBuf,
    pub memory_md_path: Option<PathBuf>,
    pub user_md_path: Option<PathBuf>,
    pub available_tool_names: Vec<String>,
    pub model: String,
    pub system_message: Option<String>,
}

pub const DEFAULT_AGENT_IDENTITY: &str = "\
You are mymy Agent, an intelligent AI assistant running inside the mymy \
workspace. You are direct, careful, and useful. Complete the user's task with \
the available tools, explain blockers concretely, and avoid inventing facts or \
data that are not present in the workspace or returned by tools.";

pub fn build_system_prompt(config: &PromptConfig) -> String {
    let mut parts = Vec::new();
    parts.push(load_identity(config));

    let guidance = build_tool_guidance(&config.available_tool_names);
    if !guidance.is_empty() {
        parts.push(guidance);
    }

    let context = load_context_files(&config.working_dir);
    if !context.is_empty() {
        parts.push(context);
    }

    if let Some(message) = &config.system_message {
        if !message.trim().is_empty() {
            parts.push(message.trim().to_string());
        }
    }

    let memory = load_memory_block(config);
    if !memory.is_empty() {
        parts.push(memory);
    }

    parts.push(format!(
        "Session metadata:\n- UTC timestamp: {}\n- Model: {}\n- Working directory: {}",
        chrono::Utc::now().to_rfc3339(),
        config.model,
        config.working_dir.display()
    ));

    parts.join("\n\n")
}

fn load_identity(config: &PromptConfig) -> String {
    config
        .soul_md_path
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .filter(|content| !content.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AGENT_IDENTITY.to_string())
}

fn build_tool_guidance(tool_names: &[String]) -> String {
    if tool_names.is_empty() {
        return String::new();
    }
    let mut parts = vec![
        "Complete tasks fully when the available tools make completion possible. Use tools for current workspace facts instead of guessing.",
        "When calling tools, provide valid JSON arguments and use the returned tool output as the source of truth.",
    ];
    if tool_names
        .iter()
        .any(|name| name == "read_file" || name == "search_files")
    {
        parts.push("Use read_file and search_files to inspect project files before making claims about the codebase.");
    }
    if tool_names
        .iter()
        .any(|name| name == "web_extract" || name == "web_search")
    {
        parts.push("Use web tools only when current external information is required.");
    }
    parts.join("\n")
}

fn load_context_files(working_dir: &Path) -> String {
    let mut blocks = Vec::new();
    for name in ["AGENTS.md", ".cursorrules"] {
        let path = working_dir.join(name);
        if let Ok(content) = std::fs::read_to_string(&path) {
            if !content.trim().is_empty() {
                blocks.push(format!("Context file: {name}\n{}", content.trim()));
            }
        }
    }
    blocks.join("\n\n")
}

fn load_memory_block(config: &PromptConfig) -> String {
    let mut blocks = Vec::new();
    for (label, path) in [
        ("USER.md", config.user_md_path.as_ref()),
        ("MEMORY.md", config.memory_md_path.as_ref()),
    ] {
        if let Some(path) = path {
            if let Ok(content) = std::fs::read_to_string(path) {
                if !content.trim().is_empty() {
                    blocks.push(format!("{label}:\n{}", content.trim()));
                }
            }
        }
    }
    blocks.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_contains_identity_and_metadata() {
        let prompt = build_system_prompt(&PromptConfig {
            soul_md_path: None,
            working_dir: std::env::current_dir().unwrap(),
            memory_md_path: None,
            user_md_path: None,
            available_tool_names: Vec::new(),
            model: "test-model".to_string(),
            system_message: None,
        });

        assert!(prompt.contains("mymy Agent"));
        assert!(prompt.contains("test-model"));
    }
}
