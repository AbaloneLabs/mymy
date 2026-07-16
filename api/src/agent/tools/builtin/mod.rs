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

/// Validate the complete static catalog during API startup. Session-specific
/// availability is still resolved per Run, but a malformed built-in must not
/// remain latent until a user starts a conversation.
pub fn validate_builtin_catalog(
    state: Arc<AppState>,
) -> Result<(), crate::agent::tools::ToolContractError> {
    let policy = AgentPermissionPolicy::from_permissions(Vec::new());
    let agent_data_dir = state.config.agent_data_dir.clone();
    let config = BuiltinToolConfig::for_session(BuiltinSessionConfig {
        working_dir: agent_data_dir.join("drive/agents/catalog-validation"),
        allowed_roots: vec![agent_data_dir.join("drive/shared")],
        agent_data_dir,
        session_id: uuid::Uuid::nil(),
        agent_profile: "catalog-validation".to_string(),
        project_id: None,
        sandbox_runner_url: state.config.sandbox_runner_url.clone(),
        sandbox_preview_host: state.config.sandbox_preview_host.clone(),
        db: state.db.clone(),
        extension_settings_key: None,
        app_state: state,
        permission_policy: policy.clone(),
    });
    let mut registry = ToolRegistry::new();
    register_all(&mut registry, &config);
    register_agent_toolsets(&mut registry, &policy);
    registry.validate_catalog()?;
    tracing::debug!(catalog = ?registry.catalog_report(), "validated built-in tool catalog");
    Ok(())
}

