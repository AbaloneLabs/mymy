//! LLM provider domain operations.
//!
//! CRUD for provider configs, plus the model-list proxy and connection test.
//! API keys are encrypted at rest (see `agent::crypto`).

use std::time::Instant;

use uuid::Uuid;

use crate::agent::crypto;
use crate::agent::providers::{self, ProviderConfig};
use crate::error::{AppError, AppResult};
use crate::models::llm_provider::{
    CreateLlmProviderRequest, DeleteLlmProviderResponse, FetchModelsRequest, FetchModelsResponse,
    LlmProviderResponse, LlmProvidersResponse, ModelInfo, ModelListSource, SetDefaultResponse,
    TestConnectionResponse, UpdateLlmProviderRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

mod credentials;
mod key_rotation;
mod model_catalog;
mod repository;
mod runtime_config;

pub use credentials::{
    create_credential, delete_credential, list_credentials, list_rate_limit_status,
    mark_credential_rate_limited, update_credential,
};
pub use key_rotation::reencrypt_all_keys;
use model_catalog::curated_models;
use repository::{ensure_default_exists, fetch_row, require_encryption_key, row_to_provider};
pub use runtime_config::{
    resolve_default_provider_id, resolve_runtime_config, resolve_runtime_config_with_credential,
};

/// GET /api/llm-providers
pub async fn list_providers(state: &AppState) -> AppResult<LlmProvidersResponse> {
    let rows = sqlx::query_as!(
        repository::LlmProviderRow,
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

#[cfg(test)]
mod tests;
