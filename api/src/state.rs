//! Shared application state passed to all handlers.

use std::collections::HashMap;
use std::sync::Arc;

use sqlx::PgPool;
use tokio::sync::{Notify, RwLock};
use uuid::Uuid;

use crate::agent::clarify::ClarifyGate;
use crate::agent::execution::RunCancellation;
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
    /// Wakes local run workers and event subscribers after durable DB changes.
    ///
    /// PostgreSQL remains the source of truth; this notification only reduces
    /// polling latency and is intentionally safe to miss across processes.
    pub agent_run_notify: Arc<Notify>,
    /// Process-local fast path for cancellation. The durable DB request is
    /// authoritative; entries are keyed by lease epoch so an expired worker
    /// cannot unregister or signal a newer owner accidentally.
    pub run_cancellations: Arc<RwLock<HashMap<(Uuid, i64), RunCancellation>>>,
}

impl AppState {
    /// Create a new AppState with an empty encryption key cache.
    pub fn new(db: PgPool, config: Config) -> Self {
        Self {
            db,
            config,
            encryption_key: Arc::new(RwLock::new(None)),
            clarify_gate: Arc::new(ClarifyGate::new()),
            agent_run_notify: Arc::new(Notify::new()),
            run_cancellations: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register_run_cancellation(
        &self,
        run_id: Uuid,
        lease_epoch: i64,
    ) -> RunCancellation {
        let cancellation = RunCancellation::new();
        self.run_cancellations
            .write()
            .await
            .insert((run_id, lease_epoch), cancellation.clone());
        cancellation
    }

    pub async fn unregister_run_cancellation(&self, run_id: Uuid, lease_epoch: i64) {
        self.run_cancellations
            .write()
            .await
            .remove(&(run_id, lease_epoch));
    }

    pub async fn signal_run_cancellation(&self, run_id: Uuid) {
        for ((candidate_id, _), cancellation) in self.run_cancellations.read().await.iter() {
            if *candidate_id == run_id {
                cancellation.cancel();
            }
        }
    }
}
