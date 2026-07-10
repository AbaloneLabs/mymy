//! MoA preset domain operations.
//!
//! This service intentionally stores provider IDs rather than expanded model
//! configs. Chat execution resolves those IDs at send time so disabled
//! providers, rotated credentials, and temporary rate-limit state are honored
//! using the same runtime path as normal chat turns.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use sqlx::postgres::PgRow;
use sqlx::Row;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::moa::{
    CreateMoaPresetRequest, DeleteMoaPresetResponse, MoaPreset, MoaPresetResponse,
    MoaPresetsResponse, MoaProviderRef, UpdateMoaPresetRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;

const MAX_MOA_CONCURRENT: i32 = 8;

#[derive(Debug, Clone)]
pub struct MoaRuntimePreset {
    pub proposer_providers: Vec<MoaProviderRef>,
    pub aggregator_provider: MoaProviderRef,
    pub max_concurrent: usize,
    pub aggregation_prompt: String,
}

pub async fn list_presets(state: &AppState) -> AppResult<MoaPresetsResponse> {
    let rows = sqlx::query(
        r#"SELECT id, name, enabled, proposer_provider_ids, aggregator_provider_id,
                  max_concurrent, aggregation_prompt, created_at, updated_at
           FROM moa_presets
           ORDER BY created_at ASC"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(MoaPresetsResponse {
        presets: rows
            .into_iter()
            .map(row_to_preset)
            .collect::<AppResult<Vec<_>>>()?,
    })
}

pub async fn create_preset(
    state: &AppState,
    req: CreateMoaPresetRequest,
) -> AppResult<MoaPresetResponse> {
    let name = validate_name(req.name)?;
    let proposer_provider_ids = parse_provider_ids(req.proposer_provider_ids)?;
    validate_provider_refs(state, &proposer_provider_ids, false).await?;
    let aggregator_provider_id = parse_provider_id(&req.aggregator_provider_id)?;
    validate_provider_refs(state, &[aggregator_provider_id], false).await?;
    let max_concurrent = validate_max_concurrent(req.max_concurrent)?;
    let aggregation_prompt = validate_aggregation_prompt(req.aggregation_prompt)?;

    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO moa_presets
             (id, name, enabled, proposer_provider_ids, aggregator_provider_id,
              max_concurrent, aggregation_prompt)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(id)
    .bind(&name)
    .bind(req.enabled)
    .bind(&proposer_provider_ids)
    .bind(aggregator_provider_id)
    .bind(max_concurrent)
    .bind(&aggregation_prompt)
    .execute(&state.db)
    .await
    .map_err(map_write_error)?;

    let preset = fetch_preset(state, id).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "create",
        "moa_preset",
        Some(&preset.id),
        Some(serde_json::json!({ "after": { "name": preset.name, "enabled": preset.enabled } })),
    )
    .await;

    Ok(MoaPresetResponse { preset })
}

