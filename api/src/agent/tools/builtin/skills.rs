//! Skill catalog and management tools.
//!
//! Skills are kept under the agent data directory instead of the project tree.
//! This lets the agent learn reusable procedures without creating untracked
//! source files in the application repository.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::BuiltinToolConfig;
use crate::agent::scheduler::{jobs_path, CronStore};
use crate::agent::skills::{
    extract_user_instruction_from_skill_message, BundleRegistry, SkillBundle, SkillRegistry,
    SkillsConfig,
};
use crate::agent::tools::{
    tool_result, tool_schema, ToolCapability, ToolEffect, ToolEntry, ToolError, ToolHandler,
    ToolRegistry,
};

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let registry_root = config.agent_data_dir.join("skills");
    let skills = Arc::new(SkillRegistry::new(registry_root));

    registry.register(ToolEntry {
        name: "skills_list".to_string(),
        toolset: "skills".to_string(),
        schema: tool_schema(
            "skills_list",
            "List available skills by name and description. Use skill_view for full content.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "category": { "type": "string" }
                }
            }),
        ),
        capability: ToolCapability::read("skill"),
        handler: Arc::new(SkillsListTool {
            skills: Arc::clone(&skills),
        }),
    });

    registry.register(ToolEntry {
        name: "skill_view".to_string(),
        toolset: "skills".to_string(),
        schema: tool_schema(
            "skill_view",
            "View a skill's SKILL.md content or one linked support file.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "file_path": { "type": "string" }
                },
                "required": ["name"]
            }),
        ),
        capability: ToolCapability::read("skill").with_resource_argument("name"),
        handler: Arc::new(SkillViewTool {
            skills: Arc::clone(&skills),
        }),
    });

    registry.register(ToolEntry {
        name: "skill_manage".to_string(),
        toolset: "skills".to_string(),
        schema: tool_schema(
            "skill_manage",
            "Create, patch, archive/delete, or edit supporting files for a local skill.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["create", "patch", "delete", "write_file", "remove_file", "pin", "unpin", "curate"] },
                    "name": { "type": "string" },
                    "category": { "type": "string" },
                    "content": { "type": "string" },
                    "old_string": { "type": "string" },
                    "new_string": { "type": "string" },
                    "file_path": { "type": "string" },
                    "archive": { "type": "boolean", "default": true },
                    "stale_days": { "type": "integer", "minimum": 1, "default": 30 },
                    "archive_days": { "type": "integer", "minimum": 1, "default": 90 }
                },
                "required": ["action"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Update, "skill")
            .with_resource_argument("name"),
        handler: Arc::new(SkillManageTool {
            skills,
            cron_store: CronStore::new(jobs_path(&config.agent_data_dir)),
        }),
    });

    let skills = Arc::new(SkillRegistry::new(config.agent_data_dir.join("skills")));
    registry.register(ToolEntry {
        name: "skill_bundle".to_string(),
        toolset: "skills".to_string(),
        schema: tool_schema(
            "skill_bundle",
            "List, create/update, invoke, or extract user instructions from skill bundles.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["list", "create", "invoke", "extract"] },
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "skills": { "type": "array", "items": { "type": "string" } },
                    "instruction": { "type": "string" },
                    "message": { "type": "string" },
                    "inline_shell": { "type": "boolean", "default": false }
                },
                "required": ["action"]
            }),
        ),
        capability: ToolCapability::mutation(ToolEffect::Update, "skill_bundle")
            .with_resource_argument("name"),
        handler: Arc::new(SkillBundleTool {
            bundles: BundleRegistry::new(
                config.agent_data_dir.join("skill-bundles"),
                (*skills).clone(),
            ),
            session_id: config
                .session_id
                .map(|id| id.to_string())
                .unwrap_or_else(|| "default".to_string()),
        }),
    });
}

struct SkillsListTool {
    skills: Arc<SkillRegistry>,
}

#[async_trait]
impl ToolHandler for SkillsListTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let category = args.get("category").and_then(Value::as_str);
        let skills = self
            .skills
            .list(category)
            .map_err(|err| ToolError::Execution(format!("skills list failed: {err}")))?;
        let categories = self
            .skills
            .categories()
            .map_err(|err| ToolError::Execution(format!("skills categories failed: {err}")))?;
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "root": self.skills.root().display().to_string(),
            "skills": skills,
            "categories": categories,
            "count": skills.len(),
            "hint": "Use skill_view(name) to inspect full instructions only when needed."
        })))
    }
}

struct SkillBundleTool {
    bundles: BundleRegistry,
    session_id: String,
}

