//! Durable cron job management tool backed by the scheduler service.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::BuiltinToolConfig;
use crate::agent::execution::ToolExecutionContext;
use crate::agent::tools::{
    tool_result, tool_schema, ToolCapability, ToolEffect, ToolEntry, ToolError, ToolHandler,
    ToolRegistry,
};
use crate::services::cron::{
    CreateCronJobRequest, InstantiateBlueprintRequest, UpdateCronJobRequest,
};
use crate::state::AppState;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    registry.register(ToolEntry {
        name: "cronjob".to_string(),
        toolset: "cron".to_string(),
        schema: cron_tool_schema(),
        capability: ToolCapability::mutation(ToolEffect::Update, "cron")
            .with_resource_argument("id"),
        handler: Arc::new(CronTool {
            state: config.app_state.clone(),
            agent_profile: config.agent_profile.clone(),
            project_id: config.project_id,
        }),
    });
}

fn cron_tool_schema() -> crate::agent::providers::ToolSchema {
    tool_schema(
        "cronjob",
        "Create or manage an exact durable schedule when the user wants future execution or delivery. Do not use it merely to remember a possible future fact. Every occurrence becomes a visible AgentRun.",
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": { "type": "string", "enum": ["list", "create", "update", "pause", "resume", "remove", "trigger", "blueprints", "instantiate_blueprint"], "description": "Cron operation to perform." },
                "id": { "type": "string", "description": "Cron job UUID required by update, pause, resume, remove, or trigger." },
                "blueprint": { "type": "string", "description": "Blueprint identifier used by instantiate_blueprint." },
                "values": { "type": "object", "description": "Template values supplied when instantiating a blueprint.", "additionalProperties": true },
                "title": { "type": "string", "description": "Human-readable cron job title." },
                "prompt": { "type": "string", "description": "Agent instruction executed for each scheduled occurrence." },
                "schedule": { "type": "string", "description": "RFC3339, duration like 30m, interval like every 2h, or a five-field cron expression." },
                "max_runs": { "type": "integer", "minimum": 1, "description": "Optional maximum number of scheduled occurrences." },
                "enabled": { "type": "boolean", "description": "Whether the schedule accepts future occurrences." },
                "skills": { "type": "array", "description": "Skill names made available to the scheduled run.", "items": { "type": "string", "description": "One registered skill name." } },
                "context_from": { "type": "array", "description": "Approved context source identifiers for the scheduled run.", "items": { "type": "string", "description": "One context source identifier." } },
                "wake_agent": { "type": "boolean", "default": true, "description": "Whether an occurrence creates an agent execution rather than result-only state." },
                "session_policy": { "type": "string", "enum": ["new", "reuse", "result_only"], "description": "Conversation-session policy for each occurrence." },
                "catch_up_policy": { "type": "string", "enum": ["skip", "latest", "all"], "description": "How missed occurrences are handled after downtime." },
                "retry_policy": { "type": "string", "enum": ["none", "safe"], "description": "Whether safely retryable failed occurrences may run again." },
                "max_tool_calls": { "type": "integer", "minimum": 1, "maximum": 1000, "description": "Maximum tool calls allowed per occurrence." },
                "max_runtime_seconds": { "type": "integer", "minimum": 1, "maximum": 86400, "description": "Maximum wall-clock runtime in seconds per occurrence." },
                "max_total_tokens": { "type": "integer", "minimum": 1000, "maximum": 2000000, "description": "Maximum model tokens consumed per occurrence." }
            },
            "required": ["action"]
        }),
    )
}

struct CronTool {
    state: Option<Arc<AppState>>,
    agent_profile: Option<String>,
    project_id: Option<uuid::Uuid>,
}

#[async_trait]
impl ToolHandler for CronTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        self.execute_inner(args, self.agent_profile.clone(), self.project_id)
            .await
    }

    async fn execute_with_context(
        &self,
        context: &ToolExecutionContext,
        args: &Value,
    ) -> Result<String, ToolError> {
        crate::services::audit::with_agent_audit_actor(
            context,
            self.execute_inner(
                args,
                Some(context.agent_profile.clone()),
                context.project_id,
            ),
        )
        .await
    }
}

