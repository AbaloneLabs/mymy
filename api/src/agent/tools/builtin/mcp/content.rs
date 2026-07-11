use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde_json::Value;

use crate::agent::security::redact_sensitive_text;
use crate::agent::tools::{app_error_to_tool, ToolError};
use crate::error::AppError;
use crate::models::content_security::ContentOrigin;
use crate::services::drive;
use crate::services::workspace_content::{AdmissionActor, AdmissionOutcome, AdmissionRequest};
use crate::state::AppState;

pub(super) async fn process_content_blocks(
    result: Value,
    _media_dir: &Path,
    state: Option<&AppState>,
    agent_profile: Option<&str>,
) -> Result<Value, ToolError> {
    let Some(blocks) = result.get("content").and_then(Value::as_array) else {
        return Ok(result);
    };
    let mut text_blocks = Vec::new();
    let mut media = Vec::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    text_blocks.push(redact_sensitive_text(text));
                }
            }
            Some("image") => {
                if let Some(data) = block.get("data").and_then(Value::as_str) {
                    let mime = block
                        .get("mimeType")
                        .or_else(|| block.get("mime_type"))
                        .and_then(Value::as_str)
                        .unwrap_or("image/png");
                    let path = cache_media_block(mime, data, state, agent_profile).await?;
                    media.push(serde_json::json!({
                        "mimeType": mime,
                        "path": path.clone(),
                        "tag": format!("MEDIA:{path}"),
                    }));
                }
            }
            _ => {}
        }
    }
    Ok(serde_json::json!({
        "content": text_blocks.join("\n"),
        "media": media,
    }))
}

pub(super) fn media_dir_for_config(path: &Path) -> PathBuf {
    path.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir)
        .join("media")
}

async fn cache_media_block(
    mime: &str,
    data: &str,
    state: Option<&AppState>,
    agent_profile: Option<&str>,
) -> Result<String, ToolError> {
    let extension = match mime {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    };
    if let Some(state) = state {
        let estimated_bytes = data.len().saturating_mul(3) / 4;
        if estimated_bytes as u64 > state.config.content_max_item_bytes() {
            return Err(ToolError::InvalidArgs(
                "MCP media exceeds the configured content limit".to_string(),
            ));
        }
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|err| ToolError::Execution(format!("MCP image decode failed: {err}")))?;
    let file_name = format!("mcp-media-{}.{}", uuid::Uuid::new_v4(), extension);
    let Some(state) = state else {
        return Err(ToolError::Unavailable(
            "MCP media admission is unavailable without application state".to_string(),
        ));
    };

    let desired_path = match agent_profile {
        Some(profile) => drive::logical_agent_file_path(profile, &file_name),
        None => format!("/drive/shared/{file_name}"),
    };
    let outcome = state
        .workspace_content
        .admit_bytes(
            state,
            AdmissionRequest {
                desired_path: desired_path.clone(),
                file_name,
                origin: ContentOrigin::ConnectorImport,
                actor: AdmissionActor::agent(agent_profile, None),
                expected_fingerprint: None,
                allow_overwrite: false,
                enqueue_s3_sync: true,
            },
            &bytes,
        )
        .await
        .map_err(app_error_to_tool)?;
    match outcome {
        AdmissionOutcome::Committed { .. } => Ok(desired_path),
        AdmissionOutcome::Quarantined { .. } => {
            Err(app_error_to_tool(AppError::content_quarantined()))
        }
        AdmissionOutcome::Rejected => Err(app_error_to_tool(AppError::content_rejected())),
    }
}
