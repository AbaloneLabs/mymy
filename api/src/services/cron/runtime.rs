use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatFile {
    updated_at: String,
    firing: bool,
}

pub(super) struct HeartbeatSnapshot {
    pub(super) alive: bool,
    pub(super) firing: bool,
    pub(super) age_secs: i64,
}

pub(super) fn record_heartbeat(state: &AppState, firing: bool) {
    let payload = HeartbeatFile {
        updated_at: Utc::now().to_rfc3339(),
        firing,
    };
    let path = heartbeat_path(state);
    match serde_json::to_string_pretty(&payload) {
        Ok(content) => {
            if let Err(err) = write_file_atomic(&path, &content) {
                tracing::warn!(error = %err, "cron heartbeat write failed");
            }
        }
        Err(err) => tracing::warn!(error = %err, "cron heartbeat serialization failed"),
    }
}

pub(super) fn read_heartbeat(state: &AppState) -> Option<HeartbeatSnapshot> {
    let raw = fs::read_to_string(heartbeat_path(state)).ok()?;
    let heartbeat = serde_json::from_str::<HeartbeatFile>(&raw).ok()?;
    let updated_at = DateTime::parse_from_rfc3339(&heartbeat.updated_at)
        .ok()?
        .with_timezone(&Utc);
    let age_secs = (Utc::now() - updated_at).num_seconds().max(0);
    Some(HeartbeatSnapshot {
        alive: age_secs < (state.config.cron_tick_interval_secs as i64 * 3),
        firing: heartbeat.firing,
        age_secs,
    })
}

fn heartbeat_path(state: &AppState) -> PathBuf {
    state
        .config
        .agent_data_dir
        .join("cron")
        .join("heartbeat.json")
}

pub(super) struct TickLock {
    path: PathBuf,
}

impl TickLock {
    pub(super) fn try_acquire(state: &AppState) -> AppResult<Option<Self>> {
        let path = state.config.agent_data_dir.join("cron").join("tick.lock");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| AppError::Internal(format!("cron lock dir create failed: {err}")))?;
        }
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => Ok(Some(Self { path })),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(None),
            Err(err) => Err(AppError::Internal(format!(
                "cron tick lock acquire failed: {err}"
            ))),
        }
    }
}

impl Drop for TickLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub(super) fn write_file_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp.{}", Uuid::new_v4()));
    fs::write(&tmp, content)?;
    fs::rename(tmp, path)?;
    Ok(())
}
