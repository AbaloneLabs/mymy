use std::collections::{BTreeMap, HashSet};

use sqlx::{FromRow, PgPool};

use crate::error::AppResult;
use crate::models::investment::{
    InvestmentAllocation, InvestmentCurrencySummary, InvestmentScopeQuery, InvestmentSummary,
    InvestmentSummaryResponse,
};
use crate::models::scope::ScopeFilter;
use crate::state::AppState;

use super::records::{fetch_positions_for_pool, list_watchlist_for_pool};

#[derive(Debug, FromRow)]
struct AllocationRow {
    label: String,
    currency: String,
    amount: i64,
}

#[derive(Debug, FromRow)]
struct SummaryRow {
    position_count: i64,
    account_count: i64,
    watchlist_count: i64,
}

#[derive(Debug, FromRow)]
struct PositionValueRow {
    cost_basis_amount: i64,
    position_currency: String,
    market_value_amount: i64,
    market_currency: String,
}

#[derive(Debug, FromRow)]
struct CashflowTotalRow {
    currency: String,
    income_amount: i64,
    expense_amount: i64,
}

#[derive(Default)]
struct CurrencyAccumulator {
    cost_basis_amount: i64,
    market_value_amount: i64,
    income_amount: i64,
    expense_amount: i64,
    mismatch: bool,
}

pub async fn summary(
    state: &AppState,
    query: InvestmentScopeQuery,
) -> AppResult<InvestmentSummaryResponse> {
    let scope = ScopeFilter::parse(query.scope.as_deref(), query.project_id.as_deref())?;
    Ok(InvestmentSummaryResponse {
        summary: summary_for_pool(&state.db, scope).await?,
    })
}

