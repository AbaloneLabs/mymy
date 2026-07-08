use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde_json::Value;

use crate::agent::security::redact_sensitive_text;
use crate::agent::tools::ToolError;

pub(super) async fn process_content_blocks(
    result: Value,
    media_dir: &Path,
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
                    let path = cache_media_block(media_dir, mime, data).await?;
                    media.push(serde_json::json!({
                        "mimeType": mime,
                        "path": path.display().to_string(),
                        "tag": format!("MEDIA:{}", path.display()),
                    }));
                }
            }
            _ => {}
        }
    }
    Ok(serde_json::json!({
        "content": text_blocks.join("\n"),
        "media": media,
        "raw": result,
    }))
}

pub(super) fn media_dir_for_config(path: &Path) -> PathBuf {
    path.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir)
        .join("media")
}

async fn cache_media_block(media_dir: &Path, mime: &str, data: &str) -> Result<PathBuf, ToolError> {
    tokio::fs::create_dir_all(media_dir)
        .await
        .map_err(|err| ToolError::Execution(format!("MCP media dir create failed: {err}")))?;
    let extension = match mime {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    };
    let path = media_dir.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|err| ToolError::Execution(format!("MCP image decode failed: {err}")))?;
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|err| ToolError::Execution(format!("MCP image cache failed: {err}")))?;
    Ok(path)
}
