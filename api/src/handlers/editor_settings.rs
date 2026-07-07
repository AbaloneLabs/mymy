//! Editor settings HTTP handlers.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Multipart, Path, State};
use axum::http::{header, HeaderValue};
use axum::response::Response;
use axum::routing::{delete, get};
use axum::{Json, Router};

use crate::error::{AppError, AppResult};
use crate::models::editor_settings::{
    EditorFontMutationResponse, EditorFontUploadResponse, EditorFontsResponse,
    EditorKeymapResponse, EditorKeymapUpdateRequest, EditorPreferencesResponse,
    EditorPreferencesUpdateRequest,
};
use crate::services::editor_settings as editor_settings_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/editor-settings/fonts",
            get(list_fonts).post(upload_fonts),
        )
        .route("/api/editor-settings/fonts/{id}", delete(delete_font))
        .route("/api/editor-settings/fonts/{id}/blob", get(read_font_blob))
        .route(
            "/api/editor-settings/keymap",
            get(read_keymap).put(write_keymap),
        )
        .route(
            "/api/editor-settings/preferences",
            get(read_preferences).put(write_preferences),
        )
}

pub async fn list_fonts(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<EditorFontsResponse>> {
    Ok(Json(EditorFontsResponse {
        fonts: editor_settings_service::list_fonts(&state)?,
    }))
}

pub async fn upload_fonts(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> AppResult<Json<EditorFontUploadResponse>> {
    let mut fonts = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| AppError::BadRequest(format!("multipart upload failed: {err}")))?
    {
        if field.name().unwrap_or_default() != "file" {
            continue;
        }
        let file_name = field
            .file_name()
            .map(str::to_string)
            .ok_or_else(|| AppError::BadRequest("uploaded font name is required".into()))?;
        let bytes = field
            .bytes()
            .await
            .map_err(|err| AppError::BadRequest(format!("upload font failed: {err}")))?;
        fonts.push(editor_settings_service::upload_font(
            &state, &file_name, bytes,
        )?);
    }
    if fonts.is_empty() {
        return Err(AppError::BadRequest(
            "multipart upload must include at least one file field".into(),
        ));
    }
    Ok(Json(EditorFontUploadResponse {
        success: true,
        fonts,
    }))
}

pub async fn delete_font(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> AppResult<Json<EditorFontMutationResponse>> {
    editor_settings_service::delete_font(&state, &id)?;
    Ok(Json(EditorFontMutationResponse { success: true }))
}

pub async fn read_font_blob(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let (font_path, mime_type) = editor_settings_service::font_blob(&state, &id)?;
    let bytes = tokio::fs::read(font_path).await?;
    let content_type = HeaderValue::from_str(&mime_type)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    let mut response = Response::new(Body::from(bytes));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, content_type);
    Ok(response)
}

pub async fn read_keymap(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<EditorKeymapResponse>> {
    Ok(Json(EditorKeymapResponse {
        shortcuts: editor_settings_service::read_keymap(&state)?,
    }))
}

pub async fn write_keymap(
    State(state): State<Arc<AppState>>,
    Json(request): Json<EditorKeymapUpdateRequest>,
) -> AppResult<Json<EditorKeymapResponse>> {
    Ok(Json(EditorKeymapResponse {
        shortcuts: editor_settings_service::write_keymap(&state, request.shortcuts)?,
    }))
}

pub async fn read_preferences(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<EditorPreferencesResponse>> {
    Ok(Json(EditorPreferencesResponse {
        preferences: editor_settings_service::read_preferences(&state)?,
    }))
}

pub async fn write_preferences(
    State(state): State<Arc<AppState>>,
    Json(request): Json<EditorPreferencesUpdateRequest>,
) -> AppResult<Json<EditorPreferencesResponse>> {
    Ok(Json(EditorPreferencesResponse {
        preferences: editor_settings_service::write_preferences(&state, request.preferences)?,
    }))
}
