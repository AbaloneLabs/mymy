//! Hermes agent system discovery service.
//!
//! Detects local hermes installations by reading the filesystem directly:
//!   - CLI path via `which hermes` (PATH lookup)
//!   - Profile dir via HERMES_HOME env or ~/.hermes default
//!   - Each profile's SOUL.md (name, role), profile.yaml (description),
//!     config.yaml (model, provider)
//!
//! This approach works without requiring the hermes dashboard/gateway to be
//! running, matching the frontend's `AgentSystemInstance` data model.

use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::Deserialize;

use crate::models::agent::{Agent, AgentModel, AgentSource, AgentStatus};
use crate::models::agent_system::{
    AgentSystemInstance, AgentSystemType, ConnectionType, DiscoverySource, InstanceStatus,
};

/// Result of a local hermes discovery scan.
pub struct DiscoveryResult {
    pub instance: Option<AgentSystemInstance>,
    pub agents: Vec<Agent>,
}

/// Top-level discovery entry point: detect local hermes + parse profiles.
pub fn discover_local_hermes() -> DiscoveryResult {
    let cli_path = detect_cli_path("hermes");
    let hermes_home = detect_hermes_home();

    tracing::debug!(
        cli_path = ?cli_path,
        hermes_home = ?hermes_home,
        "discovering local hermes"
    );

    // Need at least a profile dir to find agents.
    let Some(home) = hermes_home.clone() else {
        return DiscoveryResult {
            instance: None,
            agents: vec![],
        };
    };

    let profiles_root = home.join("profiles");
    let mut agents = Vec::new();

    // Gateway is a single global process (not per-profile). Its state file
    // lives at the hermes home root, so we check it once here and apply the
    // same status to every profile. See `hermes gateway status --profile X`
    // which returns the same PID regardless of the profile.
    let gateway_running = is_gateway_running(&home);

    // 1. Default profile = hermes home itself (SOUL.md at root)
    let default_soul = home.join("SOUL.md");
    if default_soul.is_file() {
        if let Some(agent) = parse_profile(&home, "default", gateway_running) {
            agents.push(agent);
        }
    }

    // 2. Named profiles under ~/.hermes/profiles/<name>/
    if profiles_root.is_dir() {
        if let Ok(entries) = fs::read_dir(&profiles_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && path.join("SOUL.md").is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if let Some(agent) = parse_profile(&path, &name, gateway_running) {
                        agents.push(agent);
                    }
                }
            }
        }
    }

    let detected = agents.len() as i32;
    let status = if cli_path.is_some() {
        InstanceStatus::Connected
    } else {
        InstanceStatus::Disconnected
    };

    let instance = AgentSystemInstance {
        id: format!("hermes-local-{}", chrono::Utc::now().timestamp()),
        r#type: AgentSystemType::Hermes,
        label: "Local Hermes".to_string(),
        enabled: true,
        source: DiscoverySource::Auto,
        connection: ConnectionType::Local,
        cli_path: cli_path.as_ref().map(|p| p.to_string_lossy().to_string()),
        profile_dir: Some(profiles_root.to_string_lossy().to_string()),
        host: None,
        port: None,
        ssh_user: None,
        remote_cli_path: None,
        remote_profile_dir: None,
        detected_agents: Some(detected),
        status: Some(status),
    };

    DiscoveryResult {
        instance: Some(instance),
        agents,
    }
}

/// Locate a CLI binary by name using PATH lookup (equivalent to `which`).
fn detect_cli_path(name: &str) -> Option<PathBuf> {
    // Check HERMES-specific env first, then PATH.
    if let Ok(path) = std::env::var("HERMES_CLI_PATH") {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }

    let path_var = std::env::var("PATH").ok()?;
    for dir in path_var.split(':') {
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            // Resolve symlinks to get the real binary.
            if let Ok(real) = fs::canonicalize(&candidate) {
                return Some(real);
            }
            return Some(candidate);
        }
    }
    None
}

/// Resolve the hermes home directory.
/// Priority: HERMES_HOME env → ~/.hermes
fn detect_hermes_home() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HERMES_HOME") {
        let p = PathBuf::from(home);
        if p.is_dir() {
            return Some(p);
        }
    }
    let user_home = std::env::var("HOME").ok()?;
    let p = PathBuf::from(user_home).join(".hermes");
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

