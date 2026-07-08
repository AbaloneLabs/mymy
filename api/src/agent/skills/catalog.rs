use std::collections::BTreeMap;
use std::fs;

use crate::agent::prompt::sanitize_prompt_block;
use crate::agent::security::ThreatScope;

use super::*;

impl SkillRegistry {
    pub fn list(&self, category: Option<&str>) -> std::io::Result<Vec<SkillInfo>> {
        let mut skills = Vec::new();
        if !self.root.exists() {
            return Ok(skills);
        }
        discover_dir(&self.root, &self.root, category, &mut skills)?;
        skills.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(skills)
    }

    pub fn resolve_slash(&self, slash_name: &str) -> std::io::Result<Option<SkillInfo>> {
        let slug = slugify(slash_name);
        Ok(self
            .list(None)?
            .into_iter()
            .find(|skill| slugify(&skill.name) == slug))
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
            self.record_usage(&frontmatter.name, SkillUsageEvent::View)?;
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
        self.record_usage(&frontmatter.name, SkillUsageEvent::View)?;
        Ok(SkillView {
            name: frontmatter.name,
            description: frontmatter.description,
            content: sanitize_prompt_block("SKILL.md", &raw, ThreatScope::Strict),
            path: relative_display(&self.root, &skill_md),
            linked_files: linked_files(&skill_path)?,
            readiness_status,
        })
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

    pub async fn build_invocation_message(
        &self,
        skill_name: &str,
        user_instruction: &str,
        session_id: &str,
        config: &SkillsConfig,
    ) -> std::io::Result<String> {
        let view = self.view(skill_name, None)?;
        self.record_usage(skill_name, SkillUsageEvent::Use)?;
        let skill_path = self.resolve_skill(skill_name)?;
        let content =
            preprocess_skill_content_with_config(&view.content, &skill_path, session_id, config)
                .await;
        Ok(build_skill_message(skill_name, &content, user_instruction))
    }
}
