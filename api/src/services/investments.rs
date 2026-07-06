//! Investment record services.
//!
//! This module deliberately avoids trade-order language. Positions are current
//! records, valuations are manual snapshots, and cashflows capture dividends,
//! interest, fees, taxes, deposits, withdrawals, or adjustments. That keeps the
//! product useful for portfolio tracking without implying broker execution.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::investment::{
    CreateInvestmentAccountRequest, CreateInvestmentAssetRequest, CreateInvestmentCashflowRequest,
    CreateInvestmentPositionRequest, CreateInvestmentValuationSnapshotRequest,
    CreateInvestmentWatchlistItemRequest, InvestmentAccount, InvestmentAccountResponse,
    InvestmentAccountsResponse, InvestmentAllocation, InvestmentAsset, InvestmentAssetResponse,
    InvestmentAssetsResponse, InvestmentCashflow, InvestmentCashflowResponse,
    InvestmentCashflowsResponse, InvestmentPosition, InvestmentPositionResponse,
    InvestmentPositionsResponse, InvestmentSummary, InvestmentSummaryResponse,
    InvestmentValuationSnapshot, InvestmentValuationSnapshotQuery,
    InvestmentValuationSnapshotResponse, InvestmentValuationSnapshotsResponse,
    InvestmentWatchlistItem, InvestmentWatchlistItemResponse, InvestmentWatchlistResponse,
    UpdateInvestmentAccountRequest, UpdateInvestmentAssetRequest, UpdateInvestmentCashflowRequest,
    UpdateInvestmentPositionRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

const ASSET_TYPES: &[&str] = &[
    "stock",
    "etf",
    "bond",
    "fund",
    "crypto",
    "cash",
    "commodity",
    "real_estate",
    "other",
];
const CASHFLOW_TYPES: &[&str] = &[
    "dividend",
    "interest",
    "fee",
    "tax",
    "deposit",
    "withdrawal",
    "adjustment",
    "other",
];

