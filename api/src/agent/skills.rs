//! Progressive-disclosure skills for the native agent.
//!
//! A skill is a directory containing `SKILL.md` and optional support files.
//! The runtime injects only a compact index into the system prompt; full skill
//! content is loaded on demand through tools. This keeps prompts small while
//! preserving the ability to carry detailed local procedures.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::agent::prompt::sanitize_prompt_block;
use crate::agent::security::{scan_for_threats, ThreatScope};

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

    pub fn list(&self, category: Option<&str>) -> std::io::Result<Vec<SkillInfo>> {
        let mut skills = Vec::new();
        if !self.root.exists() {
            return Ok(skills);
        }
        discover_dir(&self.root, &self.root, category, &mut skills)?;
        skills.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(skills)
    }

    pub fn view(&self, name: &str, file_path: Option<&str>) -> std::io::Result<SkillView> {
        let skill_path = self.resolve_skill(name)?;
        let skill_md = skill_path.join("SKILL.md");
        let raw = fs::read_to_string(&skill_md)?;
        let (frontmatter, _) = parse_skill(&raw).ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "invalid SKILL.md frontmatter",
            )
        })?;

        if let Some(file_path) = file_path {
            let resolved = resolve_support_file(&skill_path, file_path)?;
            let metadata = fs::metadata(&resolved)?;
            if metadata.len() > MAX_SUPPORTING_FILE {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "supporting file exceeds size limit",
                ));
            }
            let content = fs::read_to_string(&resolved)?;
            let readiness_status = readiness(&frontmatter);
            return Ok(SkillView {
                name: frontmatter.name,
                description: frontmatter.description,
                content,
                path: relative_display(&self.root, &resolved),
                linked_files: BTreeMap::new(),
                readiness_status,
            });
        }

        let readiness_status = readiness(&frontmatter);
        Ok(SkillView {
            name: frontmatter.name,
            description: frontmatter.description,
            content: sanitize_prompt_block("SKILL.md", &raw, ThreatScope::Strict),
            path: relative_display(&self.root, &skill_md),
            linked_files: linked_files(&skill_path)?,
            readiness_status,
        })
    }

    pub fn create(&self, name: &str, category: Option<&str>, content: &str) -> std::io::Result<()> {
        validate_skill_name(name)?;
        if content.chars().count() > MAX_SKILL_CONTENT {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "SKILL.md content exceeds limit",
            ));
        }
        let dir = match category {
            Some(category) if !category.trim().is_empty() => self.root.join(category).join(name),
            _ => self.root.join(name),
        };
        if dir.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "skill already exists",
            ));
        }
        ensure_safe_skill_content(content)?;
        fs::create_dir_all(&dir)?;
        fs::write(dir.join("SKILL.md"), content.trim())?;
        Ok(())
    }

    pub fn patch(&self, name: &str, old_string: &str, new_string: &str) -> std::io::Result<()> {
        let path = self.resolve_skill(name)?.join("SKILL.md");
        let content = fs::read_to_string(&path)?;
        let count = content.matches(old_string).count();
        if count != 1 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("old_string must occur exactly once, found {count}"),
            ));
        }
        let updated = content.replacen(old_string, new_string, 1);
        ensure_safe_skill_content(&updated)?;
        fs::write(path, updated)?;
        Ok(())
    }

    pub fn delete(&self, name: &str, archive: bool) -> std::io::Result<String> {
        let skill_path = self.resolve_skill(name)?;
        if archive {
            let archive_root = self.root.join(".archive");
            fs::create_dir_all(&archive_root)?;
            let destination =
                archive_root.join(format!("{name}-{}", chrono::Utc::now().timestamp()));
            fs::rename(&skill_path, &destination)?;
            return Ok(relative_display(&self.root, &destination));
        }
        fs::remove_dir_all(&skill_path)?;
        Ok(relative_display(&self.root, &skill_path))
    }

    pub fn write_support_file(
        &self,
        name: &str,
        file_path: &str,
        content: &str,
    ) -> std::io::Result<String> {
        if content.len() > MAX_SUPPORTING_FILE as usize {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "supporting file exceeds size limit",
            ));
        }
        ensure_safe_skill_content(content)?;
        let skill_path = self.resolve_skill(name)?;
        validate_support_path(file_path)?;
        if file_path == "SKILL.md" {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "use patch for SKILL.md mutations",
            ));
        }
        let path = normalize_relative_path(&skill_path.join(file_path));
        if !path.starts_with(&skill_path) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "supporting file escapes skill directory",
            ));
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, content)?;
        Ok(relative_display(&skill_path, &path))
    }

    pub fn remove_support_file(&self, name: &str, file_path: &str) -> std::io::Result<String> {
        let skill_path = self.resolve_skill(name)?;
        if file_path == "SKILL.md" {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "SKILL.md cannot be removed through remove_file",
            ));
        }
        let path = resolve_support_file(&skill_path, file_path)?;
        fs::remove_file(&path)?;
        Ok(relative_display(&skill_path, &path))
    }

    pub fn categories(&self) -> std::io::Result<Vec<String>> {
        let mut categories = self
            .list(None)?
            .into_iter()
            .filter_map(|skill| skill.category)
            .collect::<Vec<_>>();
        categories.sort();
        categories.dedup();
        Ok(categories)
    }

    pub fn system_prompt_index(&self) -> std::io::Result<String> {
        let skills = self.list(None)?;
        if skills.is_empty() {
            return Ok(String::new());
        }
        let lines = skills
            .into_iter()
            .map(|skill| format!("- {}: {}", skill.name, skill.description))
            .collect::<Vec<_>>()
            .join("\n");
        Ok(format!("Available skills:\n{lines}\nUse skills_list and skill_view to inspect full instructions only when needed."))
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

fn discover_dir(
    root: &Path,
    dir: &Path,
    category_filter: Option<&str>,
    skills: &mut Vec<SkillInfo>,
) -> std::io::Result<()> {
    let entries = fs::read_dir(dir)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if EXCLUDED_DIRS.contains(&name.as_str()) || SUPPORT_DIRS.contains(&name.as_str()) {
            continue;
        }
        if path.is_dir() {
            let skill_md = path.join("SKILL.md");
            if skill_md.exists() {
                let raw = fs::read_to_string(&skill_md)?;
                if let Some((frontmatter, _)) = parse_skill(&raw) {
                    let rel = relative_display(root, &skill_md);
                    let category = path.parent().and_then(|parent| {
                        (parent != root).then(|| relative_display(root, parent))
                    });
                    if category_filter.is_none_or(|filter| category.as_deref() == Some(filter)) {
                        skills.push(SkillInfo {
                            name: frontmatter.name,
                            description: frontmatter.description,
                            category,
                            path: rel,
                        });
                    }
                }
            } else {
                discover_dir(root, &path, category_filter, skills)?;
            }
        }
    }
    Ok(())
}

