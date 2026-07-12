//! File observation tracking for native agents.
//!
//! Agents can edit files through several tool surfaces, while users can also
//! edit the same Drive files directly from the UI. The agent must not keep
//! mutating a file from stale context after the user changed it, so this module
//! records the fingerprint of every file version an agent has actually read or
//! written. Write tools consult that fingerprint before mutating an existing
//! file and force a fresh `read_file` call when it no longer matches.

use std::path::Path;

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::fs;

use crate::services::{drive, resource_identity};

#[derive(Debug, Clone, Copy)]
pub enum FileObservationSource {
    Read,
    Write,
}

impl FileObservationSource {
    fn as_str(self) -> &'static str {
        match self {
            FileObservationSource::Read => "read",
            FileObservationSource::Write => "write",
        }
    }
}

#[derive(Debug, Clone)]
pub struct FileFingerprint {
    pub hash: String,
    pub size: u64,
    pub modified_at: Option<DateTime<Utc>>,
}

const STALE_WRITE_MESSAGE: &str =
    "File changed since your last read/write. Call read_file(path) before modifying it again.";
const UNOBSERVED_WRITE_MESSAGE: &str =
    "Existing files must be read before overwrite. Call read_file(path) and use its fingerprint.";

pub async fn fingerprint_path(path: &Path) -> Result<FileFingerprint, String> {
    let bytes = fs::read(path)
        .await
        .map_err(|err| format!("file fingerprint read failed: {err}"))?;
    let metadata = fs::metadata(path)
        .await
        .map_err(|err| format!("file fingerprint metadata failed: {err}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let modified_at = metadata.modified().ok().map(DateTime::<Utc>::from);
    Ok(FileFingerprint {
        hash: hex::encode(hasher.finalize()),
        size: metadata.len(),
        modified_at,
    })
}

pub async fn record_file_observation(
    db: Option<&PgPool>,
    agent_profile: Option<&str>,
    logical_path: &str,
    physical_path: &Path,
    source: FileObservationSource,
) -> Result<(), String> {
    let (Some(db), Some(agent_profile)) = (db, agent_profile) else {
        return Ok(());
    };
    let fingerprint = fingerprint_path(physical_path).await?;
    record_file_observation_fingerprint(db, agent_profile, logical_path, &fingerprint, source).await
}

/// Record the exact revision returned by a locked read or write operation.
///
/// Re-reading a path after its lock is released can accidentally attribute a
/// later user's revision to the agent. Callers with an authoritative result
/// fingerprint use this form to keep the knowledge boundary truthful.
pub async fn record_file_observation_fingerprint(
    db: &PgPool,
    agent_profile: &str,
    logical_path: &str,
    fingerprint: &FileFingerprint,
    source: FileObservationSource,
) -> Result<(), String> {
    let logical_path = drive::normalize_logical_drive_path(logical_path)
        .map_err(|_| "file observation path is invalid".to_string())?;
    let resource_id = resource_identity::active_resource_id_for_path(db, &logical_path)
        .await
        .map_err(|_| "file observation identity lookup failed".to_string())?;
    sqlx::query(
        r#"
        INSERT INTO agent_file_observations
            (agent_profile, logical_path, resource_id, last_seen_hash, last_seen_size,
             last_seen_modified_at, last_seen_source, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (agent_profile, logical_path) DO UPDATE SET
            resource_id = EXCLUDED.resource_id,
            last_seen_hash = EXCLUDED.last_seen_hash,
            last_seen_size = EXCLUDED.last_seen_size,
            last_seen_modified_at = EXCLUDED.last_seen_modified_at,
            last_seen_source = EXCLUDED.last_seen_source,
            updated_at = now()
        "#,
    )
    .bind(agent_profile)
    .bind(&logical_path)
    .bind(resource_id)
    .bind(&fingerprint.hash)
    .bind(fingerprint.size as i64)
    .bind(fingerprint.modified_at)
    .bind(source.as_str())
    .execute(db)
    .await
    .map_err(|err| format!("file observation record failed: {err}"))?;
    Ok(())
}

pub async fn ensure_file_not_changed_since_observed(
    db: Option<&PgPool>,
    agent_profile: Option<&str>,
    logical_path: &str,
    physical_path: &Path,
) -> Result<(), String> {
    let (Some(db), Some(agent_profile)) = (db, agent_profile) else {
        return Ok(());
    };
    if !physical_path.exists() {
        return Ok(());
    }
    let logical_path = drive::normalize_logical_drive_path(logical_path)
        .map_err(|_| "file observation path is invalid".to_string())?;
    let resource_id = resource_identity::active_resource_id_for_path(db, &logical_path)
        .await
        .map_err(|_| "file observation identity lookup failed".to_string())?;
    let Some(row) = sqlx::query_as::<_, ObservationRow>(
        r#"
        SELECT last_seen_hash, last_seen_size
          FROM agent_file_observations
         WHERE agent_profile = $1
           AND ((resource_id = $3) OR (resource_id IS NULL AND logical_path = $2))
         ORDER BY (resource_id = $3) DESC, updated_at DESC
         LIMIT 1
        "#,
    )
    .bind(agent_profile)
    .bind(&logical_path)
    .bind(resource_id)
    .fetch_optional(db)
    .await
    .map_err(|err| format!("file observation lookup failed: {err}"))?
    else {
        return Err(UNOBSERVED_WRITE_MESSAGE.to_string());
    };

    let fingerprint = fingerprint_path(physical_path).await?;
    // PostgreSQL timestamps have lower precision than several filesystems.
    // Content hash and size are the optimistic-concurrency identity; mtime is
    // retained for diagnostics but must not cause a false stale-write result
    // merely because a nanosecond value was rounded during persistence.
    if row.last_seen_hash != fingerprint.hash || row.last_seen_size != fingerprint.size as i64 {
        return Err(STALE_WRITE_MESSAGE.to_string());
    }
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
struct ObservationRow {
    last_seen_hash: String,
    last_seen_size: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "./migrations")]
    async fn existing_file_requires_observation_and_rejects_stale_content(pool: PgPool) {
        sqlx::query(
            r#"INSERT INTO native_agents
                 (profile, name, drive_path, sandbox_status)
               VALUES ('observation-test', 'Observation test',
                       '/drive/agents/observation-test', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let directory =
            std::env::temp_dir().join(format!("mymy-observation-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&directory).await.unwrap();
        let path = directory.join("state.md");
        tokio::fs::write(&path, "first").await.unwrap();

        let unobserved = ensure_file_not_changed_since_observed(
            Some(&pool),
            Some("observation-test"),
            "/drive/agents/observation-test/state.md",
            &path,
        )
        .await;
        assert_eq!(unobserved.unwrap_err(), UNOBSERVED_WRITE_MESSAGE);

        record_file_observation(
            Some(&pool),
            Some("observation-test"),
            "/drive/agents/observation-test/state.md",
            &path,
            FileObservationSource::Read,
        )
        .await
        .unwrap();
        ensure_file_not_changed_since_observed(
            Some(&pool),
            Some("observation-test"),
            "/drive/agents/observation-test/state.md",
            &path,
        )
        .await
        .unwrap();

        tokio::fs::write(&path, "changed by another actor")
            .await
            .unwrap();
        let stale = ensure_file_not_changed_since_observed(
            Some(&pool),
            Some("observation-test"),
            "/drive/agents/observation-test/state.md",
            &path,
        )
        .await;
        assert_eq!(stale.unwrap_err(), STALE_WRITE_MESSAGE);
        let _ = tokio::fs::remove_dir_all(directory).await;
    }
}
