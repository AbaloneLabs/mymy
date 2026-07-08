use std::fs;

use super::path_utils::normalize_relative_path;
use super::*;

impl SkillRegistry {
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
        write_file_atomic(&dir.join("SKILL.md"), content.trim())?;
        self.record_usage(name, SkillUsageEvent::Patch)?;
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
        write_file_atomic(&path, &updated)?;
        self.record_usage(name, SkillUsageEvent::Patch)?;
        Ok(())
    }

    pub fn replace_content(&self, name: &str, content: &str) -> std::io::Result<()> {
        validate_skill_name(name)?;
        if content.chars().count() > MAX_SKILL_CONTENT {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "SKILL.md content exceeds limit",
            ));
        }
        ensure_safe_skill_content(content)?;
        let path = self.resolve_skill(name)?.join("SKILL.md");
        write_file_atomic(&path, content.trim())?;
        self.record_usage(name, SkillUsageEvent::Patch)?;
        Ok(())
    }

    pub fn delete(&self, name: &str, archive: bool) -> std::io::Result<String> {
        if self.is_pinned(name)? {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "pinned skills cannot be deleted",
            ));
        }
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
        write_file_atomic(&path, content)?;
        self.record_usage(name, SkillUsageEvent::Patch)?;
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
        self.record_usage(name, SkillUsageEvent::Patch)?;
        Ok(relative_display(&skill_path, &path))
    }
}
