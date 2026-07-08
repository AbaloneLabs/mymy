use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::llm_provider::{AgentCredential, ApiFormatOption, LlmProvider};
use crate::state::AppState;

/// A raw DB row for `llm_providers`. The `encrypted_key` and
/// `key_nonce` are the encrypted key material.
#[derive(Debug, FromRow)]
pub(super) struct LlmProviderRow {
    pub(super) id: Uuid,
    pub(super) label: String,
    pub(super) api_format: String,
    pub(super) base_url: String,
    pub(super) encrypted_key: String,
    pub(super) key_nonce: String,
    pub(super) model: String,
    pub(super) max_tokens: i32,
    pub(super) is_default: bool,
    pub(super) enabled: bool,
    pub(super) preset: Option<String>,
}

#[derive(Debug, FromRow)]
pub(super) struct AgentCredentialRow {
    pub(super) id: Uuid,
    pub(super) provider_id: Uuid,
    pub(super) label: String,
    pub(super) status: String,
    pub(super) reset_at: Option<DateTime<Utc>>,
    pub(super) request_count: i64,
    pub(super) created_at: DateTime<Utc>,
    pub(super) updated_at: DateTime<Utc>,
}

/// Get the cached encryption key, or return an error if not logged in.
pub(super) async fn require_encryption_key(state: &AppState) -> AppResult<[u8; 32]> {
    let guard = state.encryption_key.read().await;
    guard.as_ref().copied().ok_or_else(|| {
        AppError::Unauthorized(
            "encryption key not available — please re-authenticate with your PIN".into(),
        )
    })
}

/// Fetch a single row by ID.
pub(super) async fn fetch_row(db: &sqlx::PgPool, id: Uuid) -> AppResult<LlmProviderRow> {
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

pub(super) async fn ensure_provider_exists(db: &sqlx::PgPool, id: Uuid) -> AppResult<()> {
    sqlx::query!("SELECT 1 AS present FROM llm_providers WHERE id = $1", id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("provider {id} not found")))?;
    Ok(())
}

/// Ensure exactly one provider is the default.
///
/// If no default exists, promote the first enabled provider (or any provider).
pub(super) async fn ensure_default_exists(db: &sqlx::PgPool) -> AppResult<()> {
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
pub(super) fn row_to_provider(row: LlmProviderRow) -> LlmProvider {
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

pub(super) fn row_to_credential(row: AgentCredentialRow) -> AgentCredential {
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

/// Parse a DB api_format string into the option enum (re-exported for convenience).
pub(super) fn parse_api_format_option(s: &str) -> ApiFormatOption {
    crate::models::llm_provider::parse_api_format_option(s)
}
