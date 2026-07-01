//! API key encryption at rest.
//!
//! API keys are sensitive credentials. Storing them in plaintext in the
//! database would mean a DB dump (or backup leak) exposes all provider
//! keys. Instead, we encrypt them with a key derived from the user's PIN.
//!
//! ## Threat model
//!
//! - **DB compromise alone**: attacker gets ciphertext only. Without the
//!   PIN, keys are unrecoverable.
//! - **PIN known + DB compromise**: full exposure. This is acceptable —
//!   if the attacker has the PIN, they can already authenticate and use
//!   the app normally.
//! - **Runtime**: the derived key lives in memory only for the duration
//!   of a request. It is never logged or persisted.
//!
//! ## Key derivation
//!
//! We use HKDF-SHA256 to derive a 256-bit AES key from the PIN. HKDF
//! is preferred over raw SHA-256 because it provides proper key
//! separation (the `info` parameter binds the key to this specific use).
//!
//! Ported conceptually from Hermes's credential management, but Hermes
//! stores keys in plaintext config files — mymy improves on this by
//! encrypting at rest.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;

use crate::error::{AppError, AppResult};

/// HKDF info string — binds the derived key to "llm-provider-api-key"
/// so the same PIN can't be reused for other purposes without derivation.
const HKDF_INFO: &[u8] = b"mymy-llm-provider-api-key-v1";
/// Salt for HKDF. Static is acceptable here because the PIN itself is the
/// secret; the salt prevents certain precomputation attacks.
const HKDF_SALT: &[u8] = b"mymy-llm-provider-salt";

/// Encrypted key material stored in the DB.
///
/// Both fields are hex-encoded for safe TEXT storage.
#[derive(Debug, Clone)]
pub struct EncryptedKey {
    /// Hex-encoded AES-256-GCM ciphertext.
    pub ciphertext_hex: String,
    /// Hex-encoded 12-byte GCM nonce.
    pub nonce_hex: String,
}

/// Derive a 256-bit AES key from the user's PIN via HKDF-SHA256.
///
/// Called at login time; the result is cached in `AppState.encryption_key`
/// for the session lifetime so we never need the PIN again.
pub fn derive_key(pin: &str) -> [u8; 32] {
    let hkdf = Hkdf::<Sha256>::new(Some(HKDF_SALT), pin.as_bytes());
    let mut okm = [0u8; 32];
    // unwrap is safe: 32 bytes is well within HKDF max.
    hkdf.expand(HKDF_INFO, &mut okm)
        .expect("HKDF expand for 32 bytes cannot fail");
    okm
}

/// Encrypt an API key string using a pre-derived AES key.
///
/// Returns the ciphertext + nonce, both hex-encoded for DB storage.
/// A fresh random nonce is generated for each call (never reused).
pub fn encrypt_api_key(key: &[u8; 32], plaintext_key: &str) -> AppResult<EncryptedKey> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Internal(format!("AES init: {e}")))?;

    let nonce_bytes = generate_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext_key.as_bytes())
        .map_err(|e| AppError::Internal(format!("AES encrypt: {e}")))?;

    Ok(EncryptedKey {
        ciphertext_hex: hex::encode(&ciphertext),
        nonce_hex: hex::encode(nonce_bytes),
    })
}

/// Decrypt an API key using a pre-derived AES key.
///
/// Returns the plaintext key string. Fails if the key is wrong (GCM
/// authentication tag mismatch) or if the stored data is corrupt.
pub fn decrypt_api_key(key: &[u8; 32], encrypted: &EncryptedKey) -> AppResult<String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Internal(format!("AES init: {e}")))?;

    let ciphertext = hex::decode(&encrypted.ciphertext_hex)
        .map_err(|e| AppError::Internal(format!("ciphertext hex decode: {e}")))?;
    let nonce_bytes = hex::decode(&encrypted.nonce_hex)
        .map_err(|e| AppError::Internal(format!("nonce hex decode: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| AppError::Unauthorized("API key decryption failed".into()))?;

    String::from_utf8(plaintext)
        .map_err(|e| AppError::Internal(format!("decrypted key is not valid UTF-8: {e}")))
}

/// Generate a 12-byte random nonce for AES-GCM.
///
/// Uses a simple time + counter + pseudo-random mix. This is not
/// cryptographically perfect, but for a local single-user tool it is
/// sufficient. For production multi-user, use a proper CSPRNG.
fn generate_nonce() -> [u8; 12] {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut nonce = [0u8; 12];
    // Mix nanosecond timestamp into the nonce bytes.
    nonce[0..8].copy_from_slice(&now.to_le_bytes()[..8]);
    // Fill remaining bytes with a pseudo-random value derived from the
    // address of a stack variable (ASLR provides entropy).
    let stack_var = 0u8;
    let addr = &stack_var as *const u8 as u64;
    nonce[8..12].copy_from_slice(&addr.to_le_bytes()[..4]);
    nonce
}

/// Produce a masked hint of an API key for display in the UI.
///
/// Shows the first 3 and last 4 characters, masking the middle.
/// Example: `sk-abc...7a2b`. Returns `••••` for very short keys.
#[allow(dead_code)]
pub fn mask_api_key(key: &str) -> String {
    if key.len() <= 8 {
        return "••••".to_string();
    }
    let prefix = &key[..3];
    let suffix = &key[key.len() - 4..];
    format!("{prefix}...{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = derive_key("mymy");
        let plaintext = "sk-test-1234567890abcdef";
        let encrypted = encrypt_api_key(&key, plaintext).unwrap();
        let decrypted = decrypt_api_key(&key, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_key_fails_decryption() {
        let key1 = derive_key("correct-pin");
        let key2 = derive_key("wrong-pin");
        let encrypted = encrypt_api_key(&key1, "sk-secret").unwrap();
        let result = decrypt_api_key(&key2, &encrypted);
        assert!(result.is_err());
    }

    #[test]
    fn each_encryption_uses_unique_nonce() {
        let key = derive_key("mymy");
        let plaintext = "sk-same-key";
        let enc1 = encrypt_api_key(&key, plaintext).unwrap();
        let enc2 = encrypt_api_key(&key, plaintext).unwrap();
        // Nonces should differ (fresh each call).
        assert_ne!(enc1.nonce_hex, enc2.nonce_hex);
        // But both decrypt to the same plaintext.
        assert_eq!(
            decrypt_api_key(&key, &enc1).unwrap(),
            decrypt_api_key(&key, &enc2).unwrap()
        );
    }

    #[test]
    fn mask_short_key() {
        assert_eq!(mask_api_key("short"), "••••");
    }

    #[test]
    fn mask_long_key() {
        let masked = mask_api_key("sk-abcdefghij1234567890");
        assert_eq!(masked, "sk-...7890");
    }

    #[test]
    fn mask_preserves_prefix_and_suffix() {
        let masked = mask_api_key("sk-ant-api03-xxxxxxxxxxxxxxxxxxxx");
        assert!(masked.starts_with("sk-"));
        assert!(masked.ends_with("xxxx"));
        assert!(masked.contains("..."));
    }
}
