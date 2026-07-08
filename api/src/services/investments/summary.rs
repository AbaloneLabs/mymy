use sqlx::{FromRow, PgPool};

use crate::error::AppResult;
use crate::models::investment::{
    InvestmentAllocation, InvestmentSummary, InvestmentSummaryResponse,
};
use crate::state::AppState;

use super::records::{fetch_positions_for_pool, list_watchlist_for_pool};

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

pub async fn summary(state: &AppState) -> AppResult<InvestmentSummaryResponse> {
    Ok(InvestmentSummaryResponse {
        summary: summary_for_pool(&state.db).await?,
    })
}

pub(super) async fn summary_for_pool(db: &PgPool) -> AppResult<InvestmentSummary> {
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
