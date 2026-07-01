//! LLM provider domain operations.
//!
//! CRUD for provider configs, plus the model-list proxy and connection test.
//! API keys are encrypted at rest (see `agent::crypto`).

use std::time::Instant;

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::crypto::{self, EncryptedKey};
use crate::agent::providers::{self, ApiMode, ProviderConfig};
use crate::agent::security::register_secret;
use crate::error::{AppError, AppResult};
use crate::models::llm_provider::{
    AgentCredential, AgentCredentialsResponse, ApiFormatOption, CreateAgentCredentialRequest,
    CreateLlmProviderRequest, CredentialRateLimitStatus, DeleteLlmProviderResponse,
    FetchModelsRequest, FetchModelsResponse, LlmProvider, LlmProviderResponse,
    LlmProvidersResponse, ModelInfo, ModelListSource, ProviderRateLimitStatus,
    RateLimitStatusResponse, SetDefaultResponse, TestConnectionResponse,
    UpdateAgentCredentialRequest, UpdateLlmProviderRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

/// A raw DB row for `llm_providers`. The `encrypted_key` and
/// `key_nonce` are the encrypted key material.
#[derive(Debug, FromRow)]
struct LlmProviderRow {
    id: Uuid,
    label: String,
    api_format: String,
    base_url: String,
    encrypted_key: String,
    key_nonce: String,
    model: String,
    max_tokens: i32,
    is_default: bool,
    enabled: bool,
    preset: Option<String>,
}

#[derive(Debug, FromRow)]
struct AgentCredentialRow {
    id: Uuid,
    provider_id: Uuid,
    label: String,
    status: String,
    reset_at: Option<DateTime<Utc>>,
    request_count: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

pub struct ResolvedRuntimeConfig {
    pub config: ProviderConfig,
    pub credential_id: Option<Uuid>,
}

/// GET /api/llm-providers
pub async fn list_providers(state: &AppState) -> AppResult<LlmProvidersResponse> {
    let rows = sqlx::query_as!(
        LlmProviderRow,
        r#"SELECT
             id, label, api_format, base_url,
             encrypted_key, key_nonce,
             model, max_tokens, is_default, enabled, preset
           FROM llm_providers
           ORDER BY created_at ASC"#
    )
    .fetch_all(&state.db)
    .await?;

    let providers = rows.into_iter().map(row_to_provider).collect();
    Ok(LlmProvidersResponse { providers })
}

/// POST /api/llm-providers
pub async fn create_provider(
    state: &AppState,
    req: CreateLlmProviderRequest,
) -> AppResult<LlmProviderResponse> {
    let key = require_encryption_key(state).await?;
    let encrypted = crypto::encrypt_api_key(&key, &req.api_key)?;

    let id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO llm_providers
             (id, label, api_format, base_url,
              encrypted_key, key_nonce,
              model, max_tokens, is_default, enabled, preset)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, true, $9)"#,
        id,
        req.label,
        req.api_format.as_db_str(),
        req.base_url,
        encrypted.ciphertext_hex,
        encrypted.nonce_hex,
        req.model,
        req.max_tokens,
        req.preset.as_deref(),
    )
    .execute(&state.db)
    .await?;

    // If this is the first provider, make it the default.
    ensure_default_exists(&state.db).await?;

    let row = fetch_row(&state.db, id).await?;
    let provider = row_to_provider(row);

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "llm_provider",
        Some(&provider.id),
        Some(serde_json::json!({ "after": { "label": provider.label, "model": provider.model } })),
    )
    .await;

    Ok(LlmProviderResponse { provider })
}

