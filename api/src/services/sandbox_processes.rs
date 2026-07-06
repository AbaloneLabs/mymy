//! Durable sandbox process metadata service.
//!
//! The HTTP sandbox API and native terminal tools both talk to the same runner
//! and persist the same process lifecycle records. This module owns the shared
//! database contract so new sandbox features do not need to duplicate preview
//! registration, runner reconciliation, ownership checks, or row-to-model
//! mapping in each caller.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::sandbox::{SandboxProcess, SandboxProcessStatus};

#[derive(Debug, FromRow)]
struct SandboxProcessRow {
    id: Uuid,
    agent_profile: String,
    project_id: Option<Uuid>,
    command: String,
    cwd: String,
    status: String,
    pid: Option<i32>,
    started_at: DateTime<Utc>,
    stopped_at: Option<DateTime<Utc>>,
    exit_code: Option<i32>,
    metadata: Value,
    cpu_percent: Option<f64>,
    memory_bytes: Option<i64>,
    memory_limit_bytes: Option<i64>,
    storage_bytes: Option<i64>,
    storage_limit_bytes: Option<i64>,
    open_ports: Value,
    last_heartbeat_at: Option<DateTime<Utc>>,
    preview_token: Option<String>,
    preview_target_url: Option<String>,
}

pub(crate) struct NewRunningProcess<'a> {
    pub(crate) id: Uuid,
    pub(crate) agent_profile: &'a str,
    pub(crate) project_id: Option<Uuid>,
    pub(crate) command: &'a str,
    pub(crate) cwd: &'a str,
    pub(crate) pid: Option<i32>,
    pub(crate) metadata: &'a Value,
}

pub(crate) async fn list_processes(
    db: &sqlx::PgPool,
    agent_profile: Option<&str>,
    project_id: Option<Uuid>,
) -> AppResult<Vec<SandboxProcess>> {
    let rows = if let Some(profile) = agent_profile {
        if let Some(project_id) = project_id {
            sqlx::query_as!(
                SandboxProcessRow,
                r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                          p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                          p.cpu_percent, p.memory_bytes, p.memory_limit_bytes,
                          p.storage_bytes, p.storage_limit_bytes,
                          p.open_ports AS "open_ports!: Value",
                          p.last_heartbeat_at,
                          preview.token AS "preview_token?",
                          preview.target_url AS "preview_target_url?"
                   FROM sandbox_processes p
                   LEFT JOIN LATERAL (
                       SELECT token, target_url
                       FROM preview_endpoints
                       WHERE process_id = p.id AND status = 'active'
                       ORDER BY created_at DESC
                       LIMIT 1
                   ) preview ON true
                   WHERE p.agent_profile = $1 AND p.project_id = $2
                   ORDER BY p.started_at DESC"#,
                profile,
                project_id
            )
            .fetch_all(db)
            .await?
        } else {
            sqlx::query_as!(
                SandboxProcessRow,
                r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                          p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                          p.cpu_percent, p.memory_bytes, p.memory_limit_bytes,
                          p.storage_bytes, p.storage_limit_bytes,
                          p.open_ports AS "open_ports!: Value",
                          p.last_heartbeat_at,
                          preview.token AS "preview_token?",
                          preview.target_url AS "preview_target_url?"
                   FROM sandbox_processes p
                   LEFT JOIN LATERAL (
                       SELECT token, target_url
                       FROM preview_endpoints
                       WHERE process_id = p.id AND status = 'active'
                       ORDER BY created_at DESC
                       LIMIT 1
                   ) preview ON true
                   WHERE p.agent_profile = $1
                   ORDER BY p.started_at DESC"#,
                profile
            )
            .fetch_all(db)
            .await?
        }
    } else {
        sqlx::query_as!(
            SandboxProcessRow,
            r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                      p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                      p.cpu_percent, p.memory_bytes, p.memory_limit_bytes,
                      p.storage_bytes, p.storage_limit_bytes,
                      p.open_ports AS "open_ports!: Value",
                      p.last_heartbeat_at,
                      preview.token AS "preview_token?",
                      preview.target_url AS "preview_target_url?"
               FROM sandbox_processes p
               LEFT JOIN LATERAL (
                   SELECT token, target_url
                   FROM preview_endpoints
                   WHERE process_id = p.id AND status = 'active'
                   ORDER BY created_at DESC
                   LIMIT 1
               ) preview ON true
               WHERE ($1::uuid IS NULL OR p.project_id = $1)
               ORDER BY p.started_at DESC"#,
            project_id
        )
        .fetch_all(db)
        .await?
    };

    Ok(rows.into_iter().map(row_to_process).collect())
}

