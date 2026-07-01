//! Tool registry and built-in tool dispatch for the native agent runtime.
//!
//! The registry owns schemas and handlers separately from the agent loop so
//! the loop only needs the stable operations it cares about: list schemas and
//! execute a named tool. Built-in tools are registered explicitly rather than
//! through import-time side effects, which keeps startup deterministic and
//! makes high-risk toolsets easy to withhold until Phase 8 approval policies
//! are available.

pub mod builtin;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;

use crate::agent::providers::{FunctionSchema, ToolSchema};

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("invalid arguments: {0}")]
    InvalidArgs(String),
    #[error("tool execution failed: {0}")]
    Execution(String),
    #[error("resource unavailable: {0}")]
    Unavailable(String),
}

#[async_trait]
pub trait ToolHandler: Send + Sync {
    async fn execute(&self, args: &Value) -> Result<String, ToolError>;

    fn is_available(&self) -> bool {
        true
    }
}

#[derive(Clone)]
pub struct ToolEntry {
    pub name: String,
    pub toolset: String,
    pub schema: ToolSchema,
    pub handler: Arc<dyn ToolHandler>,
}

#[derive(Clone, Default)]
pub struct ToolRegistry {
    tools: HashMap<String, ToolEntry>,
    enabled_toolsets: HashSet<String>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, entry: ToolEntry) {
        if self.tools.contains_key(&entry.name) {
            tracing::warn!(tool = %entry.name, "duplicate tool registration ignored");
            return;
        }
        self.tools.insert(entry.name.clone(), entry);
    }

    pub fn enable_toolset(&mut self, toolset: &str) {
        self.enabled_toolsets.insert(toolset.to_string());
    }

    pub fn schemas(&self) -> Vec<ToolSchema> {
        let mut schemas: Vec<ToolSchema> = self
            .tools
            .values()
            .filter(|entry| self.is_enabled(entry))
            .filter(|entry| entry.handler.is_available())
            .map(|entry| entry.schema.clone())
            .collect();
        schemas.sort_by(|a, b| a.function.name.cmp(&b.function.name));
        schemas
    }

    pub fn available_tool_names(&self) -> Vec<String> {
        self.schemas()
            .into_iter()
            .map(|schema| schema.function.name)
            .collect()
    }

    pub async fn execute(&self, name: &str, arguments: &str) -> String {
        let Some(entry) = self.tools.get(name) else {
            return tool_error(&format!("unknown tool: {name}"));
        };

        if !self.is_enabled(entry) {
            return tool_error(&format!("tool is disabled: {name}"));
        }

        if !entry.handler.is_available() {
            return tool_error(&format!("tool is unavailable: {name}"));
        }

        let args: Value = match serde_json::from_str(arguments) {
            Ok(value) => value,
            Err(err) => return tool_error(&format!("invalid JSON arguments: {err}")),
        };

        match entry.handler.execute(&args).await {
            Ok(result) => result,
            Err(err) => tool_error(&err.to_string()),
        }
    }

    fn is_enabled(&self, entry: &ToolEntry) -> bool {
        self.enabled_toolsets.is_empty() || self.enabled_toolsets.contains(&entry.toolset)
    }
}

pub fn tool_schema(name: &str, description: &str, parameters: Value) -> ToolSchema {
    ToolSchema {
        tool_type: "function".to_string(),
        function: FunctionSchema {
            name: name.to_string(),
            description: Some(description.to_string()),
            parameters,
        },
    }
}

pub fn tool_result<T: Serialize>(data: &T) -> String {
    serde_json::to_string(data).unwrap_or_else(|_| "{}".to_string())
}

pub fn tool_error(message: &str) -> String {
    serde_json::json!({ "error": message }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EchoTool;

    #[async_trait]
    impl ToolHandler for EchoTool {
        async fn execute(&self, args: &Value) -> Result<String, ToolError> {
            Ok(tool_result(args))
        }
    }

    #[tokio::test]
    async fn registry_executes_registered_tool() {
        let mut registry = ToolRegistry::new();
        registry.register(ToolEntry {
            name: "echo".to_string(),
            toolset: "test".to_string(),
            schema: tool_schema("echo", "Echo args", serde_json::json!({"type":"object"})),
            handler: Arc::new(EchoTool),
        });

        let output = registry.execute("echo", r#"{"value":1}"#).await;
        assert_eq!(serde_json::from_str::<Value>(&output).unwrap()["value"], 1);
    }

    #[tokio::test]
    async fn disabled_tool_returns_json_error() {
        let mut registry = ToolRegistry::new();
        registry.enable_toolset("other");
        registry.register(ToolEntry {
            name: "echo".to_string(),
            toolset: "test".to_string(),
            schema: tool_schema("echo", "Echo args", serde_json::json!({"type":"object"})),
            handler: Arc::new(EchoTool),
        });

        let output = registry.execute("echo", "{}").await;
        assert!(serde_json::from_str::<Value>(&output).unwrap()["error"]
            .as_str()
            .unwrap()
            .contains("disabled"));
    }
}