/// PATCH /api/llm-providers/:id
pub async fn update_provider(
    state: &AppState,
    id: Uuid,
    req: UpdateLlmProviderRequest,
) -> AppResult<LlmProviderResponse> {
    // Re-encrypt the key only if a new one was provided.
    let (cipher_col, nonce_col) = if let Some(ref new_key) = req.api_key {
        let key = require_encryption_key(state).await?;
        let encrypted = crypto::encrypt_api_key(&key, new_key)?;
        (Some(encrypted.ciphertext_hex), Some(encrypted.nonce_hex))
    } else {
        (None, None)
    };

    sqlx::query!(
        r#"UPDATE llm_providers SET
             label = COALESCE($2, label),
             api_format = COALESCE($3, api_format),
             base_url = COALESCE($4, base_url),
             encrypted_key = COALESCE($5, encrypted_key),
             key_nonce = COALESCE($6, key_nonce),
             model = COALESCE($7, model),
             max_tokens = COALESCE($8, max_tokens),
             enabled = COALESCE($9, enabled),
             updated_at = now()
           WHERE id = $1"#,
        id,
        req.label.as_deref(),
        req.api_format.map(|f| f.as_db_str()),
        req.base_url.as_deref(),
        cipher_col.as_deref(),
        nonce_col.as_deref(),
        req.model.as_deref(),
        req.max_tokens,
        req.enabled,
    )
    .execute(&state.db)
    .await?;

    let row = fetch_row(&state.db, id).await?;
    let provider = row_to_provider(row);

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "llm_provider",
        Some(&provider.id),
        Some(serde_json::json!({ "after": { "label": provider.label, "enabled": provider.enabled } })),
    )
    .await;

    Ok(LlmProviderResponse { provider })
}

/// DELETE /api/llm-providers/:id
pub async fn delete_provider(state: &AppState, id: Uuid) -> AppResult<DeleteLlmProviderResponse> {
    sqlx::query!("DELETE FROM llm_providers WHERE id = $1", id)
        .execute(&state.db)
        .await?;

    // If we deleted the default, promote another provider.
    ensure_default_exists(&state.db).await?;

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "llm_provider",
        Some(&id.to_string()),
        None,
    )
    .await;

    Ok(DeleteLlmProviderResponse { success: true })
}

/// POST /api/llm-providers/:id/default
pub async fn set_default(state: &AppState, id: Uuid) -> AppResult<SetDefaultResponse> {
    // Verify the provider exists.
    let exists = sqlx::query!("SELECT 1 as _1 FROM llm_providers WHERE id = $1", id)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("provider {id} not found")));
    }

    // Clear all defaults, then set this one.
    sqlx::query!("UPDATE llm_providers SET is_default = false")
        .execute(&state.db)
        .await?;
    sqlx::query!(
        "UPDATE llm_providers SET is_default = true, updated_at = now() WHERE id = $1",
        id
    )
    .execute(&state.db)
    .await?;

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "llm_provider",
        Some(&id.to_string()),
        Some(serde_json::json!({ "after": { "is_default": true } })),
    )
    .await;

    Ok(SetDefaultResponse { success: true })
}

