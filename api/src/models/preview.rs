//! Preview endpoint API models.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEndpoint {
    pub id: String,
    pub agent_profile: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
    pub label: String,
    pub target_url: String,
    pub token: String,
    pub visibility: PreviewVisibility,
    pub status: PreviewStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PreviewStatus {
    Active,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PreviewVisibility {
    Session,
    Public,
}

#[derive(Debug, Serialize)]
pub struct PreviewEndpointsResponse {
    pub previews: Vec<PreviewEndpoint>,
}

#[derive(Debug, Serialize)]
pub struct PreviewEndpointResponse {
    pub preview: PreviewEndpoint,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewQuery {
    #[serde(default)]
    pub agent_profile: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePreviewEndpointRequest {
    pub agent_profile: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub label: String,
    pub target_url: String,
    #[serde(default)]
    pub visibility: Option<PreviewVisibility>,
}

#[derive(Debug, Serialize)]
pub struct DeletePreviewEndpointResponse {
    pub success: bool,
}
