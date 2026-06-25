//! Parsers for human-readable Hermes CLI output.

use regex::Regex;

use crate::models::agent_ops::{
    ApiKeyStatus, AuthProviderStatus, CronJob, EnvironmentInfo, SessionInfo, SkillInfo,
};

use super::types::OpsError;

pub(super) fn parse_cron_jobs(output: &str) -> Result<Vec<CronJob>, OpsError> {
    let header_re = Regex::new(r"^\s*([0-9a-f]+)\s+\[(active|paused)\]").expect("valid regex");

    let mut jobs = Vec::new();
    let mut current: Option<CronJob> = None;

    for line in output.lines() {
        if let Some(caps) = header_re.captures(line) {
            if let Some(job) = current.take() {
                jobs.push(job);
            }
            let id = caps.get(1).expect("capture group 1").as_str().to_string();
            let paused = caps.get(2).expect("capture group 2").as_str() == "paused";
            current = Some(CronJob {
                id,
                name: None,
                schedule: String::new(),
                prompt: None,
                deliver: None,
                repeat: None,
                skill: None,
                script: None,
                workdir: None,
                next_run: None,
                paused,
            });
        } else if let Some(ref mut job) = current {
            if let Some((key, value)) = parse_field_line(line) {
                apply_field(job, &key, &value);
            }
        }
    }

    if let Some(job) = current.take() {
        jobs.push(job);
    }

    Ok(jobs)
}

fn parse_field_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let colon_idx = trimmed.find(':')?;
    let key = trimmed[..colon_idx].trim().to_lowercase();
    let value = trimmed[colon_idx + 1..].trim().to_string();
    if value.is_empty() {
        return None;
    }
    Some((key, value))
}

fn apply_field(job: &mut CronJob, key: &str, value: &str) {
    match key {
        "name" => job.name = Some(value.to_string()),
        "schedule" => job.schedule = value.to_string(),
        "prompt" => job.prompt = Some(value.to_string()),
        "deliver" => job.deliver = Some(value.to_string()),
        "repeat" => job.repeat = Some(value.to_string()),
        "skill" => job.skill = Some(value.to_string()),
        "script" => job.script = Some(value.to_string()),
        "workdir" => job.workdir = Some(value.to_string()),
        "next run" | "next_run" => job.next_run = Some(value.to_string()),
        _ => {}
    }
}

pub(super) fn parse_active_job_count(output: &str) -> i32 {
    let re = Regex::new(r"(\d+)\s+active\s+job").expect("valid regex");
    if let Some(caps) = re.captures(output) {
        return caps
            .get(1)
            .and_then(|m| m.as_str().parse::<i32>().ok())
            .unwrap_or(0);
    }
    0
}

pub(super) fn parse_next_run(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Next run:") {
            let val = rest.trim();
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

pub(super) fn reconcile_cron_message(
    running: bool,
    active_jobs: i32,
    next_run: Option<&str>,
) -> Option<String> {
    if running {
        let job_word = if active_jobs == 1 { "job" } else { "jobs" };
        match next_run {
            Some(nr) => Some(format!(
                "Gateway is running — {active_jobs} active {job_word}, next run {nr}"
            )),
            None => Some(format!(
                "Gateway is running — {active_jobs} active {job_word}"
            )),
        }
    } else {
        Some("Gateway is not running — cron jobs will NOT fire".to_string())
    }
}

pub(super) fn detect_gateway_running(output: &str) -> bool {
    let lower = output.to_lowercase();
    for line in lower.lines() {
        let trimmed = line.trim();
        if !trimmed.contains("gateway") {
            continue;
        }
        if trimmed.contains("not running")
            || trimmed.contains("✗")
            || trimmed.contains("stopped")
            || trimmed.contains("down")
            || trimmed.contains("offline")
        {
            return false;
        }
        if trimmed.contains("running")
            || trimmed.contains("✓")
            || trimmed.contains("up")
            || trimmed.contains("online")
        {
            return true;
        }
    }
    false
}

pub(super) fn build_gateway_message(running: bool) -> Option<String> {
    Some(if running {
        "Gateway is running".to_string()
    } else {
        "Gateway is not running".to_string()
    })
}

pub(super) fn parse_sessions(output: &str) -> Vec<SessionInfo> {
    let id_re = Regex::new(r"(\d{8}_\d{6}_[0-9a-f]{6})").expect("valid regex");
    let mut sessions = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("Title")
            || trimmed.chars().all(|c| c == '─' || c == ' ')
        {
            continue;
        }
        let Some(caps) = id_re.captures(trimmed) else {
            continue;
        };
        let id = caps.get(1).expect("capture group 1").as_str().to_string();
        let id_start = caps.get(1).expect("capture group 1").start();
        let before_id = trimmed[..id_start].trim();
        let (rest, last_active) = split_last_active(before_id);
        let title = if rest.is_empty() || rest == "—" {
            None
        } else {
            Some(rest.to_string())
        };
        sessions.push(SessionInfo {
            id,
            title,
            preview: None,
            last_active,
        });
    }
    sessions
}

