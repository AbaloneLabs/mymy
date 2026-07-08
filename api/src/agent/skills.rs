//! Progressive-disclosure skills for the native agent.
//!
//! A skill is a directory containing `SKILL.md` and optional support files.
//! The runtime injects only a compact index into the system prompt; full skill
//! content is loaded on demand through tools. This keeps prompts small while
//! preserving the ability to carry detailed local procedures.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MAX_SKILL_NAME: usize = 64;
const MAX_DESCRIPTION: usize = 1024;
const MAX_SKILL_CONTENT: usize = 65_536;
const MAX_SUPPORTING_FILE: u64 = 1_048_576;
const SUPPORT_DIRS: &[&str] = &["references", "templates", "assets", "scripts"];
const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    ".github",
    ".archive",
    ".venv",
    "venv",
    "node_modules",
    "site-packages",
    "__pycache__",
    ".tox",
    ".nox",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
];

mod catalog;
mod helpers;
mod invocation;
mod mutations;
mod path_utils;
mod usage;

use helpers::*;
pub use invocation::{
    build_skill_message, extract_user_instruction_from_skill_message,
    preprocess_skill_content_with_config, slugify, BundleRegistry, SkillBundle, SkillsConfig,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub category: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillView {
    pub name: String,
    pub description: String,
    pub content: String,
    pub path: String,
    pub linked_files: BTreeMap<String, Vec<String>>,
    pub readiness_status: String,
}

#[derive(Debug, Clone)]
pub struct SkillRegistry {
    root: PathBuf,
}

#[derive(Debug, Clone, Copy)]
pub enum SkillUsageEvent {
    View,
    Use,
    Patch,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SkillUsageRecord {
    #[serde(default)]
    view_count: u64,
    #[serde(default)]
    use_count: u64,
    #[serde(default)]
    patch_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_viewed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_used_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_patched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCuratorReport {
    pub stale: Vec<String>,
    pub archived: Vec<String>,
    pub protected: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SkillCuratorRecord {
    status: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct Frontmatter {
    name: String,
    description: String,
    #[serde(default)]
    platforms: Vec<String>,
    #[serde(default)]
    required_environment_variables: Vec<RequiredEnv>,
}

#[derive(Debug, Deserialize)]
struct RequiredEnv {
    name: String,
}

impl SkillRegistry {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn resolve_skill_dir(&self, name: &str) -> std::io::Result<PathBuf> {
        self.resolve_skill(name)
    }

    fn resolve_skill(&self, name: &str) -> std::io::Result<PathBuf> {
        validate_skill_name(name)?;
        let matches = self
            .list(None)?
            .into_iter()
            .filter(|skill| skill.name == name)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!(
                    "expected exactly one skill named {name}, found {}",
                    matches.len()
                ),
            ));
        }
        Ok(self
            .root
            .join(&matches[0].path)
            .parent()
            .unwrap()
            .to_path_buf())
    }
}

#[cfg(test)]
mod tests;
