use std::collections::HashSet;
use std::fs;

use super::*;

impl SkillRegistry {
    pub fn set_pinned(&self, name: &str, pinned: bool) -> std::io::Result<Vec<String>> {
        validate_skill_name(name)?;
        if pinned {
            let _ = self.resolve_skill(name)?;
        }
        let mut pins = self.load_pins()?;
        if pinned {
            pins.insert(name.to_string());
        } else {
            pins.remove(name);
        }
        self.save_pins(&pins)?;
        Ok(pins.into_iter().collect())
    }

    pub fn is_pinned(&self, name: &str) -> std::io::Result<bool> {
        Ok(self.load_pins()?.contains(name))
    }

    pub fn curate(
        &self,
        referenced_skills: &HashSet<String>,
        stale_days: i64,
        archive_days: i64,
    ) -> std::io::Result<SkillCuratorReport> {
        let pins = self.load_pins()?;
        let usage = self.load_usage()?;
        let mut state = self.load_curator_state()?;
        let mut report = SkillCuratorReport {
            stale: Vec::new(),
            archived: Vec::new(),
            protected: Vec::new(),
        };
        let now = chrono::Utc::now();
        for skill in self.list(None)? {
            if pins.contains(&skill.name) || referenced_skills.contains(&skill.name) {
                state.insert(
                    skill.name.clone(),
                    SkillCuratorRecord {
                        status: "protected".to_string(),
                        updated_at: now.to_rfc3339(),
                    },
                );
                report.protected.push(skill.name);
                continue;
            }
            let last_activity = usage
                .get(&skill.name)
                .and_then(last_activity_at)
                .or_else(|| skill_modified_at(&self.root.join(&skill.path)));
            let inactive_days = last_activity
                .map(|value| (now - value).num_days())
                .unwrap_or(archive_days);
            if inactive_days >= archive_days {
                let archived_path = self.delete(&skill.name, true)?;
                state.insert(
                    skill.name.clone(),
                    SkillCuratorRecord {
                        status: format!("archived:{archived_path}"),
                        updated_at: now.to_rfc3339(),
                    },
                );
                report.archived.push(skill.name);
            } else if inactive_days >= stale_days {
                state.insert(
                    skill.name.clone(),
                    SkillCuratorRecord {
                        status: "stale".to_string(),
                        updated_at: now.to_rfc3339(),
                    },
                );
                report.stale.push(skill.name);
            } else {
                state.insert(
                    skill.name.clone(),
                    SkillCuratorRecord {
                        status: "active".to_string(),
                        updated_at: now.to_rfc3339(),
                    },
                );
            }
        }
        self.save_curator_state(&state)?;
        report.stale.sort();
        report.archived.sort();
        report.protected.sort();
        Ok(report)
    }

    pub fn record_usage(&self, name: &str, event: SkillUsageEvent) -> std::io::Result<()> {
        validate_skill_name(name)?;
        fs::create_dir_all(&self.root)?;
        let path = self.root.join(".usage.json");
        let mut usage = self.load_usage()?;
        let now = chrono::Utc::now().to_rfc3339();
        let record = usage.entry(name.to_string()).or_default();
        match event {
            SkillUsageEvent::View => {
                record.view_count = record.view_count.saturating_add(1);
                record.last_viewed_at = Some(now);
            }
            SkillUsageEvent::Use => {
                record.use_count = record.use_count.saturating_add(1);
                record.last_used_at = Some(now);
            }
            SkillUsageEvent::Patch => {
                record.patch_count = record.patch_count.saturating_add(1);
                record.last_patched_at = Some(now);
            }
        }
        write_file_atomic(&path, &serde_json::to_string_pretty(&usage).unwrap())?;
        Ok(())
    }

    fn load_usage(&self) -> std::io::Result<BTreeMap<String, SkillUsageRecord>> {
        let path = self.root.join(".usage.json");
        if !path.exists() {
            return Ok(BTreeMap::new());
        }
        Ok(
            serde_json::from_str::<BTreeMap<String, SkillUsageRecord>>(&fs::read_to_string(path)?)
                .unwrap_or_default(),
        )
    }

    fn load_pins(&self) -> std::io::Result<HashSet<String>> {
        let path = self.root.join(".pinned.json");
        if !path.exists() {
            return Ok(HashSet::new());
        }
        Ok(
            serde_json::from_str::<Vec<String>>(&fs::read_to_string(path)?)
                .unwrap_or_default()
                .into_iter()
                .collect(),
        )
    }

    fn save_pins(&self, pins: &HashSet<String>) -> std::io::Result<()> {
        fs::create_dir_all(&self.root)?;
        let mut pins = pins.iter().cloned().collect::<Vec<_>>();
        pins.sort();
        write_file_atomic(
            &self.root.join(".pinned.json"),
            &serde_json::to_string_pretty(&pins).unwrap(),
        )
    }

    fn load_curator_state(&self) -> std::io::Result<BTreeMap<String, SkillCuratorRecord>> {
        let path = self.root.join(".curator.json");
        if !path.exists() {
            return Ok(BTreeMap::new());
        }
        Ok(
            serde_json::from_str::<BTreeMap<String, SkillCuratorRecord>>(&fs::read_to_string(
                path,
            )?)
            .unwrap_or_default(),
        )
    }

    fn save_curator_state(
        &self,
        state: &BTreeMap<String, SkillCuratorRecord>,
    ) -> std::io::Result<()> {
        fs::create_dir_all(&self.root)?;
        write_file_atomic(
            &self.root.join(".curator.json"),
            &serde_json::to_string_pretty(state).unwrap(),
        )
    }
}
