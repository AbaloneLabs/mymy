use crate::agent::crypto::{self, EncryptedKey};
use crate::error::AppResult;

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
