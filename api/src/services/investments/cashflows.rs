use serde::Deserialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::investment::{
    CreateInvestmentCashflowRequest, InvestmentCashflowResponse, InvestmentCashflowsResponse,
    UpdateInvestmentCashflowRequest,
};
use crate::state::AppState;

use super::audit;
use super::records::{
    ensure_account_exists, ensure_asset_exists, ensure_cashflow_exists, fetch_cashflow,
    row_to_cashflow, CashflowRow,
};
use super::validation::{
    clean_optional, normalize_choice, normalize_currency, parse_optional_uuid, parse_ts,
    validate_positive, CASHFLOW_TYPES,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentListQuery {
    pub limit: Option<i64>,
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
    let recorded_at =
        parse_ts(req.recorded_at.as_deref(), "recordedAt")?.unwrap_or_else(chrono::Utc::now);
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
