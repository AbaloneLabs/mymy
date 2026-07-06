//! Built-in native agent tools.

mod agent_tools;
mod app_data;
mod code_exec;
mod cron;
pub mod extensions;
mod file;
mod investments;
pub mod mcp;
mod memory;
mod preview;
mod skills;
mod terminal;
mod web;
mod workspace_paths;

use std::path::PathBuf;
use std::sync::Arc;

use sqlx::PgPool;

use super::ToolRegistry;
use crate::models::agent::AgentToolDomain;
use crate::services::agent_permissions::AgentPermissionPolicy;
use crate::state::AppState;

#[derive(Clone)]
pub struct BuiltinToolConfig {
    pub working_dir: PathBuf,
    pub allowed_roots: Vec<PathBuf>,
    pub agent_data_dir: PathBuf,
    pub session_id: Option<uuid::Uuid>,
    pub agent_profile: Option<String>,
    pub project_id: Option<uuid::Uuid>,
    pub sandbox_runner_url: Option<String>,
    pub sandbox_preview_host: String,
    pub db: Option<PgPool>,
    pub extension_settings_key: Option<[u8; 32]>,
    pub app_state: Option<Arc<AppState>>,
    pub permission_policy: Option<AgentPermissionPolicy>,
}

pub struct BuiltinSessionConfig {
    pub working_dir: PathBuf,
    pub allowed_roots: Vec<PathBuf>,
    pub agent_data_dir: PathBuf,
    pub session_id: uuid::Uuid,
    pub agent_profile: String,
    pub project_id: Option<uuid::Uuid>,
    pub sandbox_runner_url: Option<String>,
    pub sandbox_preview_host: String,
    pub db: PgPool,
    pub extension_settings_key: Option<[u8; 32]>,
    pub app_state: Arc<AppState>,
    pub permission_policy: AgentPermissionPolicy,
}

impl BuiltinToolConfig {
    pub fn for_session(config: BuiltinSessionConfig) -> Self {
        Self {
            working_dir: config.working_dir,
            allowed_roots: config.allowed_roots,
            agent_data_dir: config.agent_data_dir,
            session_id: Some(config.session_id),
            agent_profile: Some(config.agent_profile),
            project_id: config.project_id,
            sandbox_runner_url: config.sandbox_runner_url,
            sandbox_preview_host: config.sandbox_preview_host,
            db: Some(config.db),
            extension_settings_key: config.extension_settings_key,
            app_state: Some(config.app_state),
            permission_policy: Some(config.permission_policy),
        }
    }
}

pub fn register_all(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    file::register(registry, config);
    app_data::register(registry, config);
    agent_tools::register(registry, config);
    code_exec::register(registry, config);
    mcp::register(registry, config);
    extensions::register(registry, config);
    cron::register(registry, config);
    investments::register(registry, config);
    memory::register(registry, config);
    preview::register(registry, config);
    skills::register(registry, config);
    terminal::register(registry, config);
    web::register(registry);
}

pub fn register_agent_toolsets(registry: &mut ToolRegistry, policy: &AgentPermissionPolicy) {
    registry.enable_toolset("clarify");
    registry.enable_toolset("delegation");
    registry.enable_toolset("runtime");
    registry.enable_toolset("todo");
    registry.enable_toolset("mcp");
    registry.enable_toolset("extensions");
    registry.enable_toolset("skills");
    registry.enable_toolset("web");
    registry.enable_toolset("cron");

    enable_domain(registry, policy, AgentToolDomain::Prompts, "prompts");
    enable_domain(registry, policy, AgentToolDomain::Memory, "memory");
    enable_domain(registry, policy, AgentToolDomain::Sessions, "sessions");
    enable_domain(registry, policy, AgentToolDomain::Goals, "goals");
    enable_domain(registry, policy, AgentToolDomain::Calendar, "calendar");
    enable_domain(registry, policy, AgentToolDomain::Tasks, "tasks");
    enable_domain(registry, policy, AgentToolDomain::Knowledge, "knowledge");
    enable_domain(registry, policy, AgentToolDomain::Notes, "notes");
    enable_domain(registry, policy, AgentToolDomain::Drive, "drive");
    enable_domain(registry, policy, AgentToolDomain::Processes, "processes");
    enable_domain(registry, policy, AgentToolDomain::Finance, "finance");
    enable_domain(
        registry,
        policy,
        AgentToolDomain::Investments,
        "investments",
    );
    enable_domain(registry, policy, AgentToolDomain::Agents, "agents");
}

fn enable_domain(
    registry: &mut ToolRegistry,
    policy: &AgentPermissionPolicy,
    domain: AgentToolDomain,
    prefix: &str,
) {
    if policy.can_read(domain) {
        registry.enable_toolset(&format!("{prefix}_read"));
    }
    if policy.can_write(domain) {
        registry.enable_toolset(&format!("{prefix}_write"));
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated: String = value.chars().take(max_chars).collect();
    truncated.push_str("\n[truncated]");
    truncated
}
