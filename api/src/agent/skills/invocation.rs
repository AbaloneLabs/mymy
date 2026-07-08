use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::{
    validate_skill_name, write_file_atomic, SkillRegistry, SkillUsageEvent, MAX_DESCRIPTION,
};

pub fn preprocess_skill_content(content: &str, skill_dir: &Path, session_id: &str) -> String {
    content
        .replace("${MYMY_SKILL_DIR}", &skill_dir.display().to_string())
        .replace("${MYMY_SESSION_ID}", session_id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SkillsConfig {
    pub template_vars: bool,
    pub inline_shell: bool,
    pub inline_shell_timeout_secs: u64,
}

impl Default for SkillsConfig {
    fn default() -> Self {
        Self {
            template_vars: true,
            inline_shell: false,
            inline_shell_timeout_secs: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillBundle {
    pub name: String,
    pub description: String,
    pub skills: Vec<String>,
    #[serde(default)]
    pub instruction: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BundleRegistry {
    root: PathBuf,
    skills: SkillRegistry,
}

pub const SKILL_MESSAGE_PREFIX: &str =
    "[IMPORTANT: The user has invoked the skill or skill bundle.";
pub const SKILL_MESSAGE_INSTRUCTION_MARKER: &str =
    "The user has provided the following instruction alongside the skill invocation:";

impl BundleRegistry {
    pub fn new(root: PathBuf, skills: SkillRegistry) -> Self {
        Self { root, skills }
    }

    pub fn list(&self) -> std::io::Result<Vec<SkillBundle>> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }
        let mut bundles = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("yaml") {
                continue;
            }
            let raw = fs::read_to_string(path)?;
            let bundle = serde_yaml::from_str::<SkillBundle>(&raw).map_err(|err| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("invalid bundle YAML: {err}"),
                )
            })?;
            validate_skill_name(&bundle.name)?;
            bundles.push(bundle);
        }
        bundles.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(bundles)
    }

    pub fn get(&self, name: &str) -> std::io::Result<Option<SkillBundle>> {
        self.resolve(name)
    }

    pub fn resolve(&self, slash_name: &str) -> std::io::Result<Option<SkillBundle>> {
        let slug = slugify(slash_name);
        Ok(self
            .list()?
            .into_iter()
            .find(|bundle| slugify(&bundle.name) == slug))
    }

    pub fn create_or_update(&self, bundle: &SkillBundle) -> std::io::Result<()> {
        validate_skill_name(&bundle.name)?;
        if bundle.description.chars().count() > MAX_DESCRIPTION {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "bundle description exceeds limit",
            ));
        }
        if bundle.skills.is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "bundle must contain at least one skill",
            ));
        }
        for skill_name in &bundle.skills {
            validate_skill_name(skill_name)?;
            self.skills.resolve_skill(skill_name)?;
        }
        fs::create_dir_all(&self.root)?;
        let path = self.root.join(format!("{}.yaml", bundle.name));
        write_file_atomic(&path, &serde_yaml::to_string(bundle).unwrap())?;
        Ok(())
    }

    pub fn delete(&self, name: &str) -> std::io::Result<SkillBundle> {
        let bundle = self
            .resolve(name)?
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "bundle not found"))?;
        let path = self.root.join(format!("{}.yaml", bundle.name));
        fs::remove_file(path)?;
        Ok(bundle)
    }

    pub async fn build_invocation_message(
        &self,
        bundle: &SkillBundle,
        user_instruction: &str,
        session_id: &str,
        config: &SkillsConfig,
    ) -> std::io::Result<String> {
        let mut parts = Vec::new();
        if let Some(instruction) = &bundle.instruction {
            parts.push(instruction.trim().to_string());
        }
        for skill_name in &bundle.skills {
            let view = self.skills.view(skill_name, None)?;
            self.skills.record_usage(skill_name, SkillUsageEvent::Use)?;
            let skill_path = self.skills.resolve_skill(skill_name)?;
            let content = preprocess_skill_content_with_config(
                &view.content,
                &skill_path,
                session_id,
                config,
            )
            .await;
            parts.push(format!("## Skill: {skill_name}\n{content}"));
        }
        Ok(build_skill_message(
            &bundle.name,
            &parts.join("\n\n"),
            user_instruction,
        ))
    }
}

