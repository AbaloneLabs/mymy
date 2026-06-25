//! Transaction (income/expense) models — mirrors frontend `Transaction`.
//!
//! See: web/src/types/index.ts (Transaction interface)
//!
//! All id/timestamp fields are `String` (serialized from DB `Uuid`/`timestamptz`
//! in the handler's `row_to_transaction`), matching the tasks/notes pattern.
//!
//! `amount` is stored as an integer in the currency's minor unit (KRW: 1 won,
//! USD: 1 cent) and is always positive; the sign is derived from `type`.
//! This avoids floating-point errors entirely (same approach as Stripe).

use serde::{Deserialize, Serialize};

/// A transaction as exposed over the API.
///
/// Serialized as camelCase to match the frontend `Transaction` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// "income" or "expense"
    pub r#type: String,
    /// Amount in minor units (always positive)
    pub amount: i64,
    /// ISO 4217 currency code (e.g. "KRW", "USD")
    pub currency: String,
    pub category: String,
    /// ISO 8601 timestamp
    pub date: String,
    pub description: String,
    /// "pending" or "cleared"
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionsResponse {
    pub transactions: Vec<Transaction>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionResponse {
    pub transaction: Transaction,
}

/// Aggregated totals for a date range (all in minor units).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionSummary {
    pub income: i64,
    pub expense: i64,
    pub net: i64,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResponse {
    pub summary: TransactionSummary,
}

/// Payload for creating a new transaction.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransactionRequest {
    pub project_id: Option<String>,
    pub r#type: String,
    pub amount: i64,
    pub currency: Option<String>,
    pub category: Option<String>,
    /// Defaults to the current time when omitted.
    pub date: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
}

/// Payload for patching a transaction (all fields optional, COALESCE patch).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTransactionRequest {
    pub project_id: Option<String>,
    pub r#type: Option<String>,
    pub amount: Option<i64>,
    pub currency: Option<String>,
    pub category: Option<String>,
    pub date: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
}
