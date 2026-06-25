//! Transaction HTTP handlers.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch};
use axum::Json;
use axum::Router;
use uuid::Uuid;

use crate::error::AppResult;
use crate::models::project::DeleteResponse;
use crate::models::transaction::{
    CreateTransactionRequest, SummaryResponse, TransactionResponse, TransactionsResponse,
    UpdateTransactionRequest,
};
use crate::services::transactions::{self as transactions_service, TransactionQuery};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/transactions",
            get(list_transactions).post(create_transaction),
        )
        .route("/api/transactions/summary", get(transaction_summary))
        .route(
            "/api/transactions/{id}",
            patch(update_transaction).delete(delete_transaction),
        )
}

pub async fn list_transactions(
    State(state): State<Arc<AppState>>,
    Query(q): Query<TransactionQuery>,
) -> AppResult<Json<TransactionsResponse>> {
    Ok(Json(
        transactions_service::list_transactions(&state, q).await?,
    ))
}

pub async fn create_transaction(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTransactionRequest>,
) -> AppResult<Json<TransactionResponse>> {
    Ok(Json(
        transactions_service::create_transaction(&state, req).await?,
    ))
}

pub async fn update_transaction(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateTransactionRequest>,
) -> AppResult<Json<TransactionResponse>> {
    Ok(Json(
        transactions_service::update_transaction(&state, id, req).await?,
    ))
}

pub async fn delete_transaction(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<DeleteResponse>> {
    let success = transactions_service::delete_transaction(&state, id).await?;
    Ok(Json(DeleteResponse { success }))
}

pub async fn transaction_summary(
    State(state): State<Arc<AppState>>,
    Query(q): Query<TransactionQuery>,
) -> AppResult<Json<SummaryResponse>> {
    Ok(Json(
        transactions_service::transaction_summary(&state, q).await?,
    ))
}