pub fn register_agent_toolsets(registry: &mut ToolRegistry, policy: &AgentPermissionPolicy) {
    registry.enable_toolset("decision");
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
    if [
        AgentToolDomain::Sessions,
        AgentToolDomain::Tasks,
        AgentToolDomain::Notes,
        AgentToolDomain::Knowledge,
    ]
    .into_iter()
    .any(|domain| policy.can_read(domain))
    {
        registry.enable_toolset("workspace_search");
    }
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

#[cfg(test)]
mod contract_tests {
    use std::sync::Arc;

    use sqlx::postgres::PgPoolOptions;

    use super::*;
    use crate::config::Config;
    use crate::services::agent_permissions::AgentPermissionPolicy;

    fn registry_with_policy(policy: AgentPermissionPolicy) -> ToolRegistry {
        let db = PgPoolOptions::new()
            .connect_lazy("postgres://mymy:mymy@localhost/mymy")
            .unwrap();
        let agent_data_dir =
            std::env::temp_dir().join(format!("mymy-tool-catalog-{}", uuid::Uuid::new_v4()));
        let state = Arc::new(AppState::new(
            db.clone(),
            Config {
                database_url: String::new(),
                port: 0,
                cors_origins: Vec::new(),
                agent_data_dir: agent_data_dir.clone(),
                auth_cookie_secure: false,
                cron_tick_interval_secs: 60,
                cron_timezone: "UTC".to_string(),
                cron_output_keep: 10,
                drive_s3_bucket: None,
                drive_s3_region: None,
                drive_s3_endpoint: None,
                sandbox_runner_url: None,
                sandbox_preview_host: "127.0.0.1".to_string(),
            },
        ));
        let config = BuiltinToolConfig::for_session(BuiltinSessionConfig {
            working_dir: agent_data_dir.join("drive/agents/test"),
            allowed_roots: vec![agent_data_dir.join("drive/shared")],
            agent_data_dir,
            session_id: uuid::Uuid::new_v4(),
            agent_profile: "test".to_string(),
            project_id: None,
            sandbox_runner_url: None,
            sandbox_preview_host: "127.0.0.1".to_string(),
            db,
            extension_settings_key: None,
            app_state: state,
            permission_policy: policy.clone(),
        });
        let mut registry = ToolRegistry::new();
        register_all(&mut registry, &config);
        register_agent_toolsets(&mut registry, &policy);
        registry
    }

    fn complete_registry() -> ToolRegistry {
        registry_with_policy(AgentPermissionPolicy::from_permissions(Vec::new()))
    }

    #[tokio::test]
    async fn complete_builtin_catalog_has_valid_contracts() {
        let registry = complete_registry();
        let errors = registry
            .contract_errors()
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        assert!(errors.is_empty(), "{}", errors.join("\n"));
        registry.validate_catalog().unwrap();
        assert!(!registry.schemas().is_empty());
        let report = registry.catalog_report();
        assert_eq!(report.len(), registry.schemas().len());
        assert!(report.iter().all(|entry| {
            !entry.interaction_boundary.is_empty()
                && !entry.decision_behavior.is_empty()
                && !entry.operation_modes.is_empty()
                && !entry.safety_enforcement.is_empty()
        }));
        assert!(report.iter().all(|entry| {
            if matches!(entry.name.as_str(), "decision" | "clarify") {
                entry.decision_behavior == "explicit_semantic_request"
            } else {
                entry.decision_behavior == "never_automatic"
            }
        }));
        let todo = report.iter().find(|entry| entry.name == "todo").unwrap();
        assert_eq!(todo.operation_modes, vec!["read", "replace", "merge"]);
        assert!(report.iter().all(|entry| {
            entry.capability.effect == crate::agent::tools::ToolEffect::Read
                || entry
                    .safety_enforcement
                    .contains(&"argument_bound_write_inspection")
        }));
    }

    #[tokio::test]
    async fn similar_tool_descriptions_preserve_selection_boundaries() {
        let registry = complete_registry();
        let descriptions = registry
            .schemas()
            .into_iter()
            .map(|schema| {
                (
                    schema.function.name,
                    schema.function.description.unwrap_or_default(),
                )
            })
            .collect::<std::collections::HashMap<_, _>>();
        let contains = |tool: &str, required: &[&str]| {
            let description = descriptions
                .get(tool)
                .unwrap_or_else(|| panic!("missing selection fixture tool `{tool}`"))
                .to_ascii_lowercase();
            for phrase in required {
                assert!(
                    description.contains(&phrase.to_ascii_lowercase()),
                    "`{tool}` description must explain `{phrase}`: {description}"
                );
            }
        };

        contains("read_file", &["one known", "search_files"]);
        contains(
            "search_files",
            &["drive", "session_search", "workspace_search"],
        );
        contains("session_search", &["past chat", "not drive"]);
        contains("workspace_search", &["permitted", "targeted domain tool"]);
        contains("memory_search", &["durable", "does not search full chat"]);
        contains("cronjob", &["exact durable schedule", "do not use"]);
        contains(
            "write_file",
            &["complete", "patch_file", "knowledge_create"],
        );
        contains("patch_file", &["exactly one", "fingerprint", "write_file"]);
        contains("knowledge_create", &["wiki/knowledge", "write_file"]);
        contains("terminal", &["foreground", "background", "process tools"]);
    }

    #[tokio::test]
    async fn workspace_search_contract_contains_only_prompt_time_permitted_domains() {
        use crate::models::agent::{AgentToolAccess, AgentToolPermission};

        let all = complete_registry();
        let restricted = registry_with_policy(AgentPermissionPolicy::from_permissions(vec![
            AgentToolPermission {
                domain: AgentToolDomain::Notes,
                access: AgentToolAccess::Denied,
            },
        ]));
        let domains = restricted
            .schemas()
            .into_iter()
            .find(|schema| schema.function.name == "workspace_search")
            .unwrap()
            .function
            .parameters["properties"]["domains"]["items"]["enum"]
            .as_array()
            .unwrap()
            .clone();
        assert!(!domains.iter().any(|domain| domain == "notes"));
        assert!(domains.iter().any(|domain| domain == "sessions"));
        assert_ne!(
            all.contract_fingerprint("workspace_search"),
            restricted.contract_fingerprint("workspace_search")
        );
    }
}
