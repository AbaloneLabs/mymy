//! Project domain operations.

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::project::{
    CreateProjectRequest, GitSystem, Project, ProjectResponse, ProjectStatus, ProjectsResponse,
    UpdateProjectRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

/// A project workspace unit row.
#[derive(Debug, FromRow)]
struct ProjectRow {
    id: Uuid,
    name: String,
    description: Option<String>,
    git_remote: Option<String>,
    git_system: Option<String>,
    status: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

/// GET /api/projects
///
/// Returns all projects (active + archived), newest first.
pub async fn list_projects(state: &AppState) -> AppResult<ProjectsResponse> {
    let rows = sqlx::query_as!(
        ProjectRow,
        r#"SELECT id, name, description, git_remote, git_system, status,
                  created_at, updated_at
           FROM projects
           ORDER BY created_at DESC"#
    )
    .fetch_all(&state.db)
    .await?;

    let projects = rows.into_iter().map(row_to_project).collect();
    Ok(ProjectsResponse { projects })
}

/// GET /api/projects/{id}
///
/// Returns a single project by id.
pub async fn get_project(state: &AppState, id: Uuid) -> AppResult<ProjectResponse> {
    let row = sqlx::query_as!(
        ProjectRow,
        r#"SELECT id, name, description, git_remote, git_system, status,
                  created_at, updated_at
           FROM projects WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("project {id} not found")))?;

    Ok(ProjectResponse {
        project: row_to_project(row),
    })
}

/// POST /api/projects
pub async fn create_project(
    state: &AppState,
    req: CreateProjectRequest,
) -> AppResult<ProjectResponse> {
    let id = Uuid::new_v4();
    let git_system_str = req.git_system.map(gs_to_str);

    sqlx::query!(
        r#"INSERT INTO projects
             (id, name, description, git_remote, git_system, status)
           VALUES ($1, $2, $3, $4, $5, 'active')"#,
        id,
        req.name,
        req.description.as_deref(),
        req.git_remote.as_deref(),
        git_system_str.as_deref(),
    )
    .execute(&state.db)
    .await?;

    // Fetch back the created row.
    let row = sqlx::query_as!(
        ProjectRow,
        r#"SELECT id, name, description, git_remote, git_system, status,
                  created_at, updated_at
           FROM projects WHERE id = $1"#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    let project = row_to_project(row);

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "project",
        Some(&project.id),
        Some(serde_json::json!({ "after": { "name": project.name, "status": project.status } })),
    )
    .await;

    Ok(ProjectResponse { project })
}

/// PATCH /api/projects/{id}
///
/// Partial update via COALESCE pattern.
pub async fn update_project(
    state: &AppState,
    id: Uuid,
    req: UpdateProjectRequest,
) -> AppResult<ProjectResponse> {
    // Verify existence.
    let exists = sqlx::query!(r#"SELECT 1 AS x FROM projects WHERE id = $1"#, id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {id} not found")))?;

    let status_str = req.status.map(ps_to_str);
    let git_system_str = req.git_system.map(gs_to_str);

    sqlx::query!(
        r#"UPDATE projects SET
             name = COALESCE($2, name),
             description = COALESCE($3, description),
             git_remote = COALESCE($4, git_remote),
             git_system = COALESCE($5, git_system),
             status = COALESCE($6, status),
             updated_at = now()
           WHERE id = $1"#,
        id,
        req.name.as_deref(),
        req.description.as_deref(),
        req.git_remote.as_deref(),
        git_system_str.as_deref(),
        status_str.as_deref(),
    )
    .execute(&state.db)
    .await?;

    let row = sqlx::query_as!(
        ProjectRow,
        r#"SELECT id, name, description, git_remote, git_system, status,
                  created_at, updated_at
           FROM projects WHERE id = $1"#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    let project = row_to_project(row);

    let _ = exists;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "project",
        Some(&project.id),
        Some(serde_json::json!({ "after": { "name": project.name, "status": project.status } })),
    )
    .await;
    Ok(ProjectResponse { project })
}

/// DELETE /api/projects/{id}
pub async fn delete_project(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query!("DELETE FROM projects WHERE id = $1", id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("project {id} not found")));
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "project",
        Some(&id.to_string()),
        Some(serde_json::json!({ "before": { "id": id.to_string() } })),
    )
    .await;
    Ok(true)
}

// ---- helpers ----

/// Convert a DB row to the API model.
fn row_to_project(row: ProjectRow) -> Project {
    let status = match row.status.as_str() {
        "archived" => ProjectStatus::Archived,
        _ => ProjectStatus::Active,
    };
    let git_system = row.git_system.and_then(|s| match s.as_str() {
        "github" => Some(GitSystem::Github),
        "gitlab" => Some(GitSystem::Gitlab),
        "gitea" => Some(GitSystem::Gitea),
        _ => None,
    });

    Project {
        id: row.id.to_string(),
        name: row.name,
        description: row.description,
        git_remote: row.git_remote,
        git_system,
        status,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

fn gs_to_str(gs: GitSystem) -> &'static str {
    match gs {
        GitSystem::Github => "github",
        GitSystem::Gitlab => "gitlab",
        GitSystem::Gitea => "gitea",
    }
}

fn ps_to_str(ps: ProjectStatus) -> &'static str {
    match ps {
        ProjectStatus::Active => "active",
        ProjectStatus::Archived => "archived",
    }
}
