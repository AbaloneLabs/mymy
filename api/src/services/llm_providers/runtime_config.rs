use uuid::Uuid;

use crate::agent::crypto::{self, EncryptedKey};
use crate::agent::providers::ProviderConfig;
use crate::agent::security::register_secret;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::repository::{
    fetch_row, parse_api_format_option, require_encryption_key, LlmProviderRow,
};

pub struct ResolvedRuntimeConfig {
    pub config: ProviderConfig,
    pub credential_id: Option<Uuid>,
}

// Runtime config resolution
// ============================================================

/// Decrypt a provider's API key and build a live `ProviderConfig`.
///
/// This is the bridge between the encrypted DB row and the in-memory
/// config consumed by the agent loop (Phase 2).
pub async fn resolve_runtime_config(state: &AppState, id: Uuid) -> AppResult<ProviderConfig> {
    Ok(resolve_runtime_config_with_credential(state, id)
        .await?
        .config)
}

pub async fn resolve_runtime_config_with_credential(
    state: &AppState,
    id: Uuid,
) -> AppResult<ResolvedRuntimeConfig> {
    let row = fetch_row(&state.db, id).await?;
    let key = require_encryption_key(state).await?;
    let (api_key, credential_id) = resolve_runtime_api_key(state, id, &key, &row).await?;

    Ok(ResolvedRuntimeConfig {
        config: ProviderConfig {
            api_format: parse_api_format_option(&row.api_format).api_format(),
            base_url: row.base_url,
            api_key,
            model: row.model,
            max_tokens: row.max_tokens as u32,
        },
        credential_id,
    })
}

async fn resolve_runtime_api_key(
    state: &AppState,
    provider_id: Uuid,
    key: &[u8; 32],
    provider_row: &LlmProviderRow,
) -> AppResult<(String, Option<Uuid>)> {
    let credential = sqlx::query!(
        r#"SELECT id, encrypted_key, key_nonce, status
           FROM agent_credentials
           WHERE provider_id = $1
             AND (
                status = 'ok'
                OR (status = 'exhausted' AND reset_at IS NOT NULL AND reset_at <= now())
             )
           ORDER BY CASE WHEN status = 'ok' THEN 0 ELSE 1 END,
                    request_count ASC,
                    created_at ASC
           LIMIT 1"#,
        provider_id,
    )
    .fetch_optional(&state.db)
    .await?;

    if let Some(credential) = credential {
        if credential.status == "exhausted" {
            sqlx::query!(
                r#"UPDATE agent_credentials
                   SET status = 'ok', reset_at = NULL, updated_at = now()
                   WHERE id = $1"#,
                credential.id,
            )
            .execute(&state.db)
            .await?;
        }
        sqlx::query!(
            r#"UPDATE agent_credentials
               SET request_count = request_count + 1, updated_at = now()
               WHERE id = $1"#,
            credential.id,
        )
        .execute(&state.db)
        .await?;
        let encrypted = EncryptedKey {
            ciphertext_hex: credential.encrypted_key,
            nonce_hex: credential.key_nonce,
        };
        return crypto::decrypt_api_key(key, &encrypted).map(|api_key| {
            register_secret(&api_key);
            (api_key, Some(credential.id))
        });
    }

    let encrypted = EncryptedKey {
        ciphertext_hex: provider_row.encrypted_key.clone(),
        nonce_hex: provider_row.key_nonce.clone(),
    };
    crypto::decrypt_api_key(key, &encrypted).map(|api_key| {
        register_secret(&api_key);
        (api_key, None)
    })
}

/// Resolve the default provider's runtime config.
///
/// Returns `NotFound` if no default is configured.
#[allow(dead_code)]
pub async fn resolve_default_config(state: &AppState) -> AppResult<ProviderConfig> {
    let id = resolve_default_provider_id(state).await?;
    resolve_runtime_config(state, id).await
}

pub async fn resolve_default_provider_id(state: &AppState) -> AppResult<Uuid> {
    Ok(sqlx::query!(
        r#"SELECT id FROM llm_providers WHERE is_default = true AND enabled = true LIMIT 1"#
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("no default LLM provider configured".into()))?
    .id)
}
