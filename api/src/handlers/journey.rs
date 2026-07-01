//! Journey graph HTTP API.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};

use crate::error::AppResult;
use crate::services::journey::{
    self as journey_service, JourneyMutationResponse, JourneyQuery, JourneyResponse,
    UpdateJourneyNodeRequest,
};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/journey", get(get_journey)).route(
        "/api/journey/{node_id}",
        get(get_journey_node).put(update_node).delete(delete_node),
    )
}

pub async fn get_journey(
    State(state): State<Arc<AppState>>,
    Query(query): Query<JourneyQuery>,
) -> AppResult<Json<JourneyResponse>> {
    Ok(Json(journey_service::get_journey(&state, query).await?))
}

pub async fn get_journey_node(
    State(state): State<Arc<AppState>>,
    Path(node_id): Path<String>,
) -> AppResult<Json<JourneyResponse>> {
    Ok(Json(
        journey_service::get_journey(
            &state,
            JourneyQuery {
                node_type: None,
                sort: None,
                neighborhood: Some(node_id),
            },
        )
        .await?,
    ))
}

pub async fn update_node(
    State(state): State<Arc<AppState>>,
    Path(node_id): Path<String>,
    Json(req): Json<UpdateJourneyNodeRequest>,
) -> AppResult<Json<JourneyMutationResponse>> {
    Ok(Json(
        journey_service::update_node(&state, &node_id, req).await?,
    ))
}

pub async fn delete_node(
    State(state): State<Arc<AppState>>,
    Path(node_id): Path<String>,
) -> AppResult<Json<JourneyMutationResponse>> {
    Ok(Json(journey_service::delete_node(&state, &node_id).await?))
}
