//! Declarative extension tools.
//!
//! Extensions are loaded from `data/agent/extensions/extensions.json`. The
//! agent cannot create executable plugins by itself; only pre-registered,
//! enabled webhook or script definitions are exposed as tools.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::{truncate_chars, BuiltinToolConfig};
use crate::agent::security::{
    detect_dangerous_command, redact_sensitive_text, redact_terminal_output, SecretString, Severity,
};
use crate::agent::tools::{
    tool_result, tool_schema, ToolCapability, ToolEntry, ToolError, ToolHandler, ToolRegistry,
};

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_OUTPUT_CHARS: usize = 20_000;

pub fn register(registry: &mut ToolRegistry, config: &BuiltinToolConfig) {
    let path = config
        .agent_data_dir
        .join("extensions")
        .join("extensions.json");
    registry.register(ToolEntry {
        name: "extensions_status".to_string(),
        toolset: "extensions".to_string(),
        schema: tool_schema(
            "extensions_status",
            "List enabled declarative extensions loaded into this runtime.",
            serde_json::json!({ "type": "object", "properties": {} }),
        ),
        capability: ToolCapability::read("extension"),
        handler: Arc::new(ExtensionsStatusTool { path: path.clone() }),
    });

    let Ok(extensions) = load_extensions(&path) else {
        return;
    };
    register_configs(registry, extensions);
}

pub fn register_configs(registry: &mut ToolRegistry, extensions: Vec<ExtensionConfig>) {
    for extension in extensions.into_iter().filter(|extension| extension.enabled) {
        match extension.settings.clone() {
            ExtensionSettings::Webhook { .. } => registry.register(ToolEntry {
                name: extension.name.clone(),
                toolset: "extensions".to_string(),
                schema: tool_schema(
                    &extension.name,
                    &extension.description,
                    extension.parameters.clone(),
                ),
                capability: ToolCapability::external("extension_webhook"),
                handler: Arc::new(WebhookExtensionTool { extension }),
            }),
            ExtensionSettings::Script { .. } => registry.register(ToolEntry {
                name: extension.name.clone(),
                toolset: "extensions".to_string(),
                schema: tool_schema(
                    &extension.name,
                    &extension.description,
                    extension.parameters.clone(),
                ),
                capability: ToolCapability::process(),
                handler: Arc::new(ScriptExtensionTool { extension }),
            }),
            ExtensionSettings::McpServer { .. } => {}
        }
    }
}

pub async fn execute_config(extension: ExtensionConfig, args: &Value) -> Result<String, ToolError> {
    match extension.settings.clone() {
        ExtensionSettings::Webhook { .. } => WebhookExtensionTool { extension }.execute(args).await,
        ExtensionSettings::Script { .. } => ScriptExtensionTool { extension }.execute(args).await,
        ExtensionSettings::McpServer { .. } => Err(ToolError::Unavailable(
            "MCP server extensions are tested through the MCP client".to_string(),
        )),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionConfig {
    pub id: uuid::Uuid,
    pub kind: ExtensionKind,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    #[serde(default = "default_parameters")]
    pub parameters: Value,
    #[serde(flatten)]
    pub settings: ExtensionSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionKind {
    Webhook,
    Script,
    McpServer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExtensionSettings {
    Webhook {
        url: String,
        #[serde(default = "default_method")]
        method: String,
        #[serde(default)]
        headers: BTreeMap<String, SecretString>,
        #[serde(default)]
        timeout_secs: Option<u64>,
    },
    Script {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        working_dir: Option<String>,
        #[serde(default)]
        timeout_secs: Option<u64>,
    },
    McpServer {
        transport: String,
        #[serde(default)]
        command: Option<String>,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        url: Option<String>,
        #[serde(default)]
        env: BTreeMap<String, SecretString>,
        #[serde(default)]
        headers: BTreeMap<String, SecretString>,
        #[serde(default)]
        timeout_secs: Option<u64>,
    },
}

struct ExtensionsStatusTool {
    path: PathBuf,
}

#[async_trait]
impl ToolHandler for ExtensionsStatusTool {
    async fn execute(&self, _args: &Value) -> Result<String, ToolError> {
        let extensions = load_extensions(&self.path)?;
        let visible = extensions
            .into_iter()
            .filter(|extension| extension.enabled)
            .map(|extension| {
                serde_json::json!({
                    "id": extension.id,
                    "name": extension.name,
                    "kind": extension.kind,
                    "description": extension.description
                })
            })
            .collect::<Vec<_>>();
        Ok(tool_result(&serde_json::json!({
            "success": true,
            "extensions": visible
        })))
    }
}

struct WebhookExtensionTool {
    extension: ExtensionConfig,
}

#[async_trait]
impl ToolHandler for WebhookExtensionTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let ExtensionSettings::Webhook {
            url,
            method,
            headers,
            timeout_secs,
        } = &self.extension.settings
        else {
            return Err(ToolError::Execution(
                "invalid webhook extension".to_string(),
            ));
        };
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(
                timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS),
            ))
            .build()
            .map_err(|err| ToolError::Execution(format!("webhook client failed: {err}")))?;
        let mut request = match method.to_ascii_uppercase().as_str() {
            "GET" => client.get(url).query(args),
            "POST" => client.post(url).json(args),
            "PUT" => client.put(url).json(args),
            _ => {
                return Err(ToolError::InvalidArgs(
                    "unsupported webhook method".to_string(),
                ))
            }
        };
        for (key, value) in headers {
            request = request.header(key, value.expose());
        }
        let response = request
            .send()
            .await
            .map_err(|err| ToolError::Execution(format!("webhook request failed: {err}")))?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .map_err(|err| ToolError::Execution(format!("webhook body failed: {err}")))?;
        Ok(tool_result(&serde_json::json!({
            "success": (200..300).contains(&status),
            "status": status,
            "body": truncate_chars(&redact_sensitive_text(&body), MAX_OUTPUT_CHARS)
        })))
    }
}

