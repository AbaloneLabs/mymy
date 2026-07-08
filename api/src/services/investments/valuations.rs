use chrono::Utc;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::investment::{
    CreateInvestmentValuationSnapshotRequest, InvestmentValuationSnapshotQuery,
    InvestmentValuationSnapshotResponse, InvestmentValuationSnapshotsResponse,
};
use crate::state::AppState;

use super::audit;
use super::records::{ensure_position_exists, fetch_snapshot, row_to_snapshot, SnapshotRow};
use super::validation::{
    clean_optional, normalize_currency, parse_optional_uuid, parse_ts, parse_uuid,
    validate_nonnegative,
};

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
