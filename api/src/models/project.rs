//! Project model — mirrors frontend `Project`.
//!
//! See: web/src/types/index.ts (Project interface)

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Active,
    Archived,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitSystem {
    Github,
    Gitlab,
    Gitea,
}

/// A project workspace unit.
///
/// Serialized as camelCase to match the frontend `Project` interface
/// (gitRemote, gitSystem, createdAt, updatedAt).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_remote: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_system: Option<GitSystem>,
    pub drive_slug: String,
    pub drive_path: String,
    pub status: ProjectStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectsResponse {
    pub projects: Vec<Project>,
}

#[derive(Debug, Serialize)]
pub struct ProjectResponse {
    pub project: Project,
}

/// Payload for creating a new project.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub description: Option<String>,
    pub git_remote: Option<String>,
    pub git_system: Option<GitSystem>,
}

/// Payload for patching a project (all fields optional for partial updates).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub git_remote: Option<String>,
    pub git_system: Option<GitSystem>,
    pub status: Option<ProjectStatus>,
}

#[derive(Debug, Serialize)]
pub struct DeleteResponse {
    pub success: bool,
}
