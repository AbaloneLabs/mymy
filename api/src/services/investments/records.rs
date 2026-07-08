use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::investment::{
    InvestmentAccount, InvestmentAsset, InvestmentCashflow, InvestmentPosition,
    InvestmentValuationSnapshot, InvestmentWatchlistItem,
};
use crate::state::AppState;

#[derive(Debug, FromRow)]
pub(super) struct AccountRow {
    id: Uuid,
    name: String,
    institution: String,
    currency: String,
    notes: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub(super) struct AssetRow {
    id: Uuid,
    symbol: String,
    name: String,
    asset_type: String,
    exchange: String,
    currency: String,
    sector: String,
    notes: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub(super) struct PositionRow {
    id: Uuid,
    account_id: Option<Uuid>,
    asset_id: Uuid,
    quantity_micro: i64,
    cost_basis_amount: i64,
    currency: String,
    opened_at: Option<DateTime<Utc>>,
    notes: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    account_name: Option<String>,
    asset_symbol: String,
    asset_name: String,
    asset_type: String,
    latest_market_value_amount: Option<i64>,
    latest_unit_price_amount: Option<i64>,
    latest_valued_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
pub(super) struct SnapshotRow {
    id: Uuid,
    position_id: Uuid,
    unit_price_amount: Option<i64>,
    market_value_amount: i64,
    currency: String,
    recorded_at: DateTime<Utc>,
    notes: String,
}

#[derive(Debug, FromRow)]
pub(super) struct CashflowRow {
    id: Uuid,
    account_id: Option<Uuid>,
    asset_id: Option<Uuid>,
    flow_type: String,
    amount: i64,
    currency: String,
    recorded_at: DateTime<Utc>,
    notes: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    account_name: Option<String>,
    asset_symbol: Option<String>,
}

#[derive(Debug, FromRow)]
pub(super) struct WatchlistRow {
    id: Uuid,
    asset_id: Uuid,
    target_price_amount: Option<i64>,
    currency: String,
    notes: String,
    created_at: DateTime<Utc>,
    asset_symbol: String,
    asset_name: String,
    asset_type: String,
}

pub(super) async fn fetch_account(state: &AppState, id: Uuid) -> AppResult<InvestmentAccount> {
    let row = sqlx::query_as::<_, AccountRow>(
        r#"SELECT id, name, institution, currency, notes, created_at, updated_at
           FROM investment_accounts
           WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("investment account {id} not found")))?;
    Ok(row_to_account(row))
}

pub(super) async fn fetch_asset(state: &AppState, id: Uuid) -> AppResult<InvestmentAsset> {
    let row = sqlx::query_as::<_, AssetRow>(
        r#"SELECT id, symbol, name, asset_type, exchange, currency, sector, notes, created_at, updated_at
           FROM investment_assets
           WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("investment asset {id} not found")))?;
    Ok(row_to_asset(row))
}

pub(super) async fn fetch_position(state: &AppState, id: Uuid) -> AppResult<InvestmentPosition> {
    fetch_positions_for_pool(&state.db, Some(id))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound(format!("investment position {id} not found")))
}

pub(super) async fn fetch_positions_for_pool(
    db: &PgPool,
    id: Option<Uuid>,
) -> AppResult<Vec<InvestmentPosition>> {
    let rows = sqlx::query_as::<_, PositionRow>(
        r#"WITH latest_values AS (
             SELECT DISTINCT ON (position_id)
                    position_id, unit_price_amount, market_value_amount, recorded_at
             FROM investment_valuation_snapshots
             ORDER BY position_id, recorded_at DESC
           )
           SELECT p.id, p.account_id, p.asset_id, p.quantity_micro, p.cost_basis_amount,
                  p.currency, p.opened_at, p.notes, p.created_at, p.updated_at,
                  acc.name AS account_name,
                  asset.symbol AS asset_symbol,
                  asset.name AS asset_name,
                  asset.asset_type AS asset_type,
                  v.market_value_amount AS latest_market_value_amount,
                  v.unit_price_amount AS latest_unit_price_amount,
                  v.recorded_at AS latest_valued_at
           FROM investment_positions p
           JOIN investment_assets asset ON asset.id = p.asset_id
           LEFT JOIN investment_accounts acc ON acc.id = p.account_id
           LEFT JOIN latest_values v ON v.position_id = p.id
           WHERE ($1::uuid IS NULL OR p.id = $1)
           ORDER BY p.updated_at DESC, p.created_at DESC"#,
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(row_to_position).collect())
}

pub(super) async fn fetch_snapshot(
    state: &AppState,
    id: Uuid,
) -> AppResult<InvestmentValuationSnapshot> {
    let row = sqlx::query_as::<_, SnapshotRow>(
        r#"SELECT id, position_id, unit_price_amount, market_value_amount, currency, recorded_at, notes
           FROM investment_valuation_snapshots
           WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("investment valuation snapshot {id} not found")))?;
    Ok(row_to_snapshot(row))
}

pub(super) async fn fetch_cashflow(state: &AppState, id: Uuid) -> AppResult<InvestmentCashflow> {
    let row = sqlx::query_as::<_, CashflowRow>(
        r#"SELECT c.id, c.account_id, c.asset_id, c.flow_type, c.amount, c.currency,
                  c.recorded_at, c.notes, c.created_at, c.updated_at,
                  a.name AS account_name,
                  asset.symbol AS asset_symbol
           FROM investment_cashflows c
           LEFT JOIN investment_accounts a ON a.id = c.account_id
           LEFT JOIN investment_assets asset ON asset.id = c.asset_id
           WHERE c.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("investment cashflow {id} not found")))?;
    Ok(row_to_cashflow(row))
}

