//! DB-backed native extension registry.
//!
//! The registry stores declarative webhook, script, and MCP server entries in
//! PostgreSQL. At chat-turn startup enabled webhook/script entries are converted
//! into dynamic tools; MCP server rows are configuration records consumed by the
//! MCP client layer.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::crypto::{self, EncryptedKey};
use crate::agent::tools::builtin::extensions::{
    execute_config, register_configs, ExtensionConfig, ExtensionKind, ExtensionSettings,
};
use crate::agent::tools::ToolRegistry;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ExtensionsResponse {
    pub extensions: Vec<ExtensionListItem>,
}

#[derive(Debug, Serialize)]
pub struct ExtensionListItem {
    #[serde(flatten)]
    pub config: ExtensionConfig,
    pub status: ExtensionStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStatus {
    pub state: &'static str,
    pub loaded: bool,
    pub callable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<&'static str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExtensionRequest {
    pub kind: ExtensionKind,
    pub name: String,
    pub description: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_parameters")]
    pub parameters: Value,
    #[serde(default)]
    pub settings: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateExtensionRequest {
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub parameters: Option<Value>,
    pub settings: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct DeleteExtensionResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestExtensionRequest {
    #[serde(default = "default_parameters")]
    pub args: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestExtensionResponse {
    pub success: bool,
    pub output: Value,
}

#[derive(Debug, FromRow)]
struct ExtensionRow {
    id: Uuid,
    kind: String,
    name: String,
    description: String,
    enabled: bool,
    parameters: Value,
    settings: Value,
    settings_encrypted: Option<String>,
    settings_nonce: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub async fn list_extensions(state: &AppState) -> AppResult<ExtensionsResponse> {
    let rows = sqlx::query_as!(
        ExtensionRow,
        r#"SELECT id, kind, name, description, enabled, parameters, settings,
                  settings_encrypted, settings_nonce,
                  created_at, updated_at
           FROM extensions
           ORDER BY created_at ASC"#
    )
    .fetch_all(&state.db)
    .await?;
    Ok(ExtensionsResponse {
        extensions: rows.into_iter().filter_map(row_to_public_item).collect(),
    })
}

pub async fn create_extension(
    state: &AppState,
    req: CreateExtensionRequest,
) -> AppResult<ExtensionsResponse> {
    validate_extension_name(&req.name)?;
    let settings = settings_with_type(req.kind.clone(), req.settings)?;
    let _: ExtensionSettings = serde_json::from_value(settings.clone())
        .map_err(|err| AppError::BadRequest(format!("invalid extension settings: {err}")))?;
    let key = require_encryption_key(state).await?;
    let encrypted = crypto::encrypt_api_key(&key, &settings.to_string())?;
    let display_settings = redacted_settings(&settings)?;
    sqlx::query!(
        r#"INSERT INTO extensions
           (kind, name, description, enabled, parameters, settings,
            settings_encrypted, settings_nonce)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        kind_label(&req.kind),
        req.name.trim(),
        req.description.trim(),
        req.enabled,
        req.parameters,
        display_settings,
        encrypted.ciphertext_hex,
        encrypted.nonce_hex,
    )
    .execute(&state.db)
    .await?;
    list_extensions(state).await
}

pub async fn update_extension(
    state: &AppState,
    id: Uuid,
    req: UpdateExtensionRequest,
) -> AppResult<ExtensionsResponse> {
    let existing = fetch_row(state, id).await?;
    let (settings, settings_encrypted, settings_nonce) = match req.settings {
        Some(settings) => {
            let settings = settings_with_type(parse_kind(&existing.kind)?, settings)?;
            let _: ExtensionSettings = serde_json::from_value(settings.clone()).map_err(|err| {
                AppError::BadRequest(format!("invalid extension settings: {err}"))
            })?;
            let key = require_encryption_key(state).await?;
            let encrypted = crypto::encrypt_api_key(&key, &settings.to_string())?;
            (
                Some(redacted_settings(&settings)?),
                Some(encrypted.ciphertext_hex),
                Some(encrypted.nonce_hex),
            )
        }
        None => (None, None, None),
    };
    sqlx::query!(
        r#"UPDATE extensions SET
             description = COALESCE($2, description),
             enabled = COALESCE($3, enabled),
             parameters = COALESCE($4, parameters),
             settings = COALESCE($5, settings),
             settings_encrypted = COALESCE($6, settings_encrypted),
             settings_nonce = COALESCE($7, settings_nonce),
             updated_at = now()
           WHERE id = $1"#,
        id,
        req.description.as_deref(),
        req.enabled,
        req.parameters,
        settings,
        settings_encrypted.as_deref(),
        settings_nonce.as_deref(),
    )
    .execute(&state.db)
    .await?;
    list_extensions(state).await
}

pub async fn delete_extension(state: &AppState, id: Uuid) -> AppResult<DeleteExtensionResponse> {
    let result = sqlx::query!("DELETE FROM extensions WHERE id = $1", id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("extension {id} not found")));
    }
    Ok(DeleteExtensionResponse { success: true })
}

pub async fn test_extension(
    state: &AppState,
    id: Uuid,
    req: TestExtensionRequest,
) -> AppResult<TestExtensionResponse> {
    let row = fetch_row(state, id).await?;
    let config = row_to_runtime_config(state, row, true)
        .await?
        .ok_or_else(|| AppError::Internal(format!("extension {id} could not be decoded")))?;
    let output = execute_config(config, &req.args)
        .await
        .map_err(|err| AppError::BadRequest(format!("extension test failed: {err}")))?;
    let parsed = serde_json::from_str::<Value>(&output).unwrap_or(Value::String(output));
    Ok(TestExtensionResponse {
        success: true,
        output: parsed,
    })
}

pub async fn register_runtime_extensions(
    registry: &mut ToolRegistry,
    state: &AppState,
) -> AppResult<()> {
    let rows = sqlx::query_as!(
        ExtensionRow,
        r#"SELECT id, kind, name, description, enabled, parameters, settings,
                  settings_encrypted, settings_nonce,
                  created_at, updated_at
           FROM extensions
           WHERE enabled = true
           ORDER BY created_at ASC"#
    )
    .fetch_all(&state.db)
    .await?;
    let mut configs = Vec::new();
    for row in rows {
        if let Some(config) = row_to_runtime_config(state, row, false).await? {
            configs.push(config);
        }
    }
    register_configs(registry, configs);
    Ok(())
}

async fn fetch_row(state: &AppState, id: Uuid) -> AppResult<ExtensionRow> {
    sqlx::query_as!(
        ExtensionRow,
        r#"SELECT id, kind, name, description, enabled, parameters, settings,
                  settings_encrypted, settings_nonce,
                  created_at, updated_at
           FROM extensions
           WHERE id = $1"#,
        id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("extension {id} not found")))
}

fn row_to_public_config(row: ExtensionRow) -> Option<ExtensionConfig> {
    let kind = parse_kind(&row.kind).ok()?;
    let settings = serde_json::from_value::<ExtensionSettings>(row.settings).ok()?;
    let _ = (row.created_at, row.updated_at);
    Some(ExtensionConfig {
        id: row.id,
        kind,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        parameters: row.parameters,
        settings,
    })
}

fn row_to_public_item(row: ExtensionRow) -> Option<ExtensionListItem> {
    let status = extension_status(&row);
    row_to_public_config(row).map(|config| ExtensionListItem { config, status })
}

fn extension_status(row: &ExtensionRow) -> ExtensionStatus {
    if !row.enabled {
        return ExtensionStatus {
            state: "disabled",
            loaded: false,
            callable: false,
            message: Some("extension is disabled"),
        };
    }
    if row.settings_encrypted.is_none() || row.settings_nonce.is_none() {
        return ExtensionStatus {
            state: "error",
            loaded: false,
            callable: false,
            message: Some("encrypted settings are missing"),
        };
    }
    match row.kind.as_str() {
        "webhook" | "script" => ExtensionStatus {
            state: "callable",
            loaded: true,
            callable: true,
            message: None,
        },
        "mcp_server" => ExtensionStatus {
            state: "configured",
            loaded: true,
            callable: false,
            message: Some("MCP tools are discovered by the MCP client"),
        },
        _ => ExtensionStatus {
            state: "error",
            loaded: false,
            callable: false,
            message: Some("unknown extension kind"),
        },
    }
}

async fn row_to_runtime_config(
    state: &AppState,
    row: ExtensionRow,
    require_unlocked_key: bool,
) -> AppResult<Option<ExtensionConfig>> {
    let (Some(ciphertext_hex), Some(nonce_hex)) =
        (row.settings_encrypted.clone(), row.settings_nonce.clone())
    else {
        tracing::warn!(
            extension_id = %row.id,
            extension = %row.name,
            "extension settings are not encrypted; skipping runtime registration"
        );
        return Ok(None);
    };
    let key = match state.encryption_key.read().await.as_ref().copied() {
        Some(key) => key,
        None if require_unlocked_key => {
            return Err(AppError::Unauthorized(
                "encryption key not available — please re-authenticate with your PIN".into(),
            ))
        }
        None => {
            tracing::warn!(
                extension_id = %row.id,
                extension = %row.name,
                "extension settings require an unlocked encryption key; skipping runtime registration"
            );
            return Ok(None);
        }
    };
    let plaintext = crypto::decrypt_api_key(
        &key,
        &EncryptedKey {
            ciphertext_hex,
            nonce_hex,
        },
    )?;
    let settings_value = serde_json::from_str::<Value>(&plaintext).map_err(|err| {
        AppError::Internal(format!("extension settings JSON decrypt failed: {err}"))
    })?;
    let settings = serde_json::from_value::<ExtensionSettings>(settings_value)
        .map_err(|err| AppError::Internal(format!("extension settings decode failed: {err}")))?;
    let kind = parse_kind(&row.kind)?;
    let _ = (row.created_at, row.updated_at);
    Ok(Some(ExtensionConfig {
        id: row.id,
        kind,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        parameters: row.parameters,
        settings,
    }))
}

fn settings_with_type(kind: ExtensionKind, mut settings: Value) -> AppResult<Value> {
    let type_value = kind_label(&kind).to_string();
    if settings.is_null() {
        settings = serde_json::json!({});
    }
    let Some(object) = settings.as_object_mut() else {
        return Err(AppError::BadRequest(
            "extension settings must be an object".to_string(),
        ));
    };
    object.insert("type".to_string(), Value::String(type_value));
    Ok(settings)
}

fn redacted_settings(settings: &Value) -> AppResult<Value> {
    let parsed = serde_json::from_value::<ExtensionSettings>(settings.clone())
        .map_err(|err| AppError::BadRequest(format!("invalid extension settings: {err}")))?;
    serde_json::to_value(parsed)
        .map_err(|err| AppError::Internal(format!("extension settings redaction failed: {err}")))
}

async fn require_encryption_key(state: &AppState) -> AppResult<[u8; 32]> {
    let guard = state.encryption_key.read().await;
    guard.as_ref().copied().ok_or_else(|| {
        AppError::Unauthorized(
            "encryption key not available — please re-authenticate with your PIN".into(),
        )
    })
}

fn parse_kind(value: &str) -> AppResult<ExtensionKind> {
    match value {
        "webhook" => Ok(ExtensionKind::Webhook),
        "script" => Ok(ExtensionKind::Script),
        "mcp_server" => Ok(ExtensionKind::McpServer),
        _ => Err(AppError::BadRequest("invalid extension kind".to_string())),
    }
}

fn kind_label(kind: &ExtensionKind) -> &'static str {
    match kind {
        ExtensionKind::Webhook => "webhook",
        ExtensionKind::Script => "script",
        ExtensionKind::McpServer => "mcp_server",
    }
}

fn validate_extension_name(name: &str) -> AppResult<()> {
    let trimmed = name.trim();
    let valid = !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_');
    if valid {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "extension name must be lowercase snake_case".to_string(),
        ))
    }
}

fn default_enabled() -> bool {
    true
}

fn default_parameters() -> Value {
    serde_json::json!({ "type": "object", "properties": {} })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_type_is_inserted_from_kind() {
        let settings = settings_with_type(
            ExtensionKind::Webhook,
            serde_json::json!({"url":"https://example.com"}),
        )
        .unwrap();
        assert_eq!(settings["type"], "webhook");
    }
}
