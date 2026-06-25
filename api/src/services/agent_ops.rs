//! Agent operational data service.
//!
//! Queries local Hermes CLI state for an agent system instance. Remote
//! instances are intentionally rejected until a backend transport exists.

use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::agent_ops::{
    CronResponse, EnvironmentResponse, IdentityResponse, MemoryResponse, SessionsResponse,
    SkillsResponse, StatusResponse,
};
use crate::services::audit::log_audit_safe;
use crate::services::hermes_ops;
use crate::state::AppState;

pub async fn get_cron(
    state: &AppState,
    id: Uuid,
    profile: Option<&str>,
) -> AppResult<CronResponse> {
    let instance = fetch_local_instance(state, id).await?;

    let jobs = hermes_ops::query_cron_list(&instance.cli_path, profile)
        .await
        .map_err(map_ops_error)?;

    let status =
        hermes_ops::query_cron_status(&instance.cli_path, instance.profile_dir.as_deref(), profile)
            .await
            .map_err(map_ops_error)?;

    Ok(CronResponse { jobs, status })
}

pub async fn get_status(
    state: &AppState,
    id: Uuid,
    profile: Option<&str>,
) -> AppResult<StatusResponse> {
    let instance = fetch_local_instance(state, id).await?;

    let gateway = hermes_ops::query_gateway_status(
        &instance.cli_path,
        instance.profile_dir.as_deref(),
        profile,
    )
    .await
    .map_err(map_ops_error)?;

    Ok(StatusResponse { gateway })
}

pub async fn get_sessions(
    state: &AppState,
    id: Uuid,
    profile: Option<&str>,
) -> AppResult<SessionsResponse> {
    let instance = fetch_local_instance(state, id).await?;
    let sessions = hermes_ops::query_sessions(&instance.cli_path, profile)
        .await
        .map_err(map_ops_error)?;
    Ok(SessionsResponse { sessions })
}

pub async fn delete_session(
    state: &AppState,
    id: Uuid,
    session_id: &str,
    profile: Option<&str>,
) -> AppResult<()> {
    let instance = fetch_local_instance(state, id).await?;
    hermes_ops::delete_session(&instance.cli_path, session_id, profile)
        .await
        .map_err(map_ops_error)?;

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "hermes_session",
        Some(session_id),
        Some(serde_json::json!({ "before": { "id": session_id } })),
    )
    .await;

    Ok(())
}

pub async fn get_skills(
    state: &AppState,
    id: Uuid,
    profile: Option<&str>,
) -> AppResult<SkillsResponse> {
    let instance = fetch_local_instance(state, id).await?;
    let skills = hermes_ops::query_skills(&instance.cli_path, profile)
        .await
        .map_err(map_ops_error)?;
    Ok(SkillsResponse { skills })
}

pub async fn get_memory(
    state: &AppState,
    id: Uuid,
    profile: Option<&str>,
) -> AppResult<MemoryResponse> {
    let instance = fetch_local_instance(state, id).await?;
    let memory =
        hermes_ops::query_memory(&instance.cli_path, instance.profile_dir.as_deref(), profile)
            .await
            .map_err(map_ops_error)?;
    Ok(MemoryResponse { memory })
}

pub async fn get_identity(state: &AppState, id: Uuid) -> AppResult<IdentityResponse> {
    let instance = fetch_local_instance(state, id).await?;
    let identity = hermes_ops::query_identity(instance.profile_dir.as_deref())
        .await
        .map_err(map_ops_error)?;
    Ok(IdentityResponse { identity })
}

pub async fn get_environment(
    state: &AppState,
    id: Uuid,
    profile: Option<&str>,
) -> AppResult<EnvironmentResponse> {
    let instance = fetch_local_instance(state, id).await?;
    let environment = hermes_ops::query_environment(&instance.cli_path, profile)
        .await
        .map_err(map_ops_error)?;
    Ok(EnvironmentResponse { environment })
}

struct InstanceOps {
    cli_path: String,
    profile_dir: Option<String>,
}

async fn fetch_local_instance(state: &AppState, id: Uuid) -> AppResult<InstanceOps> {
    let row = sqlx::query!(
        r#"SELECT cli_path, profile_dir, connection
           FROM agent_system_instances
           WHERE id = $1"#,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("instance {id} not found")))?;

    if row.connection == "remote" {
        return Err(AppError::NotImplemented(
            "remote instances are not yet supported".to_string(),
        ));
    }

    let cli_path = row
        .cli_path
        .ok_or_else(|| AppError::Internal("instance has no cli_path configured".to_string()))?;

    Ok(InstanceOps {
        cli_path,
        profile_dir: row.profile_dir,
    })
}

fn map_ops_error(e: hermes_ops::OpsError) -> AppError {
    use hermes_ops::OpsError;
    match e {
        OpsError::CliNotFound(msg) => AppError::Internal(format!("hermes CLI error: {msg}")),
        OpsError::Timeout => AppError::Internal("hermes CLI timed out".to_string()),
        OpsError::Io(msg) => AppError::Internal(format!("io error: {msg}")),
        OpsError::HermesFailed(msg) => AppError::Internal(format!("hermes CLI failed: {msg}")),
    }
}
