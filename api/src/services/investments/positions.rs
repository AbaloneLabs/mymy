use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::investment::{
    CreateInvestmentPositionRequest, InvestmentPositionResponse, InvestmentPositionsResponse,
    InvestmentScopeQuery, UpdateInvestmentPositionRequest,
};
use crate::models::scope::ScopeFilter;
use crate::state::AppState;

use super::audit;
use super::records::{
    ensure_account_exists, ensure_asset_exists, ensure_position_exists, fetch_position,
    fetch_positions_for_pool_scoped,
};
use super::validation::{
    clean_optional, normalize_currency, parse_optional_uuid, parse_ts, parse_uuid,
    validate_nonnegative,
};

pub async fn list_positions(
    state: &AppState,
    query: InvestmentScopeQuery,
) -> AppResult<InvestmentPositionsResponse> {
    let scope = ScopeFilter::parse(query.scope.as_deref(), query.project_id.as_deref())?;
    let positions = fetch_positions_for_pool_scoped(&state.db, None, scope).await?;
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
