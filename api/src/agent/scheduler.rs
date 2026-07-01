//! Cron and interval scheduling primitives for native agent jobs.
//!
//! This module provides the durable job store and deterministic schedule
//! calculations. The HTTP/UI surface can build on top without duplicating the
//! at-most-once and catch-up semantics.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Schedule {
    Once { at: DateTime<Utc> },
    Interval { seconds: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobMode {
    Agent,
    NoAgent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJob {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub schedule: Schedule,
    pub mode: JobMode,
    pub enabled: bool,
    pub next_run_at: DateTime<Utc>,
    pub run_count: u32,
    pub max_runs: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct CronStore {
    path: PathBuf,
}

impl CronStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> std::io::Result<Vec<CronJob>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&self.path)?;
        serde_json::from_str(&raw).map_err(|err| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid cron jobs file: {err}"),
            )
        })
    }

    pub fn save(&self, jobs: &[CronJob]) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = self
            .path
            .with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
        fs::write(&tmp, serde_json::to_string_pretty(jobs).unwrap())?;
        fs::rename(tmp, &self.path)?;
        Ok(())
    }

    pub fn upsert(&self, mut job: CronJob) -> std::io::Result<()> {
        let mut jobs = self.load()?;
        if job.id.is_empty() {
            job.id = uuid::Uuid::new_v4().to_string();
        }
        if let Some(existing) = jobs.iter_mut().find(|existing| existing.id == job.id) {
            *existing = job;
        } else {
            jobs.push(job);
        }
        self.save(&jobs)
    }

    pub fn due_jobs(&self, now: DateTime<Utc>) -> std::io::Result<Vec<CronJob>> {
        Ok(self
            .load()?
            .into_iter()
            .filter(|job| job.enabled)
            .filter(|job| job.max_runs.is_none_or(|max| job.run_count < max))
            .filter(|job| job.next_run_at <= now)
            .collect())
    }

    pub fn mark_run(&self, id: &str, now: DateTime<Utc>) -> std::io::Result<()> {
        let mut jobs = self.load()?;
        if let Some(job) = jobs.iter_mut().find(|job| job.id == id) {
            job.run_count = job.run_count.saturating_add(1);
            job.next_run_at = compute_next_run(&job.schedule, now);
            if matches!(job.schedule, Schedule::Once { .. }) {
                job.enabled = false;
            }
        }
        self.save(&jobs)
    }
}

pub fn parse_schedule(input: &str, now: DateTime<Utc>) -> Option<Schedule> {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.strip_prefix("every ") {
        let seconds = parse_duration_seconds(rest)?;
        return Some(Schedule::Interval { seconds });
    }
    if let Some(seconds) = parse_duration_seconds(trimmed) {
        return Some(Schedule::Once {
            at: now + Duration::seconds(seconds),
        });
    }
    DateTime::parse_from_rfc3339(trimmed)
        .ok()
        .map(|dt| Schedule::Once {
            at: dt.with_timezone(&Utc),
        })
}

pub fn compute_next_run(schedule: &Schedule, last_run_at: DateTime<Utc>) -> DateTime<Utc> {
    match schedule {
        Schedule::Once { at } => *at,
        Schedule::Interval { seconds } => last_run_at + Duration::seconds(*seconds),
    }
}

fn parse_duration_seconds(input: &str) -> Option<i64> {
    let trimmed = input.trim();
    let (number, unit) = trimmed.split_at(trimmed.len().saturating_sub(1));
    let value = number.parse::<i64>().ok()?;
    match unit {
        "s" => Some(value),
        "m" => Some(value * 60),
        "h" => Some(value * 60 * 60),
        "d" => Some(value * 60 * 60 * 24),
        _ => None,
    }
}

pub fn jobs_path(agent_data_dir: &Path) -> PathBuf {
    agent_data_dir.join("cron").join("jobs.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_interval_and_duration() {
        let now = Utc::now();
        assert!(matches!(
            parse_schedule("every 30m", now),
            Some(Schedule::Interval { seconds: 1800 })
        ));
        assert!(matches!(
            parse_schedule("2h", now),
            Some(Schedule::Once { .. })
        ));
    }

    #[test]
    fn store_marks_due_job_once() {
        let dir = std::env::temp_dir().join(format!("mymy-cron-{}", uuid::Uuid::new_v4()));
        let store = CronStore::new(dir.join("jobs.json"));
        let now = Utc::now();
        let job = CronJob {
            id: "job1".to_string(),
            title: "Test".to_string(),
            prompt: "hello".to_string(),
            schedule: Schedule::Once { at: now },
            mode: JobMode::NoAgent,
            enabled: true,
            next_run_at: now,
            run_count: 0,
            max_runs: Some(1),
        };
        store.upsert(job).unwrap();
        assert_eq!(store.due_jobs(now).unwrap().len(), 1);
        store.mark_run("job1", now).unwrap();
        assert!(store.due_jobs(now).unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