#[async_trait]
impl ToolHandler for SkillBundleTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let action = required_str(args, "action")?;
        match action {
            "list" => {
                let bundles = self
                    .bundles
                    .list()
                    .map_err(|err| ToolError::Execution(format!("bundle list failed: {err}")))?;
                Ok(tool_result(&serde_json::json!({
                    "success": true,
                    "bundles": bundles
                })))
            }
            "create" => {
                let bundle = SkillBundle {
                    name: required_str(args, "name")?.to_string(),
                    description: args
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    skills: args
                        .get("skills")
                        .and_then(Value::as_array)
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_string)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default(),
                    instruction: args
                        .get("instruction")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                };
                self.bundles
                    .create_or_update(&bundle)
                    .map_err(|err| ToolError::Execution(format!("bundle save failed: {err}")))?;
                Ok(tool_result(&serde_json::json!({
                    "success": true,
                    "bundle": bundle
                })))
            }
            "invoke" => {
                let name = required_str(args, "name")?;
                let bundle = self
                    .bundles
                    .resolve(name)
                    .map_err(|err| ToolError::Execution(format!("bundle resolve failed: {err}")))?
                    .ok_or_else(|| ToolError::InvalidArgs(format!("bundle not found: {name}")))?;
                let config = SkillsConfig {
                    inline_shell: args
                        .get("inline_shell")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    ..SkillsConfig::default()
                };
                let message = self
                    .bundles
                    .build_invocation_message(
                        &bundle,
                        args.get("instruction")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        &self.session_id,
                        &config,
                    )
                    .await
                    .map_err(|err| ToolError::Execution(format!("bundle invoke failed: {err}")))?;
                Ok(tool_result(&serde_json::json!({
                    "success": true,
                    "bundle": bundle.name,
                    "message": message
                })))
            }
            "extract" => {
                let instruction =
                    extract_user_instruction_from_skill_message(required_str(args, "message")?);
                Ok(tool_result(&serde_json::json!({
                    "success": instruction.is_some(),
                    "instruction": instruction
                })))
            }
            _ => Err(ToolError::InvalidArgs("invalid action".to_string())),
        }
    }
}

struct SkillViewTool {
    skills: Arc<SkillRegistry>,
}

#[async_trait]
impl ToolHandler for SkillViewTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let name = required_str(args, "name")?;
        let file_path = args.get("file_path").and_then(Value::as_str);
        let view = self
            .skills
            .view(name, file_path)
            .map_err(|err| ToolError::Execution(format!("skill view failed: {err}")))?;
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "usage_hint": "To view linked files, call skill_view with name and file_path.",
            "skill": view
        })))
    }
}

struct SkillManageTool {
    skills: Arc<SkillRegistry>,
    cron_store: CronStore,
}

#[async_trait]
impl ToolHandler for SkillManageTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let action = required_str(args, "action")?;
        let result = match action {
            "create" => self
                .skills
                .create(
                    required_str(args, "name")?,
                    args.get("category").and_then(Value::as_str),
                    required_str(args, "content")?,
                )
                .map(|()| serde_json::json!({ "created": required_str(args, "name").unwrap_or("") })),
            "patch" => self
                .skills
                .patch(
                    required_str(args, "name")?,
                    required_str(args, "old_string")?,
                    required_str(args, "new_string")?,
                )
                .map(|()| serde_json::json!({ "patched": required_str(args, "name").unwrap_or("") })),
            "delete" => self
                .skills
                .delete(
                    required_str(args, "name")?,
                    args.get("archive").and_then(Value::as_bool).unwrap_or(true),
                )
                .map(|path| serde_json::json!({ "removed": required_str(args, "name").unwrap_or(""), "path": path })),
            "write_file" => self
                .skills
                .write_support_file(
                    required_str(args, "name")?,
                    required_str(args, "file_path")?,
                    required_str(args, "content")?,
                )
                .map(|path| serde_json::json!({ "written": path })),
            "remove_file" => self
                .skills
                .remove_support_file(required_str(args, "name")?, required_str(args, "file_path")?)
                .map(|path| serde_json::json!({ "removed": path })),
            "pin" => self
                .skills
                .set_pinned(required_str(args, "name")?, true)
                .map(|pins| serde_json::json!({ "pinned": required_str(args, "name").unwrap_or(""), "pins": pins })),
            "unpin" => self
                .skills
                .set_pinned(required_str(args, "name")?, false)
                .map(|pins| serde_json::json!({ "unpinned": required_str(args, "name").unwrap_or(""), "pins": pins })),
            "curate" => {
                let referenced = self
                    .cron_store
                    .referenced_skill_names()
                    .map_err(|err| ToolError::Execution(format!("cron refs failed: {err}")))?;
                let stale_days = args
                    .get("stale_days")
                    .and_then(Value::as_i64)
                    .unwrap_or(30)
                    .max(1);
                let archive_days = args
                    .get("archive_days")
                    .and_then(Value::as_i64)
                    .unwrap_or(90)
                    .max(stale_days + 1);
                self.skills
                    .curate(&referenced, stale_days, archive_days)
                    .map(|report| serde_json::json!(report))
            }
            _ => return Err(ToolError::InvalidArgs("invalid action".to_string())),
        }
        .map_err(|err| ToolError::Execution(format!("skill manage failed: {err}")))?;

        Ok(tool_result(&serde_json::json!({
            "success": true,
            "result": result
        })))
    }
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
}
