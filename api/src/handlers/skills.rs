//! Native skill and skill-bundle HTTP API.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};

use crate::error::AppResult;
use crate::services::skills::{
    self as skills_service, DeleteSkillBundleResponse, PreprocessPreviewRequest,
    PreprocessPreviewResponse, SaveSkillBundleRequest, SkillBundleResponse, SkillBundlesResponse,
    SkillResponse, SkillsConfigResponse, SkillsResponse, UpdateSkillsConfigRequest,
};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/skills", get(list_skills))
        .route("/api/skills/config", get(get_config).put(update_config))
        .route("/api/skills/preprocess-preview", post(preprocess_preview))
        .route("/api/skills/bundles", get(list_bundles).post(create_bundle))
        .route(
            "/api/skills/bundles/{name}",
            get(get_bundle).put(update_bundle).delete(delete_bundle),
        )
        .route("/api/skills/{name}", get(get_skill))
}

pub async fn list_skills(State(state): State<Arc<AppState>>) -> AppResult<Json<SkillsResponse>> {
    Ok(Json(skills_service::list_skills(&state).await?))
}

pub async fn get_skill(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<SkillResponse>> {
    Ok(Json(skills_service::get_skill(&state, &name).await?))
}

pub async fn list_bundles(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<SkillBundlesResponse>> {
    Ok(Json(skills_service::list_bundles(&state).await?))
}

pub async fn get_bundle(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<SkillBundleResponse>> {
    Ok(Json(skills_service::get_bundle(&state, &name).await?))
}

pub async fn create_bundle(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SaveSkillBundleRequest>,
) -> AppResult<Json<SkillBundlesResponse>> {
    Ok(Json(skills_service::create_bundle(&state, req).await?))
}

pub async fn update_bundle(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<SaveSkillBundleRequest>,
) -> AppResult<Json<SkillBundlesResponse>> {
    Ok(Json(
        skills_service::update_bundle(&state, &name, req).await?,
    ))
}

pub async fn delete_bundle(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<DeleteSkillBundleResponse>> {
    Ok(Json(skills_service::delete_bundle(&state, &name).await?))
}

pub async fn get_config(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<SkillsConfigResponse>> {
    Ok(Json(skills_service::get_config(&state).await?))
}

pub async fn update_config(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateSkillsConfigRequest>,
) -> AppResult<Json<SkillsConfigResponse>> {
    Ok(Json(skills_service::update_config(&state, req).await?))
}

pub async fn preprocess_preview(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreprocessPreviewRequest>,
) -> AppResult<Json<PreprocessPreviewResponse>> {
    Ok(Json(skills_service::preprocess_preview(&state, req).await?))
}