pub(super) async fn summary_for_pool(
    db: &PgPool,
    scope: ScopeFilter,
) -> AppResult<InvestmentSummary> {
    let row = sqlx::query_as::<_, SummaryRow>(
        r#"SELECT (SELECT COUNT(*)::bigint
                   FROM investment_positions p
                   LEFT JOIN investment_accounts a ON a.id = p.account_id
                   WHERE ($1 = 'all'
                          OR ($1 = 'general' AND a.project_id IS NULL)
                          OR ($1 = 'project' AND a.project_id = $2))) AS position_count,
                  (SELECT COUNT(*)::bigint FROM investment_accounts a
                   WHERE ($1 = 'all'
                          OR ($1 = 'general' AND a.project_id IS NULL)
                          OR ($1 = 'project' AND a.project_id = $2))) AS account_count,
                  (SELECT COUNT(*)::bigint FROM investment_watchlist) AS watchlist_count"#,
    )
    .bind(scope.kind())
    .bind(scope.project_id())
    .fetch_one(db)
    .await?;

    let positions = sqlx::query_as::<_, PositionValueRow>(
        r#"WITH latest_values AS (
             SELECT DISTINCT ON (position_id)
                    position_id, market_value_amount, currency
             FROM investment_valuation_snapshots
             ORDER BY position_id, recorded_at DESC
           )
           SELECT p.cost_basis_amount, p.currency AS position_currency,
                  COALESCE(v.market_value_amount, p.cost_basis_amount) AS market_value_amount,
                  COALESCE(v.currency, p.currency) AS market_currency
           FROM investment_positions p
           LEFT JOIN investment_accounts a ON a.id = p.account_id
           LEFT JOIN latest_values v ON v.position_id = p.id
           WHERE ($1 = 'all'
                  OR ($1 = 'general' AND a.project_id IS NULL)
                  OR ($1 = 'project' AND a.project_id = $2))"#,
    )
    .bind(scope.kind())
    .bind(scope.project_id())
    .fetch_all(db)
    .await?;
    let cashflows = sqlx::query_as::<_, CashflowTotalRow>(
        r#"SELECT c.currency,
                  COALESCE(SUM(CASE WHEN flow_type IN ('dividend', 'interest', 'deposit', 'adjustment')
                               THEN amount ELSE 0 END), 0)::bigint AS income_amount,
                  COALESCE(SUM(CASE WHEN flow_type IN ('fee', 'tax', 'withdrawal')
                               THEN amount ELSE 0 END), 0)::bigint AS expense_amount
           FROM investment_cashflows c
           LEFT JOIN investment_accounts a ON a.id = c.account_id
           WHERE ($1 = 'all'
                  OR ($1 = 'general' AND a.project_id IS NULL)
                  OR ($1 = 'project' AND a.project_id = $2))
           GROUP BY c.currency"#,
    )
    .bind(scope.kind())
    .bind(scope.project_id())
    .fetch_all(db)
    .await?;
    let mut totals = BTreeMap::<String, CurrencyAccumulator>::new();
    for position in positions {
        totals
            .entry(position.position_currency.clone())
            .or_default()
            .cost_basis_amount += position.cost_basis_amount;
        totals
            .entry(position.market_currency.clone())
            .or_default()
            .market_value_amount += position.market_value_amount;
        if position.position_currency != position.market_currency {
            totals
                .entry(position.position_currency)
                .or_default()
                .mismatch = true;
            totals.entry(position.market_currency).or_default().mismatch = true;
        }
    }
    for cashflow in cashflows {
        let total = totals.entry(cashflow.currency).or_default();
        total.income_amount = cashflow.income_amount;
        total.expense_amount = cashflow.expense_amount;
    }
    let totals_by_currency = totals
        .into_iter()
        .map(|(currency, total)| InvestmentCurrencySummary {
            currency,
            cost_basis_amount: total.cost_basis_amount,
            market_value_amount: total.market_value_amount,
            unrealized_pl_amount: (!total.mismatch)
                .then_some(total.market_value_amount - total.cost_basis_amount),
            income_amount: total.income_amount,
            expense_amount: total.expense_amount,
            net_cashflow_amount: total.income_amount - total.expense_amount,
            has_currency_mismatch: total.mismatch,
        })
        .collect::<Vec<_>>();
    let mismatched_currencies = totals_by_currency
        .iter()
        .filter(|total| total.has_currency_mismatch)
        .map(|total| total.currency.as_str())
        .collect::<HashSet<_>>();

    let allocations = sqlx::query_as::<_, AllocationRow>(
        r#"WITH latest_values AS (
             SELECT DISTINCT ON (position_id)
                    position_id, market_value_amount, currency
             FROM investment_valuation_snapshots
             ORDER BY position_id, recorded_at DESC
           )
           SELECT a.asset_type AS label,
                  COALESCE(v.currency, p.currency) AS currency,
                  COALESCE(SUM(COALESCE(v.market_value_amount, p.cost_basis_amount)), 0)::bigint AS amount
           FROM investment_positions p
           JOIN investment_assets a ON a.id = p.asset_id
           LEFT JOIN investment_accounts acc ON acc.id = p.account_id
           LEFT JOIN latest_values v ON v.position_id = p.id
           WHERE ($1 = 'all'
                  OR ($1 = 'general' AND acc.project_id IS NULL)
                  OR ($1 = 'project' AND acc.project_id = $2))
           GROUP BY a.asset_type, COALESCE(v.currency, p.currency)
           ORDER BY currency, amount DESC, a.asset_type ASC"#,
    )
    .bind(scope.kind())
    .bind(scope.project_id())
    .fetch_all(db)
    .await?
    .into_iter()
    .map(|row| InvestmentAllocation {
        label: row.label,
        currency: row.currency,
        amount: row.amount,
    })
    .collect::<Vec<_>>();

    let single = (totals_by_currency.len() == 1).then(|| &totals_by_currency[0]);
    Ok(InvestmentSummary {
        currency: single.map(|total| total.currency.clone()),
        cost_basis_amount: single.map(|total| total.cost_basis_amount),
        market_value_amount: single.map(|total| total.market_value_amount),
        unrealized_pl_amount: single.and_then(|total| total.unrealized_pl_amount),
        income_amount: single.map(|total| total.income_amount),
        expense_amount: single.map(|total| total.expense_amount),
        net_cashflow_amount: single.map(|total| total.net_cashflow_amount),
        position_count: row.position_count,
        account_count: row.account_count,
        watchlist_count: row.watchlist_count,
        allocations,
        has_currency_mismatch: !mismatched_currencies.is_empty(),
        totals_by_currency,
    })
}

pub async fn compact_snapshot(db: &PgPool) -> AppResult<serde_json::Value> {
    let summary = summary_for_pool(db, ScopeFilter::All).await?;
    let positions = fetch_positions_for_pool(db, None).await?;
    let watchlist = list_watchlist_for_pool(db).await?;
    Ok(serde_json::json!({
        "summary": summary,
        "positions": positions,
        "watchlist": watchlist,
    }))
}