#[derive(Debug, FromRow)]
struct AccountRow {
    id: Uuid,
    name: String,
    institution: String,
    currency: String,
    notes: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct AssetRow {
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
struct PositionRow {
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
struct SnapshotRow {
    id: Uuid,
    position_id: Uuid,
    unit_price_amount: Option<i64>,
    market_value_amount: i64,
    currency: String,
    recorded_at: DateTime<Utc>,
    notes: String,
}

#[derive(Debug, FromRow)]
struct CashflowRow {
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
struct WatchlistRow {
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

#[derive(Debug, FromRow)]
struct AllocationRow {
    label: String,
    amount: i64,
}

#[derive(Debug, FromRow)]
struct SummaryRow {
    cost_basis_amount: i64,
    market_value_amount: i64,
    income_amount: i64,
    expense_amount: i64,
    position_count: i64,
    account_count: i64,
    watchlist_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentListQuery {
    pub limit: Option<i64>,
}

pub async fn summary(state: &AppState) -> AppResult<InvestmentSummaryResponse> {
    Ok(InvestmentSummaryResponse {
        summary: summary_for_pool(&state.db).await?,
    })
}

async fn summary_for_pool(db: &PgPool) -> AppResult<InvestmentSummary> {
    let row = sqlx::query_as::<_, SummaryRow>(
        r#"WITH latest_values AS (
             SELECT DISTINCT ON (position_id)
                    position_id, market_value_amount
             FROM investment_valuation_snapshots
             ORDER BY position_id, recorded_at DESC
           ),
           position_totals AS (
             SELECT COALESCE(SUM(p.cost_basis_amount), 0)::bigint AS cost_basis_amount,
                    COALESCE(SUM(COALESCE(v.market_value_amount, p.cost_basis_amount)), 0)::bigint AS market_value_amount,
                    COUNT(*)::bigint AS position_count
             FROM investment_positions p
             LEFT JOIN latest_values v ON v.position_id = p.id
           ),
           cashflow_totals AS (
             SELECT COALESCE(SUM(CASE WHEN flow_type IN ('dividend', 'interest', 'deposit', 'adjustment')
                                      THEN amount ELSE 0 END), 0)::bigint AS income_amount,
                    COALESCE(SUM(CASE WHEN flow_type IN ('fee', 'tax', 'withdrawal')
                                      THEN amount ELSE 0 END), 0)::bigint AS expense_amount
             FROM investment_cashflows
           )
           SELECT pt.cost_basis_amount,
                  pt.market_value_amount,
                  ct.income_amount,
                  ct.expense_amount,
                  pt.position_count,
                  (SELECT COUNT(*)::bigint FROM investment_accounts) AS account_count,
                  (SELECT COUNT(*)::bigint FROM investment_watchlist) AS watchlist_count
           FROM position_totals pt CROSS JOIN cashflow_totals ct"#,
    )
    .fetch_one(db)
    .await?;

    let allocations = sqlx::query_as::<_, AllocationRow>(
        r#"WITH latest_values AS (
             SELECT DISTINCT ON (position_id)
                    position_id, market_value_amount
             FROM investment_valuation_snapshots
             ORDER BY position_id, recorded_at DESC
           )
           SELECT a.asset_type AS label,
                  COALESCE(SUM(COALESCE(v.market_value_amount, p.cost_basis_amount)), 0)::bigint AS amount
           FROM investment_positions p
           JOIN investment_assets a ON a.id = p.asset_id
           LEFT JOIN latest_values v ON v.position_id = p.id
           GROUP BY a.asset_type
           ORDER BY amount DESC, a.asset_type ASC"#,
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|row| InvestmentAllocation {
        label: row.label,
        amount: row.amount,
    })
    .collect::<Vec<_>>();

    Ok(InvestmentSummary {
        cost_basis_amount: row.cost_basis_amount,
        market_value_amount: row.market_value_amount,
        unrealized_pl_amount: row.market_value_amount - row.cost_basis_amount,
        income_amount: row.income_amount,
        expense_amount: row.expense_amount,
        net_cashflow_amount: row.income_amount - row.expense_amount,
        position_count: row.position_count,
        account_count: row.account_count,
        watchlist_count: row.watchlist_count,
        allocations,
    })
}

pub async fn list_accounts(state: &AppState) -> AppResult<InvestmentAccountsResponse> {
    let rows = sqlx::query_as::<_, AccountRow>(
        r#"SELECT id, name, institution, currency, notes, created_at, updated_at
           FROM investment_accounts
           ORDER BY name ASC, created_at DESC"#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(InvestmentAccountsResponse {
        accounts: rows.into_iter().map(row_to_account).collect(),
    })
}

pub async fn create_account(
    state: &AppState,
    req: CreateInvestmentAccountRequest,
) -> AppResult<InvestmentAccountResponse> {
    let id = Uuid::new_v4();
    let name = validate_required(req.name, "name")?;
    let currency = normalize_currency(req.currency.as_deref());
    let institution = clean_optional(req.institution).unwrap_or_default();
    let notes = clean_optional(req.notes).unwrap_or_default();
    sqlx::query(
        r#"INSERT INTO investment_accounts (id, name, institution, currency, notes)
           VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(id)
    .bind(&name)
    .bind(&institution)
    .bind(&currency)
    .bind(&notes)
    .execute(&state.db)
    .await?;
    let account = fetch_account(state, id).await?;
    audit(state, "create", "investment_account", &account.id).await;
    Ok(InvestmentAccountResponse { account })
}

pub async fn update_account(
    state: &AppState,
    id: Uuid,
    req: UpdateInvestmentAccountRequest,
) -> AppResult<InvestmentAccountResponse> {
    ensure_account_exists(state, id).await?;
    let name = req
        .name
        .map(|value| validate_required(value, "name"))
        .transpose()?;
    let currency = req
        .currency
        .as_deref()
        .map(|value| normalize_currency(Some(value)));
    sqlx::query(
        r#"UPDATE investment_accounts SET
             name = COALESCE($2, name),
             institution = COALESCE($3, institution),
             currency = COALESCE($4, currency),
             notes = COALESCE($5, notes),
             updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(name.as_deref())
    .bind(req.institution.as_deref())
    .bind(currency.as_deref())
    .bind(req.notes.as_deref())
    .execute(&state.db)
    .await?;
    let account = fetch_account(state, id).await?;
    audit(state, "update", "investment_account", &account.id).await;
    Ok(InvestmentAccountResponse { account })
}

pub async fn delete_account(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM investment_accounts WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "investment account {id} not found"
        )));
    }
    audit(state, "delete", "investment_account", &id.to_string()).await;
    Ok(true)
}

pub async fn list_assets(state: &AppState) -> AppResult<InvestmentAssetsResponse> {
    let rows = sqlx::query_as::<_, AssetRow>(
        r#"SELECT id, symbol, name, asset_type, exchange, currency, sector, notes, created_at, updated_at
           FROM investment_assets
           ORDER BY symbol ASC, exchange ASC"#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(InvestmentAssetsResponse {
        assets: rows.into_iter().map(row_to_asset).collect(),
    })
}

