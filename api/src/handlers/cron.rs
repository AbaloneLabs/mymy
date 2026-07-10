//! Native cron HTTP API.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};

use crate::error::AppResult;
use crate::services::cron::{
    self as cron_service, CreateCronJobRequest, CronBlueprintsResponse, CronJobsResponse,
    CronResultsQuery, CronResultsResponse, CronStatusResponse, InstantiateBlueprintRequest,
    QuarantinedCronJobDeleteResponse, QuarantinedCronJobDetailResponse,
    QuarantinedCronJobsResponse, UpdateCronJobRequest,
};
use crate::state::AppState;
use uuid::Uuid;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/cron/jobs", get(list_jobs).post(create_job))
        .route("/api/cron/jobs/{id}", patch(update_job).delete(delete_job))
        .route("/api/cron/jobs/{id}/pause", post(pause_job))
        .route("/api/cron/jobs/{id}/resume", post(resume_job))
        .route("/api/cron/jobs/{id}/trigger", post(trigger_job))
        .route("/api/cron/status", get(status))
        .route("/api/cron/results", get(list_results))
        .route(
            "/api/cron/security/quarantined-jobs",
            get(list_quarantined_jobs),
        )
        .route(
            "/api/cron/security/quarantined-jobs/{id}",
            get(get_quarantined_job).delete(delete_quarantined_job),
        )
        .route(
            "/api/cron/security/quarantined-jobs/{id}/export",
            get(export_quarantined_job),
        )
        .route("/api/cron/blueprints", get(list_blueprints))
        .route(
            "/api/cron/blueprints/{key}/instantiate",
            post(instantiate_blueprint),
        )
}

pub async fn list_jobs(State(state): State<Arc<AppState>>) -> AppResult<Json<CronJobsResponse>> {
    Ok(Json(cron_service::list_jobs(&state).await?))
}

pub async fn create_job(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateCronJobRequest>,
) -> AppResult<Json<CronJobsResponse>> {
    Ok(Json(cron_service::create_job(&state, req).await?))
}

pub async fn pause_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> AppResult<Json<CronJobsResponse>> {
    Ok(Json(cron_service::pause_job(&state, &id).await?))
}

pub async fn update_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<UpdateCronJobRequest>,
) -> AppResult<Json<CronJobsResponse>> {
    Ok(Json(cron_service::update_job(&state, &id, req).await?))
}

pub async fn resume_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> AppResult<Json<CronJobsResponse>> {
    Ok(Json(cron_service::resume_job(&state, &id).await?))
}

pub async fn trigger_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> AppResult<Json<CronJobsResponse>> {
    Ok(Json(cron_service::trigger_job(&state, &id).await?))
}

pub async fn delete_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> AppResult<Json<CronJobsResponse>> {
    Ok(Json(cron_service::delete_job(&state, &id).await?))
}

pub async fn status(State(state): State<Arc<AppState>>) -> AppResult<Json<CronStatusResponse>> {
    Ok(Json(cron_service::status(&state).await?))
}

pub async fn list_results(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CronResultsQuery>,
) -> AppResult<Json<CronResultsResponse>> {
    Ok(Json(cron_service::list_results(&state, query).await?))
}

pub async fn list_blueprints() -> AppResult<Json<CronBlueprintsResponse>> {
    Ok(Json(cron_service::list_blueprints().await?))
}

pub async fn list_quarantined_jobs(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<QuarantinedCronJobsResponse>> {
    Ok(Json(cron_service::list_quarantined_jobs(&state).await?))
}

pub async fn get_quarantined_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<QuarantinedCronJobDetailResponse>> {
    Ok(Json(cron_service::get_quarantined_job(&state, id).await?))
}

pub async fn export_quarantined_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<QuarantinedCronJobDetailResponse>> {
    Ok(Json(
        cron_service::export_quarantined_job(&state, id).await?,
    ))
}

pub async fn delete_quarantined_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<QuarantinedCronJobDeleteResponse>> {
    Ok(Json(
        cron_service::delete_quarantined_job(&state, id).await?,
    ))
}

pub async fn instantiate_blueprint(
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
    Json(req): Json<InstantiateBlueprintRequest>,
) -> AppResult<Json<CronJobsResponse>> {
    Ok(Json(
        cron_service::instantiate_blueprint(&state, &key, req).await?,
    ))
}
