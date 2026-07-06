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
    sqlx::query(
        r#"
        INSERT INTO agent_file_observations
            (agent_profile, logical_path, last_seen_hash, last_seen_size,
             last_seen_modified_at, last_seen_source, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (agent_profile, logical_path) DO UPDATE SET
            last_seen_hash = EXCLUDED.last_seen_hash,
            last_seen_size = EXCLUDED.last_seen_size,
            last_seen_modified_at = EXCLUDED.last_seen_modified_at,
            last_seen_source = EXCLUDED.last_seen_source,
            updated_at = now()
        "#,
    )
    .bind(agent_profile)
    .bind(logical_path)
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
    let Some(row) = sqlx::query_as::<_, ObservationRow>(
        r#"
        SELECT last_seen_hash, last_seen_size, last_seen_modified_at
          FROM agent_file_observations
         WHERE agent_profile = $1 AND logical_path = $2
        "#,
    )
    .bind(agent_profile)
    .bind(logical_path)
    .fetch_optional(db)
    .await
    .map_err(|err| format!("file observation lookup failed: {err}"))?
    else {
        return Ok(());
    };

    let fingerprint = fingerprint_path(physical_path).await?;
    if row.last_seen_hash != fingerprint.hash
        || row.last_seen_size != fingerprint.size as i64
        || row.last_seen_modified_at != fingerprint.modified_at
    {
        return Err(STALE_WRITE_MESSAGE.to_string());
    }
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
struct ObservationRow {
    last_seen_hash: String,
    last_seen_size: i64,
    last_seen_modified_at: Option<DateTime<Utc>>,
}