pub async fn create_asset(
    state: &AppState,
    req: CreateInvestmentAssetRequest,
) -> AppResult<InvestmentAssetResponse> {
    let id = Uuid::new_v4();
    let symbol = validate_required(req.symbol, "symbol")?.to_uppercase();
    let asset_type =
        normalize_choice(req.asset_type.as_deref(), ASSET_TYPES, "assetType", "stock")?;
    let currency = normalize_currency(req.currency.as_deref());
    let name = clean_optional(req.name).unwrap_or_default();
    let exchange = clean_optional(req.exchange).unwrap_or_default();
    let sector = clean_optional(req.sector).unwrap_or_default();
    let notes = clean_optional(req.notes).unwrap_or_default();
    sqlx::query(
        r#"INSERT INTO investment_assets
             (id, symbol, name, asset_type, exchange, currency, sector, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
    )
    .bind(id)
    .bind(&symbol)
    .bind(&name)
    .bind(&asset_type)
    .bind(&exchange)
    .bind(&currency)
    .bind(&sector)
    .bind(&notes)
    .execute(&state.db)
    .await?;
    let asset = fetch_asset(state, id).await?;
    audit(state, "create", "investment_asset", &asset.id).await;
    Ok(InvestmentAssetResponse { asset })
}

pub async fn update_asset(
    state: &AppState,
    id: Uuid,
    req: UpdateInvestmentAssetRequest,
) -> AppResult<InvestmentAssetResponse> {
    ensure_asset_exists(state, id).await?;
    let symbol = req
        .symbol
        .map(|value| validate_required(value, "symbol").map(|value| value.to_uppercase()))
        .transpose()?;
    let asset_type = req
        .asset_type
        .as_deref()
        .map(|value| normalize_choice(Some(value), ASSET_TYPES, "assetType", "stock"))
        .transpose()?;
    let currency = req
        .currency
        .as_deref()
        .map(|value| normalize_currency(Some(value)));
    sqlx::query(
        r#"UPDATE investment_assets SET
             symbol = COALESCE($2, symbol),
             name = COALESCE($3, name),
             asset_type = COALESCE($4, asset_type),
             exchange = COALESCE($5, exchange),
             currency = COALESCE($6, currency),
             sector = COALESCE($7, sector),
             notes = COALESCE($8, notes),
             updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(symbol.as_deref())
    .bind(req.name.as_deref())
    .bind(asset_type.as_deref())
    .bind(req.exchange.as_deref())
    .bind(currency.as_deref())
    .bind(req.sector.as_deref())
    .bind(req.notes.as_deref())
    .execute(&state.db)
    .await?;
    let asset = fetch_asset(state, id).await?;
    audit(state, "update", "investment_asset", &asset.id).await;
    Ok(InvestmentAssetResponse { asset })
}

pub async fn delete_asset(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM investment_assets WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "investment asset {id} not found"
        )));
    }
    audit(state, "delete", "investment_asset", &id.to_string()).await;
    Ok(true)
}

