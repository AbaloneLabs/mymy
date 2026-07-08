use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;

use crate::agent::crypto::{self, EncryptedKey};
use crate::agent::security::SecretString;
use crate::agent::tools::ToolError;

use super::super::extensions::ExtensionSettings;
use super::DEFAULT_TIMEOUT_SECS;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct McpServerConfig {
    pub(super) name: String,
    #[serde(default)]
    pub(super) command: Option<String>,
    #[serde(default)]
    pub(super) args: Vec<String>,
    #[serde(default)]
    pub(super) url: Option<String>,
    #[serde(default)]
    pub(super) transport: Option<String>,
    #[serde(default)]
    pub(super) env: BTreeMap<String, SecretString>,
    #[serde(default)]
    pub(super) headers: BTreeMap<String, SecretString>,
    #[serde(default = "default_timeout")]
    pub(super) timeout_secs: u64,
    #[serde(default = "default_source")]
    pub(super) source: String,
}

fn default_timeout() -> u64 {
    DEFAULT_TIMEOUT_SECS
}

fn default_source() -> String {
    "file".to_string()
}

pub(super) async fn load_servers(
    path: &PathBuf,
    db: Option<&sqlx::PgPool>,
    extension_settings_key: Option<&[u8; 32]>,
) -> Result<Vec<McpServerConfig>, ToolError> {
    let mut servers = load_file_servers(path)?;
    if let Some(db) = db {
        let rows = sqlx::query(
            r#"SELECT name, settings_encrypted, settings_nonce
               FROM extensions
               WHERE kind = 'mcp_server' AND enabled = true
               ORDER BY created_at ASC"#,
        )
        .fetch_all(db)
        .await
        .map_err(|err| ToolError::Execution(format!("MCP extension config query failed: {err}")))?;
        let Some(key) = extension_settings_key else {
            if !rows.is_empty() {
                tracing::warn!(
                    "MCP extension settings require an unlocked encryption key; skipping DB MCP servers"
                );
            }
            return Ok(servers);
        };
        for row in rows {
            let name = row.get::<String, _>("name");
            let Some(ciphertext_hex) = row.get::<Option<String>, _>("settings_encrypted") else {
                tracing::warn!(server = %name, "MCP extension settings are not encrypted; skipping");
                continue;
            };
            let Some(nonce_hex) = row.get::<Option<String>, _>("settings_nonce") else {
                tracing::warn!(server = %name, "MCP extension settings nonce missing; skipping");
                continue;
            };
            let plaintext = crypto::decrypt_api_key(
                key,
                &EncryptedKey {
                    ciphertext_hex,
                    nonce_hex,
                },
            )
            .map_err(|err| ToolError::Execution(format!("MCP extension decrypt failed: {err}")))?;
            let settings = serde_json::from_str::<Value>(&plaintext).map_err(|err| {
                ToolError::Execution(format!("MCP extension settings JSON failed: {err}"))
            })?;
            if let Some(server) = config_from_extension_row(name, settings)? {
                let server_name = server.name.clone();
                if let Some(existing) = servers
                    .iter_mut()
                    .find(|existing| existing.name == server_name)
                {
                    *existing = server;
                } else {
                    servers.push(server);
                }
            }
        }
    }
    Ok(servers)
}

fn load_file_servers(path: &PathBuf) -> Result<Vec<McpServerConfig>, ToolError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| ToolError::Execution(format!("MCP config read failed: {err}")))?;
    serde_json::from_str(&raw)
        .map_err(|err| ToolError::Execution(format!("MCP config parse failed: {err}")))
}

fn config_from_extension_row(
    name: String,
    settings: Value,
) -> Result<Option<McpServerConfig>, ToolError> {
    let settings = serde_json::from_value::<ExtensionSettings>(settings).map_err(|err| {
        ToolError::Execution(format!("MCP extension settings parse failed: {err}"))
    })?;
    let ExtensionSettings::McpServer {
        transport,
        command,
        args,
        url,
        env,
        headers,
        timeout_secs,
    } = settings
    else {
        return Ok(None);
    };
    Ok(Some(McpServerConfig {
        name,
        command,
        args,
        url,
        transport: Some(transport),
        env,
        headers,
        timeout_secs: timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS),
        source: "extension".to_string(),
    }))
}

pub(super) async fn resolve_server(
    path: &PathBuf,
    db: Option<&sqlx::PgPool>,
    extension_settings_key: Option<&[u8; 32]>,
    name: &str,
) -> Result<McpServerConfig, ToolError> {
    load_servers(path, db, extension_settings_key)
        .await?
        .into_iter()
        .find(|server| server.name == name)
        .ok_or_else(|| ToolError::InvalidArgs(format!("MCP server not found: {name}")))
}

pub(super) fn filtered_env(
    configured: &BTreeMap<String, SecretString>,
) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for key in ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }
    for (key, value) in configured {
        env.insert(key.clone(), value.expose().to_string());
    }
    env
}

pub(super) fn transport_name(server: &McpServerConfig) -> &str {
    if let Some(transport) = server.transport.as_deref() {
        return transport;
    }
    if server.command.is_some() {
        "stdio"
    } else {
        "http"
    }
}
