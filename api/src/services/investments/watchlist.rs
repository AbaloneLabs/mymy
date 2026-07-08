use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::investment::{
    CreateInvestmentWatchlistItemRequest, InvestmentWatchlistItemResponse,
    InvestmentWatchlistResponse,
};
use crate::state::AppState;

use super::audit;
use super::records::{ensure_asset_exists, fetch_watchlist_by_asset, list_watchlist_for_pool};
use super::validation::{clean_optional, normalize_currency, parse_uuid, validate_nonnegative};

pub async fn list_watchlist(state: &AppState) -> AppResult<InvestmentWatchlistResponse> {
    Ok(InvestmentWatchlistResponse {
        watchlist: list_watchlist_for_pool(&state.db).await?,
    })
}

pub async fn create_watchlist_item(
    state: &AppState,
    req: CreateInvestmentWatchlistItemRequest,
) -> AppResult<InvestmentWatchlistItemResponse> {
    let id = Uuid::new_v4();
    let asset_id = parse_uuid(&req.asset_id, "assetId")?;
    ensure_asset_exists(state, asset_id).await?;
    if let Some(target_price) = req.target_price_amount {
        validate_nonnegative(target_price, "targetPriceAmount")?;
    }
    let currency = normalize_currency(req.currency.as_deref());
    let notes = clean_optional(req.notes).unwrap_or_default();
    sqlx::query(
        r#"INSERT INTO investment_watchlist
             (id, asset_id, target_price_amount, currency, notes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (asset_id) DO UPDATE SET
             target_price_amount = EXCLUDED.target_price_amount,
             currency = EXCLUDED.currency,
             notes = EXCLUDED.notes
           RETURNING id"#,
    )
    .bind(id)
    .bind(asset_id)
    .bind(req.target_price_amount)
    .bind(&currency)
    .bind(&notes)
    .fetch_one(&state.db)
    .await?;
    let watchlist_item = fetch_watchlist_by_asset(state, asset_id).await?;
    audit(state, "create", "investment_watchlist", &watchlist_item.id).await;
    Ok(InvestmentWatchlistItemResponse { watchlist_item })
}

pub async fn delete_watchlist_item(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM investment_watchlist WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "investment watchlist item {id} not found"
        )));
    }
    audit(state, "delete", "investment_watchlist", &id.to_string()).await;
    Ok(true)
}
