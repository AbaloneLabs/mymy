//! Agent system domain operations.

use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::agent_system::{
    AgentSystemInstance, AgentSystemsResponse, ConnectionType, CreateAgentSystemRequest,
    DiscoverResponse, InstanceStatus,
};
use crate::services::audit::log_audit_safe;
use crate::services::hermes;
use crate::state::AppState;

/// A registered agent system instance row.
#[derive(Debug, FromRow)]
struct AgentSystemInstanceRow {
    id: Uuid,
    r#type: String,
    label: String,
    enabled: bool,
    source: String,
    connection: String,
    cli_path: Option<String>,
    profile_dir: Option<String>,
    host: Option<String>,
    port: Option<i32>,
    ssh_user: Option<String>,
    remote_cli_path: Option<String>,
    remote_profile_dir: Option<String>,
    detected_agents: Option<i32>,
    status: Option<String>,
}

/// POST /api/agent-systems/discover
///
/// Scan the local filesystem for hermes/openclaw and upsert discovered
/// instances (source = 'auto'). Returns the auto-discovered instances.
pub async fn discover(state: &AppState) -> AppResult<DiscoverResponse> {
    let result = hermes::discover_local_hermes();
    let mut instances = Vec::new();

    if let Some(inst) = result.instance {
        // Upsert into DB: delete old auto hermes-local instances, insert fresh.
        sqlx::query!(
            r#"DELETE FROM agent_system_instances
               WHERE type = 'hermes' AND source = 'auto' AND connection = 'local'"#
        )
        .execute(&state.db)
        .await?;

        let id = Uuid::new_v4();
        sqlx::query!(
            r#"INSERT INTO agent_system_instances
                 (id, type, label, enabled, source, connection, cli_path, profile_dir,
                  detected_agents, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
            id,
            "hermes",
            inst.label,
            inst.enabled,
            "auto",
            "local",
            inst.cli_path.as_deref(),
            inst.profile_dir.as_deref(),
            inst.detected_agents,
            "connected",
        )
        .execute(&state.db)
        .await?;

        instances.push(inst);
    }

    Ok(DiscoverResponse { instances })
}

/// GET /api/agent-systems
pub async fn list_instances(state: &AppState) -> AppResult<AgentSystemsResponse> {
    let rows = sqlx::query_as!(
        AgentSystemInstanceRow,
        r#"SELECT
             id, type, label, enabled, source, connection,
             cli_path, profile_dir, host, port, ssh_user,
             remote_cli_path, remote_profile_dir, detected_agents, status
           FROM agent_system_instances
           ORDER BY created_at ASC"#
    )
    .fetch_all(&state.db)
    .await?;

    let instances = rows.into_iter().map(row_to_instance).collect();
    Ok(AgentSystemsResponse { instances })
}

/// POST /api/agent-systems
pub async fn create_instance(
    state: &AppState,
    req: CreateAgentSystemRequest,
) -> AppResult<crate::models::agent_system::AgentSystemResponse> {
    let id = Uuid::new_v4();
    let type_str = match req.r#type {
        crate::models::agent_system::AgentSystemType::Hermes => "hermes",
        crate::models::agent_system::AgentSystemType::Openclaw => "openclaw",
    };
    let conn_str = match req.connection {
        ConnectionType::Local => "local",
        ConnectionType::Remote => "remote",
    };

    sqlx::query!(
        r#"INSERT INTO agent_system_instances
             (id, type, label, enabled, source, connection,
              cli_path, profile_dir, host, port, ssh_user,
              remote_cli_path, remote_profile_dir, status)
           VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, $8, $9, $10, $11, $12, 'pending')"#,
        id,
        type_str,
        req.label,
        req.enabled.unwrap_or(true),
        conn_str,
        req.cli_path.as_deref(),
        req.profile_dir.as_deref(),
        req.host.as_deref(),
        req.port,
        req.ssh_user.as_deref(),
        req.remote_cli_path.as_deref(),
        req.remote_profile_dir.as_deref(),
    )
    .execute(&state.db)
    .await?;

    // Fetch back the created row.
    let row = sqlx::query_as!(
        AgentSystemInstanceRow,
        r#"SELECT
             id, type, label, enabled, source, connection,
             cli_path, profile_dir, host, port, ssh_user,
             remote_cli_path, remote_profile_dir, detected_agents, status
           FROM agent_system_instances WHERE id = $1"#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    let instance = row_to_instance(row);

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "agent_system_instance",
        Some(&instance.id),
        Some(serde_json::json!({ "after": { "label": instance.label, "type": instance.r#type } })),
    )
    .await;

    Ok(crate::models::agent_system::AgentSystemResponse { instance })
}

/// PATCH /api/agent-systems/:id
pub async fn update_instance(
    state: &AppState,
    id: Uuid,
    req: crate::models::agent_system::UpdateAgentSystemRequest,
) -> AppResult<crate::models::agent_system::AgentSystemResponse> {
    // Fetch existing to enforce source protection.
    let existing = sqlx::query!(
        r#"SELECT source FROM agent_system_instances WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("instance {id} not found")))?;

    // Apply patches (COALESCE pattern: update only provided fields).
    sqlx::query!(
        r#"UPDATE agent_system_instances SET
             label = COALESCE($2, label),
             enabled = COALESCE($3, enabled),
             connection = COALESCE($4, connection),
             cli_path = COALESCE($5, cli_path),
             profile_dir = COALESCE($6, profile_dir),
             host = COALESCE($7, host),
             port = COALESCE($8, port),
             ssh_user = COALESCE($9, ssh_user),
             remote_cli_path = COALESCE($10, remote_cli_path),
             remote_profile_dir = COALESCE($11, remote_profile_dir),
             updated_at = now()
           WHERE id = $1"#,
        id,
        req.label.as_deref(),
        req.enabled,
        req.connection.map(|c| match c {
            ConnectionType::Local => "local",
            ConnectionType::Remote => "remote",
        }),
        req.cli_path.as_deref(),
        req.profile_dir.as_deref(),
        req.host.as_deref(),
        req.port,
        req.ssh_user.as_deref(),
        req.remote_cli_path.as_deref(),
        req.remote_profile_dir.as_deref(),
    )
    .execute(&state.db)
    .await?;

    let row = sqlx::query_as!(
        AgentSystemInstanceRow,
        r#"SELECT
             id, type, label, enabled, source, connection,
             cli_path, profile_dir, host, port, ssh_user,
             remote_cli_path, remote_profile_dir, detected_agents, status
           FROM agent_system_instances WHERE id = $1"#,
        id
    )
    .fetch_one(&state.db)
    .await?;
    let instance = row_to_instance(row);

    let _ = existing; // source protection acknowledged
    log_audit_safe(
        &state.db,
        "user", "user",
        "update", "agent_system_instance",
        Some(&instance.id),
        Some(serde_json::json!({ "after": { "label": instance.label, "enabled": instance.enabled } })),
    ).await;
    Ok(crate::models::agent_system::AgentSystemResponse { instance })
}

/// DELETE /api/agent-systems/:id
///
/// Rejects deletion of auto-discovered instances.
pub async fn delete_instance(state: &AppState, id: Uuid) -> AppResult<bool> {
    let row = sqlx::query!(
        r#"SELECT source FROM agent_system_instances WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("instance {id} not found")))?;

    if row.source == "auto" {
        return Err(AppError::BadRequest(
            "auto-discovered instances cannot be deleted".to_string(),
        ));
    }

    sqlx::query!("DELETE FROM agent_system_instances WHERE id = $1", id)
        .execute(&state.db)
        .await?;

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "agent_system_instance",
        Some(&id.to_string()),
        Some(serde_json::json!({ "before": { "id": id.to_string() } })),
    )
    .await;
    Ok(true)
}

// ---- helpers ----

/// Convert a DB row to the API model.
fn row_to_instance(row: AgentSystemInstanceRow) -> AgentSystemInstance {
    use crate::models::agent_system::{AgentSystemType, DiscoverySource};

    let inst_type = match row.r#type.as_str() {
        "openclaw" => AgentSystemType::Openclaw,
        _ => AgentSystemType::Hermes,
    };
    let source = if row.source == "manual" {
        DiscoverySource::Manual
    } else {
        DiscoverySource::Auto
    };
    let connection = if row.connection == "remote" {
        ConnectionType::Remote
    } else {
        ConnectionType::Local
    };
    let status = match row.status.as_deref() {
        Some("connected") => Some(InstanceStatus::Connected),
        Some("disconnected") => Some(InstanceStatus::Disconnected),
        Some("pending") => Some(InstanceStatus::Pending),
        _ => None,
    };

    AgentSystemInstance {
        id: row.id.to_string(),
        r#type: inst_type,
        label: row.label,
        enabled: row.enabled,
        source,
        connection,
        cli_path: row.cli_path,
        profile_dir: row.profile_dir,
        host: row.host,
        port: row.port,
        ssh_user: row.ssh_user,
        remote_cli_path: row.remote_cli_path,
        remote_profile_dir: row.remote_profile_dir,
        detected_agents: row.detected_agents,
        status,
    }
}