pub async fn update_preset(
    state: &AppState,
    id: Uuid,
    req: UpdateMoaPresetRequest,
) -> AppResult<MoaPresetResponse> {
    let existing = fetch_preset(state, id).await?;
    let name = match req.name {
        Some(name) => validate_name(name)?,
        None => existing.name.clone(),
    };
    let proposer_provider_ids = match req.proposer_provider_ids {
        Some(ids) => {
            let ids = parse_provider_ids(ids)?;
            validate_provider_refs(state, &ids, false).await?;
            ids
        }
        None => existing
            .proposer_provider_ids
            .iter()
            .map(|id| parse_provider_id(id))
            .collect::<AppResult<Vec<_>>>()?,
    };
    let aggregator_provider_id = match req.aggregator_provider_id {
        Some(id) => {
            let id = parse_provider_id(&id)?;
            validate_provider_refs(state, &[id], false).await?;
            id
        }
        None => parse_provider_id(&existing.aggregator_provider_id)?,
    };
    let max_concurrent = match req.max_concurrent {
        Some(value) => validate_max_concurrent(value)?,
        None => existing.max_concurrent,
    };
    let aggregation_prompt = match req.aggregation_prompt {
        Some(value) => validate_aggregation_prompt(value)?,
        None => existing.aggregation_prompt.clone(),
    };
    let enabled = req.enabled.unwrap_or(existing.enabled);

    sqlx::query(
        r#"UPDATE moa_presets SET
             name = $2,
             enabled = $3,
             proposer_provider_ids = $4,
             aggregator_provider_id = $5,
             max_concurrent = $6,
             aggregation_prompt = $7,
             updated_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(&name)
    .bind(enabled)
    .bind(&proposer_provider_ids)
    .bind(aggregator_provider_id)
    .bind(max_concurrent)
    .bind(&aggregation_prompt)
    .execute(&state.db)
    .await
    .map_err(map_write_error)?;

    let preset = fetch_preset(state, id).await?;
    log_audit_safe(
        &state.db,
        "user",
        "user",
        "update",
        "moa_preset",
        Some(&preset.id),
        Some(serde_json::json!({ "before": { "name": existing.name }, "after": { "name": preset.name, "enabled": preset.enabled } })),
    )
    .await;

    Ok(MoaPresetResponse { preset })
}

pub async fn delete_preset(state: &AppState, id: Uuid) -> AppResult<DeleteMoaPresetResponse> {
    let existing = fetch_preset(state, id).await?;
    let result = sqlx::query("DELETE FROM moa_presets WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("MoA preset {id} not found")));
    }

    log_audit_safe(
        &state.db,
        "user",
        "user",
        "delete",
        "moa_preset",
        Some(&existing.id),
        Some(serde_json::json!({ "before": { "name": existing.name } })),
    )
    .await;

    Ok(DeleteMoaPresetResponse { success: true })
}

pub async fn resolve_runtime_preset(
    state: &AppState,
    preset_id: Option<Uuid>,
) -> AppResult<MoaRuntimePreset> {
    let preset = match preset_id {
        Some(id) => fetch_enabled_preset(state, id).await?,
        None => fetch_first_enabled_preset(state).await?,
    };

    let proposer_ids = preset
        .proposer_provider_ids
        .iter()
        .map(|id| parse_provider_id(id))
        .collect::<AppResult<Vec<_>>>()?;
    let aggregator_id = parse_provider_id(&preset.aggregator_provider_id)?;
    let proposer_providers = validate_provider_refs(state, &proposer_ids, true).await?;
    let aggregator_provider = validate_provider_refs(state, &[aggregator_id], true)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound(format!("provider {aggregator_id} not found")))?;

    Ok(MoaRuntimePreset {
        proposer_providers,
        aggregator_provider,
        max_concurrent: preset.max_concurrent as usize,
        aggregation_prompt: preset.aggregation_prompt,
    })
}

async fn fetch_preset(state: &AppState, id: Uuid) -> AppResult<MoaPreset> {
    let row = sqlx::query(
        r#"SELECT id, name, enabled, proposer_provider_ids, aggregator_provider_id,
                  max_concurrent, aggregation_prompt, created_at, updated_at
           FROM moa_presets
           WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("MoA preset {id} not found")))?;
    row_to_preset(row)
}

