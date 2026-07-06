//! Investment record HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::investment::{
    CreateInvestmentAccountRequest, CreateInvestmentAssetRequest, CreateInvestmentCashflowRequest,
    CreateInvestmentPositionRequest, CreateInvestmentValuationSnapshotRequest,
    CreateInvestmentWatchlistItemRequest, InvestmentAccountResponse, InvestmentAccountsResponse,
    InvestmentAssetResponse, InvestmentAssetsResponse, InvestmentCashflowResponse,
    InvestmentCashflowsResponse, InvestmentPositionResponse, InvestmentPositionsResponse,
    InvestmentSummaryResponse, InvestmentValuationSnapshotQuery,
    InvestmentValuationSnapshotResponse, InvestmentValuationSnapshotsResponse,
    InvestmentWatchlistItemResponse, InvestmentWatchlistResponse, UpdateInvestmentAccountRequest,
    UpdateInvestmentAssetRequest, UpdateInvestmentCashflowRequest, UpdateInvestmentPositionRequest,
};
use crate::models::project::DeleteResponse;
use crate::services::investments::{self as investment_service, InvestmentListQuery};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/investments/summary", get(summary))
        .route(
            "/api/investments/accounts",
            get(list_accounts).post(create_account),
        )
        .route(
            "/api/investments/accounts/{id}",
            patch(update_account).delete(delete_account),
        )
        .route(
            "/api/investments/assets",
            get(list_assets).post(create_asset),
        )
        .route(
            "/api/investments/assets/{id}",
            patch(update_asset).delete(delete_asset),
        )
        .route(
            "/api/investments/positions",
            get(list_positions).post(create_position),
        )
        .route(
            "/api/investments/positions/{id}",
            patch(update_position).delete(delete_position),
        )
        .route(
            "/api/investments/valuation-snapshots",
            get(list_valuation_snapshots).post(create_valuation_snapshot),
        )
        .route(
            "/api/investments/valuation-snapshots/{id}",
            axum::routing::delete(delete_valuation_snapshot),
        )
        .route(
            "/api/investments/cashflows",
            get(list_cashflows).post(create_cashflow),
        )
        .route(
            "/api/investments/cashflows/{id}",
            patch(update_cashflow).delete(delete_cashflow),
        )
        .route(
            "/api/investments/watchlist",
            get(list_watchlist).post(create_watchlist_item),
        )
        .route(
            "/api/investments/watchlist/{id}",
            axum::routing::delete(delete_watchlist_item),
        )
}

pub async fn summary(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<InvestmentSummaryResponse>> {
    Ok(Json(investment_service::summary(&state).await?))
}

pub async fn list_accounts(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<InvestmentAccountsResponse>> {
    Ok(Json(investment_service::list_accounts(&state).await?))
}

pub async fn create_account(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateInvestmentAccountRequest>,
) -> AppResult<Json<InvestmentAccountResponse>> {
    Ok(Json(investment_service::create_account(&state, req).await?))
}

pub async fn update_account(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateInvestmentAccountRequest>,
) -> AppResult<Json<InvestmentAccountResponse>> {
    Ok(Json(
        investment_service::update_account(&state, id, req).await?,
    ))
}

pub async fn delete_account(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    Ok(Json(DeleteResponse {
        success: investment_service::delete_account(&state, id).await?,
    }))
}

pub async fn list_assets(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<InvestmentAssetsResponse>> {
    Ok(Json(investment_service::list_assets(&state).await?))
}

pub async fn create_asset(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateInvestmentAssetRequest>,
) -> AppResult<Json<InvestmentAssetResponse>> {
    Ok(Json(investment_service::create_asset(&state, req).await?))
}

pub async fn update_asset(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateInvestmentAssetRequest>,
) -> AppResult<Json<InvestmentAssetResponse>> {
    Ok(Json(
        investment_service::update_asset(&state, id, req).await?,
    ))
}

pub async fn delete_asset(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    Ok(Json(DeleteResponse {
        success: investment_service::delete_asset(&state, id).await?,
    }))
}

pub async fn list_positions(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<InvestmentPositionsResponse>> {
    Ok(Json(investment_service::list_positions(&state).await?))
}

pub async fn create_position(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateInvestmentPositionRequest>,
) -> AppResult<Json<InvestmentPositionResponse>> {
    Ok(Json(
        investment_service::create_position(&state, req).await?,
    ))
}

pub async fn update_position(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateInvestmentPositionRequest>,
) -> AppResult<Json<InvestmentPositionResponse>> {
    Ok(Json(
        investment_service::update_position(&state, id, req).await?,
    ))
}

pub async fn delete_position(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    Ok(Json(DeleteResponse {
        success: investment_service::delete_position(&state, id).await?,
    }))
}

pub async fn list_valuation_snapshots(
    State(state): State<Arc<AppState>>,
    Query(query): Query<InvestmentValuationSnapshotQuery>,
) -> AppResult<Json<InvestmentValuationSnapshotsResponse>> {
    Ok(Json(
        investment_service::list_valuation_snapshots(&state, query).await?,
    ))
}

pub async fn create_valuation_snapshot(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateInvestmentValuationSnapshotRequest>,
) -> AppResult<Json<InvestmentValuationSnapshotResponse>> {
    Ok(Json(
        investment_service::create_valuation_snapshot(&state, req).await?,
    ))
}

pub async fn delete_valuation_snapshot(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    Ok(Json(DeleteResponse {
        success: investment_service::delete_valuation_snapshot(&state, id).await?,
    }))
}

pub async fn list_cashflows(
    State(state): State<Arc<AppState>>,
    Query(query): Query<InvestmentListQuery>,
) -> AppResult<Json<InvestmentCashflowsResponse>> {
    Ok(Json(
        investment_service::list_cashflows(&state, query).await?,
    ))
}

pub async fn create_cashflow(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateInvestmentCashflowRequest>,
) -> AppResult<Json<InvestmentCashflowResponse>> {
    Ok(Json(
        investment_service::create_cashflow(&state, req).await?,
    ))
}

pub async fn update_cashflow(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateInvestmentCashflowRequest>,
) -> AppResult<Json<InvestmentCashflowResponse>> {
    Ok(Json(
        investment_service::update_cashflow(&state, id, req).await?,
    ))
}

pub async fn delete_cashflow(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    Ok(Json(DeleteResponse {
        success: investment_service::delete_cashflow(&state, id).await?,
    }))
}

pub async fn list_watchlist(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<InvestmentWatchlistResponse>> {
    Ok(Json(investment_service::list_watchlist(&state).await?))
}

pub async fn create_watchlist_item(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateInvestmentWatchlistItemRequest>,
) -> AppResult<Json<InvestmentWatchlistItemResponse>> {
    Ok(Json(
        investment_service::create_watchlist_item(&state, req).await?,
    ))
}

pub async fn delete_watchlist_item(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    Ok(Json(DeleteResponse {
        success: investment_service::delete_watchlist_item(&state, id).await?,
    }))
}
