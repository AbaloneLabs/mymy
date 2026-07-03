//! Drive HTTP handlers.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, HeaderValue};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};

use crate::error::AppResult;
use crate::models::drive::{
    CreateDriveFolderRequest, DriveFileResponse, DriveListResponse, DriveMutationResponse,
    DrivePathQuery, DriveProvidersResponse, WriteDriveFileRequest,
};
use crate::services::drive as drive_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/drive", get(list_drive).delete(delete_drive_path))
        .route("/api/drive/providers", get(list_drive_providers))
        .route(
            "/api/drive/file",
            get(read_drive_file).put(write_drive_file),
        )
        .route(
            "/api/drive/folder",
            axum::routing::post(create_drive_folder),
        )
        .route("/api/drive/blob", get(read_drive_blob))
}

pub async fn list_drive_providers(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<DriveProvidersResponse>> {
    Ok(Json(drive_service::provider_status(&state)))
}

pub async fn list_drive(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DrivePathQuery>,
) -> AppResult<Json<DriveListResponse>> {
    Ok(Json(
        drive_service::list(&state, query.path.as_deref()).await?,
    ))
}

pub async fn read_drive_file(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DrivePathQuery>,
) -> AppResult<Json<DriveFileResponse>> {
    let path = query.path.unwrap_or_else(|| "/drive".to_string());
    Ok(Json(drive_service::read_file(&state, &path).await?))
}

pub async fn read_drive_blob(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DrivePathQuery>,
) -> AppResult<Response> {
    let path = query.path.unwrap_or_else(|| "/drive".to_string());
    let (blob_path, mime_type) = drive_service::blob_path(&state, &path)?;
    let bytes = tokio::fs::read(blob_path).await?;
    let content_type = HeaderValue::from_str(&mime_type)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    let mut response = Response::new(Body::from(bytes));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, content_type);
    Ok(response)
}

pub async fn write_drive_file(
    State(state): State<Arc<AppState>>,
    Json(req): Json<WriteDriveFileRequest>,
) -> AppResult<Json<DriveMutationResponse>> {
    drive_service::write_file(&state, &req.path, &req.content).await?;
    Ok(Json(DriveMutationResponse { success: true }))
}

pub async fn create_drive_folder(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateDriveFolderRequest>,
) -> AppResult<Json<DriveMutationResponse>> {
    drive_service::create_folder(&state, &req.path).await?;
    Ok(Json(DriveMutationResponse { success: true }))
}

pub async fn delete_drive_path(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DrivePathQuery>,
) -> AppResult<Json<DriveMutationResponse>> {
    let path = query.path.unwrap_or_else(|| "/drive".to_string());
    drive_service::delete_path(&state, &path).await?;
    Ok(Json(DriveMutationResponse { success: true }))
}
