//! Authenticated media serving for agent-generated artifacts.
//!
//! MCP and future multimodal tools return `MEDIA:<path>` tags instead of
//! embedding binary data in chat messages. This handler serves only files that
//! live under the agent media cache roots, so a tag cannot be abused to read an
//! arbitrary local file.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::header::{CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS};
use axum::http::{HeaderValue, Response, StatusCode};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct MediaQuery {
    pub path: String,
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/media", get(get_media))
}

pub async fn get_media(
    State(state): State<Arc<AppState>>,
    Query(query): Query<MediaQuery>,
) -> AppResult<Response<Body>> {
    let requested = PathBuf::from(query.path);
    let path = std::fs::canonicalize(&requested)
        .map_err(|_| AppError::NotFound("media file not found".into()))?;
    ensure_media_path_allowed(&state.config.agent_data_dir, &path)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| AppError::NotFound("media file not found".into()))?;
    let content_type = content_type_for_path(&path);

    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, HeaderValue::from_static(content_type))
        .header(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"))
        .body(Body::from(bytes))
        .map_err(|err| AppError::Internal(format!("media response build failed: {err}")))
}

fn ensure_media_path_allowed(agent_data_dir: &Path, path: &Path) -> AppResult<()> {
    let agent_data_dir =
        std::fs::canonicalize(agent_data_dir).unwrap_or_else(|_| normalize_path(agent_data_dir));
    let roots = [
        agent_data_dir.join("mcp").join("media"),
        agent_data_dir.join("media"),
    ];
    if roots.iter().any(|root| {
        let root = std::fs::canonicalize(root).unwrap_or_else(|_| normalize_path(root));
        path.starts_with(root)
    }) {
        return Ok(());
    }
    Err(AppError::BadRequest(
        "media path is outside allowed cache roots".into(),
    ))
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "image/png",
    }
}