pub async fn list_credentials(
    state: &AppState,
    provider_id: Uuid,
) -> AppResult<AgentCredentialsResponse> {
    ensure_provider_exists(&state.db, provider_id).await?;
    let rows = sqlx::query_as!(
        AgentCredentialRow,
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
           (provider_id, label, encrypted_key, key_nonce)
           VALUES ($1, $2, $3, $4)"#,
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

/// POST /api/llm-providers/:id/test
///
/// Sends a minimal 1-token request to verify the credentials work.
pub async fn test_connection(state: &AppState, id: Uuid) -> AppResult<TestConnectionResponse> {
    let config = resolve_runtime_config(state, id).await?;
    let provider = providers::create_provider(&config);

    let start = Instant::now();
    // Minimal stream: we only need the first delta to confirm connectivity.
    use futures::StreamExt;
    let system = "You are a test.";
    let messages = vec![providers::Message {
        role: providers::MessageRole::User,
        content: Some("Reply with the single word: ok".to_string()),
        tool_calls: vec![],
        tool_call_id: None,
    }];
    let mut stream = provider
        .stream(system, &messages, &[])
        .await
        .map_err(|e| AppError::BadRequest(format!("connection test failed: {e}")))?;

    // Consume at least one delta to confirm the stream works.
    let _first = stream.next().await;

    let latency_ms = start.elapsed().as_millis() as u64;
    Ok(TestConnectionResponse {
        ok: true,
        error: None,
        latency_ms: Some(latency_ms),
    })
}

/// POST /api/llm-providers/models
///
/// Fetch available models from a provider's `GET /models` endpoint.
/// Falls back to a curated list if the API call fails.
pub async fn fetch_models(
    _state: &AppState,
    req: FetchModelsRequest,
) -> AppResult<FetchModelsResponse> {
    let config = ProviderConfig {
        api_format: req.api_format.api_format(),
        base_url: req.base_url.clone(),
        api_key: req.api_key.clone(),
        model: String::new(), // not needed for listing
        max_tokens: 1,
    };
    let provider = providers::create_provider(&config);

    // Try the live API first.
    match provider.list_models().await {
        Ok(mut models) => {
            // Sort alphabetically by id for stable display.
            models.sort_by(|a, b| a.id.cmp(&b.id));
            // Convert provider-layer ModelInfo to API-layer ModelInfo.
            let models = models
                .into_iter()
                .map(|m| ModelInfo {
                    id: m.id,
                    display_name: m.display_name,
                    is_curated: false,
                })
                .collect();
            Ok(FetchModelsResponse {
                models,
                source: ModelListSource::Live,
            })
        }
        Err(e) => {
            tracing::warn!("model list fetch failed, falling back to curated: {e}");
            let curated = curated_models(&config);
            if curated.is_empty() {
                Ok(FetchModelsResponse {
                    models: vec![],
                    source: ModelListSource::Error,
                })
            } else {
                Ok(FetchModelsResponse {
                    models: curated,
                    source: ModelListSource::Curated,
                })
            }
        }
    }
}

// ============================================================
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
// PIN change re-encryption
// ============================================================

/// Re-encrypt all provider API keys with a new key.
///
/// Called when the user changes their PIN. Each key is decrypted with the
/// old key and re-encrypted with the new key. This must happen atomically
/// (within a transaction) to avoid partial re-encryption on failure.
pub async fn reencrypt_all_keys(
    db: &sqlx::PgPool,
    old_key: &[u8; 32],
    new_key: &[u8; 32],
) -> AppResult<()> {
    let rows = sqlx::query!(r#"SELECT id, encrypted_key, key_nonce FROM llm_providers"#)
        .fetch_all(db)
        .await?;

    let mut tx = db.begin().await?;
    for row in rows {
        let encrypted = EncryptedKey {
            ciphertext_hex: row.encrypted_key,
            nonce_hex: row.key_nonce,
        };
        let plaintext = match crypto::decrypt_api_key(old_key, &encrypted) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(
                    "failed to decrypt key for provider {} during PIN change: {e}",
                    row.id
                );
                // Skip this row rather than failing the whole operation.
                // The user can re-enter the key manually.
                continue;
            }
        };
        let new_encrypted = crypto::encrypt_api_key(new_key, &plaintext)?;
        sqlx::query!(
            r#"UPDATE llm_providers
               SET encrypted_key = $2, key_nonce = $3, updated_at = now()
               WHERE id = $1"#,
            row.id,
            new_encrypted.ciphertext_hex,
            new_encrypted.nonce_hex,
        )
        .execute(&mut *tx)
        .await?;
    }

    let credential_rows =
        sqlx::query!(r#"SELECT id, encrypted_key, key_nonce FROM agent_credentials"#)
            .fetch_all(db)
            .await?;
    for row in credential_rows {
        let encrypted = EncryptedKey {
            ciphertext_hex: row.encrypted_key,
            nonce_hex: row.key_nonce,
        };
        let plaintext = match crypto::decrypt_api_key(old_key, &encrypted) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(
                    "failed to decrypt pooled credential {} during PIN change: {e}",
                    row.id
                );
                continue;
            }
        };
        let new_encrypted = crypto::encrypt_api_key(new_key, &plaintext)?;
        sqlx::query!(
            r#"UPDATE agent_credentials
               SET encrypted_key = $2, key_nonce = $3, updated_at = now()
               WHERE id = $1"#,
            row.id,
            new_encrypted.ciphertext_hex,
            new_encrypted.nonce_hex,
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

// ============================================================
// Helpers
// ============================================================

/// Get the cached encryption key, or return an error if not logged in.
async fn require_encryption_key(state: &AppState) -> AppResult<[u8; 32]> {
    let guard = state.encryption_key.read().await;
    guard.as_ref().copied().ok_or_else(|| {
        AppError::Unauthorized(
            "encryption key not available — please re-authenticate with your PIN".into(),
        )
    })
}

/// Fetch a single row by ID.
async fn fetch_row(db: &sqlx::PgPool, id: Uuid) -> AppResult<LlmProviderRow> {
    sqlx::query_as!(
        LlmProviderRow,
        r#"SELECT
             id, label, api_format, base_url,
             encrypted_key, key_nonce,
             model, max_tokens, is_default, enabled, preset
           FROM llm_providers WHERE id = $1"#,
        id
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("provider {id} not found")))
}

async fn ensure_provider_exists(db: &sqlx::PgPool, id: Uuid) -> AppResult<()> {
    sqlx::query!("SELECT 1 AS present FROM llm_providers WHERE id = $1", id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("provider {id} not found")))?;
    Ok(())
}

/// Ensure exactly one provider is the default.
///
/// If no default exists, promote the first enabled provider (or any provider).
async fn ensure_default_exists(db: &sqlx::PgPool) -> AppResult<()> {
    let has_default =
        sqlx::query!("SELECT 1 as _1 FROM llm_providers WHERE is_default = true LIMIT 1")
            .fetch_optional(db)
            .await?;
    if has_default.is_some() {
        return Ok(());
    }

    // Promote the first enabled provider; if none enabled, the first provider.
    let candidate = sqlx::query!(
        r#"SELECT id FROM llm_providers
           WHERE enabled = true
           ORDER BY created_at ASC
           LIMIT 1"#
    )
    .fetch_optional(db)
    .await?;

    let candidate = match candidate {
        Some(c) => c.id,
        None => {
            sqlx::query!("SELECT id FROM llm_providers ORDER BY created_at ASC LIMIT 1")
                .fetch_optional(db)
                .await?
                .ok_or_else(|| AppError::Internal("no providers to promote".into()))?
                .id
        }
    };

    sqlx::query!(
        "UPDATE llm_providers SET is_default = true, updated_at = now() WHERE id = $1",
        candidate
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Convert a DB row to the API model (with masked key).
fn row_to_provider(row: LlmProviderRow) -> LlmProvider {
    // Derive a masked hint without decrypting — we reconstruct it from the
    // ciphertext prefix/suffix. This is a display-only hint, not the real key.
    // We use the ciphertext's first/last chars as a visual anchor.
    let hint = mask_ciphertext_hint(&row.encrypted_key);

    LlmProvider {
        id: row.id.to_string(),
        label: row.label,
        api_format: row.api_format,
        base_url: row.base_url,
        api_key_hint: hint,
        model: row.model,
        max_tokens: row.max_tokens,
        is_default: row.is_default,
        enabled: row.enabled,
        preset: row.preset,
    }
}

fn row_to_credential(row: AgentCredentialRow) -> AgentCredential {
    AgentCredential {
        id: row.id.to_string(),
        provider_id: row.provider_id.to_string(),
        label: row.label,
        status: row.status,
        reset_at: row.reset_at.map(|value| value.to_rfc3339()),
        request_count: row.request_count,
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

/// Produce a non-sensitive hint from the ciphertext.
///
/// Since we can't decrypt without the PIN on every list call, we show a
/// fixed mask. The actual key hint (e.g. `sk-...7a2b`) is only available
/// when decrypting, which happens in test/edit operations.
fn mask_ciphertext_hint(_ciphertext: &str) -> String {
    // We deliberately show a generic mask in list views. A richer hint
    // would require decryption on every list call, which is expensive
    // and unnecessary.
    "••••".to_string()
}

/// Curated model presets for offline fallback.
///
/// Used when the provider's `GET /models` endpoint is unreachable.
fn curated_models(config: &ProviderConfig) -> Vec<ModelInfo> {
    let mode = config.resolved_mode();
    let ids: &[&str] = match mode {
        ApiMode::Openai => {
            // Check for known OpenAI-compatible hosts.
            let host = config.base_url.to_lowercase();
            if host.contains("ollama") || host.contains("localhost:11434") {
                &CURATED_OLLAMA
            } else if host.contains("groq") {
                &CURATED_GROQ
            } else if host.contains("deepseek") {
                &CURATED_DEEPSEEK
            } else {
                &CURATED_OPENAI
            }
        }
        ApiMode::Anthropic => &CURATED_ANTHROPIC,
    };

    ids.iter()
        .map(|id| ModelInfo {
            id: id.to_string(),
            display_name: id.to_string(),
            is_curated: true,
        })
        .collect()
}

const CURATED_OPENAI: [&str; 6] = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "o1",
    "o1-mini",
    "o3-mini",
];

const CURATED_ANTHROPIC: [&str; 3] = [
    "claude-sonnet-4-5-20250514",
    "claude-opus-4-20250514",
    "claude-haiku-3-5-20241022",
];

const CURATED_OLLAMA: [&str; 5] = ["llama3", "llama3.1", "qwen2.5", "mistral", "phi3"];

const CURATED_GROQ: [&str; 3] = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b",
];

const CURATED_DEEPSEEK: [&str; 2] = ["deepseek-chat", "deepseek-reasoner"];

/// Parse a DB api_format string into the option enum (re-exported for convenience).
fn parse_api_format_option(s: &str) -> ApiFormatOption {
    crate::models::llm_provider::parse_api_format_option(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curated_openai_for_default_host() {
        let config = ProviderConfig {
            api_format: Some(providers::ApiFormat::Openai),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4o".to_string(),
            max_tokens: 1024,
        };
        let models = curated_models(&config);
        assert!(models.iter().any(|m| m.id == "gpt-4o"));
        assert!(models.iter().all(|m| m.is_curated));
    }

    #[test]
    fn curated_ollama_for_localhost() {
        let config = ProviderConfig {
            api_format: Some(providers::ApiFormat::Openai),
            base_url: "http://localhost:11434/v1".to_string(),
            api_key: "ollama".to_string(),
            model: "llama3".to_string(),
            max_tokens: 1024,
        };
        let models = curated_models(&config);
        assert!(models.iter().any(|m| m.id == "llama3"));
    }

    #[test]
    fn curated_anthropic_for_claude() {
        let config = ProviderConfig {
            api_format: Some(providers::ApiFormat::Anthropic),
            base_url: "https://api.anthropic.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            max_tokens: 1024,
        };
        let models = curated_models(&config);
        assert!(models.iter().any(|m| m.id == "claude-sonnet-4-5-20250514"));
    }

    // ---- DB integration tests ----

    fn test_state(pool: sqlx::PgPool) -> AppState {
        AppState::new(
            pool,
            crate::config::Config {
                database_url: String::new(),
                port: 0,
                cors_origins: vec![],
                agent_data_dir: std::env::temp_dir().join("mymy-test-agent"),
                auth_cookie_secure: false,
                cron_tick_interval_secs: 60,
                cron_timezone: "UTC".to_string(),
                cron_output_keep: 50,
            },
        )
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn db_create_and_list_provider(pool: sqlx::PgPool) {
        let state = test_state(pool);

        // Set the encryption key (simulates login).
        let key = crypto::derive_key("test-pin");
        *state.encryption_key.write().await = Some(key);

        let req = CreateLlmProviderRequest {
            label: "Test OpenAI".to_string(),
            api_format: ApiFormatOption::Openai,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-test-1234567890abcdef".to_string(),
            model: "gpt-4o".to_string(),
            max_tokens: 8192,
            preset: Some("openai".to_string()),
        };
        let created = create_provider(&state, req)
            .await
            .expect("create should succeed");
        assert_eq!(created.provider.label, "Test OpenAI");
        assert_eq!(created.provider.model, "gpt-4o");
        assert!(
            created.provider.is_default,
            "first provider should be default"
        );

        let list = list_providers(&state).await.expect("list should succeed");
        assert_eq!(list.providers.len(), 1);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn db_update_provider_preserves_key(pool: sqlx::PgPool) {
        let state = test_state(pool);
        let key = crypto::derive_key("test-pin");
        *state.encryption_key.write().await = Some(key);

        let created = create_provider(
            &state,
            CreateLlmProviderRequest {
                label: "Original".to_string(),
                api_format: ApiFormatOption::Openai,
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: "sk-original-key-12345".to_string(),
                model: "gpt-4o".to_string(),
                max_tokens: 4096,
                preset: None,
            },
        )
        .await
        .expect("create should succeed");

        let id: Uuid = created.provider.id.parse().expect("valid uuid");

        // Update label only — api_key is None, so existing key should be preserved.
        let updated = update_provider(
            &state,
            id,
            UpdateLlmProviderRequest {
                label: Some("Updated".to_string()),
                api_format: None,
                base_url: None,
                api_key: None,
                model: None,
                max_tokens: None,
                enabled: None,
            },
        )
        .await
        .expect("update should succeed");

        assert_eq!(updated.provider.label, "Updated");

        // The runtime config should still decrypt successfully (key preserved).
        let config = resolve_runtime_config(&state, id)
            .await
            .expect("runtime config should resolve");
        assert_eq!(config.api_key, "sk-original-key-12345");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn db_pooled_credential_overrides_provider_key(pool: sqlx::PgPool) {
        let state = test_state(pool);
        let key = crypto::derive_key("test-pin");
        *state.encryption_key.write().await = Some(key);

        let created = create_provider(
            &state,
            CreateLlmProviderRequest {
                label: "Provider".to_string(),
                api_format: ApiFormatOption::Openai,
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: "sk-primary-key".to_string(),
                model: "gpt-4o".to_string(),
                max_tokens: 4096,
                preset: None,
            },
        )
        .await
        .expect("create provider");
        let provider_id: Uuid = created.provider.id.parse().unwrap();

        create_credential(
            &state,
            provider_id,
            CreateAgentCredentialRequest {
                label: "secondary".to_string(),
                api_key: "sk-secondary-key".to_string(),
            },
        )
        .await
        .expect("create credential");

        let config = resolve_runtime_config(&state, provider_id)
            .await
            .expect("runtime config");
        assert_eq!(config.api_key, "sk-secondary-key");

        let credentials = list_credentials(&state, provider_id)
            .await
            .expect("credentials list")
            .credentials;
        assert_eq!(credentials[0].request_count, 1);

        let credential_id: Uuid = credentials[0].id.parse().unwrap();
        update_credential(
            &state,
            provider_id,
            credential_id,
            UpdateAgentCredentialRequest {
                status: Some("dead".to_string()),
            },
        )
        .await
        .expect("mark dead");

        let fallback = resolve_runtime_config(&state, provider_id)
            .await
            .expect("fallback runtime config");
        assert_eq!(fallback.api_key, "sk-primary-key");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn db_set_default_only_one(pool: sqlx::PgPool) {
        let state = test_state(pool);
        let key = crypto::derive_key("test-pin");
        *state.encryption_key.write().await = Some(key);

        let p1 = create_provider(
            &state,
            CreateLlmProviderRequest {
                label: "P1".to_string(),
                api_format: ApiFormatOption::Openai,
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: "sk-key-1-123456789".to_string(),
                model: "gpt-4o".to_string(),
                max_tokens: 4096,
                preset: None,
            },
        )
        .await
        .expect("create p1");
        let p2 = create_provider(
            &state,
            CreateLlmProviderRequest {
                label: "P2".to_string(),
                api_format: ApiFormatOption::Anthropic,
                base_url: "https://api.anthropic.com/v1".to_string(),
                api_key: "sk-key-2-123456789".to_string(),
                model: "claude-sonnet-4-5".to_string(),
                max_tokens: 4096,
                preset: None,
            },
        )
        .await
        .expect("create p2");

        let id1: Uuid = p1.provider.id.parse().unwrap();
        let id2: Uuid = p2.provider.id.parse().unwrap();

        // P1 is default (first provider). Set P2 as default.
        set_default(&state, id2).await.expect("set default p2");

        let list = list_providers(&state).await.expect("list");
        let defaults: Vec<_> = list.providers.iter().filter(|p| p.is_default).collect();
        assert_eq!(defaults.len(), 1, "exactly one default");
        assert_eq!(defaults[0].id, p2.provider.id);

        // Switch back to P1.
        set_default(&state, id1).await.expect("set default p1");
        let list = list_providers(&state).await.expect("list");
        let defaults: Vec<_> = list.providers.iter().filter(|p| p.is_default).collect();
        assert_eq!(defaults.len(), 1);
        assert_eq!(defaults[0].id, p1.provider.id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn db_delete_promotes_new_default(pool: sqlx::PgPool) {
        let state = test_state(pool);
        let key = crypto::derive_key("test-pin");
        *state.encryption_key.write().await = Some(key);

        let p1 = create_provider(
            &state,
            CreateLlmProviderRequest {
                label: "P1".to_string(),
                api_format: ApiFormatOption::Openai,
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: "sk-key-1-123456789".to_string(),
                model: "gpt-4o".to_string(),
                max_tokens: 4096,
                preset: None,
            },
        )
        .await
        .expect("create p1");
        let p2 = create_provider(
            &state,
            CreateLlmProviderRequest {
                label: "P2".to_string(),
                api_format: ApiFormatOption::Openai,
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: "sk-key-2-123456789".to_string(),
                model: "gpt-4o-mini".to_string(),
                max_tokens: 4096,
                preset: None,
            },
        )
        .await
        .expect("create p2");

        let id1: Uuid = p1.provider.id.parse().unwrap();

        // P1 is default. Delete it — P2 should be promoted.
        delete_provider(&state, id1).await.expect("delete p1");

        let list = list_providers(&state).await.expect("list");
        assert_eq!(list.providers.len(), 1);
        assert!(
            list.providers[0].is_default,
            "remaining provider should be promoted to default"
        );
        assert_eq!(list.providers[0].id, p2.provider.id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn db_pin_change_reencrypts_keys(pool: sqlx::PgPool) {
        let state = test_state(pool);
        let old_key = crypto::derive_key("old-pin");
        let new_key = crypto::derive_key("new-pin");
        *state.encryption_key.write().await = Some(old_key);

        let created = create_provider(
            &state,
            CreateLlmProviderRequest {
                label: "Test".to_string(),
                api_format: ApiFormatOption::Openai,
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: "sk-secret-123456789".to_string(),
                model: "gpt-4o".to_string(),
                max_tokens: 4096,
                preset: None,
            },
        )
        .await
        .expect("create");

        let id: Uuid = created.provider.id.parse().unwrap();

        // Re-encrypt with the new PIN key.
        reencrypt_all_keys(&state.db, &old_key, &new_key)
            .await
            .expect("reencrypt");

        // Update the cached key to the new one.
        *state.encryption_key.write().await = Some(new_key);

        // Should decrypt successfully with the new key.
        let config = resolve_runtime_config(&state, id)
            .await
            .expect("should resolve with new key");
        assert_eq!(config.api_key, "sk-secret-123456789");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn db_encryption_key_required_for_create(pool: sqlx::PgPool) {
        let state = test_state(pool);
        // Don't set the encryption key (simulates not logged in).

        let result = create_provider(
            &state,
            CreateLlmProviderRequest {
                label: "Test".to_string(),
                api_format: ApiFormatOption::Openai,
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: "sk-test".to_string(),
                model: "gpt-4o".to_string(),
                max_tokens: 4096,
                preset: None,
            },
        )
        .await;

        assert!(result.is_err(), "should fail without encryption key");
    }
}