fn parse_skill(content: &str) -> Option<(Frontmatter, &str)> {
    let rest = content.strip_prefix("---\n")?;
    let (yaml, body) = rest.split_once("\n---")?;
    let frontmatter = serde_yaml::from_str::<Frontmatter>(yaml).ok()?;
    if !valid_skill_name(&frontmatter.name)
        || frontmatter.description.chars().count() > MAX_DESCRIPTION
    {
        return None;
    }
    Some((frontmatter, body.trim_start_matches('\n')))
}

fn validate_skill_name(name: &str) -> std::io::Result<()> {
    if valid_skill_name(name) {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid skill name",
        ))
    }
}

fn valid_skill_name(name: &str) -> bool {
    if name.is_empty() || name.chars().count() > MAX_SKILL_NAME {
        return false;
    }
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|ch| {
            ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '.' | '_' | '-')
        })
}

fn validate_support_path(file_path: &str) -> std::io::Result<&str> {
    if file_path == "SKILL.md" {
        return Ok("SKILL.md");
    }
    let path = Path::new(file_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "supporting file path escapes skill directory",
        ));
    }
    let first = path
        .components()
        .next()
        .and_then(|component| component.as_os_str().to_str())
        .unwrap_or_default();
    if SUPPORT_DIRS.contains(&first) {
        Ok(first)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "supporting files must be under references, templates, assets, or scripts",
        ))
    }
}

fn resolve_support_file(skill_root: &Path, file_path: &str) -> std::io::Result<PathBuf> {
    if file_path == "SKILL.md" {
        return Ok(skill_root.join("SKILL.md"));
    }
    validate_support_path(file_path)?;
    let resolved = fs::canonicalize(skill_root.join(file_path))?;
    let canonical_root = fs::canonicalize(skill_root)?;
    if !resolved.starts_with(canonical_root) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "supporting file escapes skill directory",
        ));
    }
    Ok(resolved)
}

fn linked_files(skill_root: &Path) -> std::io::Result<BTreeMap<String, Vec<String>>> {
    let mut linked = BTreeMap::new();
    for dir in SUPPORT_DIRS {
        let path = skill_root.join(dir);
        if !path.exists() {
            continue;
        }
        let mut files = Vec::new();
        collect_files(&path, skill_root, &mut files)?;
        if !files.is_empty() {
            linked.insert((*dir).to_string(), files);
        }
    }
    Ok(linked)
}

fn collect_files(dir: &Path, skill_root: &Path, files: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, skill_root, files)?;
        } else {
            files.push(relative_display(skill_root, &path));
        }
    }
    files.sort();
    Ok(())
}