pub async fn preprocess_skill_content_with_config(
    content: &str,
    skill_dir: &Path,
    session_id: &str,
    config: &SkillsConfig,
) -> String {
    let mut processed = if config.template_vars {
        preprocess_skill_content(content, skill_dir, session_id)
    } else {
        content.to_string()
    };
    if config.inline_shell {
        processed = expand_inline_shell(
            &processed,
            skill_dir,
            std::time::Duration::from_secs(config.inline_shell_timeout_secs),
        )
        .await;
    }
    processed
}

pub async fn expand_inline_shell(
    content: &str,
    skill_dir: &Path,
    timeout: std::time::Duration,
) -> String {
    let re = regex::Regex::new(r"!`([^`]+)`").expect("inline shell regex compiles");
    let mut output = String::new();
    let mut last = 0;
    for capture in re.captures_iter(content) {
        let Some(full) = capture.get(0) else {
            continue;
        };
        output.push_str(&content[last..full.start()]);
        let command = capture
            .get(1)
            .map(|value| value.as_str())
            .unwrap_or_default();
        output.push_str(&run_inline_shell(command, skill_dir, timeout).await);
        last = full.end();
    }
    output.push_str(&content[last..]);
    output
}

pub fn build_skill_message(
    skill_name: &str,
    skill_content: &str,
    user_instruction: &str,
) -> String {
    format!(
        "{SKILL_MESSAGE_PREFIX}\nName: {skill_name}\nThe full skill content is loaded below.]\n\n{skill_content}\n\n{SKILL_MESSAGE_INSTRUCTION_MARKER}\n{user_instruction}\n\n[Runtime note: Skill scaffolding is metadata; preserve only the user instruction in memory.]"
    )
}

pub fn extract_user_instruction_from_skill_message(content: &str) -> Option<String> {
    let (_, rest) = content.split_once(SKILL_MESSAGE_INSTRUCTION_MARKER)?;
    let (instruction, _) = rest.split_once("\n\n[Runtime note:").unwrap_or((rest, ""));
    let trimmed = instruction.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

pub fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            previous_dash = false;
        } else if matches!(ch, '-' | '_' | ' ' | '/') && !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

async fn run_inline_shell(command: &str, skill_dir: &Path, timeout: std::time::Duration) -> String {
    if let Some(matched) = crate::agent::security::detect_dangerous_command(command) {
        return format!(
            "[inline shell blocked: {} ({})]",
            matched.description, matched.pattern_key
        );
    }
    let output = tokio::time::timeout(
        timeout,
        Command::new("bash")
            .arg("-lc")
            .arg(command)
            .current_dir(skill_dir)
            .env_clear()
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .output(),
    )
    .await;
    match output {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let text = if output.status.success() {
                stdout.trim().to_string()
            } else {
                format!("[inline shell failed: {}]", stderr.trim())
            };
            crate::agent::security::redact_sensitive_text(&truncate_inline_output(&text))
        }
        Ok(Err(err)) => format!("[inline shell failed: {err}]"),
        Err(_) => "[inline shell timed out]".to_string(),
    }
}

fn truncate_inline_output(value: &str) -> String {
    const MAX_INLINE_SHELL_OUTPUT: usize = 4_000;
    if value.chars().count() <= MAX_INLINE_SHELL_OUTPUT {
        return value.to_string();
    }
    let mut truncated = value
        .chars()
        .take(MAX_INLINE_SHELL_OUTPUT)
        .collect::<String>();
    truncated.push_str("\n[truncated]");
    truncated
}
