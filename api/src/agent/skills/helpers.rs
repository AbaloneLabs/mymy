use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::agent::security::{scan_for_threats, ThreatScope};

use super::*;

pub(super) fn discover_dir(
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

pub(super) fn parse_skill(content: &str) -> Option<(Frontmatter, &str)> {
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

pub(super) fn validate_skill_name(name: &str) -> std::io::Result<()> {
    if valid_skill_name(name) {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid skill name",
        ))
    }
}

pub(super) fn valid_skill_name(name: &str) -> bool {
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

pub(super) fn validate_support_path(file_path: &str) -> std::io::Result<&str> {
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

pub(super) fn resolve_support_file(skill_root: &Path, file_path: &str) -> std::io::Result<PathBuf> {
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

pub(super) fn linked_files(skill_root: &Path) -> std::io::Result<BTreeMap<String, Vec<String>>> {
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

pub(super) fn collect_files(
    dir: &Path,
    skill_root: &Path,
    files: &mut Vec<String>,
) -> std::io::Result<()> {
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

pub(super) fn readiness(frontmatter: &Frontmatter) -> String {
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

pub(super) fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .trim_start_matches('/')
        .to_string()
}

pub(super) fn ensure_safe_skill_content(content: &str) -> std::io::Result<()> {
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

pub(super) fn last_activity_at(record: &SkillUsageRecord) -> Option<chrono::DateTime<chrono::Utc>> {
    [
        &record.last_patched_at,
        &record.last_used_at,
        &record.last_viewed_at,
    ]
    .into_iter()
    .flatten()
    .filter_map(|value| {
        chrono::DateTime::parse_from_rfc3339(value)
            .ok()
            .map(|value| value.with_timezone(&chrono::Utc))
    })
    .max()
}

pub(super) fn skill_modified_at(skill_md: &Path) -> Option<chrono::DateTime<chrono::Utc>> {
    let modified = fs::metadata(skill_md).ok()?.modified().ok()?;
    Some(chrono::DateTime::<chrono::Utc>::from(modified))
}

pub(super) fn write_file_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
    fs::write(&tmp, content)?;
    fs::rename(tmp, path)?;
    Ok(())
}