fn split_last_active(text: &str) -> (&str, Option<String>) {
    let trimmed = text.trim();
    let rel_re = Regex::new(r"(\d+[smhdwy]\s+ago)$").expect("valid regex");
    if let Some(caps) = rel_re.captures(trimmed) {
        let matched = caps.get(1).expect("capture group 1").as_str();
        let remaining = trimmed[..trimmed.len() - matched.len()].trim();
        return (remaining, Some(matched.to_string()));
    }
    let date_re = Regex::new(r"(\d{4}-\d{2}-\d{2})$").expect("valid regex");
    if let Some(caps) = date_re.captures(trimmed) {
        let matched = caps.get(1).expect("capture group 1").as_str();
        let remaining = trimmed[..trimmed.len() - matched.len()].trim();
        return (remaining, Some(matched.to_string()));
    }
    (trimmed, None)
}

pub(super) fn parse_skills(output: &str) -> Vec<SkillInfo> {
    let mut skills = Vec::new();
    for line in output.lines() {
        if !line.contains('│') {
            continue;
        }
        if line.contains("Name") && line.contains("Category") {
            continue;
        }
        let mut fields: Vec<String> = line.split('│').map(|f| f.trim().to_string()).collect();
        if fields.first().map(|s| s.is_empty()).unwrap_or(false) {
            fields.remove(0);
        }
        if fields.last().map(|s| s.is_empty()).unwrap_or(false) {
            fields.pop();
        }
        if fields.is_empty() {
            continue;
        }
        let name = fields[0].clone();
        if name.is_empty() {
            continue;
        }
        skills.push(SkillInfo {
            name,
            category: fields.get(1).filter(|s| !s.is_empty()).cloned(),
            source: fields.get(2).filter(|s| !s.is_empty()).cloned(),
            trust: fields.get(3).filter(|s| !s.is_empty()).cloned(),
            status: fields.get(4).filter(|s| !s.is_empty()).cloned(),
        });
    }
    skills
}

pub(super) fn parse_memory_status(output: &str) -> (Option<String>, bool, Vec<String>) {
    let mut provider = None;
    let mut builtin_active = true;
    let mut plugins = Vec::new();
    let mut in_plugins = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Built-in:") {
            builtin_active = rest.trim().contains("active");
        } else if let Some(rest) = trimmed.strip_prefix("Provider:") {
            let val = rest.trim();
            if !val.contains("none") {
                provider = Some(
                    val.trim_start_matches('(')
                        .trim_end_matches(')')
                        .to_string(),
                );
            }
        } else if trimmed.starts_with("Installed plugins") {
            in_plugins = true;
        } else if in_plugins {
            if let Some(rest) = trimmed.strip_prefix('•') {
                let name = rest.split_whitespace().next().unwrap_or("").to_string();
                if !name.is_empty() {
                    plugins.push(name);
                }
            } else if trimmed.is_empty() {
                in_plugins = false;
            }
        }
    }
    (provider, builtin_active, plugins)
}

