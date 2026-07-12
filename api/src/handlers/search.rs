//! OmniSearch HTTP handler.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::header::COOKIE;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::search::{
    SearchQuery, SearchResponse, UserWorkspaceSearchRequest, WorkspaceSearchResponse,
    WorkspaceSearchScope,
};
use crate::services::auth::{
    extract_cookie_value, recovery_scope_for_session, SESSION_COOKIE_NAME,
};
use crate::services::search as search_service;
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/search", get(search_all))
        .route("/api/search/workspace", post(search_workspace))
}

/// User OmniSearch shares the federated adapters with agent discovery while
/// deriving its durable owner and revocable browser-session boundary on the
/// server. The query stays in a POST body so normal access logs and copied URLs
/// do not retain workspace search text.
pub async fn search_workspace(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<UserWorkspaceSearchRequest>,
) -> AppResult<Json<WorkspaceSearchResponse>> {
    let token = headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|header| extract_cookie_value(header, SESSION_COOKIE_NAME))
        .ok_or_else(|| AppError::Unauthorized("authentication required".to_string()))?;
    let project_id = request
        .project_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::BadRequest("invalid projectId".to_string()))?;
    match request.scope {
        WorkspaceSearchScope::CurrentProject | WorkspaceSearchScope::CurrentPlusGlobal
            if project_id.is_none() =>
        {
            return Err(AppError::BadRequest(
                "the requested workspace search scope requires projectId".to_string(),
            ));
        }
        WorkspaceSearchScope::AllPermitted if project_id.is_some() => {
            return Err(AppError::BadRequest(
                "all_permitted workspace search must omit projectId".to_string(),
            ));
        }
        _ => {}
    }
    let principal_key = format!(
        "user:local-owner-v1:session:{}",
        recovery_scope_for_session(token)
    );
    let response = search_service::workspace_search(
        &state,
        request.into_workspace_request(),
        project_id,
        &principal_key,
        "user-omnisearch-domains-v1",
    )
    .await?;
    Ok(Json(response))
}

pub async fn search_all(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<SearchResponse>> {
    Ok(Json(search_service::search_all(&state, q).await?))
}