pub(crate) async fn list_owned_processes(
    db: &sqlx::PgPool,
    agent_profile: &str,
    project_id: Option<Uuid>,
    limit: i64,
) -> AppResult<Vec<SandboxProcess>> {
    let rows = sqlx::query_as!(
        SandboxProcessRow,
        r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                  p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                  p.cpu_percent, p.memory_bytes, p.memory_limit_bytes,
                  p.storage_bytes, p.storage_limit_bytes,
                  p.open_ports AS "open_ports!: Value",
                  p.last_heartbeat_at,
                  preview.token AS "preview_token?",
                  preview.target_url AS "preview_target_url?"
           FROM sandbox_processes p
           LEFT JOIN LATERAL (
               SELECT token, target_url
               FROM preview_endpoints
               WHERE process_id = p.id AND status = 'active'
               ORDER BY created_at DESC
               LIMIT 1
           ) preview ON true
           WHERE p.agent_profile = $1
             AND ($2::uuid IS NULL OR p.project_id = $2)
           ORDER BY p.started_at DESC
           LIMIT $3"#,
        agent_profile,
        project_id,
        limit,
    )
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(row_to_process).collect())
}

pub(crate) async fn insert_running_process(
    db: &sqlx::PgPool,
    record: &NewRunningProcess<'_>,
) -> AppResult<()> {
    sqlx::query!(
        r#"INSERT INTO sandbox_processes
             (id, agent_profile, project_id, command, cwd, status, pid, metadata)
           VALUES ($1, $2, $3, $4, $5, 'running', $6, $7)"#,
        record.id,
        record.agent_profile,
        record.project_id,
        record.command,
        record.cwd,
        record.pid,
        record.metadata,
    )
    .execute(db)
    .await?;
    Ok(())
}

pub(crate) async fn fetch_process(db: &sqlx::PgPool, id: Uuid) -> AppResult<SandboxProcess> {
    sqlx::query_as!(
        SandboxProcessRow,
        r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                  p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                  p.cpu_percent, p.memory_bytes, p.memory_limit_bytes,
                  p.storage_bytes, p.storage_limit_bytes,
                  p.open_ports AS "open_ports!: Value",
                  p.last_heartbeat_at,
                  preview.token AS "preview_token?",
                  preview.target_url AS "preview_target_url?"
           FROM sandbox_processes p
           LEFT JOIN LATERAL (
               SELECT token, target_url
               FROM preview_endpoints
               WHERE process_id = p.id AND status = 'active'
               ORDER BY created_at DESC
               LIMIT 1
           ) preview ON true
           WHERE p.id = $1"#,
        id
    )
    .fetch_optional(db)
    .await?
    .map(row_to_process)
    .ok_or_else(|| AppError::NotFound(format!("sandbox process {id} not found")))
}

pub(crate) async fn fetch_process_for_owner(
    db: &sqlx::PgPool,
    id: Uuid,
    agent_profile: &str,
    project_id: Option<Uuid>,
) -> AppResult<SandboxProcess> {
    sqlx::query_as!(
        SandboxProcessRow,
        r#"SELECT p.id, p.agent_profile, p.project_id, p.command, p.cwd, p.status,
                  p.pid, p.started_at, p.stopped_at, p.exit_code, p.metadata,
                  p.cpu_percent, p.memory_bytes, p.memory_limit_bytes,
                  p.storage_bytes, p.storage_limit_bytes,
                  p.open_ports AS "open_ports!: Value",
                  p.last_heartbeat_at,
                  preview.token AS "preview_token?",
                  preview.target_url AS "preview_target_url?"
           FROM sandbox_processes p
           LEFT JOIN LATERAL (
               SELECT token, target_url
               FROM preview_endpoints
               WHERE process_id = p.id AND status = 'active'
               ORDER BY created_at DESC
               LIMIT 1
           ) preview ON true
           WHERE p.id = $1
             AND p.agent_profile = $2
             AND ($3::uuid IS NULL OR p.project_id = $3)"#,
        id,
        agent_profile,
        project_id,
    )
    .fetch_optional(db)
    .await?
    .map(row_to_process)
    .ok_or_else(|| AppError::NotFound(format!("sandbox process {id} not found")))
}

pub(crate) async fn ensure_process_owner(
    db: &sqlx::PgPool,
    id: Uuid,
    agent_profile: &str,
    project_id: Option<Uuid>,
) -> AppResult<()> {
    let row = sqlx::query!(
        r#"SELECT id
           FROM sandbox_processes
           WHERE id = $1
             AND agent_profile = $2
             AND ($3::uuid IS NULL OR project_id = $3)"#,
        id,
        agent_profile,
        project_id,
    )
    .fetch_optional(db)
    .await?;
    if row.is_some() {
        Ok(())
    } else {
        Err(AppError::NotFound(format!(
            "sandbox process {id} not found"
        )))
    }
}

