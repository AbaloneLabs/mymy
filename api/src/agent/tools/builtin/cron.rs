//! Cron job management tool.
//!
//! The first native cron layer is intentionally explicit: jobs can be created,
//! inspected, paused, resumed, removed, and marked for manual trigger, while
//! background execution is left to the scheduler service layer. This keeps
//! autonomous work visible through the scheduler's persisted job records.

use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use serde_json::Value;

use super::BuiltinToolConfig;
use crate::agent::scheduler::{
    compute_next_run, jobs_path, parse_schedule, CronJob, CronStore, JobMode, Schedule,
};
use crate::agent::security::{scan_for_threats, ThreatScope};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    registry.register(ToolEntry {
        name: "cronjob".to_string(),
        toolset: "cron".to_string(),
        schema: tool_schema(
            "cronjob",
            "Manage scheduled native agent jobs. Background execution is controlled by the scheduler service.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["list", "create", "update", "pause", "resume", "remove", "trigger", "mark_run", "due", "referenced_skills", "blueprints", "instantiate_blueprint"] },
                    "id": { "type": "string" },
                    "blueprint": { "type": "string" },
                    "values": { "type": "object" },
                    "title": { "type": "string" },
                    "prompt": { "type": "string" },
                    "schedule": { "type": "string", "description": "RFC3339, duration like 30m, or interval like every 2h." },
                    "mode": { "type": "string", "enum": ["agent", "no_agent"], "default": "agent" },
                    "max_runs": { "type": "integer", "minimum": 1 },
                    "enabled": { "type": "boolean" },
                    "skills": { "type": "array", "items": { "type": "string" } },
                    "context_from": { "type": "array", "items": { "type": "string" } },
                    "wake_agent": { "type": "boolean", "default": true }
                },
                "required": ["action"]
            }),
        ),
        handler: Arc::new(CronTool {
            store: CronStore::new(jobs_path(&config.agent_data_dir)),
        }),
    });
}

struct CronTool {
    store: CronStore,
}

