//! Drive API models.

use serde::{Deserialize, Serialize};

use crate::models::document_editor::DocumentEditorKind;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveEntry {
    pub name: String,
    pub path: String,
    pub kind: DriveEntryKind,
    pub mime_type: String,
    pub size: u64,
    pub updated_at: Option<String>,
    pub provider: DriveProviderKind,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DriveEntryKind {
    Directory,
    File,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DriveProviderKind {
    LocalVm,
    S3,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveListResponse {
    pub path: String,
    pub entries: Vec<DriveEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFileResponse {
    pub path: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub updated_at: Option<String>,
    pub content: String,
    pub editable: bool,
    pub editor_kind: DocumentEditorKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrivePathQuery {
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteDriveFileRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDriveFolderRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveDrivePathRequest {
    pub source_path: String,
    pub destination_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveDrivePathResponse {
    pub success: bool,
    pub source_path: String,
    pub destination_path: String,
}

#[derive(Debug, Serialize)]
pub struct DriveMutationResponse {
    pub success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveUploadResponse {
    pub success: bool,
    pub files: Vec<DriveEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveTrashResponse {
    pub entries: Vec<DriveTrashEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveTrashEntry {
    pub id: String,
    pub original_path: String,
    pub trash_path: String,
    pub kind: DriveEntryKind,
    pub size: u64,
    pub deleted_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveRestoreResponse {
    pub success: bool,
    pub restored_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveSyncJobsResponse {
    pub jobs: Vec<DriveSyncJob>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveSyncJob {
    pub id: String,
    pub provider: DriveProviderKind,
    pub drive_path: String,
    pub operation: DriveSyncOperation,
    pub status: DriveSyncStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DriveSyncOperation {
    Upload,
    Download,
    Delete,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DriveSyncStatus {
    Pending,
    Running,
    Failed,
    Done,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveProvidersResponse {
    pub providers: Vec<DriveProviderStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveProviderStatus {
    pub provider: DriveProviderKind,
    pub configured: bool,
    pub writable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bucket: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
}