pub async fn list_positions(state: &AppState) -> AppResult<InvestmentPositionsResponse> {
    let positions = fetch_positions_for_pool(&state.db, None).await?;
    Ok(InvestmentPositionsResponse { positions })
}

pub async fn create_position(
    state: &AppState,
    req: CreateInvestmentPositionRequest,
) -> AppResult<InvestmentPositionResponse> {
    let id = Uuid::new_v4();
    let account_id = parse_optional_uuid(req.account_id.as_deref(), "accountId")?;
    let asset_id = parse_uuid(&req.asset_id, "assetId")?;
    if let Some(account_id) = account_id {
        ensure_account_exists(state, account_id).await?;
    }
    ensure_asset_exists(state, asset_id).await?;
    validate_nonnegative(req.quantity_micro, "quantityMicro")?;
    validate_nonnegative(req.cost_basis_amount, "costBasisAmount")?;
    let currency = normalize_currency(req.currency.as_deref());
    let opened_at = parse_ts(req.opened_at.as_deref(), "openedAt")?;
    let notes = clean_optional(req.notes).unwrap_or_default();
    sqlx::query(
        r#"INSERT INTO investment_positions
             (id, account_id, asset_id, quantity_micro, cost_basis_amount, currency, opened_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
    )
    .bind(id)
    .bind(account_id)
    .bind(asset_id)
    .bind(req.quantity_micro)
    .bind(req.cost_basis_amount)
    .bind(&currency)
    .bind(opened_at)
    .bind(&notes)
    .execute(&state.db)
    .await?;
    let position = fetch_position(state, id).await?;
    audit(state, "create", "investment_position", &position.id).await;
    Ok(InvestmentPositionResponse { position })
}

pub async fn update_position(
    state: &AppState,
    id: Uuid,
    req: UpdateInvestmentPositionRequest,
) -> AppResult<InvestmentPositionResponse> {
    ensure_position_exists(state, id).await?;
    let account_id = parse_optional_uuid(req.account_id.as_deref(), "accountId")?;
    let asset_id = req
        .asset_id
        .as_deref()
        .map(|value| parse_uuid(value, "assetId"))
        .transpose()?;
    if let Some(account_id) = account_id {
        ensure_account_exists(state, account_id).await?;
    }
    if let Some(asset_id) = asset_id {
        ensure_asset_exists(state, asset_id).await?;
    }
    if let Some(quantity) = req.quantity_micro {
        validate_nonnegative(quantity, "quantityMicro")?;
    }
    if let Some(cost_basis) = req.cost_basis_amount {
        validate_nonnegative(cost_basis, "costBasisAmount")?;
    }
    let currency = req
        .currency
        .as_deref()
        .map(|value| normalize_currency(Some(value)));
    let opened_at = parse_ts(req.opened_at.as_deref(), "openedAt")?;
    sqlx::query(
        r#"UPDATE investment_positions SET
             account_id = COALESCE($2, account_id),
             asset_id = COALESCE($3, asset_id),
             quantity_micro = COALESCE($4, quantity_micro),
             cost_basis_amount = COALESCE($5, cost_basis_amount),
             currency = COALESCE($6, currency),
             opened_at = COALESCE($7, opened_at),
             notes = COALESCE($8, notes),
             updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(account_id)
    .bind(asset_id)
    .bind(req.quantity_micro)
    .bind(req.cost_basis_amount)
    .bind(currency.as_deref())
    .bind(opened_at)
    .bind(req.notes.as_deref())
    .execute(&state.db)
    .await?;
    let position = fetch_position(state, id).await?;
    audit(state, "update", "investment_position", &position.id).await;
    Ok(InvestmentPositionResponse { position })
}

pub async fn delete_position(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM investment_positions WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "investment position {id} not found"
        )));
    }
    audit(state, "delete", "investment_position", &id.to_string()).await;
    Ok(true)
}

