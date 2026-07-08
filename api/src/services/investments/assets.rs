use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::investment::{
    CreateInvestmentAssetRequest, InvestmentAssetResponse, InvestmentAssetsResponse,
    UpdateInvestmentAssetRequest,
};
use crate::state::AppState;

use super::audit;
use super::records::{ensure_asset_exists, fetch_asset, row_to_asset, AssetRow};
use super::validation::{
    clean_optional, normalize_choice, normalize_currency, validate_required, ASSET_TYPES,
};

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