/// Parse a single profile directory into an Agent.
///
/// `gateway_running` is the GLOBAL gateway status (shared across all profiles),
/// because the Hermes gateway is a single global process, not per-profile.
fn parse_profile(dir: &Path, name: &str, gateway_running: bool) -> Option<Agent> {
    let soul = fs::read_to_string(dir.join("SOUL.md")).unwrap_or_default();
    let (display_name, role) = parse_soul(&soul, name);

    let description = parse_profile_yaml(dir).unwrap_or_default();
    let (model, _provider) = parse_config_model(dir);

    let status = if gateway_running {
        AgentStatus::Active
    } else {
        AgentStatus::Idle
    };

    Some(Agent {
        id: format!("hermes-{name}"),
        name: display_name,
        role,
        description: if description.is_empty() {
            None
        } else {
            Some(description)
        },
        status,
        source: AgentSource::Hermes,
        model,
        avatar_url: None,
        profile_path: Some(dir.to_string_lossy().to_string()),
        last_active_at: None,
    })
}

/// Extract Name and Role from SOUL.md content.
/// Convention: lines like "- Name: Aria" and "- Role: Orchestrator".
fn parse_soul(content: &str, fallback_name: &str) -> (String, String) {
    let name_re = Regex::new(r"(?i)^[-\s]*name:\s*(.+)$").unwrap();
    let role_re = Regex::new(r"(?i)^[-\s]*role:\s*(.+)$").unwrap();

    let mut name = String::new();
    let mut role = String::new();

    for line in content.lines() {
        if name.is_empty() {
            if let Some(c) = name_re.captures(line) {
                name = c
                    .get(1)
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default();
            }
        }
        if role.is_empty() {
            if let Some(c) = role_re.captures(line) {
                role = c
                    .get(1)
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default();
            }
        }
    }

    if name.is_empty() {
        name = fallback_name.to_string();
    }
    if role.is_empty() {
        role = "Agent".to_string();
    }
    (name, role)
}

#[derive(Debug, Deserialize)]
struct ProfileYaml {
    description: Option<String>,
}

/// Read `profile.yaml` and extract the description.
fn parse_profile_yaml(dir: &Path) -> Option<String> {
    let content = fs::read_to_string(dir.join("profile.yaml")).ok()?;
    let parsed: ProfileYaml = serde_yaml::from_str(&content).ok()?;
    parsed.description
}

#[derive(Debug, Deserialize)]
struct ConfigModel {
    default: Option<String>,
    provider: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConfigRoot {
    model: Option<ConfigModel>,
}

/// Read `config.yaml` and extract model.default + model.provider.
/// Falls back gracefully if the file is missing or malformed.
fn parse_config_model(dir: &Path) -> (AgentModel, Option<String>) {
    let content = match fs::read_to_string(dir.join("config.yaml")) {
        Ok(c) => c,
        Err(_) => return (AgentModel::Unknown, None),
    };
    let parsed: ConfigRoot = match serde_yaml::from_str(&content) {
        Ok(c) => c,
        Err(_) => return (AgentModel::Unknown, None),
    };
    let model_str = parsed
        .model
        .as_ref()
        .and_then(|m| m.default.as_deref())
        .unwrap_or("");
    let model = map_model(model_str);
    let provider = parsed.model.and_then(|m| m.provider);
    (model, provider)
}

/// Map a model string to the frontend AgentModel enum.
fn map_model(s: &str) -> AgentModel {
    let lower = s.to_lowercase();
    if lower.contains("qwen") {
        AgentModel::Qwen
    } else if lower.contains("gpt") || lower.contains("openai") {
        AgentModel::Openai
    } else if lower.contains("claude") || lower.contains("anthropic") {
        AgentModel::Anthropic
    } else if lower.contains("local") || lower.contains("ollama") || lower.contains("llama") {
        AgentModel::Local
    } else {
        AgentModel::Unknown
    }
}

/// Heuristic: is the gateway running for this profile?
/// Checks for gateway_state.json or gateway.pid in the profile dir.
fn is_gateway_running(dir: &Path) -> bool {
    dir.join("gateway_state.json").exists() || dir.join("gateway.pid").exists()
}