pub(super) fn parse_environment(output: &str) -> EnvironmentInfo {
    let mut python = None;
    let mut model = None;
    let mut provider = None;
    let mut api_keys = Vec::new();
    let mut auth_providers = Vec::new();

    let mut section = "";
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix('◆') {
            let header = rest.trim();
            section = if header.contains("Environment") {
                "env"
            } else if header.contains("API Keys") {
                "api"
            } else if header.contains("Auth") {
                "auth"
            } else {
                ""
            };
            continue;
        }

        match section {
            "env" => {
                if let Some(rest) = trimmed.strip_prefix("Python:") {
                    python = Some(rest.trim().to_string());
                } else if let Some(rest) = trimmed.strip_prefix("Model:") {
                    model = Some(rest.trim().to_string());
                } else if let Some(rest) = trimmed.strip_prefix("Provider:") {
                    provider = Some(rest.trim().to_string());
                }
            }
            "api" => {
                if let Some((name, detail)) = parse_status_line(trimmed) {
                    let configured = detail.contains('✓') || !detail.contains("not set");
                    api_keys.push(ApiKeyStatus {
                        name,
                        configured,
                        detail: Some(detail),
                    });
                }
            }
            "auth" => {
                if let Some((name, detail)) = parse_status_line(trimmed) {
                    let logged_in = !detail.contains("not logged in") && !detail.contains("✗");
                    auth_providers.push(AuthProviderStatus {
                        name,
                        logged_in,
                        detail: Some(detail),
                    });
                }
            }
            _ => {}
        }
    }

    EnvironmentInfo {
        python,
        model,
        provider,
        api_keys,
        auth_providers,
    }
}

fn parse_status_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let marker_pos = trimmed.find('✓').or_else(|| trimmed.find('✗'))?;
    let name = trimmed[..marker_pos].trim().to_string();
    let detail = trimmed[marker_pos..].trim().to_string();
    if name.is_empty() {
        return None;
    }
    Some((name, detail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cron_jobs() {
        let output = r#"
f3a553811d9d [active]
  Name:      format-check
  Schedule:  once in 30m
  Repeat:    0/1
  Next run:  2026-06-22T06:43:02+00:00
  Deliver:   local
"#;
        let jobs = parse_cron_jobs(output).expect("cron output should parse");
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, "f3a553811d9d");
        assert_eq!(jobs[0].name.as_deref(), Some("format-check"));
        assert_eq!(jobs[0].schedule, "once in 30m");
        assert_eq!(
            jobs[0].next_run.as_deref(),
            Some("2026-06-22T06:43:02+00:00")
        );
    }

    #[test]
    fn parses_sessions_from_table_lines() {
        let output = r#"
Title            Last Active   ID
────────────────────────────────────────
Aria intro       4d ago        20260616_020911_25de81
—                2026-05-28    20260528_021126_d8f84f
"#;
        let sessions = parse_sessions(output);
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].id, "20260616_020911_25de81");
        assert_eq!(sessions[0].last_active.as_deref(), Some("4d ago"));
        assert_eq!(sessions[1].title, None);
    }

    #[test]
    fn parses_skills_table() {
        let output = "│ planner │ ops │ local │ trusted │ enabled │";
        let skills = parse_skills(output);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "planner");
        assert_eq!(skills[0].category.as_deref(), Some("ops"));
    }

    #[test]
    fn parses_environment_sections() {
        let output = r#"
◆ Environment
Python: 3.12
Model: gpt
Provider: openai
◆ API Keys
OpenAI  ✓ sk-...
◆ Auth Providers
GitHub  ✗ not logged in
"#;
        let env = parse_environment(output);
        assert_eq!(env.python.as_deref(), Some("3.12"));
        assert_eq!(env.api_keys.len(), 1);
        assert!(env.api_keys[0].configured);
        assert_eq!(env.auth_providers.len(), 1);
        assert!(!env.auth_providers[0].logged_in);
    }
}