struct ScriptExtensionTool {
    extension: ExtensionConfig,
}

#[async_trait]
impl ToolHandler for ScriptExtensionTool {
    async fn execute(&self, args: &Value) -> Result<String, ToolError> {
        let ExtensionSettings::Script {
            command,
            args: script_args,
            working_dir,
            timeout_secs,
        } = &self.extension.settings
        else {
            return Err(ToolError::Execution("invalid script extension".to_string()));
        };
        let command_path = Path::new(command);
        if !command_path.is_absolute() {
            return Err(ToolError::Unavailable(
                "script extension command must be an absolute path".to_string(),
            ));
        }
        if let Some(matched) = detect_dangerous_command(command) {
            if matched.severity == Severity::Hardline {
                return Err(ToolError::Unavailable(format!(
                    "blocked: {} ({})",
                    matched.description, matched.pattern_key
                )));
            }
        }
        let mut child = Command::new(command_path)
            .args(script_args)
            .current_dir(working_dir.as_deref().unwrap_or("/"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear()
            .envs(scrubbed_env())
            .spawn()
            .map_err(|err| ToolError::Unavailable(format!("script spawn failed: {err}")))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(args.to_string().as_bytes())
                .await
                .map_err(|err| ToolError::Execution(format!("script stdin failed: {err}")))?;
        }
        let output = tokio::time::timeout(
            Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS)),
            child.wait_with_output(),
        )
        .await
        .map_err(|_| ToolError::Execution("script extension timed out".to_string()))?
        .map_err(|err| ToolError::Execution(format!("script wait failed: {err}")))?;
        Ok(tool_result(&serde_json::json!({
            "success": output.status.success(),
            "stdout": truncate_chars(&redact_terminal_output(&String::from_utf8_lossy(&output.stdout)), MAX_OUTPUT_CHARS),
            "stderr": truncate_chars(&redact_terminal_output(&String::from_utf8_lossy(&output.stderr)), MAX_OUTPUT_CHARS),
            "exit_code": output.status.code().unwrap_or(-1)
        })))
    }
}

fn load_extensions(path: &PathBuf) -> Result<Vec<ExtensionConfig>, ToolError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| ToolError::Execution(format!("extensions config read failed: {err}")))?;
    serde_json::from_str(&raw)
        .map_err(|err| ToolError::Execution(format!("extensions config parse failed: {err}")))
}

fn default_parameters() -> Value {
    serde_json::json!({ "type": "object", "properties": {} })
}

fn default_method() -> String {
    "POST".to_string()
}

fn scrubbed_env() -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for key in ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_env_does_not_include_home_or_tokens() {
        let env = scrubbed_env();
        assert!(!env.contains_key("HOME"));
        assert!(!env.keys().any(|key| key.contains("TOKEN")));
    }
}
