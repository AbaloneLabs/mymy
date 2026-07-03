//! Preview endpoint registration and proxy policy.
//!
//! A preview is an explicit, tokenized tunnel from the web UI to a server that
//! an agent started inside its sandbox network. Until the microVM runner owns
//! port forwarding, targets are restricted to loopback addresses so this API
//! cannot become a general-purpose SSRF proxy.

use chrono::{DateTime, Utc};
use reqwest::Url;
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::preview::{
    CreatePreviewEndpointRequest, DeletePreviewEndpointResponse, PreviewEndpoint,
    PreviewEndpointResponse, PreviewEndpointsResponse, PreviewStatus, PreviewVisibility,
};
use crate::services::agents;
use crate::state::AppState;

const MAX_PREVIEW_LABEL_CHARS: usize = 80;

#[derive(Debug, FromRow)]
pub struct PreviewEndpointRow {
    pub id: Uuid,
    pub agent_profile: String,
    pub project_id: Option<Uuid>,
    pub process_id: Option<Uuid>,
    pub label: String,
    pub target_url: String,
    pub token: String,
    pub visibility: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_previews(
    state: &AppState,
    agent_profile: Option<&str>,
) -> AppResult<PreviewEndpointsResponse> {
    let rows = if let Some(profile) = agent_profile {
        let profile = agents::normalize_agent_profile(profile)?;
        sqlx::query_as!(
            PreviewEndpointRow,
            r#"SELECT id, agent_profile, project_id, process_id, label, target_url,
                      token, visibility, status, created_at, updated_at
               FROM preview_endpoints
               WHERE agent_profile = $1
               ORDER BY created_at DESC"#,
            profile
        )
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as!(
            PreviewEndpointRow,
            r#"SELECT id, agent_profile, project_id, process_id, label, target_url,
                      token, visibility, status, created_at, updated_at
               FROM preview_endpoints
               ORDER BY created_at DESC"#
        )
        .fetch_all(&state.db)
        .await?
    };

    Ok(PreviewEndpointsResponse {
        previews: rows.into_iter().map(row_to_preview).collect(),
    })
}

pub async fn create_preview(
    state: &AppState,
    req: CreatePreviewEndpointRequest,
) -> AppResult<PreviewEndpointResponse> {
    let profile = agents::normalize_agent_profile(&req.agent_profile)?;
    ensure_agent_exists(state, &profile).await?;
    let project_id = match req.project_id {
        Some(value) => Some(
            Uuid::parse_str(&value)
                .map_err(|err| AppError::BadRequest(format!("invalid projectId: {err}")))?,
        ),
        None => None,
    };
    if let Some(project_id) = project_id {
        ensure_project_exists(state, project_id).await?;
    }

    let label = validate_label(req.label)?;
    let target_url = validate_target_url(&req.target_url)?;
    let visibility = visibility_to_str(req.visibility.unwrap_or(PreviewVisibility::Session));
    let token = Uuid::new_v4().simple().to_string();

    let row = sqlx::query_as!(
        PreviewEndpointRow,
        r#"INSERT INTO preview_endpoints
             (agent_profile, project_id, label, target_url, token, visibility, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'active')
           RETURNING id, agent_profile, project_id, process_id, label, target_url,
                     token, visibility, status, created_at, updated_at"#,
        profile,
        project_id,
        label,
        target_url,
        token,
        visibility,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(PreviewEndpointResponse {
        preview: row_to_preview(row),
    })
}

pub async fn delete_preview(
    state: &AppState,
    id: Uuid,
) -> AppResult<DeletePreviewEndpointResponse> {
    let result = sqlx::query!("DELETE FROM preview_endpoints WHERE id = $1", id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("preview {id} not found")));
    }
    Ok(DeletePreviewEndpointResponse { success: true })
}

