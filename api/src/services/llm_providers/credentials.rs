use chrono::Utc;
use uuid::Uuid;

use crate::agent::crypto;
use crate::error::{AppError, AppResult};
use crate::models::llm_provider::{
    AgentCredentialsResponse, CreateAgentCredentialRequest, CredentialRateLimitStatus,
    DeleteLlmProviderResponse, ProviderRateLimitStatus, RateLimitStatusResponse,
    UpdateAgentCredentialRequest,
};
use crate::state::AppState;

use super::repository::{ensure_provider_exists, require_encryption_key, row_to_credential};

pub async fn list_credentials(
    state: &AppState,
    provider_id: Uuid,
) -> AppResult<AgentCredentialsResponse> {
    ensure_provider_exists(&state.db, provider_id).await?;
    let rows = sqlx::query_as!(
        super::repository::AgentCredentialRow,
        r#"SELECT id, provider_id, label, status, reset_at, request_count,
                  created_at, updated_at
           FROM agent_credentials
           WHERE provider_id = $1
           ORDER BY created_at ASC"#,
        provider_id,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(AgentCredentialsResponse {
        credentials: rows.into_iter().map(row_to_credential).collect(),
    })
}

pub async fn list_rate_limit_status(state: &AppState) -> AppResult<RateLimitStatusResponse> {
    let provider_rows = sqlx::query!(
        r#"SELECT id, label
           FROM llm_providers
           WHERE enabled = true
           ORDER BY created_at ASC"#
    )
    .fetch_all(&state.db)
    .await?;
    let mut providers = Vec::new();
    for provider in provider_rows {
        let credential_rows = sqlx::query!(
            r#"SELECT id, label, status, reset_at, request_count
               FROM agent_credentials
               WHERE provider_id = $1
               ORDER BY created_at ASC"#,
            provider.id,
        )
        .fetch_all(&state.db)
        .await?;
        let mut credentials = vec![CredentialRateLimitStatus {
            credential_id: None,
            label: "primary".to_string(),
            status: "ok".to_string(),
            reset_at: None,
            reset_after_secs: None,
            request_count: 0,
        }];
        credentials.extend(credential_rows.into_iter().map(|row| {
            let reset_after_secs = row
                .reset_at
                .map(|reset_at| (reset_at - Utc::now()).num_seconds().max(0));
            CredentialRateLimitStatus {
                credential_id: Some(row.id.to_string()),
                label: row.label,
                status: row.status,
                reset_at: row.reset_at.map(|reset_at| reset_at.to_rfc3339()),
                reset_after_secs,
                request_count: row.request_count,
            }
        }));
        providers.push(ProviderRateLimitStatus {
            provider_id: provider.id.to_string(),
            label: provider.label,
            credentials,
        });
    }
    Ok(RateLimitStatusResponse { providers })
}

pub async fn create_credential(
    state: &AppState,
    provider_id: Uuid,
    req: CreateAgentCredentialRequest,
) -> AppResult<AgentCredentialsResponse> {
    ensure_provider_exists(&state.db, provider_id).await?;
    let label = req.label.trim();
    if label.is_empty() {
        return Err(AppError::BadRequest(
            "credential label cannot be empty".to_string(),
        ));
    }
    let key = require_encryption_key(state).await?;
    let encrypted = crypto::encrypt_api_key(&key, &req.api_key)?;
    sqlx::query!(
        r#"INSERT INTO agent_credentials
           (provider_id, label, encrypted_key, key_nonce, key_derivation_version)
           VALUES ($1, $2, $3, $4, 2)"#,
        provider_id,
        label,
        encrypted.ciphertext_hex,
        encrypted.nonce_hex,
    )
    .execute(&state.db)
    .await?;
    list_credentials(state, provider_id).await
}

pub async fn update_credential(
    state: &AppState,
    provider_id: Uuid,
    credential_id: Uuid,
    req: UpdateAgentCredentialRequest,
) -> AppResult<AgentCredentialsResponse> {
    ensure_provider_exists(&state.db, provider_id).await?;
    if let Some(status) = req.status.as_deref() {
        if !matches!(status, "ok" | "exhausted" | "dead") {
            return Err(AppError::BadRequest(
                "invalid credential status".to_string(),
            ));
        }
        sqlx::query!(
            r#"UPDATE agent_credentials SET
                 status = $3,
                 reset_at = CASE WHEN $3 = 'exhausted' THEN now() + interval '60 seconds' ELSE NULL END,
                 updated_at = now()
               WHERE provider_id = $1 AND id = $2"#,
            provider_id,
            credential_id,
            status,
        )
        .execute(&state.db)
        .await?;
    }
    list_credentials(state, provider_id).await
}

pub async fn delete_credential(
    state: &AppState,
    provider_id: Uuid,
    credential_id: Uuid,
) -> AppResult<DeleteLlmProviderResponse> {
    ensure_provider_exists(&state.db, provider_id).await?;
    let result = sqlx::query!(
        "DELETE FROM agent_credentials WHERE provider_id = $1 AND id = $2",
        provider_id,
        credential_id,
    )
    .execute(&state.db)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "credential {credential_id} not found"
        )));
    }
    Ok(DeleteLlmProviderResponse { success: true })
}

pub async fn mark_credential_rate_limited(
    state: &AppState,
    provider_id: Uuid,
    credential_id: Option<Uuid>,
    retry_after_secs: Option<u64>,
) -> AppResult<()> {
    let Some(credential_id) = credential_id else {
        return Ok(());
    };
    let cooldown = retry_after_secs.unwrap_or(60).clamp(1, 86_400);
    let reset_at = Utc::now() + chrono::Duration::seconds(cooldown as i64);
    sqlx::query!(
        r#"UPDATE agent_credentials
           SET status = 'exhausted', reset_at = $3, updated_at = now()
           WHERE provider_id = $1 AND id = $2"#,
        provider_id,
        credential_id,
        reset_at,
    )
    .execute(&state.db)
    .await?;
    Ok(())
}

// ============================================================
// Helpers
// ============================================================
