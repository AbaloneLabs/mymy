//! Shared application state passed to all handlers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Weak;

use sqlx::PgPool;
use tokio::sync::{Mutex, Notify, RwLock};
use uuid::Uuid;

use crate::agent::clarify::ClarifyGate;
use crate::agent::execution::RunCancellation;
use crate::config::Config;
use crate::services::document_conversion::DocumentConversionPool;

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
    /// Fixed-size pool for untrusted document ZIP/XML conversion. The pool is
    /// intentionally separate from Tokio's general blocking workers and uses a
    /// bounded queue so overload becomes a retryable response.
    pub document_conversion_pool: Arc<DocumentConversionPool>,
    /// Serializes writes to the same Drive file across UI, agent, and sync
    /// entry points in this API process. The weak registry avoids retaining a
    /// mutex for every historical path while still making the fingerprint
    /// check and atomic replacement one indivisible critical section.
    drive_write_locks: Arc<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>>,
    /// Coordinates file-level operations with namespace mutations such as
    /// move, trash, and restore. Ordinary reads/writes take a shared guard;
    /// namespace mutations take an exclusive guard so a parent rename cannot
    /// race an editor save to a child path.
    drive_namespace_lock: Arc<RwLock<()>>,
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
            document_conversion_pool: Arc::new(DocumentConversionPool::from_environment()),
            drive_write_locks: Arc::new(Mutex::new(HashMap::new())),
            drive_namespace_lock: Arc::new(RwLock::new(())),
        }
    }

    /// Return the process-local lock for a physical Drive path.
    ///
    /// Callers must resolve and boundary-check logical paths before requesting
    /// a lock. Keeping lock allocation on shared state makes independently
    /// implemented write surfaces participate in the same revision protocol.
    pub async fn drive_write_lock(&self, path: &Path) -> Arc<Mutex<()>> {
        let mut locks = self.drive_write_locks.lock().await;
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(path).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(Mutex::new(()));
        locks.insert(path.to_path_buf(), Arc::downgrade(&lock));
        lock
    }

    pub(crate) fn drive_namespace_lock(&self) -> &RwLock<()> {
        &self.drive_namespace_lock
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
