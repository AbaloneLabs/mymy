//! Transaction (income/expense) domain operations.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::transaction::{
    CreateTransactionRequest, SummaryResponse, Transaction, TransactionResponse,
    TransactionSummary, TransactionsResponse, UpdateTransactionRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

/// A transaction row.
///
/// `amount` is in the currency's minor unit and always positive.
#[derive(Debug, FromRow)]
struct TransactionRow {
    id: Uuid,
    project_id: Option<Uuid>,
    r#type: String,
    amount: i64,
    currency: String,
    category: String,
    date: DateTime<Utc>,
    description: String,
    status: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

/// Query params for GET /api/transactions and GET /api/transactions/summary.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionQuery {
    pub project_id: Option<String>,
    pub r#type: Option<String>,
    /// Inclusive start (ISO 8601). Optional.
    pub from: Option<String>,
    /// Exclusive end (ISO 8601). Optional.
    pub to: Option<String>,
    pub category: Option<String>,
    pub status: Option<String>,
}

/// GET /api/transactions
///
/// Ordered by date DESC (newest first), then created_at DESC.
pub async fn list_transactions(
    state: &AppState,
    q: TransactionQuery,
) -> AppResult<TransactionsResponse> {
    let project_uuid = parse_project_id(q.project_id.as_deref())?;
    let from = parse_ts(q.from.as_deref(), "from")?;
    let to = parse_ts(q.to.as_deref(), "to")?;

    if let Some(ref t) = q.r#type {
        validate_type(t)?;
    }
    if let Some(ref s) = q.status {
        validate_status(s)?;
    }

    // Single query with `($n::T IS NULL OR col = $n)` predicates. This avoids
    // the combinatorial explosion of enumerating every filter combination
    // (2^6 = 64 arms), which `sqlx::query_as!` would otherwise require since
    // it only accepts literal SQL for compile-time validation.
    let rows = sqlx::query_as!(
        TransactionRow,
        r#"SELECT id, project_id, type, amount, currency, category, date,
                  description, status, created_at, updated_at
           FROM transactions
           WHERE ($1::uuid IS NULL OR project_id = $1)
             AND ($2::text IS NULL OR type = $2)
             AND ($3::timestamptz IS NULL OR date >= $3)
             AND ($4::timestamptz IS NULL OR date < $4)
             AND ($5::text IS NULL OR category = $5)
             AND ($6::text IS NULL OR status = $6)
           ORDER BY date DESC, created_at DESC"#,
        project_uuid,
        q.r#type.as_deref() as Option<&str>,
        from,
        to,
        q.category.as_deref() as Option<&str>,
        q.status.as_deref() as Option<&str>,
    )
    .fetch_all(&state.db)
    .await?;

    let transactions = rows.into_iter().map(row_to_transaction).collect();
    Ok(TransactionsResponse { transactions })
}

