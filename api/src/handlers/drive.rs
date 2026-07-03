//! Drive HTTP handlers.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, HeaderValue};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use bytes::Bytes;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::drive::{
    CreateDriveFolderRequest, DriveFileResponse, DriveListResponse, DriveMutationResponse,
    DrivePathQuery, DriveProvidersResponse, DriveRestoreResponse, DriveSyncJobsResponse,
    DriveTrashResponse, DriveUploadResponse, WriteDriveFileRequest,
};
use crate::services::drive as drive_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/drive", get(list_drive).delete(delete_drive_path))
        .route("/api/drive/providers", get(list_drive_providers))
        .route("/api/drive/sync-jobs", get(list_drive_sync_jobs))
        .route("/api/drive/upload", axum::routing::post(upload_drive_file))
        .route("/api/drive/trash", get(list_drive_trash))
        .route(
            "/api/drive/trash/{id}/restore",
            axum::routing::post(restore_drive_trash),
        )
        .route(
            "/api/drive/trash/{id}",
            axum::routing::delete(purge_drive_trash),
        )
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

pub async fn list_drive_sync_jobs(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<DriveSyncJobsResponse>> {
    Ok(Json(drive_service::list_sync_jobs(&state).await?))
}

pub async fn list_drive_trash(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<DriveTrashResponse>> {
    Ok(Json(drive_service::list_trash(&state).await?))
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

pub async fn upload_drive_file(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> AppResult<Json<DriveUploadResponse>> {
    let mut target_path = "/drive".to_string();
    let mut files: Vec<(String, Bytes)> = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| AppError::BadRequest(format!("multipart upload failed: {err}")))?
    {
        match field.name().unwrap_or_default() {
            "path" => {
                target_path = field
                    .text()
                    .await
                    .map_err(|err| AppError::BadRequest(format!("upload path failed: {err}")))?;
            }
            "file" => {
                let file_name = field
                    .file_name()
                    .map(str::to_string)
                    .ok_or_else(|| AppError::BadRequest("uploaded file name is required".into()))?;
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|err| AppError::BadRequest(format!("upload file failed: {err}")))?;
                files.push((file_name, bytes));
            }
            _ => {}
        }
    }
    if files.is_empty() {
        return Err(AppError::BadRequest(
            "multipart upload must include at least one file field".into(),
        ));
    }

    let mut uploaded = Vec::new();
    for (file_name, bytes) in files {
        let response = drive_service::upload_file(&state, &target_path, &file_name, &bytes).await?;
        uploaded.extend(response.files);
    }

    Ok(Json(DriveUploadResponse {
        success: true,
        files: uploaded,
    }))
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

pub async fn restore_drive_trash(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DriveRestoreResponse>> {
    Ok(Json(drive_service::restore_trash(&state, id).await?))
}

pub async fn purge_drive_trash(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DriveMutationResponse>> {
    Ok(Json(drive_service::purge_trash(&state, id).await?))
}