pub async fn list_valuation_snapshots(
    state: &AppState,
    q: InvestmentValuationSnapshotQuery,
) -> AppResult<InvestmentValuationSnapshotsResponse> {
    let position_id = parse_optional_uuid(q.position_id.as_deref(), "positionId")?;
    let rows = sqlx::query_as::<_, SnapshotRow>(
        r#"SELECT id, position_id, unit_price_amount, market_value_amount, currency, recorded_at, notes
           FROM investment_valuation_snapshots
           WHERE ($1::uuid IS NULL OR position_id = $1)
           ORDER BY recorded_at DESC, id DESC
           LIMIT 200"#,
    )
    .bind(position_id)
    .fetch_all(&state.db)
    .await?;
    Ok(InvestmentValuationSnapshotsResponse {
        valuation_snapshots: rows.into_iter().map(row_to_snapshot).collect(),
    })
}

pub async fn create_valuation_snapshot(
    state: &AppState,
    req: CreateInvestmentValuationSnapshotRequest,
) -> AppResult<InvestmentValuationSnapshotResponse> {
    let id = Uuid::new_v4();
    let position_id = parse_uuid(&req.position_id, "positionId")?;
    ensure_position_exists(state, position_id).await?;
    if let Some(price) = req.unit_price_amount {
        validate_nonnegative(price, "unitPriceAmount")?;
    }
    validate_nonnegative(req.market_value_amount, "marketValueAmount")?;
    let currency = normalize_currency(req.currency.as_deref());
    let recorded_at = parse_ts(req.recorded_at.as_deref(), "recordedAt")?.unwrap_or_else(Utc::now);
    let notes = clean_optional(req.notes).unwrap_or_default();
    sqlx::query(
        r#"INSERT INTO investment_valuation_snapshots
             (id, position_id, unit_price_amount, market_value_amount, currency, recorded_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(id)
    .bind(position_id)
    .bind(req.unit_price_amount)
    .bind(req.market_value_amount)
    .bind(&currency)
    .bind(recorded_at)
    .bind(&notes)
    .execute(&state.db)
    .await?;
    let valuation_snapshot = fetch_snapshot(state, id).await?;
    audit(
        state,
        "create",
        "investment_valuation_snapshot",
        &valuation_snapshot.id,
    )
    .await;
    Ok(InvestmentValuationSnapshotResponse { valuation_snapshot })
}

pub async fn delete_valuation_snapshot(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM investment_valuation_snapshots WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "investment valuation snapshot {id} not found"
        )));
    }
    audit(
        state,
        "delete",
        "investment_valuation_snapshot",
        &id.to_string(),
    )
    .await;
    Ok(true)
}

pub async fn list_cashflows(
    state: &AppState,
    q: InvestmentListQuery,
) -> AppResult<InvestmentCashflowsResponse> {
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let rows = sqlx::query_as::<_, CashflowRow>(
        r#"SELECT c.id, c.account_id, c.asset_id, c.flow_type, c.amount, c.currency,
                  c.recorded_at, c.notes, c.created_at, c.updated_at,
                  a.name AS account_name,
                  asset.symbol AS asset_symbol
           FROM investment_cashflows c
           LEFT JOIN investment_accounts a ON a.id = c.account_id
           LEFT JOIN investment_assets asset ON asset.id = c.asset_id
           ORDER BY c.recorded_at DESC, c.created_at DESC
           LIMIT $1"#,
    )
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    Ok(InvestmentCashflowsResponse {
        cashflows: rows.into_iter().map(row_to_cashflow).collect(),
    })
}

