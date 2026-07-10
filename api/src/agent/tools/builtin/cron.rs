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
    compute_next_run, jobs_path, parse_schedule, CronJob, CronStore, Schedule,
};
use crate::agent::security::{redact_sensitive_text, scan_for_threats, ThreatScope};
use crate::agent::tools::{
    tool_result, tool_schema, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};
use crate::services::audit::log_audit_safe;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    registry.register(ToolEntry {
        name: "cronjob".to_string(),
        toolset: "cron".to_string(),
        schema: cron_tool_schema(),
        handler: Arc::new(CronTool {
            store: CronStore::new(jobs_path(&config.agent_data_dir)),
            db: config.db.clone(),
            agent_profile: config.agent_profile.clone(),
        }),
    });
}

fn cron_tool_schema() -> crate::agent::providers::ToolSchema {
    tool_schema(
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
                "max_runs": { "type": "integer", "minimum": 1 },
                "enabled": { "type": "boolean" },
                "skills": { "type": "array", "items": { "type": "string" } },
                "context_from": { "type": "array", "items": { "type": "string" } },
                "wake_agent": { "type": "boolean", "default": true }
            },
            "required": ["action"]
        }),
    )
}

struct CronTool {
    store: CronStore,
    db: Option<sqlx::PgPool>,
    agent_profile: Option<String>,
}

#[async_trait]
impl ToolHandler for CronTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        reject_removed_execution_mode(args)?;
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
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                    title: args
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or(blueprint.title)
                        .trim()
                        .to_string(),
                    prompt,
                    next_run_at: compute_next_run(&schedule, now),
                    schedule,
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
                let id = job.id.clone();
                let title = job.title.clone();
                self.store.upsert(job).map_err(to_execution)?;
                self.audit("create", &id, "instantiate_blueprint", &title)
                    .await;
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
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                    title: args
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("Scheduled agent job")
                        .trim()
                        .to_string(),
                    prompt: prompt.trim().to_string(),
                    schedule,
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
                let id = job.id.clone();
                let title = job.title.clone();
                self.store.upsert(job).map_err(to_execution)?;
                self.audit("create", &id, "create", &title).await;
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
                self.audit("update", id, "update", &updated.title).await;
                Ok(tool_result(&serde_json::json!({
                    "success": true,
                    "job": updated
                })))
            }
            "pause" | "resume" | "trigger" | "mark_run" | "remove" => {
                let id = required_str(args, "id")?;
                if action == "mark_run" {
                    self.store.mark_run(id, now).map_err(to_execution)?;
                    self.audit("update", id, "mark_run", "").await;
                    return Ok(tool_result(&serde_json::json!({
                        "success": true,
                        "marked_run": id
                    })));
                }
                let mut jobs = self.store.load().map_err(to_execution)?;
                let before = jobs.len();
                if action == "remove" {
                    let title = jobs
                        .iter()
                        .find(|job| job.id == id)
                        .map(|job| job.title.clone())
                        .unwrap_or_default();
                    jobs.retain(|job| job.id != id);
                    self.store.save(&jobs).map_err(to_execution)?;
                    if before != jobs.len() {
                        self.audit("delete", id, "remove", &title).await;
                    }
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
                self.audit("update", id, action, &updated.title).await;
                Ok(tool_result(&serde_json::json!({
                    "success": true,
                    "job": updated
                })))
            }
            _ => Err(ToolError::InvalidArgs("invalid action".to_string())),
        }
    }
}

impl CronTool {
    async fn audit(&self, action: &str, id: &str, operation: &str, title: &str) {
        let Some(db) = &self.db else {
            return;
        };
        let actor_id = self
            .agent_profile
            .as_deref()
            .map(|profile| format!("agent:{profile}"))
            .unwrap_or_else(|| "agent:native".to_string());
        log_audit_safe(
            db,
            "agent",
            &actor_id,
            action,
            "cron_job",
            Some(id),
            Some(serde_json::json!({
                "operation": operation,
                "title": redact_sensitive_text(title),
            })),
        )
        .await;
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

fn reject_removed_execution_mode(args: &Value) -> Result<(), ToolError> {
    if args.get("mode").is_some() {
        return Err(ToolError::Unavailable(
            "cron execution mode is fixed to agent; no_agent mode has been removed".to_string(),
        ));
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_schema_exposes_no_execution_mode() {
        let schema = serde_json::to_value(cron_tool_schema()).unwrap();
        let properties = schema["function"]["parameters"]["properties"]
            .as_object()
            .unwrap();

        assert!(!properties.contains_key("mode"));
        assert!(!serde_json::to_string(&schema).unwrap().contains("no_agent"));
    }

    #[test]
    fn crafted_execution_mode_is_rejected_by_the_handler_guard() {
        let error = reject_removed_execution_mode(&serde_json::json!({
            "action": "create",
            "mode": "no_agent"
        }))
        .unwrap_err();

        assert!(error.to_string().contains("no_agent mode has been removed"));
    }

    #[test]
    fn normal_agent_job_arguments_need_no_mode() {
        assert!(reject_removed_execution_mode(&serde_json::json!({
            "action": "create"
        }))
        .is_ok());
    }

    #[tokio::test]
    async fn legacy_no_agent_jobs_cannot_be_updated_resumed_or_triggered() {
        let dir =
            std::env::temp_dir().join(format!("mymy-agent-cron-legacy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("jobs.json"),
            r#"[{"id":"legacy","title":"Legacy","prompt":"hidden","schedule":{"kind":"interval","seconds":60},"mode":"no_agent","enabled":false,"next_run_at":"2026-07-10T00:00:00Z","run_count":0,"max_runs":null,"skills":[],"context_from":null,"wake_agent":true}]"#,
        )
        .unwrap();
        let tool = CronTool {
            store: CronStore::new(dir.join("jobs.json")),
            db: None,
            agent_profile: None,
        };

        for action in ["update", "resume", "trigger"] {
            let error = tool
                .execute(&serde_json::json!({"action": action, "id": "legacy"}))
                .await
                .unwrap_err();
            assert!(error.to_string().contains("security quarantine"));
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn agent_cron_mutation_records_the_agent_actor(pool: sqlx::PgPool) {
        let dir =
            std::env::temp_dir().join(format!("mymy-agent-cron-audit-{}", uuid::Uuid::new_v4()));
        let tool = CronTool {
            store: CronStore::new(dir.join("jobs.json")),
            db: Some(pool.clone()),
            agent_profile: Some("security-test".to_string()),
        };

        tool.execute(&serde_json::json!({
            "action": "create",
            "title": "Agent job",
            "prompt": "Review tasks",
            "schedule": "every 1h"
        }))
        .await
        .unwrap();

        let actor = sqlx::query_scalar::<_, String>(
            r#"SELECT actor_id FROM audit_logs
               WHERE entity_type = 'cron_job' AND action = 'create'"#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(actor, "agent:security-test");
        let _ = std::fs::remove_dir_all(dir);
    }
}