impl CronTool {
    async fn execute_inner(
        &self,
        args: &Value,
        agent_profile: Option<String>,
        project_id: Option<uuid::Uuid>,
    ) -> Result<String, ToolError> {
        reject_removed_execution_mode(args)?;
        let state = self.state.as_deref().ok_or_else(|| {
            ToolError::Unavailable("durable cron service is unavailable".to_string())
        })?;
        let action = required_str(args, "action")?;
        let response = match action {
            "list" => serde_json::to_value(
                crate::services::cron::list_jobs(state)
                    .await
                    .map_err(to_tool)?,
            )
            .map_err(|err| ToolError::Execution(err.to_string()))?,
            "blueprints" => serde_json::json!({
                "blueprints": crate::services::cron::builtin_blueprints(),
            }),
            "instantiate_blueprint" => {
                let key = required_str(args, "blueprint")?;
                serde_json::to_value(
                    crate::services::cron::instantiate_blueprint(
                        state,
                        key,
                        InstantiateBlueprintRequest {
                            values: args.get("values").cloned().unwrap_or_default(),
                            title: string(args, "title"),
                            schedule: string(args, "schedule"),
                            enabled: args.get("enabled").and_then(Value::as_bool),
                            agent_profile: agent_profile.clone(),
                            project_id: project_id.map(|id| id.to_string()),
                        },
                    )
                    .await
                    .map_err(to_tool)?,
                )
                .map_err(|err| ToolError::Execution(err.to_string()))?
            }
            "create" => {
                let request = CreateCronJobRequest {
                    title: string(args, "title")
                        .unwrap_or_else(|| "Scheduled agent job".to_string()),
                    prompt: required_str(args, "prompt")?.to_string(),
                    schedule: required_str(args, "schedule")?.to_string(),
                    max_runs: args
                        .get("max_runs")
                        .and_then(Value::as_u64)
                        .and_then(|value| u32::try_from(value).ok()),
                    enabled: args.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                    skills: strings(args.get("skills")),
                    context_from: optional_strings(args.get("context_from")),
                    wake_agent: args
                        .get("wake_agent")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                    agent_profile,
                    project_id: project_id.map(|id| id.to_string()),
                    session_policy: string(args, "session_policy")
                        .unwrap_or_else(|| "new".to_string()),
                    catch_up_policy: string(args, "catch_up_policy")
                        .unwrap_or_else(|| "latest".to_string()),
                    retry_policy: string(args, "retry_policy")
                        .unwrap_or_else(|| "safe".to_string()),
                    max_tool_calls: args
                        .get("max_tool_calls")
                        .and_then(Value::as_u64)
                        .and_then(|value| u32::try_from(value).ok())
                        .unwrap_or_else(crate::agent::scheduler::default_max_tool_calls),
                    max_runtime_seconds: args
                        .get("max_runtime_seconds")
                        .and_then(Value::as_u64)
                        .and_then(|value| u32::try_from(value).ok())
                        .unwrap_or_else(crate::agent::scheduler::default_max_runtime_seconds),
                    max_total_tokens: args
                        .get("max_total_tokens")
                        .and_then(Value::as_u64)
                        .and_then(|value| u32::try_from(value).ok())
                        .unwrap_or_else(crate::agent::scheduler::default_max_total_tokens),
                };
                serde_json::to_value(
                    crate::services::cron::create_job(state, request)
                        .await
                        .map_err(to_tool)?,
                )
                .map_err(|err| ToolError::Execution(err.to_string()))?
            }
            "update" => {
                let id = required_str(args, "id")?;
                let request = UpdateCronJobRequest {
                    title: string(args, "title"),
                    prompt: string(args, "prompt"),
                    schedule: string(args, "schedule"),
                    max_runs: args
                        .get("max_runs")
                        .map(|value| value.as_u64().and_then(|number| u32::try_from(number).ok())),
                    enabled: args.get("enabled").and_then(Value::as_bool),
                    skills: args.get("skills").map(|value| strings(Some(value))),
                    context_from: args
                        .get("context_from")
                        .map(|value| optional_strings(Some(value))),
                    wake_agent: args.get("wake_agent").and_then(Value::as_bool),
                    agent_profile: None,
                    project_id: None,
                    session_policy: string(args, "session_policy"),
                    catch_up_policy: string(args, "catch_up_policy"),
                    retry_policy: string(args, "retry_policy"),
                    max_tool_calls: args
                        .get("max_tool_calls")
                        .and_then(Value::as_u64)
                        .and_then(|value| u32::try_from(value).ok()),
                    max_runtime_seconds: args
                        .get("max_runtime_seconds")
                        .and_then(Value::as_u64)
                        .and_then(|value| u32::try_from(value).ok()),
                    max_total_tokens: args
                        .get("max_total_tokens")
                        .and_then(Value::as_u64)
                        .and_then(|value| u32::try_from(value).ok()),
                };
                serde_json::to_value(
                    crate::services::cron::update_job(state, id, request)
                        .await
                        .map_err(to_tool)?,
                )
                .map_err(|err| ToolError::Execution(err.to_string()))?
            }
            "pause" => serde_json::to_value(
                crate::services::cron::pause_job(state, required_str(args, "id")?)
                    .await
                    .map_err(to_tool)?,
            )
            .map_err(|err| ToolError::Execution(err.to_string()))?,
            "resume" => serde_json::to_value(
                crate::services::cron::resume_job(state, required_str(args, "id")?)
                    .await
                    .map_err(to_tool)?,
            )
            .map_err(|err| ToolError::Execution(err.to_string()))?,
            "trigger" => serde_json::to_value(
                crate::services::cron::trigger_job(state, required_str(args, "id")?)
                    .await
                    .map_err(to_tool)?,
            )
            .map_err(|err| ToolError::Execution(err.to_string()))?,
            "remove" => serde_json::to_value(
                crate::services::cron::delete_job(state, required_str(args, "id")?)
                    .await
                    .map_err(to_tool)?,
            )
            .map_err(|err| ToolError::Execution(err.to_string()))?,
            _ => return Err(ToolError::InvalidArgs("invalid action".to_string())),
        };
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "data": response,
        })))
    }
}

fn reject_removed_execution_mode(args: &Value) -> Result<(), ToolError> {
    if args.get("mode").is_some() {
        return Err(ToolError::Unavailable(
            "cron execution mode is fixed to agent; no_agent mode has been removed".to_string(),
        ));
    }
    Ok(())
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
}

fn string(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn optional_strings(value: Option<&Value>) -> Option<Vec<String>> {
    let values = strings(value);
    (!values.is_empty()).then_some(values)
}

fn to_tool(error: crate::error::AppError) -> ToolError {
    ToolError::Execution(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_schema_exposes_no_execution_mode() {
        let schema = serde_json::to_value(cron_tool_schema()).unwrap();
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
}
