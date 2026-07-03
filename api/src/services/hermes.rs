//! Hermes agent system discovery service.
//!
//! Detects local Hermes installations by reading the filesystem directly:
//!   - CLI path via `which hermes` (PATH lookup)
//!   - Profile dir via HERMES_HOME env or ~/.hermes default
//!   - Number of local profiles with a SOUL.md
//!
//! This approach works without requiring the hermes dashboard/gateway to be
//! running, matching the frontend's `AgentSystemInstance` data model.

use std::fs;
use std::path::{Path, PathBuf};

use crate::models::agent_system::{
    AgentSystemInstance, AgentSystemType, ConnectionType, DiscoverySource, InstanceStatus,
};

/// Result of a local hermes discovery scan.
pub struct DiscoveryResult {
    pub instance: Option<AgentSystemInstance>,
}

/// Top-level discovery entry point: detect local Hermes and count profiles.
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
        return DiscoveryResult { instance: None };
    };

    let profiles_root = home.join("profiles");
    let detected = count_profiles(&home, &profiles_root);
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
    }
}

fn count_profiles(home: &Path, profiles_root: &Path) -> i32 {
    let mut detected = i32::from(home.join("SOUL.md").is_file());
    if let Ok(entries) = fs::read_dir(profiles_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("SOUL.md").is_file() {
                detected += 1;
            }
        }
    }
    detected
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