fn readiness(frontmatter: &Frontmatter) -> String {
    let os = std::env::consts::OS;
    if !frontmatter.platforms.is_empty()
        && !frontmatter
            .platforms
            .iter()
            .any(|platform| platform == os || platform == "linux")
    {
        return "unsupported".to_string();
    }
    if frontmatter
        .required_environment_variables
        .iter()
        .any(|env| std::env::var(&env.name).is_err())
    {
        return "setup_needed".to_string();
    }
    "available".to_string()
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .trim_start_matches('/')
        .to_string()
}

fn ensure_safe_skill_content(content: &str) -> std::io::Result<()> {
    let findings = scan_for_threats(content, ThreatScope::Strict);
    if findings.is_empty() {
        return Ok(());
    }
    let ids = findings
        .into_iter()
        .map(|finding| finding.pattern_id)
        .collect::<Vec<_>>()
        .join(", ");
    Err(std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        format!("skill content blocked by security scan: {ids}"),
    ))
}

pub fn preprocess_skill_content(content: &str, skill_dir: &Path, session_id: &str) -> String {
    content
        .replace("${HERMES_SKILL_DIR}", &skill_dir.display().to_string())
        .replace("${HERMES_SESSION_ID}", session_id)
}

#[derive(Debug, Clone)]
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

    pub fn resolve(&self, slash_name: &str) -> std::io::Result<Option<SkillBundle>> {
        let slug = slugify(slash_name);
        Ok(self
            .list()?
            .into_iter()
            .find(|bundle| slugify(&bundle.name) == slug))
    }

    pub fn create_or_update(&self, bundle: &SkillBundle) -> std::io::Result<()> {
        validate_skill_name(&bundle.name)?;
        fs::create_dir_all(&self.root)?;
        let path = self.root.join(format!("{}.yaml", bundle.name));
        fs::write(path, serde_yaml::to_string(bundle).unwrap())?;
        Ok(())
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

fn normalize_relative_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!("mymy-skills-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn skill_list_and_view_work() {
        let root = temp_root();
        let skill_dir = root.join("dev").join("sample");
        fs::create_dir_all(skill_dir.join("references")).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: sample\ndescription: Sample skill\n---\n# Sample\nUse it.",
        )
        .unwrap();
        fs::write(skill_dir.join("references/api.md"), "API").unwrap();

        let registry = SkillRegistry::new(root.clone());
        assert_eq!(registry.root(), root.as_path());
        let skills = registry.list(Some("dev")).unwrap();
        assert_eq!(skills.len(), 1);
        let view = registry.view("sample", None).unwrap();
        assert!(view.linked_files["references"].contains(&"references/api.md".to_string()));
        let linked = registry.view("sample", Some("references/api.md")).unwrap();
        assert_eq!(linked.content, "API");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_skill_name_is_rejected() {
        assert!(validate_skill_name("../bad").is_err());
        assert!(validate_skill_name("good-skill_1").is_ok());
    }

    #[tokio::test]
    async fn advanced_skill_preprocessing_and_bundles_work() {
        let root = temp_root();
        let skill_dir = root.join("sample");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: sample\ndescription: Sample skill\n---\nUse ${HERMES_SESSION_ID} in ${HERMES_SKILL_DIR}.",
        )
        .unwrap();

        let registry = SkillRegistry::new(root.clone());
        let bundle_registry = BundleRegistry::new(root.join("bundles"), registry);
        let bundle = SkillBundle {
            name: "backend-dev".to_string(),
            description: "Backend bundle".to_string(),
            skills: vec!["sample".to_string()],
            instruction: Some("Extra guidance".to_string()),
        };
        bundle_registry.create_or_update(&bundle).unwrap();
        assert_eq!(bundle_registry.list().unwrap().len(), 1);
        assert!(bundle_registry.resolve("/backend_dev").unwrap().is_some());
        let invocation = bundle_registry
            .build_invocation_message(&bundle, "ship it", "session1", &SkillsConfig::default())
            .await
            .unwrap();
        assert!(invocation.contains("Extra guidance"));
        assert!(invocation.contains("ship it"));
        assert_eq!(slugify("/Backend Dev"), "backend-dev");

        let processed =
            preprocess_skill_content("Hello ${HERMES_SESSION_ID}", &skill_dir, "session1");
        assert_eq!(processed, "Hello session1");
        let shell_off = preprocess_skill_content_with_config(
            "!`printf hi`",
            &skill_dir,
            "session1",
            &SkillsConfig::default(),
        )
        .await;
        assert_eq!(shell_off, "!`printf hi`");
        let shell_on = expand_inline_shell(
            "!`printf hi` and !`rm -rf /`",
            &skill_dir,
            std::time::Duration::from_secs(2),
        )
        .await;
        assert!(shell_on.contains("hi"));
        assert!(shell_on.contains("inline shell blocked"));

        let message = build_skill_message("sample", "body", "do the thing");
        assert_eq!(
            extract_user_instruction_from_skill_message(&message).unwrap(),
            "do the thing"
        );

        let _ = fs::remove_dir_all(root);
    }
}
