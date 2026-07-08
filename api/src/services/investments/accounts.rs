use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::investment::{
    CreateInvestmentAccountRequest, InvestmentAccountResponse, InvestmentAccountsResponse,
    UpdateInvestmentAccountRequest,
};
use crate::state::AppState;

use super::audit;
use super::records::{ensure_account_exists, fetch_account, row_to_account, AccountRow};
use super::validation::{clean_optional, normalize_currency, validate_required};

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