pub async fn create_cashflow(
    state: &AppState,
    req: CreateInvestmentCashflowRequest,
) -> AppResult<InvestmentCashflowResponse> {
    let id = Uuid::new_v4();
    let account_id = parse_optional_uuid(req.account_id.as_deref(), "accountId")?;
    let asset_id = parse_optional_uuid(req.asset_id.as_deref(), "assetId")?;
    if let Some(account_id) = account_id {
        ensure_account_exists(state, account_id).await?;
    }
    if let Some(asset_id) = asset_id {
        ensure_asset_exists(state, asset_id).await?;
    }
    let flow_type = normalize_choice(Some(&req.flow_type), CASHFLOW_TYPES, "flowType", "other")?;
    validate_positive(req.amount, "amount")?;
    let currency = normalize_currency(req.currency.as_deref());
    let recorded_at = parse_ts(req.recorded_at.as_deref(), "recordedAt")?.unwrap_or_else(Utc::now);
    let notes = clean_optional(req.notes).unwrap_or_default();
    sqlx::query(
        r#"INSERT INTO investment_cashflows
             (id, account_id, asset_id, flow_type, amount, currency, recorded_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
    )
    .bind(id)
    .bind(account_id)
    .bind(asset_id)
    .bind(&flow_type)
    .bind(req.amount)
    .bind(&currency)
    .bind(recorded_at)
    .bind(&notes)
    .execute(&state.db)
    .await?;
    let cashflow = fetch_cashflow(state, id).await?;
    audit(state, "create", "investment_cashflow", &cashflow.id).await;
    Ok(InvestmentCashflowResponse { cashflow })
}

pub async fn update_cashflow(
    state: &AppState,
    id: Uuid,
    req: UpdateInvestmentCashflowRequest,
) -> AppResult<InvestmentCashflowResponse> {
    ensure_cashflow_exists(state, id).await?;
    let account_id = parse_optional_uuid(req.account_id.as_deref(), "accountId")?;
    let asset_id = parse_optional_uuid(req.asset_id.as_deref(), "assetId")?;
    if let Some(account_id) = account_id {
        ensure_account_exists(state, account_id).await?;
    }
    if let Some(asset_id) = asset_id {
        ensure_asset_exists(state, asset_id).await?;
    }
    let flow_type = req
        .flow_type
        .as_deref()
        .map(|value| normalize_choice(Some(value), CASHFLOW_TYPES, "flowType", "other"))
        .transpose()?;
    if let Some(amount) = req.amount {
        validate_positive(amount, "amount")?;
    }
    let currency = req
        .currency
        .as_deref()
        .map(|value| normalize_currency(Some(value)));
    let recorded_at = parse_ts(req.recorded_at.as_deref(), "recordedAt")?;
    sqlx::query(
        r#"UPDATE investment_cashflows SET
             account_id = COALESCE($2, account_id),
             asset_id = COALESCE($3, asset_id),
             flow_type = COALESCE($4, flow_type),
             amount = COALESCE($5, amount),
             currency = COALESCE($6, currency),
             recorded_at = COALESCE($7, recorded_at),
             notes = COALESCE($8, notes),
             updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(account_id)
    .bind(asset_id)
    .bind(flow_type.as_deref())
    .bind(req.amount)
    .bind(currency.as_deref())
    .bind(recorded_at)
    .bind(req.notes.as_deref())
    .execute(&state.db)
    .await?;
    let cashflow = fetch_cashflow(state, id).await?;
    audit(state, "update", "investment_cashflow", &cashflow.id).await;
    Ok(InvestmentCashflowResponse { cashflow })
}

pub async fn delete_cashflow(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM investment_cashflows WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "investment cashflow {id} not found"
        )));
    }
    audit(state, "delete", "investment_cashflow", &id.to_string()).await;
    Ok(true)
}

pub async fn list_watchlist(state: &AppState) -> AppResult<InvestmentWatchlistResponse> {
    Ok(InvestmentWatchlistResponse {
        watchlist: list_watchlist_for_pool(&state.db).await?,
    })
}