/// POST /api/transactions
pub async fn create_transaction(
    state: &AppState,
    req: CreateTransactionRequest,
) -> AppResult<TransactionResponse> {
    let id = Uuid::new_v4();
    let project_uuid = parse_project_id(req.project_id.as_deref())?;

    validate_type(&req.r#type)?;
    validate_amount(req.amount)?;
    if let Some(ref s) = req.status {
        validate_status(s)?;
    }

    // Coerce absent fields to DB defaults (NOT NULL columns reject NULL).
    let currency = req.currency.unwrap_or_else(|| "KRW".to_string());
    let category = req.category.unwrap_or_else(|| "uncategorized".to_string());
    let description = req.description.unwrap_or_default();
    let status = req.status.unwrap_or_else(|| "cleared".to_string());
    // Default to "now" when the client omits the date.
    let date = parse_ts(req.date.as_deref(), "date")?.unwrap_or_else(Utc::now);

    sqlx::query!(
        r#"INSERT INTO transactions
             (id, project_id, type, amount, currency, category, date, description, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
        id,
        project_uuid,
        req.r#type,
        req.amount,
        currency,
        category,
        date,
        description,
        status,
    )
    .execute(&state.db)
    .await?;

    let transaction = fetch_transaction(state, id).await?;
    log_audit_safe(
        &state.db,
        "user", "user",
        "create", "transaction",
        Some(&transaction.id),
        Some(serde_json::json!({ "after": { "type": transaction.r#type, "amount": transaction.amount, "category": transaction.category } })),
    ).await;
    Ok(TransactionResponse { transaction })
}

/// PATCH /api/transactions/{id}
///
/// COALESCE patch for all scalar fields.
pub async fn update_transaction(
    state: &AppState,
    id: Uuid,
    req: UpdateTransactionRequest,
) -> AppResult<TransactionResponse> {
    sqlx::query!(r#"SELECT 1 AS x FROM transactions WHERE id = $1"#, id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("transaction {id} not found")))?;

    let project_uuid = parse_project_id(req.project_id.as_deref())?;

    if let Some(ref t) = req.r#type {
        validate_type(t)?;
    }
    if let Some(a) = req.amount {
        validate_amount(a)?;
    }
    if let Some(ref s) = req.status {
        validate_status(s)?;
    }

    let date = parse_ts(req.date.as_deref(), "date")?;

    sqlx::query!(
        r#"UPDATE transactions SET
             project_id = COALESCE($2, project_id),
             type = COALESCE($3, type),
             amount = COALESCE($4, amount),
             currency = COALESCE($5, currency),
             category = COALESCE($6, category),
             date = COALESCE($7, date),
             description = COALESCE($8, description),
             status = COALESCE($9, status),
             updated_at = now()
           WHERE id = $1"#,
        id,
        project_uuid,
        req.r#type.as_deref(),
        req.amount,
        req.currency.as_deref(),
        req.category.as_deref(),
        date,
        req.description.as_deref(),
        req.status.as_deref(),
    )
    .execute(&state.db)
    .await?;

    let transaction = fetch_transaction(state, id).await?;
    log_audit_safe(
        &state.db,
        "user", "user",
        "update", "transaction",
        Some(&transaction.id),
        Some(serde_json::json!({ "after": { "type": transaction.r#type, "amount": transaction.amount, "category": transaction.category } })),
    ).await;
    Ok(TransactionResponse { transaction })
}

/// DELETE /api/transactions/{id}
pub async fn delete_transaction(state: &AppState, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query!("DELETE FROM transactions WHERE id = $1", id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("transaction {id} not found")));
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "transaction",
        Some(&id.to_string()),
        Some(serde_json::json!({ "before": { "id": id.to_string() } })),
    )
    .await;
    Ok(true)
}

/// GET /api/transactions/summary
///
/// Returns aggregated income/expense/net/count for the given filters.
pub async fn transaction_summary(
    state: &AppState,
    q: TransactionQuery,
) -> AppResult<SummaryResponse> {
    let project_uuid = parse_project_id(q.project_id.as_deref())?;
    let from = parse_ts(q.from.as_deref(), "from")?;
    let to = parse_ts(q.to.as_deref(), "to")?;

    if let Some(ref t) = q.r#type {
        validate_type(t)?;
    }
    if let Some(ref s) = q.status {
        validate_status(s)?;
    }

    // We compute the three SUMs in a single query with CASE expressions.
    // SUM() over bigint returns numeric in Postgres, which sqlx can't decode
    // into i64 directly — cast back to bigint. All filters are optional.
    let row = sqlx::query!(
        r#"SELECT
             COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0)::bigint AS "income!: i64",
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::bigint AS "expense!: i64",
             COUNT(*)::bigint AS "count!: i64"
           FROM transactions
           WHERE ($1::uuid IS NULL OR project_id = $1)
             AND ($2::text IS NULL OR type = $2)
             AND ($3::timestamptz IS NULL OR date >= $3)
             AND ($4::timestamptz IS NULL OR date < $4)
             AND ($5::text IS NULL OR category = $5)
             AND ($6::text IS NULL OR status = $6)"#,
        project_uuid,
        q.r#type.as_deref() as Option<&str>,
        from,
        to,
        q.category.as_deref() as Option<&str>,
        q.status.as_deref() as Option<&str>,
    )
    .fetch_one(&state.db)
    .await?;

    let income = row.income;
    let expense = row.expense;
    let net = income - expense;

    Ok(SummaryResponse {
        summary: TransactionSummary {
            income,
            expense,
            net,
            count: row.count,
        },
    })
}

// ---- helpers ----

async fn fetch_transaction(state: &AppState, id: Uuid) -> AppResult<Transaction> {
    let row = sqlx::query_as!(
        TransactionRow,
        r#"SELECT id, project_id, type, amount, currency, category, date,
                  description, status, created_at, updated_at
           FROM transactions WHERE id = $1"#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    Ok(row_to_transaction(row))
}

fn row_to_transaction(row: TransactionRow) -> Transaction {
    Transaction {
        id: row.id.to_string(),
        project_id: row.project_id.map(|u| u.to_string()),
        r#type: row.r#type,
        amount: row.amount,
        currency: row.currency,
        category: row.category,
        date: row.date.to_rfc3339(),
        description: row.description,
        status: row.status,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

fn validate_type(t: &str) -> AppResult<()> {
    if matches!(t, "income" | "expense") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid type: {t}")))
    }
}

fn validate_status(s: &str) -> AppResult<()> {
    if matches!(s, "pending" | "cleared") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid status: {s}")))
    }
}

fn validate_amount(a: i64) -> AppResult<()> {
    if a > 0 {
        Ok(())
    } else {
        Err(AppError::BadRequest("amount must be positive".to_string()))
    }
}

fn parse_project_id(pid: Option<&str>) -> AppResult<Option<Uuid>> {
    match pid.filter(|s| !s.is_empty()) {
        Some(s) => Uuid::parse_str(s)
            .map(Some)
            .map_err(|e| AppError::BadRequest(format!("invalid projectId: {e}"))),
        None => Ok(None),
    }
}

/// Parse an optional RFC3339 timestamp. `None` / empty -> `None`.
fn parse_ts(s: Option<&str>, field: &str) -> AppResult<Option<DateTime<Utc>>> {
    match s.filter(|s| !s.is_empty()) {
        Some(s) => {
            let dt = DateTime::parse_from_rfc3339(s)
                .map_err(|e| AppError::BadRequest(format!("invalid {field}: {e}")))?
                .with_timezone(&Utc);
            Ok(Some(dt))
        }
        None => Ok(None),
    }
}