pub(crate) async fn create_process_preview(
    db: &sqlx::PgPool,
    agent_profile: &str,
    project_id: Option<Uuid>,
    process_id: Uuid,
    label: &str,
    target_url: &str,
) -> AppResult<String> {
    let token = Uuid::new_v4().simple().to_string();
    sqlx::query!(
        r#"INSERT INTO preview_endpoints
             (agent_profile, project_id, process_id, label, target_url, token, visibility, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'session', 'active')"#,
        agent_profile,
        project_id,
        process_id,
        label,
        target_url,
        token,
    )
    .execute(db)
    .await?;
    Ok(format!("/api/previews/{token}"))
}

pub(crate) async fn stop_process_record(db: &sqlx::PgPool, id: Uuid) -> AppResult<()> {
    sqlx::query!(
        r#"UPDATE sandbox_processes
           SET status = 'stopped', stopped_at = COALESCE(stopped_at, now())
           WHERE id = $1"#,
        id
    )
    .execute(db)
    .await?;
    mark_process_previews(db, id, "stopped").await
}

pub(crate) struct RunnerProcessReconcile<'a> {
    pub id: Uuid,
    pub runner_status: &'a str,
    pub pid: Option<i32>,
    pub command: &'a str,
    pub cwd: &'a str,
    pub port: Option<u16>,
    pub cpu_percent: Option<f64>,
    pub memory_bytes: Option<i64>,
    pub storage_bytes: Option<i64>,
    pub open_ports: Value,
}

pub(crate) async fn reconcile_from_runner(
    db: &sqlx::PgPool,
    update: RunnerProcessReconcile<'_>,
) -> AppResult<()> {
    let status = normalize_process_status(update.runner_status);
    let stopped = matches!(status, "exited" | "failed" | "stopped");
    let metadata = serde_json::json!({
        "runnerCommand": update.command,
        "runnerCwd": update.cwd,
        "port": update.port,
    });
    sqlx::query!(
        r#"UPDATE sandbox_processes
           SET status = $2,
               pid = COALESCE($3, pid),
               stopped_at = CASE WHEN $4 THEN COALESCE(stopped_at, now()) ELSE stopped_at END,
               metadata = metadata || $5,
               cpu_percent = $6,
               memory_bytes = $7,
               storage_bytes = $8,
               open_ports = $9,
               last_heartbeat_at = now()
           WHERE id = $1"#,
        update.id,
        status,
        update.pid,
        stopped,
        metadata,
        update.cpu_percent,
        update.memory_bytes,
        update.storage_bytes,
        update.open_ports,
    )
    .execute(db)
    .await?;
    if stopped {
        mark_process_previews(db, update.id, "stopped").await?;
    }
    Ok(())
}

async fn mark_process_previews(db: &sqlx::PgPool, id: Uuid, status: &str) -> AppResult<()> {
    sqlx::query!(
        "UPDATE preview_endpoints SET status = $2, updated_at = now() WHERE process_id = $1",
        id,
        status,
    )
    .execute(db)
    .await?;
    Ok(())
}

fn row_to_process(row: SandboxProcessRow) -> SandboxProcess {
    let open_ports = row
        .open_ports
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_u64())
                .filter_map(|port| u16::try_from(port).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let uptime_seconds = if row.stopped_at.is_none() {
        Some((Utc::now() - row.started_at).num_seconds().max(0))
    } else {
        None
    };
    SandboxProcess {
        id: row.id.to_string(),
        agent_profile: row.agent_profile,
        project_id: row.project_id.map(|id| id.to_string()),
        command: row.command,
        cwd: row.cwd,
        status: parse_process_status(&row.status),
        pid: row.pid,
        started_at: row.started_at.to_rfc3339(),
        stopped_at: row.stopped_at.map(|time| time.to_rfc3339()),
        exit_code: row.exit_code,
        metadata: row.metadata,
        cpu_percent: row.cpu_percent,
        memory_bytes: row.memory_bytes,
        memory_limit_bytes: row.memory_limit_bytes,
        storage_bytes: row.storage_bytes,
        storage_limit_bytes: row.storage_limit_bytes,
        open_ports,
        uptime_seconds,
        last_heartbeat_at: row.last_heartbeat_at.map(|time| time.to_rfc3339()),
        preview_path: row
            .preview_token
            .map(|token| format!("/api/previews/{token}")),
        preview_target_url: row.preview_target_url,
    }
}

fn normalize_process_status(value: &str) -> &'static str {
    match value {
        "exited" => "exited",
        "failed" => "failed",
        "stopped" => "stopped",
        "starting" => "starting",
        _ => "running",
    }
}

fn parse_process_status(value: &str) -> SandboxProcessStatus {
    match value {
        "starting" => SandboxProcessStatus::Starting,
        "exited" => SandboxProcessStatus::Exited,
        "failed" => SandboxProcessStatus::Failed,
        "stopped" => SandboxProcessStatus::Stopped,
        _ => SandboxProcessStatus::Running,
    }
}