async fn list_watchlist_for_pool(db: &PgPool) -> AppResult<Vec<InvestmentWatchlistItem>> {
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

pub async fn compact_snapshot(db: &PgPool) -> AppResult<serde_json::Value> {
    let summary = summary_for_pool(db).await?;
    let positions = fetch_positions_for_pool(db, None).await?;
    let watchlist = list_watchlist_for_pool(db).await?;
    Ok(serde_json::json!({
        "summary": summary,
        "positions": positions,
        "watchlist": watchlist,
    }))
}

async fn fetch_account(state: &AppState, id: Uuid) -> AppResult<InvestmentAccount> {
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

async fn fetch_asset(state: &AppState, id: Uuid) -> AppResult<InvestmentAsset> {
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

async fn fetch_position(state: &AppState, id: Uuid) -> AppResult<InvestmentPosition> {
    fetch_positions_for_pool(&state.db, Some(id))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound(format!("investment position {id} not found")))
}

async fn fetch_positions_for_pool(
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

async fn fetch_snapshot(state: &AppState, id: Uuid) -> AppResult<InvestmentValuationSnapshot> {
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

async fn fetch_cashflow(state: &AppState, id: Uuid) -> AppResult<InvestmentCashflow> {
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

async fn fetch_watchlist_by_asset(
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

async fn ensure_account_exists(state: &AppState, id: Uuid) -> AppResult<()> {
    sqlx::query("SELECT 1 FROM investment_accounts WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("investment account {id} not found")))?;
    Ok(())
}

async fn ensure_asset_exists(state: &AppState, id: Uuid) -> AppResult<()> {
    sqlx::query("SELECT 1 FROM investment_assets WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("investment asset {id} not found")))?;
    Ok(())
}

async fn ensure_position_exists(state: &AppState, id: Uuid) -> AppResult<()> {
    sqlx::query("SELECT 1 FROM investment_positions WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("investment position {id} not found")))?;
    Ok(())
}

async fn ensure_cashflow_exists(state: &AppState, id: Uuid) -> AppResult<()> {
    sqlx::query("SELECT 1 FROM investment_cashflows WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("investment cashflow {id} not found")))?;
    Ok(())
}

fn row_to_account(row: AccountRow) -> InvestmentAccount {
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

fn row_to_asset(row: AssetRow) -> InvestmentAsset {
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

fn row_to_snapshot(row: SnapshotRow) -> InvestmentValuationSnapshot {
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

fn row_to_cashflow(row: CashflowRow) -> InvestmentCashflow {
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

fn validate_required(value: String, field: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(format!("{field} is required")));
    }
    if trimmed.chars().count() > 160 {
        return Err(AppError::BadRequest(format!("{field} is too long")));
    }
    Ok(trimmed.to_string())
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.map(|value| value.trim().chars().take(4_000).collect())
}

fn normalize_currency(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or("KRW").trim();
    if trimmed.is_empty() {
        return "KRW".to_string();
    }
    trimmed.chars().take(12).collect::<String>().to_uppercase()
}

fn normalize_choice(
    value: Option<&str>,
    allowed: &[&str],
    field: &str,
    default_value: &str,
) -> AppResult<String> {
    let normalized = value.unwrap_or(default_value).trim().to_lowercase();
    if allowed.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(AppError::BadRequest(format!(
            "invalid {field}: {normalized}"
        )))
    }
}

fn validate_positive(value: i64, field: &str) -> AppResult<()> {
    if value > 0 {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("{field} must be positive")))
    }
}

fn validate_nonnegative(value: i64, field: &str) -> AppResult<()> {
    if value >= 0 {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("{field} cannot be negative")))
    }
}

fn parse_uuid(value: &str, field: &str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|err| AppError::BadRequest(format!("invalid {field}: {err}")))
}

fn parse_optional_uuid(value: Option<&str>, field: &str) -> AppResult<Option<Uuid>> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| parse_uuid(value, field))
        .transpose()
}

fn parse_ts(value: Option<&str>, field: &str) -> AppResult<Option<DateTime<Utc>>> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|value| value.with_timezone(&Utc))
                .map_err(|err| AppError::BadRequest(format!("invalid {field}: {err}")))
        })
        .transpose()
}

async fn audit(state: &AppState, action: &str, entity_type: &str, entity_id: &str) {
    log_audit_safe(
        &state.db,
        "user",
        "user",
        action,
        entity_type,
        Some(entity_id),
        None,
    )
    .await;
}
