use crate::agent::crypto::{self, EncryptedKey};
use crate::error::{AppError, AppResult};

/// Rotate every stored credential inside the caller's transaction. Credential
/// rotation is all-or-nothing because committing a partially rotated catalog
/// would make the remaining entries undecryptable after the owner PIN changes.
pub async fn reencrypt_all_keys_for_pin_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    current_pin: &str,
    next_pin: &str,
) -> AppResult<()> {
    let legacy_key = crypto::derive_legacy_key(current_pin);
    let current_key = crypto::derive_key(current_pin);
    let next_key = if current_pin == next_pin {
        current_key
    } else {
        crypto::derive_key(next_pin)
    };
    let rows = sqlx::query!(
        r#"SELECT id, encrypted_key, key_nonce, key_derivation_version
           FROM llm_providers"#
    )
    .fetch_all(&mut **tx)
    .await?;

    for row in rows {
        let encrypted = EncryptedKey {
            ciphertext_hex: row.encrypted_key,
            nonce_hex: row.key_nonce,
        };
        let decryption_key = match row.key_derivation_version {
            1 => &legacy_key,
            2 => &current_key,
            _ => {
                return Err(AppError::Internal(
                    "credential key derivation version is unsupported".to_string(),
                ));
            }
        };
        let plaintext = crypto::decrypt_api_key(decryption_key, &encrypted).map_err(|error| {
            tracing::error!(
                "credential rotation aborted because provider {} could not be decrypted: {error}",
                row.id
            );
            AppError::Internal(
                "credential rotation failed; no credentials were changed".to_string(),
            )
        })?;
        let new_encrypted = crypto::encrypt_api_key(&next_key, &plaintext)?;
        sqlx::query!(
            r#"UPDATE llm_providers
               SET encrypted_key = $2, key_nonce = $3,
                   key_derivation_version = 2, updated_at = now()
               WHERE id = $1"#,
            row.id,
            new_encrypted.ciphertext_hex,
            new_encrypted.nonce_hex,
        )
        .execute(&mut **tx)
        .await?;
    }

    let credential_rows = sqlx::query!(
        r#"SELECT id, encrypted_key, key_nonce, key_derivation_version
           FROM agent_credentials"#
    )
    .fetch_all(&mut **tx)
    .await?;
    for row in credential_rows {
        let encrypted = EncryptedKey {
            ciphertext_hex: row.encrypted_key,
            nonce_hex: row.key_nonce,
        };
        let decryption_key = match row.key_derivation_version {
            1 => &legacy_key,
            2 => &current_key,
            _ => {
                return Err(AppError::Internal(
                    "credential key derivation version is unsupported".to_string(),
                ));
            }
        };
        let plaintext = crypto::decrypt_api_key(decryption_key, &encrypted).map_err(|error| {
            tracing::error!(
                "credential rotation aborted because pooled credential {} could not be decrypted: {error}",
                row.id
            );
            AppError::Internal(
                "credential rotation failed; no credentials were changed".to_string(),
            )
        })?;
        let new_encrypted = crypto::encrypt_api_key(&next_key, &plaintext)?;
        sqlx::query!(
            r#"UPDATE agent_credentials
               SET encrypted_key = $2, key_nonce = $3,
                   key_derivation_version = 2, updated_at = now()
               WHERE id = $1"#,
            row.id,
            new_encrypted.ciphertext_hex,
            new_encrypted.nonce_hex,
        )
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Upgrade historical HKDF rows after the PIN was successfully verified. The
/// transaction also rewrites already-current rows only when at least one
/// legacy row exists, leaving the catalog in one derivation version.
pub async fn migrate_legacy_keys_for_pin_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    pin: &str,
) -> AppResult<()> {
    let has_legacy = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1 FROM llm_providers WHERE key_derivation_version = 1
             UNION ALL
             SELECT 1 FROM agent_credentials WHERE key_derivation_version = 1
           )"#,
    )
    .fetch_one(&mut **tx)
    .await?;
    if !has_legacy {
        return Ok(());
    }
    reencrypt_all_keys_for_pin_in_transaction(tx, pin, pin).await
}