pub async fn active_preview_by_token(
    state: &AppState,
    token: &str,
) -> AppResult<PreviewEndpointRow> {
    sqlx::query_as!(
        PreviewEndpointRow,
        r#"SELECT id, agent_profile, project_id, process_id, label, target_url,
                  token, visibility, status, created_at, updated_at
           FROM preview_endpoints
           WHERE token = $1 AND status = 'active'"#,
        token
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("preview endpoint not found".to_string()))
}

pub fn proxied_target_url(
    endpoint: &PreviewEndpointRow,
    path: &str,
    query: Option<&str>,
) -> AppResult<String> {
    let base = validate_target_url(&endpoint.target_url)?;
    let mut url = Url::parse(&base)
        .map_err(|err| AppError::BadRequest(format!("invalid preview target URL: {err}")))?;
    let mut joined_path = url.path().trim_end_matches('/').to_string();
    let path = path.trim_start_matches('/');
    if !path.is_empty() {
        joined_path.push('/');
        joined_path.push_str(path);
    }
    url.set_path(&joined_path);
    url.set_query(query);
    Ok(url.to_string())
}

fn validate_label(value: String) -> AppResult<String> {
    let label = value.trim().to_string();
    if label.is_empty() {
        return Err(AppError::BadRequest("preview label cannot be empty".into()));
    }
    if label.chars().count() > MAX_PREVIEW_LABEL_CHARS {
        return Err(AppError::BadRequest(format!(
            "preview label must be at most {MAX_PREVIEW_LABEL_CHARS} characters"
        )));
    }
    Ok(label)
}

fn validate_target_url(value: &str) -> AppResult<String> {
    let url = Url::parse(value)
        .map_err(|err| AppError::BadRequest(format!("invalid preview target URL: {err}")))?;
    if url.scheme() != "http" {
        return Err(AppError::BadRequest(
            "preview target must use http".to_string(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::BadRequest("preview target host is required".to_string()))?;
    let is_loopback = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if !is_loopback {
        return Err(AppError::BadRequest(
            "preview target must be a loopback sandbox forwarding address".to_string(),
        ));
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| AppError::BadRequest("preview target port is required".to_string()))?;
    if !(1024..=65535).contains(&port) {
        return Err(AppError::BadRequest(
            "preview target port must be between 1024 and 65535".to_string(),
        ));
    }
    Ok(url.to_string())
}

async fn ensure_agent_exists(state: &AppState, profile: &str) -> AppResult<()> {
    let exists =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM native_agents WHERE profile = $1")
            .bind(profile)
            .fetch_one(&state.db)
            .await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("agent {profile} not found")));
    }
    Ok(())
}

async fn ensure_project_exists(state: &AppState, id: Uuid) -> AppResult<()> {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM projects WHERE id = $1")
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("project {id} not found")));
    }
    Ok(())
}

fn row_to_preview(row: PreviewEndpointRow) -> PreviewEndpoint {
    PreviewEndpoint {
        id: row.id.to_string(),
        agent_profile: row.agent_profile,
        project_id: row.project_id.map(|id| id.to_string()),
        process_id: row.process_id.map(|id| id.to_string()),
        label: row.label,
        target_url: row.target_url,
        token: row.token,
        visibility: parse_visibility(&row.visibility),
        status: parse_status(&row.status),
        created_at: row.created_at.to_rfc3339(),
        updated_at: row.updated_at.to_rfc3339(),
    }
}

fn visibility_to_str(value: PreviewVisibility) -> &'static str {
    match value {
        PreviewVisibility::Session => "session",
        PreviewVisibility::Public => "public",
    }
}

fn parse_visibility(value: &str) -> PreviewVisibility {
    match value {
        "public" => PreviewVisibility::Public,
        _ => PreviewVisibility::Session,
    }
}

fn parse_status(value: &str) -> PreviewStatus {
    match value {
        "stopped" => PreviewStatus::Stopped,
        "failed" => PreviewStatus::Failed,
        _ => PreviewStatus::Active,
    }
}
