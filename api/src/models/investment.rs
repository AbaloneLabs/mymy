//! Investment record models.
//!
//! The investment surface is intentionally a ledger and analytics module, not
//! a broker. It stores positions, valuation snapshots, cashflows, and watchlist
//! state that the user or an approved agent can maintain manually. There are no
//! buy/sell order models, because mymy must not imply it can execute trades.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentAccount {
    pub id: String,
    pub name: String,
    pub institution: String,
    pub currency: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentAsset {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub asset_type: String,
    pub exchange: String,
    pub currency: String,
    pub sector: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentPosition {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    pub asset_id: String,
    pub quantity_micro: i64,
    pub cost_basis_amount: i64,
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opened_at: Option<String>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
    pub asset_symbol: String,
    pub asset_name: String,
    pub asset_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_market_value_amount: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_unit_price_amount: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_valued_at: Option<String>,
    pub unrealized_pl_amount: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentValuationSnapshot {
    pub id: String,
    pub position_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_price_amount: Option<i64>,
    pub market_value_amount: i64,
    pub currency: String,
    pub recorded_at: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentCashflow {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    pub flow_type: String,
    pub amount: i64,
    pub currency: String,
    pub recorded_at: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_symbol: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentWatchlistItem {
    pub id: String,
    pub asset_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_price_amount: Option<i64>,
    pub currency: String,
    pub notes: String,
    pub created_at: String,
    pub asset_symbol: String,
    pub asset_name: String,
    pub asset_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentSummary {
    pub cost_basis_amount: i64,
    pub market_value_amount: i64,
    pub unrealized_pl_amount: i64,
    pub income_amount: i64,
    pub expense_amount: i64,
    pub net_cashflow_amount: i64,
    pub position_count: i64,
    pub account_count: i64,
    pub watchlist_count: i64,
    pub allocations: Vec<InvestmentAllocation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentAllocation {
    pub label: String,
    pub amount: i64,
}

#[derive(Debug, Serialize)]
pub struct InvestmentAccountsResponse {
    pub accounts: Vec<InvestmentAccount>,
}

#[derive(Debug, Serialize)]
pub struct InvestmentAccountResponse {
    pub account: InvestmentAccount,
}

#[derive(Debug, Serialize)]
pub struct InvestmentAssetsResponse {
    pub assets: Vec<InvestmentAsset>,
}

#[derive(Debug, Serialize)]
pub struct InvestmentAssetResponse {
    pub asset: InvestmentAsset,
}

#[derive(Debug, Serialize)]
pub struct InvestmentPositionsResponse {
    pub positions: Vec<InvestmentPosition>,
}

#[derive(Debug, Serialize)]
pub struct InvestmentPositionResponse {
    pub position: InvestmentPosition,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentValuationSnapshotsResponse {
    pub valuation_snapshots: Vec<InvestmentValuationSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentValuationSnapshotResponse {
    pub valuation_snapshot: InvestmentValuationSnapshot,
}

#[derive(Debug, Serialize)]
pub struct InvestmentCashflowsResponse {
    pub cashflows: Vec<InvestmentCashflow>,
}

#[derive(Debug, Serialize)]
pub struct InvestmentCashflowResponse {
    pub cashflow: InvestmentCashflow,
}

#[derive(Debug, Serialize)]
pub struct InvestmentWatchlistResponse {
    pub watchlist: Vec<InvestmentWatchlistItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentWatchlistItemResponse {
    pub watchlist_item: InvestmentWatchlistItem,
}

#[derive(Debug, Serialize)]
pub struct InvestmentSummaryResponse {
    pub summary: InvestmentSummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvestmentAccountRequest {
    pub name: String,
    pub institution: Option<String>,
    pub currency: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInvestmentAccountRequest {
    pub name: Option<String>,
    pub institution: Option<String>,
    pub currency: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvestmentAssetRequest {
    pub symbol: String,
    pub name: Option<String>,
    pub asset_type: Option<String>,
    pub exchange: Option<String>,
    pub currency: Option<String>,
    pub sector: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInvestmentAssetRequest {
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub asset_type: Option<String>,
    pub exchange: Option<String>,
    pub currency: Option<String>,
    pub sector: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvestmentPositionRequest {
    pub account_id: Option<String>,
    pub asset_id: String,
    pub quantity_micro: i64,
    pub cost_basis_amount: i64,
    pub currency: Option<String>,
    pub opened_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInvestmentPositionRequest {
    pub account_id: Option<String>,
    pub asset_id: Option<String>,
    pub quantity_micro: Option<i64>,
    pub cost_basis_amount: Option<i64>,
    pub currency: Option<String>,
    pub opened_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvestmentValuationSnapshotRequest {
    pub position_id: String,
    pub unit_price_amount: Option<i64>,
    pub market_value_amount: i64,
    pub currency: Option<String>,
    pub recorded_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentValuationSnapshotQuery {
    pub position_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvestmentCashflowRequest {
    pub account_id: Option<String>,
    pub asset_id: Option<String>,
    pub flow_type: String,
    pub amount: i64,
    pub currency: Option<String>,
    pub recorded_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInvestmentCashflowRequest {
    pub account_id: Option<String>,
    pub asset_id: Option<String>,
    pub flow_type: Option<String>,
    pub amount: Option<i64>,
    pub currency: Option<String>,
    pub recorded_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvestmentWatchlistItemRequest {
    pub asset_id: String,
    pub target_price_amount: Option<i64>,
    pub currency: Option<String>,
    pub notes: Option<String>,
}