#[async_trait]
impl ToolHandler for CronTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let action = required_str(args, "action")?;
        let now = Utc::now();
        match action {
            "list" => Ok(tool_result(&serde_json::json!({
                "success": true,
                "jobs": self.store.load().map_err(to_execution)?,
            }))),
            "due" => Ok(tool_result(&serde_json::json!({
                "success": true,
                "jobs": self.store.due_jobs(now).map_err(to_execution)?,
            }))),
            "referenced_skills" => Ok(tool_result(&serde_json::json!({
                "success": true,
                "skills": self.store.referenced_skill_names().map_err(to_execution)?,
            }))),
            "blueprints" => Ok(tool_result(&serde_json::json!({
                "success": true,
                "blueprints": crate::services::cron::builtin_blueprints(),
            }))),
            "instantiate_blueprint" => {
                let blueprint_key = required_str(args, "blueprint")?;
                let blueprint = crate::services::cron::builtin_blueprints()
                    .into_iter()
                    .find(|blueprint| blueprint.key == blueprint_key)
                    .ok_or_else(|| {
                        ToolError::InvalidArgs(format!("blueprint not found: {blueprint_key}"))
                    })?;
                let values = args
                    .get("values")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                let prompt = crate::services::cron::instantiate_blueprint_prompt(
                    blueprint.prompt_template,
                    &values,
                );
                ensure_prompt_safe(&prompt)?;
                let schedule =
                    parse_schedule(blueprint.default_schedule, now).ok_or_else(|| {
                        ToolError::InvalidArgs("invalid blueprint schedule".to_string())
                    })?;
                let job = CronJob {
                    id: args
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_default(),
                    title: args
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or(blueprint.title)
                        .trim()
                        .to_string(),
                    prompt,
                    next_run_at: compute_next_run(&schedule, now),
                    schedule,
                    mode: JobMode::Agent,
                    enabled: args.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                    run_count: 0,
                    max_runs: None,
                    skills: blueprint
                        .suggested_skills
                        .iter()
                        .map(|skill| (*skill).to_string())
                        .collect(),
                    context_from: None,
                    wake_agent: true,
                };
                self.store.upsert(job).map_err(to_execution)?;
                Ok(tool_result(&serde_json::json!({ "success": true })))
            }
            "create" => {
                let prompt = required_str(args, "prompt")?;
                ensure_prompt_safe(prompt)?;
                let schedule_text = required_str(args, "schedule")?;
                let schedule = parse_schedule(schedule_text, now)
                    .ok_or_else(|| ToolError::InvalidArgs("invalid schedule".to_string()))?;
                let max_runs = args
                    .get("max_runs")
                    .and_then(Value::as_u64)
                    .map(|value| value as u32);
                let max_runs =
                    max_runs.or_else(|| matches!(schedule, Schedule::Once { .. }).then_some(1));
                let next_run_at = compute_next_run(&schedule, now);
                let job = CronJob {
                    id: args
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_default(),
                    title: args
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("Scheduled agent job")
                        .trim()
                        .to_string(),
                    prompt: prompt.trim().to_string(),
                    schedule,
                    mode: parse_mode(args.get("mode").and_then(Value::as_str).unwrap_or("agent"))?,
                    enabled: args.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                    next_run_at,
                    run_count: 0,
                    max_runs,
                    skills: parse_string_array(args.get("skills")),
                    context_from: parse_optional_string_array(args.get("context_from")),
                    wake_agent: args
                        .get("wake_agent")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                };
                self.store.upsert(job).map_err(to_execution)?;
                Ok(tool_result(&serde_json::json!({ "success": true })))
            }
            "update" => {
                let id = required_str(args, "id")?;
                let mut jobs = self.store.load().map_err(to_execution)?;
                let Some(job) = jobs.iter_mut().find(|job| job.id == id) else {
                    return Err(ToolError::InvalidArgs(format!("job not found: {id}")));
                };
                if let Some(title) = args.get("title").and_then(Value::as_str) {
                    job.title = title.trim().to_string();
                }
                if let Some(prompt) = args.get("prompt").and_then(Value::as_str) {
                    ensure_prompt_safe(prompt)?;
                    job.prompt = prompt.trim().to_string();
                }
                if let Some(schedule_text) = args.get("schedule").and_then(Value::as_str) {
                    let schedule = parse_schedule(schedule_text, now)
                        .ok_or_else(|| ToolError::InvalidArgs("invalid schedule".to_string()))?;
                    job.next_run_at = compute_next_run(&schedule, now);
                    job.schedule = schedule;
                }
                if let Some(mode) = args.get("mode").and_then(Value::as_str) {
                    job.mode = parse_mode(mode)?;
                }
                if let Some(enabled) = args.get("enabled").and_then(Value::as_bool) {
                    job.enabled = enabled;
                }
                if let Some(max_runs) = args.get("max_runs").and_then(Value::as_u64) {
                    job.max_runs = Some(max_runs as u32);
                }
                if args.get("skills").is_some() {
                    job.skills = parse_string_array(args.get("skills"));
                }
                if args.get("context_from").is_some() {
                    job.context_from = parse_optional_string_array(args.get("context_from"));
                }
                if let Some(wake_agent) = args.get("wake_agent").and_then(Value::as_bool) {
                    job.wake_agent = wake_agent;
                }
                let updated = job.clone();
                self.store.save(&jobs).map_err(to_execution)?;
                Ok(tool_result(&serde_json::json!({
                    "success": true,
                    "job": updated
                })))
            }
            "pause" | "resume" | "trigger" | "mark_run" | "remove" => {
                let id = required_str(args, "id")?;
                if action == "mark_run" {
                    self.store.mark_run(id, now).map_err(to_execution)?;
                    return Ok(tool_result(&serde_json::json!({
                        "success": true,
                        "marked_run": id
                    })));
                }
                let mut jobs = self.store.load().map_err(to_execution)?;
                let before = jobs.len();
                if action == "remove" {
                    jobs.retain(|job| job.id != id);
                    self.store.save(&jobs).map_err(to_execution)?;
                    return Ok(tool_result(&serde_json::json!({
                        "success": before != jobs.len(),
                        "removed": id
                    })));
                }
                let Some(job) = jobs.iter_mut().find(|job| job.id == id) else {
                    return Err(ToolError::InvalidArgs(format!("job not found: {id}")));
                };
                match action {
                    "pause" => job.enabled = false,
                    "resume" => job.enabled = true,
                    "trigger" => {
                        job.enabled = true;
                        job.next_run_at = now;
                    }
                    _ => {}
                }
                let updated = job.clone();
                self.store.save(&jobs).map_err(to_execution)?;
                Ok(tool_result(&serde_json::json!({
                    "success": true,
                    "job": updated
                })))
            }
            _ => Err(ToolError::InvalidArgs("invalid action".to_string())),
        }
    }
}

fn ensure_prompt_safe(prompt: &str) -> Result<(), ToolError> {
    let findings = scan_for_threats(prompt, ThreatScope::Strict);
    if findings.is_empty() {
        return Ok(());
    }
    let ids = findings
        .into_iter()
        .map(|finding| finding.pattern_id)
        .collect::<Vec<_>>()
        .join(", ");
    Err(ToolError::Unavailable(format!(
        "cron prompt blocked by security scan: {ids}"
    )))
}

fn parse_mode(value: &str) -> Result<JobMode, ToolError> {
    match value {
        "agent" => Ok(JobMode::Agent),
        "no_agent" => Ok(JobMode::NoAgent),
        _ => Err(ToolError::InvalidArgs("invalid mode".to_string())),
    }
}

fn parse_string_array(value: Option<&Value>) -> Vec<String> {
    let mut items = value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| {
                    !item.is_empty()
                        && !item.contains('/')
                        && !item.contains('\\')
                        && !item.contains("..")
                })
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    items.sort();
    items.dedup();
    items
}

fn parse_optional_string_array(value: Option<&Value>) -> Option<Vec<String>> {
    let items = parse_string_array(value);
    (!items.is_empty()).then_some(items)
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
}

fn to_execution(err: std::io::Error) -> ToolError {
    ToolError::Execution(format!("cron store failed: {err}"))
}