pub(super) async fn fetch_watchlist_by_asset(
    state: &AppState,
    asset_id: Uuid,
) -> AppResult<InvestmentWatchlistItem> {
    let row = sqlx::query_as::<_, WatchlistRow>(
        r#"SELECT w.id, w.asset_id, w.target_price_amount, w.currency, w.notes, w.created_at,
                  a.symbol AS asset_symbol, a.name AS asset_name, a.asset_type AS asset_type
           FROM investment_watchlist w
           JOIN investment_assets a ON a.id = w.asset_id
           WHERE w.asset_id = $1"#,
    )
    .bind(asset_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!(
            "investment watchlist item for {asset_id} not found"
        ))
    })?;
    Ok(row_to_watchlist(row))
}

pub(super) async fn list_watchlist_for_pool(
    db: &PgPool,
) -> AppResult<Vec<InvestmentWatchlistItem>> {
    let rows = sqlx::query_as::<_, WatchlistRow>(
        r#"SELECT w.id, w.asset_id, w.target_price_amount, w.currency, w.notes, w.created_at,
                  a.symbol AS asset_symbol, a.name AS asset_name, a.asset_type AS asset_type
           FROM investment_watchlist w
           JOIN investment_assets a ON a.id = w.asset_id
           ORDER BY w.created_at DESC"#,
    )
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(row_to_watchlist).collect())
}

pub(super) async fn ensure_account_exists(state: &AppState, id: Uuid) -> AppResult<()> {
    sqlx::query("SELECT 1 FROM investment_accounts WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("investment account {id} not found")))?;
    Ok(())
}

pub(super) async fn ensure_asset_exists(state: &AppState, id: Uuid) -> AppResult<()> {
    sqlx::query("SELECT 1 FROM investment_assets WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("investment asset {id} not found")))?;
    Ok(())
}

pub(super) async fn ensure_position_exists(state: &AppState, id: Uuid) -> AppResult<()> {
    sqlx::query("SELECT 1 FROM investment_positions WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("investment position {id} not found")))?;
    Ok(())
}

pub(super) async fn ensure_cashflow_exists(state: &AppState, id: Uuid) -> AppResult<()> {
    sqlx::query("SELECT 1 FROM investment_cashflows WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("investment cashflow {id} not found")))?;
    Ok(())
}

pub(super) fn row_to_account(row: AccountRow) -> InvestmentAccount {
    InvestmentAccount {
        id: row.id.to_string(),
        name: row.name,
        institution: row.institution,
        currency: row.currency,
        notes: row.notes,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

pub(super) fn row_to_asset(row: AssetRow) -> InvestmentAsset {
    InvestmentAsset {
        id: row.id.to_string(),
        symbol: row.symbol,
        name: row.name,
        asset_type: row.asset_type,
        exchange: row.exchange,
        currency: row.currency,
        sector: row.sector,
        notes: row.notes,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

fn row_to_position(row: PositionRow) -> InvestmentPosition {
    let market_value = row
        .latest_market_value_amount
        .unwrap_or(row.cost_basis_amount);
    InvestmentPosition {
        id: row.id.to_string(),
        account_id: row.account_id.map(|id| id.to_string()),
        asset_id: row.asset_id.to_string(),
        quantity_micro: row.quantity_micro,
        cost_basis_amount: row.cost_basis_amount,
        currency: row.currency,
        opened_at: row.opened_at.map(|value| value.to_rfc3339()),
        notes: row.notes,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
        account_name: row.account_name,
        asset_symbol: row.asset_symbol,
        asset_name: row.asset_name,
        asset_type: row.asset_type,
        latest_market_value_amount: row.latest_market_value_amount,
        latest_unit_price_amount: row.latest_unit_price_amount,
        latest_valued_at: row.latest_valued_at.map(|value| value.to_rfc3339()),
        unrealized_pl_amount: market_value - row.cost_basis_amount,
    }
}

pub(super) fn row_to_snapshot(row: SnapshotRow) -> InvestmentValuationSnapshot {
    InvestmentValuationSnapshot {
        id: row.id.to_string(),
        position_id: row.position_id.to_string(),
        unit_price_amount: row.unit_price_amount,
        market_value_amount: row.market_value_amount,
        currency: row.currency,
        recorded_at: row.recorded_at.to_rfc3339(),
        notes: row.notes,
    }
}

pub(super) fn row_to_cashflow(row: CashflowRow) -> InvestmentCashflow {
    InvestmentCashflow {
        id: row.id.to_string(),
        account_id: row.account_id.map(|id| id.to_string()),
        asset_id: row.asset_id.map(|id| id.to_string()),
        flow_type: row.flow_type,
        amount: row.amount,
        currency: row.currency,
        recorded_at: row.recorded_at.to_rfc3339(),
        notes: row.notes,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
        account_name: row.account_name,
        asset_symbol: row.asset_symbol,
    }
}

fn row_to_watchlist(row: WatchlistRow) -> InvestmentWatchlistItem {
    InvestmentWatchlistItem {
        id: row.id.to_string(),
        asset_id: row.asset_id.to_string(),
        target_price_amount: row.target_price_amount,
        currency: row.currency,
        notes: row.notes,
        created_at: row.created_at.to_rfc3339(),
        asset_symbol: row.asset_symbol,
        asset_name: row.asset_name,
        asset_type: row.asset_type,
    }
}
