//! Cron and interval scheduling primitives for native agent jobs.
//!
//! This module provides the durable job store and deterministic schedule
//! calculations. The HTTP/UI surface can build on top without duplicating the
//! at-most-once and catch-up semantics.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Datelike, Duration, Timelike, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Schedule {
    Once { at: DateTime<Utc> },
    Interval { seconds: i64 },
    Cron { expression: String },
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
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_from: Option<Vec<String>>,
    #[serde(default = "default_wake_agent")]
    pub wake_agent: bool,
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
        self.mark_run_with_timezone(id, now, "UTC")
    }

    pub fn mark_run_with_timezone(
        &self,
        id: &str,
        now: DateTime<Utc>,
        timezone: &str,
    ) -> std::io::Result<()> {
        let mut jobs = self.load()?;
        if let Some(job) = jobs.iter_mut().find(|job| job.id == id) {
            job.run_count = job.run_count.saturating_add(1);
            job.next_run_at = compute_next_run_in_timezone(&job.schedule, now, timezone);
            if matches!(job.schedule, Schedule::Once { .. }) {
                job.enabled = false;
            }
        }
        jobs.retain(|job| job.max_runs.is_none_or(|max| job.run_count < max));
        self.save(&jobs)
    }

    pub fn referenced_skill_names(&self) -> std::io::Result<HashSet<String>> {
        Ok(self
            .load()?
            .into_iter()
            .flat_map(|job| job.skills.into_iter())
            .collect())
    }
}

pub fn parse_schedule(input: &str, now: DateTime<Utc>) -> Option<Schedule> {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.strip_prefix("every ") {
        let seconds = parse_duration_seconds(rest)?;
        return Some(Schedule::Interval { seconds });
    }
    if is_cron_expression(trimmed) {
        return Some(Schedule::Cron {
            expression: trimmed.to_string(),
        });
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
    compute_next_run_in_timezone(schedule, last_run_at, "UTC")
}

pub fn compute_next_run_in_timezone(
    schedule: &Schedule,
    last_run_at: DateTime<Utc>,
    timezone: &str,
) -> DateTime<Utc> {
    match schedule {
        Schedule::Once { at } => *at,
        Schedule::Interval { seconds } => last_run_at + Duration::seconds(*seconds),
        Schedule::Cron { expression } => next_cron_run(expression, last_run_at, timezone),
    }
}

fn parse_duration_seconds(input: &str) -> Option<i64> {
    let mut total = 0_i64;
    let mut digits = String::new();
    let mut saw_unit = false;
    for ch in input.trim().chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            continue;
        }
        let value = digits.parse::<i64>().ok()?;
        digits.clear();
        let multiplier = match ch {
            's' => 1,
            'm' => 60,
            'h' => 60 * 60,
            'd' => 60 * 60 * 24,
            'w' => 60 * 60 * 24 * 7,
            _ => return None,
        };
        total = total.checked_add(value.checked_mul(multiplier)?)?;
        saw_unit = true;
    }
    if !digits.is_empty() || !saw_unit || total <= 0 {
        return None;
    }
    Some(total)
}

fn is_cron_expression(input: &str) -> bool {
    let fields = input.split_whitespace().collect::<Vec<_>>();
    fields.len() == 5
        && fields.iter().all(|field| {
            field
                .chars()
                .all(|ch| ch.is_ascii_digit() || "*,-/".contains(ch))
        })
}

fn next_cron_run(expression: &str, after: DateTime<Utc>, timezone: &str) -> DateTime<Utc> {
    let tz = timezone.parse::<Tz>().unwrap_or(chrono_tz::UTC);
    let after_local = after.with_timezone(&tz);
    let Some(mut candidate) = after_local
        .with_second(0)
        .and_then(|value| value.with_nanosecond(0))
        .map(|value| value + Duration::minutes(1))
    else {
        return after + Duration::minutes(1);
    };
    for _ in 0..(366 * 24 * 60) {
        if cron_matches(expression, candidate) {
            return candidate.with_timezone(&Utc);
        }
        candidate += Duration::minutes(1);
    }
    after + Duration::hours(24)
}

fn cron_matches<Z: chrono::TimeZone>(expression: &str, candidate: DateTime<Z>) -> bool {
    let fields = expression.split_whitespace().collect::<Vec<_>>();
    if fields.len() != 5 {
        return false;
    }
    field_matches(fields[0], candidate.minute(), 0, 59)
        && field_matches(fields[1], candidate.hour(), 0, 23)
        && field_matches(fields[2], candidate.day(), 1, 31)
        && field_matches(fields[3], candidate.month(), 1, 12)
        && field_matches(fields[4], candidate.weekday().num_days_from_sunday(), 0, 7)
}

fn field_matches(field: &str, value: u32, min: u32, max: u32) -> bool {
    field
        .split(',')
        .any(|part| part_matches(part, value, min, max))
}

fn part_matches(part: &str, value: u32, min: u32, max: u32) -> bool {
    let (range_part, step) = match part.split_once('/') {
        Some((range, step)) => (range, step.parse::<u32>().ok().filter(|step| *step > 0)),
        None => (part, Some(1)),
    };
    let Some(step) = step else {
        return false;
    };
    let (start, end) = if range_part == "*" {
        (min, max)
    } else if let Some((start, end)) = range_part.split_once('-') {
        let Some(start) = start.parse::<u32>().ok() else {
            return false;
        };
        let Some(end) = end.parse::<u32>().ok() else {
            return false;
        };
        (start, end)
    } else {
        let Some(exact) = range_part.parse::<u32>().ok() else {
            return false;
        };
        (exact, exact)
    };
    let value = if max == 7 && value == 0 && start == 7 {
        7
    } else {
        value
    };
    value >= start && value <= end && (value - start) % step == 0
}

pub fn jobs_path(agent_data_dir: &Path) -> PathBuf {
    agent_data_dir.join("cron").join("jobs.json")
}

fn default_wake_agent() -> bool {
    true
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
            parse_schedule("1h30m", now),
            Some(Schedule::Once { .. })
        ));
        assert!(matches!(
            parse_schedule("2w", now),
            Some(Schedule::Once { .. })
        ));
        assert!(matches!(
            parse_schedule("0 9 * * *", now),
            Some(Schedule::Cron { .. })
        ));
        assert!(matches!(
            parse_schedule("2h", now),
            Some(Schedule::Once { .. })
        ));
    }

    #[test]
    fn cron_next_run_matches_basic_daily_expression() {
        let after = DateTime::parse_from_rfc3339("2026-07-01T08:59:30Z")
            .unwrap()
            .with_timezone(&Utc);
        let next = compute_next_run(
            &Schedule::Cron {
                expression: "0 9 * * *".to_string(),
            },
            after,
        );
        assert_eq!(next.to_rfc3339(), "2026-07-01T09:00:00+00:00");
    }

    #[test]
    fn cron_next_run_uses_configured_timezone() {
        let after = DateTime::parse_from_rfc3339("2026-07-01T12:59:30Z")
            .unwrap()
            .with_timezone(&Utc);
        let next = compute_next_run_in_timezone(
            &Schedule::Cron {
                expression: "0 9 * * *".to_string(),
            },
            after,
            "America/New_York",
        );
        assert_eq!(next.to_rfc3339(), "2026-07-01T13:00:00+00:00");
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
            skills: Vec::new(),
            context_from: None,
            wake_agent: true,
        };
        store.upsert(job).unwrap();
        assert_eq!(store.due_jobs(now).unwrap().len(), 1);
        store.mark_run("job1", now).unwrap();
        assert!(store.due_jobs(now).unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
