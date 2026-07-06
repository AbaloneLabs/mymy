//! Shared application state passed to all handlers.

use std::sync::Arc;

use sqlx::PgPool;
use tokio::sync::RwLock;

use crate::agent::clarify::ClarifyGate;
use crate::config::Config;

/// In-memory cache of the encryption key derived from the user's PIN.
///
/// The PIN itself is never stored. Instead, at login time we derive a
/// 256-bit AES key (via HKDF) and cache it here for the session lifetime.
/// This avoids re-prompting for the PIN on every API key operation while
/// keeping the key out of the database.
///
/// `None` means the user hasn't logged in since the server started, or
/// has logged out. In that case, API key operations return an error
/// prompting re-authentication.
pub type EncryptionKeyCache = Arc<RwLock<Option<[u8; 32]>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Config,
    /// Cached HKDF-derived AES key for API key encryption/decryption.
    pub encryption_key: EncryptionKeyCache,
    /// Live clarify requests keyed by SSE/chat session.
    pub clarify_gate: Arc<ClarifyGate>,
}

impl AppState {
    /// Create a new AppState with an empty encryption key cache.
    pub fn new(db: PgPool, config: Config) -> Self {
        Self {
            db,
            config,
            encryption_key: Arc::new(RwLock::new(None)),
            clarify_gate: Arc::new(ClarifyGate::new()),
        }
    }
}
