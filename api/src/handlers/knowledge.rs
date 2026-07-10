//! Knowledge Base / Wiki HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::knowledge::{
    AttachKnowledgeResourceRequest, CreateKnowledgeArticleRequest, KnowledgeArticleResponse,
    KnowledgeBreadcrumbResponse, KnowledgeFlatQuery, KnowledgeListResponse, KnowledgeResource,
    KnowledgeResourcesResponse, KnowledgeSearchQuery, KnowledgeTreeQuery, KnowledgeTreeResponse,
    MoveKnowledgeArticleRequest, UpdateKnowledgeArticleRequest,
};
use crate::models::project::DeleteResponse;
use crate::services::knowledge as knowledge_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/knowledge", get(list_tree).post(create))
        .route("/api/knowledge/flat", get(list_flat))
        .route("/api/knowledge/search", get(search))
        .route(
            "/api/knowledge/{id}",
            get(get_by_id).patch(update).delete(delete),
        )
        .route("/api/knowledge/{id}/children", get(get_children))
        .route("/api/knowledge/{id}/breadcrumb", get(get_breadcrumb))
        .route("/api/knowledge/{id}/move", patch(move_node))
        .route(
            "/api/knowledge/{id}/resources",
            get(list_resources).post(attach_resource),
        )
        .route(
            "/api/knowledge/{id}/resources/{resource_id}",
            axum::routing::delete(detach_resource),
        )
}

async fn list_resources(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<KnowledgeResourcesResponse>> {
    Ok(Json(knowledge_service::list_resources(&state, id).await?))
}

async fn attach_resource(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(request): Json<AttachKnowledgeResourceRequest>,
) -> AppResult<Json<KnowledgeResource>> {
    Ok(Json(
        knowledge_service::attach_resource(&state, id, request).await?,
    ))
}

async fn detach_resource(
    State(state): State<Arc<AppState>>,
    Path((id, resource_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<DeleteResponse>> {
    let success = knowledge_service::detach_resource(&state, id, resource_id).await?;
    Ok(Json(DeleteResponse { success }))
}

pub async fn list_tree(
    State(state): State<Arc<AppState>>,
    Query(q): Query<KnowledgeTreeQuery>,
) -> AppResult<Json<KnowledgeTreeResponse>> {
    Ok(Json(knowledge_service::list_tree(&state, q).await?))
}

pub async fn list_flat(
    State(state): State<Arc<AppState>>,
    Query(q): Query<KnowledgeFlatQuery>,
) -> AppResult<Json<KnowledgeListResponse>> {
    Ok(Json(knowledge_service::list_flat(&state, q).await?))
}

pub async fn search(
    State(state): State<Arc<AppState>>,
    Query(q): Query<KnowledgeSearchQuery>,
) -> AppResult<Json<KnowledgeListResponse>> {
    Ok(Json(knowledge_service::search(&state, q).await?))
}

pub async fn get_by_id(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<KnowledgeArticleResponse>> {
    Ok(Json(knowledge_service::get_by_id(&state, id).await?))
}

pub async fn get_children(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<KnowledgeListResponse>> {
    Ok(Json(knowledge_service::get_children(&state, id).await?))
}

pub async fn get_breadcrumb(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<KnowledgeBreadcrumbResponse>> {
    Ok(Json(knowledge_service::get_breadcrumb(&state, id).await?))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateKnowledgeArticleRequest>,
) -> AppResult<Json<KnowledgeArticleResponse>> {
    Ok(Json(knowledge_service::create(&state, req).await?))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateKnowledgeArticleRequest>,
) -> AppResult<Json<KnowledgeArticleResponse>> {
    Ok(Json(knowledge_service::update(&state, id, req).await?))
}

pub async fn move_node(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<MoveKnowledgeArticleRequest>,
) -> AppResult<Json<KnowledgeArticleResponse>> {
    Ok(Json(knowledge_service::move_node(&state, id, req).await?))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = knowledge_service::delete(&state, id).await?;
    Ok(Json(DeleteResponse { success }))
}