async fn fetch_enabled_preset(state: &AppState, id: Uuid) -> AppResult<MoaPreset> {
    let row = sqlx::query(
        r#"SELECT id, name, enabled, proposer_provider_ids, aggregator_provider_id,
                  max_concurrent, aggregation_prompt, created_at, updated_at
           FROM moa_presets
           WHERE id = $1 AND enabled = true"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("enabled MoA preset {id} not found")))?;
    row_to_preset(row)
}

async fn fetch_first_enabled_preset(state: &AppState) -> AppResult<MoaPreset> {
    let row = sqlx::query(
        r#"SELECT id, name, enabled, proposer_provider_ids, aggregator_provider_id,
                  max_concurrent, aggregation_prompt, created_at, updated_at
           FROM moa_presets
           WHERE enabled = true
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 1"#,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("no enabled MoA preset configured".into()))?;
    row_to_preset(row)
}

fn row_to_preset(row: PgRow) -> AppResult<MoaPreset> {
    let id: Uuid = row.try_get("id")?;
    let proposer_provider_ids: Vec<Uuid> = row.try_get("proposer_provider_ids")?;
    let aggregator_provider_id: Uuid = row.try_get("aggregator_provider_id")?;
    let created_at: DateTime<Utc> = row.try_get("created_at")?;
    let updated_at: DateTime<Utc> = row.try_get("updated_at")?;

    Ok(MoaPreset {
        id: id.to_string(),
        name: row.try_get("name")?,
        enabled: row.try_get("enabled")?,
        proposer_provider_ids: proposer_provider_ids
            .into_iter()
            .map(|id| id.to_string())
            .collect(),
        aggregator_provider_id: aggregator_provider_id.to_string(),
        max_concurrent: row.try_get("max_concurrent")?,
        aggregation_prompt: row.try_get("aggregation_prompt")?,
        created_at: created_at.to_rfc3339(),
        updated_at: updated_at.to_rfc3339(),
    })
}

fn validate_name(name: String) -> AppResult<String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "MoA preset name cannot be empty".into(),
        ));
    }
    Ok(trimmed)
}

fn validate_aggregation_prompt(prompt: String) -> AppResult<String> {
    let trimmed = prompt.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "MoA aggregation prompt cannot be empty".into(),
        ));
    }
    Ok(trimmed)
}

fn validate_max_concurrent(value: i32) -> AppResult<i32> {
    if !(1..=MAX_MOA_CONCURRENT).contains(&value) {
        return Err(AppError::BadRequest(format!(
            "MoA maxConcurrent must be between 1 and {MAX_MOA_CONCURRENT}"
        )));
    }
    Ok(value)
}

fn parse_provider_ids(ids: Vec<String>) -> AppResult<Vec<Uuid>> {
    if ids.is_empty() {
        return Err(AppError::BadRequest(
            "MoA preset requires at least one proposer provider".into(),
        ));
    }
    let parsed = ids
        .iter()
        .map(|id| parse_provider_id(id))
        .collect::<AppResult<Vec<_>>>()?;
    let unique = parsed.iter().copied().collect::<HashSet<_>>();
    if unique.len() != parsed.len() {
        return Err(AppError::BadRequest(
            "MoA proposer providers must be unique".into(),
        ));
    }
    Ok(parsed)
}

fn parse_provider_id(id: &str) -> AppResult<Uuid> {
    Uuid::parse_str(id).map_err(|err| AppError::BadRequest(format!("invalid provider id: {err}")))
}

async fn validate_provider_refs(
    state: &AppState,
    provider_ids: &[Uuid],
    require_enabled: bool,
) -> AppResult<Vec<MoaProviderRef>> {
    let rows = sqlx::query(
        r#"SELECT id, label, model, enabled
           FROM llm_providers
           WHERE id = ANY($1)"#,
    )
    .bind(provider_ids)
    .fetch_all(&state.db)
    .await?;

    let mut by_id = HashMap::new();
    for row in rows {
        let id: Uuid = row.try_get("id")?;
        by_id.insert(
            id,
            (
                row.try_get::<String, _>("label")?,
                row.try_get::<String, _>("model")?,
                row.try_get::<bool, _>("enabled")?,
            ),
        );
    }

    let mut resolved = Vec::with_capacity(provider_ids.len());
    for id in provider_ids {
        let Some((label, model, enabled)) = by_id.get(id) else {
            return Err(AppError::NotFound(format!("provider {id} not found")));
        };
        if require_enabled && !enabled {
            return Err(AppError::BadRequest(format!("provider {id} is disabled")));
        }
        resolved.push(MoaProviderRef {
            id: id.to_string(),
            label: label.clone(),
            model: model.clone(),
        });
    }

    Ok(resolved)
}

fn map_write_error(err: sqlx::Error) -> AppError {
    if is_unique_violation(&err) {
        AppError::BadRequest("MoA preset name already exists".into())
    } else {
        AppError::Database(err)
    }
}

fn is_unique_violation(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::Database(db) => db.code().as_deref() == Some("23505"),
        _ => false,
    }
}
