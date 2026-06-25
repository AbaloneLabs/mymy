//! Project HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::get;
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::project::{
    CreateProjectRequest, DeleteResponse, ProjectResponse, ProjectsResponse, UpdateProjectRequest,
};
use crate::services::projects as projects_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/projects", get(list_projects).post(create_project))
        .route(
            "/api/projects/{id}",
            get(get_project)
                .patch(update_project)
                .delete(delete_project),
        )
}

pub async fn list_projects(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<ProjectsResponse>> {
    Ok(Json(projects_service::list_projects(&state).await?))
}

pub async fn get_project(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ProjectResponse>> {
    Ok(Json(projects_service::get_project(&state, id).await?))
}

pub async fn create_project(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateProjectRequest>,
) -> AppResult<Json<ProjectResponse>> {
    Ok(Json(projects_service::create_project(&state, req).await?))
}

pub async fn update_project(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateProjectRequest>,
) -> AppResult<Json<ProjectResponse>> {
    Ok(Json(
        projects_service::update_project(&state, id, req).await?,
    ))
}

pub async fn delete_project(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = projects_service::delete_project(&state, id).await?;
    Ok(Json(DeleteResponse { success }))
}
