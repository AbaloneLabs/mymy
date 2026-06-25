//! Filesystem readers for Hermes ops data.

use std::path::{Path, PathBuf};

use crate::models::agent_ops::IdentityInfo;

use super::types::{ConfigRoot, GatewayStateFile, OpsError};

/// Read the gateway running state from `gateway_state.json`.
pub(super) fn read_gateway_running(profile_dir: Option<&str>) -> Option<bool> {
    let dir = profile_dir.map(Path::new)?;
    let state_path = find_gateway_state_json(dir)?;
    let content = std::fs::read_to_string(&state_path).ok()?;
    let parsed: GatewayStateFile = serde_json::from_str(&content).ok()?;
    Some(parsed.gateway_state.eq_ignore_ascii_case("running"))
}

fn find_gateway_state_json(dir: &Path) -> Option<PathBuf> {
    let direct = dir.join("gateway_state.json");
    if direct.is_file() {
        return Some(direct);
    }
    let parent = dir.parent()?;
    let parent_state = parent.join("gateway_state.json");
    if parent_state.is_file() {
        return Some(parent_state);
    }
    None
}

/// Read `config.yaml` and extract model.default + model.provider.
pub(super) fn parse_config_model(dir: &Path) -> (Option<String>, Option<String>) {
    let config_path = find_config_yaml(dir);
    let content = match config_path
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
    {
        Some(c) => c,
        None => return (None, None),
    };
    let parsed: ConfigRoot = match serde_yaml::from_str(&content) {
        Ok(c) => c,
        Err(_) => return (None, None),
    };
    let model = parsed.model.as_ref().and_then(|m| m.default.clone());
    let provider = parsed.model.and_then(|m| m.provider);
    (model, provider)
}

fn find_config_yaml(dir: &Path) -> Option<PathBuf> {
    let direct = dir.join("config.yaml");
    if direct.is_file() {
        return Some(direct);
    }
    let parent = dir.parent()?;
    let parent_config = parent.join("config.yaml");
    if parent_config.is_file() {
        return Some(parent_config);
    }
    None
}

pub(super) fn read_user_memory(profile_dir: Option<&str>) -> Option<String> {
    profile_dir
        .map(Path::new)
        .and_then(find_memory_dir)
        .and_then(|d| std::fs::read_to_string(d.join("USER.md")).ok())
        .filter(|c| !c.trim().is_empty())
}

fn find_memory_dir(dir: &Path) -> Option<PathBuf> {
    let direct = dir.join("memories");
    if direct.is_dir() {
        return Some(direct);
    }
    let parent = dir.parent()?;
    let parent_mem = parent.join("memories");
    if parent_mem.is_dir() {
        return Some(parent_mem);
    }
    None
}

/// Query agent identity from `~/.hermes/SOUL.md`.
pub async fn query_identity(profile_dir: Option<&str>) -> Result<IdentityInfo, OpsError> {
    let content = profile_dir
        .map(Path::new)
        .and_then(find_soul_md)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();

    let name = extract_md_field(&content, "Name");
    let role = extract_md_field(&content, "Role");

    Ok(IdentityInfo {
        name,
        role,
        content,
    })
}

fn find_soul_md(dir: &Path) -> Option<PathBuf> {
    let direct = dir.join("SOUL.md");
    if direct.is_file() {
        return Some(direct);
    }
    let parent = dir.parent()?;
    let parent_soul = parent.join("SOUL.md");
    if parent_soul.is_file() {
        return Some(parent_soul);
    }
    None
}

fn extract_md_field(content: &str, field: &str) -> Option<String> {
    let prefix = format!("- {field}:");
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(&prefix) {
            let val = rest.trim();
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_md_field_reads_named_field() {
        let content = "- Name: Aria\n- Role: Orchestrator";
        assert_eq!(extract_md_field(content, "Name").as_deref(), Some("Aria"));
        assert_eq!(
            extract_md_field(content, "Role").as_deref(),
            Some("Orchestrator")
        );
    }
}
