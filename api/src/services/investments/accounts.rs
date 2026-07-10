use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::investment::{
    CreateInvestmentAccountRequest, InvestmentAccountResponse, InvestmentAccountsResponse,
    InvestmentScopeQuery, UpdateInvestmentAccountRequest,
};
use crate::models::scope::{ScopeFilter, WorkspaceScope};
use crate::state::AppState;

use super::audit;
use super::records::{ensure_account_exists, fetch_account, row_to_account, AccountRow};
use super::validation::{clean_optional, normalize_currency, validate_required};

pub async fn list_accounts(
    state: &AppState,
    query: InvestmentScopeQuery,
) -> AppResult<InvestmentAccountsResponse> {
    let scope = ScopeFilter::parse(query.scope.as_deref(), query.project_id.as_deref())?;
    let rows = sqlx::query_as::<_, AccountRow>(
        r#"SELECT id, project_id, name, institution, currency, notes, created_at, updated_at
           FROM investment_accounts
           WHERE ($1 = 'all'
                  OR ($1 = 'general' AND project_id IS NULL)
                  OR ($1 = 'project' AND project_id = $2))
           ORDER BY name ASC, created_at DESC"#,
    )
    .bind(scope.kind())
    .bind(scope.project_id())
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
    let project_id = req
        .project_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|err| AppError::BadRequest(format!("invalid projectId: {err}")))?;
    ensure_project_exists(state, project_id).await?;
    let name = validate_required(req.name, "name")?;
    let currency = normalize_currency(req.currency.as_deref());
    let institution = clean_optional(req.institution).unwrap_or_default();
    let notes = clean_optional(req.notes).unwrap_or_default();
    sqlx::query(
        r#"INSERT INTO investment_accounts (id, project_id, name, institution, currency, notes)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(id)
    .bind(project_id)
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
    let project_scope = req.project_id.workspace_scope()?;
    let project_specified = project_scope.is_some();
    let project_id = project_scope.and_then(|scope| match scope {
        WorkspaceScope::General => None,
        WorkspaceScope::Project(id) => Some(id),
    });
    ensure_project_exists(state, project_id).await?;
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
             project_id = CASE WHEN $2 THEN $3 ELSE project_id END,
             name = COALESCE($4, name),
             institution = COALESCE($5, institution),
             currency = COALESCE($6, currency),
             notes = COALESCE($7, notes),
             updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(project_specified)
    .bind(project_id)
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

async fn ensure_project_exists(state: &AppState, project_id: Option<Uuid>) -> AppResult<()> {
    let Some(project_id) = project_id else {
        return Ok(());
    };
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)")
            .bind(project_id)
            .fetch_one(&state.db)
            .await?;
    if !exists {
        return Err(AppError::NotFound(format!(
            "project {project_id} not found"
        )));
    }
    Ok(())
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
