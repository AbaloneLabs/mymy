//! Stable Drive identity and durable resource-operation projection.
//!
//! Filesystem bytes and PostgreSQL cannot share a transaction. This service
//! therefore journals intent before a visible filesystem commit, records that
//! commit immediately afterwards, and projects revisions, Run effects,
//! artifacts, and an outbox event in one database transaction. A retry with the
//! same operation key observes or resumes the same receipt instead of blindly
//! applying a second mutation.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::services::drive::{
    mime_type_for_path, normalize_logical_drive_path, resolve_drive_path,
};
use crate::services::file_observations::fingerprint_path;
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActor {
    pub kind: String,
    pub id: Option<String>,
    pub run_id: Option<Uuid>,
    pub invocation_id: Option<String>,
    pub source_session_id: Option<Uuid>,
}

impl ResourceActor {
    pub fn user() -> Self {
        Self {
            kind: "user".to_string(),
            id: None,
            run_id: None,
            invocation_id: None,
            source_session_id: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactClassification {
    pub artifact_type: String,
    pub title: String,
    pub mime_type: String,
}

#[derive(Debug, Clone)]
pub struct PrepareContentOperation {
    pub operation_key: String,
    pub logical_path: String,
    pub expected_fingerprint: Option<String>,
    pub content_sha256: String,
    pub content_size: u64,
    pub source: String,
    pub actor: ResourceActor,
    pub artifact: Option<ArtifactClassification>,
}

pub struct PrepareLifecycleOperation<'a> {
    pub operation_key: &'a str,
    pub operation_kind: &'a str,
    pub known_resource_id: Option<Uuid>,
    pub logical_path: &'a str,
    pub requested_reference: Option<&'a str>,
    pub expected_revision: Option<&'a str>,
    pub actor: &'a ResourceActor,
    pub resource_kind: &'a str,
    pub trash_entry_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
pub struct PreparedOperation {
    pub operation_id: Uuid,
    pub resource_id: Uuid,
    pub state: String,
    pub committed_fingerprint: Option<String>,
    pub requested_reference: Option<String>,
}

pub struct ContentCommitProjection<'a> {
    pub logical_path: &'a str,
    pub fingerprint: &'a str,
    pub size: u64,
    pub source: &'a str,
    pub actor: &'a ResourceActor,
    pub artifact: Option<&'a ArtifactClassification>,
}

struct RunEffectProjection<'a> {
    operation_id: Uuid,
    resource_id: Uuid,
    effect_kind: &'a str,
    before_reference: Option<&'a str>,
    after_reference: Option<&'a str>,
    revision: &'a str,
    sequence: i64,
}

type ActorEffectContext = (Option<Uuid>, Option<Uuid>, Option<String>, Option<Uuid>);

#[derive(Debug, Clone)]
pub enum TrashProjection {
    Created {
        id: Uuid,
        original_path: String,
        trash_path: String,
        kind: String,
        size_bytes: i64,
    },
    Restored {
        id: Uuid,
    },
    Purged {
        id: Uuid,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceOperationStatus {
    pub id: String,
    pub resource_id: Option<String>,
    pub operation_kind: String,
    pub state: String,
    pub committed_reference: Option<String>,
    pub committed_revision: Option<String>,
    pub last_error_code: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
struct OperationRow {
    id: Uuid,
    resource_id: Option<Uuid>,
    operation_kind: String,
    state: String,
    committed_reference: Option<String>,
    committed_revision: Option<String>,
    last_error_code: Option<String>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct ReconciliationRow {
    id: Uuid,
    resource_id: Option<Uuid>,
    operation_kind: String,
    state: String,
    requested_reference: Option<String>,
    committed_revision: Option<String>,
    request_payload: serde_json::Value,
    reconcile_attempts: i32,
    directory_move_pending: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentRequestHash<'a> {
    version: u8,
    path: &'a str,
    expected_fingerprint: Option<&'a str>,
    content_sha256: &'a str,
    content_size: u64,
    source: &'a str,
    actor_kind: &'a str,
    actor_id: Option<&'a str>,
    run_id: Option<Uuid>,
    invocation_id: Option<&'a str>,
    source_session_id: Option<Uuid>,
    artifact_type: Option<&'a str>,
    artifact_title: Option<&'a str>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentOperationIntent {
    version: u8,
    logical_path: String,
    content_sha256: String,
    content_size: u64,
    source: String,
    actor: ResourceActor,
    artifact: Option<ArtifactClassification>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleOperationIntent {
    version: u8,
    operation_kind: String,
    logical_path: String,
    requested_reference: Option<String>,
    actor: ResourceActor,
    resource_kind: String,
    trash_entry_id: Option<Uuid>,
}

const RECONCILE_MAX_ATTEMPTS: i32 = 10;
const RECONCILE_BATCH_SIZE: usize = 16;

pub fn start_worker(state: Arc<AppState>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            match reconcile_pending_operations(&state, RECONCILE_BATCH_SIZE).await {
                Ok(count) if count > 0 => {
                    tracing::info!(count, "reconciled incomplete resource operations")
                }
                Ok(_) => {}
                Err(_) => tracing::warn!("resource operation reconciliation pass failed"),
            }
            match crate::services::chat::reconcile_session_deletions(&state, RECONCILE_BATCH_SIZE)
                .await
            {
                Ok(count) if count > 0 => {
                    tracing::info!(count, "completed fenced chat-session deletions")
                }
                Ok(_) => {}
                Err(_) => tracing::warn!("chat-session deletion reconciliation pass failed"),
            }
            match crate::services::search::reconcile_drive_search_index(
                &state,
                RECONCILE_BATCH_SIZE,
            )
            .await
            {
                Ok(count) if count > 0 => {
                    tracing::info!(count, "updated Drive search projections")
                }
                Ok(_) => {}
                Err(_) => tracing::warn!("Drive search projection pass failed"),
            }
        }
    })
}

pub async fn reconcile_pending_operations(state: &AppState, maximum: usize) -> AppResult<usize> {
    let owner = Uuid::new_v4().to_string();
    let mut processed = 0;
    for _ in 0..maximum.min(10_000) {
        let Some(operation) = claim_reconciliation(state, &owner).await? else {
            break;
        };
        let result = match operation.operation_kind.as_str() {
            "content_write" => reconcile_content_operation(state, &operation).await,
            "move" | "trash" | "restore" | "purge" => {
                reconcile_lifecycle_operation(state, &operation).await
            }
            _ => Err(AppError::BadRequest(
                "unsupported reconciliation operation kind".to_string(),
            )),
        };
        if let Err(error) = result {
            let code = reconciliation_error_code(&error);
            tracing::warn!(operation_id = %operation.id, error_code = code, "resource operation remains incomplete");
            schedule_reconciliation_retry(state, &operation, code).await?;
        }
        processed += 1;
    }
    Ok(processed)
}

async fn claim_reconciliation(
    state: &AppState,
    owner: &str,
) -> AppResult<Option<ReconciliationRow>> {
    Ok(sqlx::query_as::<_, ReconciliationRow>(
        r#"UPDATE resource_operations
           SET reconcile_lease_owner = $1,
               reconcile_lease_expires_at = now() + interval '30 seconds',
               reconcile_attempts = reconcile_attempts + 1,
               updated_at = now()
           WHERE id = (
             SELECT id FROM resource_operations
             WHERE (state IN ('prepared', 'filesystem_committed', 'reconciling')
                    OR (state = 'completed' AND directory_move_pending))
               AND reconcile_after <= now()
               AND updated_at <= now() - interval '30 seconds'
               AND (reconcile_lease_expires_at IS NULL OR reconcile_lease_expires_at < now())
             ORDER BY reconcile_after, created_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           RETURNING id, resource_id, operation_kind, state,
                     requested_reference, committed_revision, request_payload,
                     reconcile_attempts, directory_move_pending"#,
    )
    .bind(owner)
    .fetch_optional(&state.db)
    .await?)
}

async fn reconcile_content_operation(
    state: &AppState,
    operation: &ReconciliationRow,
) -> AppResult<()> {
    let intent =
        serde_json::from_value::<ContentOperationIntent>(operation.request_payload.clone())
            .map_err(|_| {
                AppError::BadRequest("resource operation intent is invalid".to_string())
            })?;
    if intent.version != 1 {
        return Err(AppError::BadRequest(
            "resource operation intent version is unsupported".to_string(),
        ));
    }
    let resource_id = operation.resource_id.ok_or_else(|| {
        AppError::Conflict("resource operation identity is unavailable".to_string())
    })?;
    let resolved = resolve_drive_path(&state.config.agent_data_dir, &intent.logical_path)?;
    if !resolved.physical_path.is_file() {
        return Err(AppError::NotFound(
            "committed resource bytes are unavailable".to_string(),
        ));
    }
    let fingerprint = fingerprint_path(&resolved.physical_path)
        .await
        .map_err(AppError::Internal)?;
    if fingerprint.hash != intent.content_sha256 || fingerprint.size != intent.content_size {
        if operation.state == "prepared" {
            // A request can be cancelled after durable preparation but before
            // atomic replacement. Target bytes prove crash-after-write; their
            // absence proves this prepared attempt never committed and must be
            // terminalized instead of retried into compensation_required.
            mark_precommit_conflict(state, operation.id, "prepared_bytes_not_committed").await?;
            return Ok(());
        }
        return Err(AppError::Conflict(
            "resource bytes no longer match the prepared operation".to_string(),
        ));
    }
    if operation
        .committed_revision
        .as_deref()
        .is_some_and(|revision| revision != fingerprint.hash)
    {
        return Err(AppError::Conflict(
            "filesystem receipt does not match current resource bytes".to_string(),
        ));
    }
    mark_filesystem_committed(
        state,
        operation.id,
        &resolved.logical_path,
        &fingerprint.hash,
    )
    .await?;
    project_content_commit(
        state,
        &PreparedOperation {
            operation_id: operation.id,
            resource_id,
            state: operation.state.clone(),
            committed_fingerprint: Some(fingerprint.hash.clone()),
            requested_reference: Some(resolved.logical_path.clone()),
        },
        ContentCommitProjection {
            logical_path: &resolved.logical_path,
            fingerprint: &fingerprint.hash,
            size: fingerprint.size,
            source: &intent.source,
            actor: &intent.actor,
            artifact: intent.artifact.as_ref(),
        },
    )
    .await
}

async fn reconcile_lifecycle_operation(
    state: &AppState,
    operation: &ReconciliationRow,
) -> AppResult<()> {
    let intent =
        serde_json::from_value::<LifecycleOperationIntent>(operation.request_payload.clone())
            .map_err(|_| {
                AppError::BadRequest("lifecycle operation intent is invalid".to_string())
            })?;
    if intent.version != 1 || intent.operation_kind != operation.operation_kind {
        return Err(AppError::BadRequest(
            "lifecycle operation intent version is unsupported".to_string(),
        ));
    }
    let resource_id = operation.resource_id.ok_or_else(|| {
        AppError::Conflict("lifecycle resource identity is unavailable".to_string())
    })?;
    let prepared = PreparedOperation {
        operation_id: operation.id,
        resource_id,
        state: operation.state.clone(),
        committed_fingerprint: operation.committed_revision.clone(),
        requested_reference: operation.requested_reference.clone(),
    };
    if operation.state == "completed" {
        if operation.operation_kind == "move" && operation.directory_move_pending {
            let destination = operation.requested_reference.as_deref().ok_or_else(|| {
                AppError::BadRequest("directory move destination is missing".to_string())
            })?;
            project_directory_descendant_paths(
                state,
                operation.id,
                resource_id,
                &intent.logical_path,
                destination,
            )
            .await?;
        }
        return Ok(());
    }

    match operation.operation_kind.as_str() {
        "move" => {
            let destination = operation
                .requested_reference
                .as_deref()
                .ok_or_else(|| AppError::BadRequest("move destination is missing".to_string()))?;
            let source = resolve_drive_path(&state.config.agent_data_dir, &intent.logical_path)?;
            let target = resolve_drive_path(&state.config.agent_data_dir, destination)?;
            if source.physical_path.exists() || !target.physical_path.exists() {
                return Err(AppError::Conflict(
                    "move filesystem state does not prove a committed rename".to_string(),
                ));
            }
            mark_filesystem_committed(
                state,
                operation.id,
                destination,
                "lifecycle:filesystem_committed",
            )
            .await?;
            project_lifecycle_commit(
                state,
                &prepared,
                "moved",
                "active",
                Some(destination),
                &intent.actor,
                None,
            )
            .await?;
            if intent.resource_kind == "directory" {
                project_directory_descendant_paths(
                    state,
                    operation.id,
                    resource_id,
                    &intent.logical_path,
                    destination,
                )
                .await?;
            }
            crate::services::knowledge::reconcile_drive_move(
                state,
                &intent.logical_path,
                destination,
            )
            .await?;
        }
        "trash" => {
            let name = Path::new(&intent.logical_path)
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| AppError::BadRequest("trash source name is invalid".to_string()))?;
            let trash_path = format!("/drive/.trash/{}/{name}", operation.id);
            let source = resolve_drive_path(&state.config.agent_data_dir, &intent.logical_path)?;
            let target = resolve_drive_path(&state.config.agent_data_dir, &trash_path)?;
            if source.physical_path.exists() || !target.physical_path.exists() {
                return Err(AppError::Conflict(
                    "trash filesystem state does not prove a committed rename".to_string(),
                ));
            }
            let metadata = std::fs::metadata(&target.physical_path)?;
            mark_filesystem_committed(
                state,
                operation.id,
                &trash_path,
                "lifecycle:filesystem_committed",
            )
            .await?;
            project_lifecycle_commit(
                state,
                &prepared,
                "trashed",
                "trashed",
                None,
                &intent.actor,
                Some(&TrashProjection::Created {
                    id: operation.id,
                    original_path: intent.logical_path.clone(),
                    trash_path,
                    kind: intent.resource_kind,
                    size_bytes: if metadata.is_file() {
                        i64::try_from(metadata.len()).unwrap_or(i64::MAX)
                    } else {
                        0
                    },
                }),
            )
            .await?;
            crate::services::knowledge::mark_drive_path_broken(state, &intent.logical_path).await?;
        }
        "restore" => {
            let trash_id = intent.trash_entry_id.ok_or_else(|| {
                AppError::BadRequest("restore trash identity is missing".to_string())
            })?;
            let (trash_path, original_path) = sqlx::query_as::<_, (String, String)>(
                "SELECT trash_path, original_path FROM drive_trash_entries WHERE id = $1",
            )
            .bind(trash_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("restore trash entry is unavailable".to_string()))?;
            let destination = operation.requested_reference.as_deref().ok_or_else(|| {
                AppError::BadRequest("restore destination is missing".to_string())
            })?;
            let trash = resolve_drive_path(&state.config.agent_data_dir, &trash_path)?;
            let target = resolve_drive_path(&state.config.agent_data_dir, destination)?;
            if trash.physical_path.exists() || !target.physical_path.exists() {
                return Err(AppError::Conflict(
                    "restore filesystem state does not prove a committed rename".to_string(),
                ));
            }
            mark_filesystem_committed(
                state,
                operation.id,
                destination,
                "lifecycle:filesystem_committed",
            )
            .await?;
            project_lifecycle_commit(
                state,
                &prepared,
                "restored",
                "active",
                Some(destination),
                &intent.actor,
                Some(&TrashProjection::Restored { id: trash_id }),
            )
            .await?;
            crate::services::knowledge::reconcile_drive_restore(state, &original_path, destination)
                .await?;
        }
        "purge" => {
            let trash_id = intent.trash_entry_id.ok_or_else(|| {
                AppError::BadRequest("purge trash identity is missing".to_string())
            })?;
            let trash_path = sqlx::query_scalar::<_, String>(
                "SELECT trash_path FROM drive_trash_entries WHERE id = $1",
            )
            .bind(trash_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("purge trash entry is unavailable".to_string()))?;
            let trash = resolve_drive_path(&state.config.agent_data_dir, &trash_path)?;
            if trash.physical_path.is_dir() {
                std::fs::remove_dir_all(&trash.physical_path)?;
            } else if trash.physical_path.exists() {
                std::fs::remove_file(&trash.physical_path)?;
            }
            mark_filesystem_committed(
                state,
                operation.id,
                &trash_path,
                "lifecycle:filesystem_committed",
            )
            .await?;
            project_lifecycle_commit(
                state,
                &prepared,
                "purged",
                "purged",
                None,
                &intent.actor,
                Some(&TrashProjection::Purged { id: trash_id }),
            )
            .await?;
        }
        _ => unreachable!(),
    }
    Ok(())
}

async fn schedule_reconciliation_retry(
    state: &AppState,
    operation: &ReconciliationRow,
    code: &str,
) -> AppResult<()> {
    if operation.reconcile_attempts >= RECONCILE_MAX_ATTEMPTS {
        sqlx::query(
            r#"UPDATE resource_operations
               SET state = 'compensation_required', last_error_code = $2,
                   reconcile_lease_owner = NULL, reconcile_lease_expires_at = NULL,
                   updated_at = now()
               WHERE id = $1"#,
        )
        .bind(operation.id)
        .bind(code)
        .execute(&state.db)
        .await?;
        return Ok(());
    }
    let exponent = operation.reconcile_attempts.clamp(1, 8) as u32;
    let delay_seconds = i64::from(2_u16.pow(exponent));
    sqlx::query(
        r#"UPDATE resource_operations
           SET state = CASE WHEN $4 = 'prepared' THEN 'prepared' ELSE 'reconciling' END,
               last_error_code = $2,
               reconcile_after = now() + make_interval(secs => $3),
               reconcile_lease_owner = NULL, reconcile_lease_expires_at = NULL,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(operation.id)
    .bind(code)
    .bind(delay_seconds as f64)
    .bind(&operation.state)
    .execute(&state.db)
    .await?;
    Ok(())
}

fn reconciliation_error_code(error: &AppError) -> &'static str {
    match error {
        AppError::NotFound(_) => "resource_missing",
        AppError::Conflict(_) => "resource_state_mismatch",
        AppError::BadRequest(_) => "operation_intent_invalid",
        AppError::Database(_) => "projection_database_error",
        AppError::Io(_) => "projection_storage_error",
        _ => "projection_failed",
    }
}

pub async fn prepare_content_operation(
    state: &AppState,
    request: &PrepareContentOperation,
) -> AppResult<PreparedOperation> {
    validate_operation_key(&request.operation_key)?;
    let logical_path = normalize_logical_drive_path(&request.logical_path)?;
    let request_hash = content_request_hash(request, &logical_path)?;
    let request_payload = serde_json::to_value(ContentOperationIntent {
        version: 1,
        logical_path: logical_path.clone(),
        content_sha256: request.content_sha256.clone(),
        content_size: request.content_size,
        source: request.source.clone(),
        actor: request.actor.clone(),
        artifact: request.artifact.clone(),
    })
    .map_err(|error| AppError::Internal(format!("operation intent encode failed: {error}")))?;
    let idempotency_key = format!("content:{}", request.operation_key);
    let mut tx = state.db.begin().await?;
    if let Some(existing) = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            Option<Uuid>,
            String,
            Option<String>,
            Option<String>,
        ),
    >(
        r#"SELECT id, request_hash, resource_id, state, committed_revision, requested_reference
           FROM resource_operations WHERE idempotency_key = $1 FOR UPDATE"#,
    )
    .bind(&idempotency_key)
    .fetch_optional(&mut *tx)
    .await?
    {
        if existing.1 != request_hash {
            return Err(AppError::Conflict(
                "operation key was already used for different content".to_string(),
            ));
        }
        let resource_id = existing.2.ok_or_else(|| {
            AppError::Internal("content operation is missing its resource identity".to_string())
        })?;
        tx.commit().await?;
        return Ok(PreparedOperation {
            operation_id: existing.0,
            resource_id,
            state: existing.3,
            committed_fingerprint: existing.4,
            requested_reference: existing.5,
        });
    }

    let resource_id = match sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM drive_resources
           WHERE provider = 'local_vm' AND canonical_path = $1
             AND lifecycle_state = 'active'
           FOR UPDATE"#,
    )
    .bind(&logical_path)
    .fetch_optional(&mut *tx)
    .await?
    {
        Some(id) => id,
        None => {
            sqlx::query_scalar::<_, Uuid>(
                r#"INSERT INTO drive_resources(kind, lifecycle_state)
               VALUES ('file', 'reconciling') RETURNING id"#,
            )
            .fetch_one(&mut *tx)
            .await?
        }
    };
    let operation_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO resource_operations
             (idempotency_key, request_hash, operation_kind, resource_id,
              before_reference, requested_reference, expected_revision, state,
              request_payload)
           VALUES ($1, $2, 'content_write', $3,
                   (SELECT current_path FROM drive_resources WHERE id = $3),
                   $4, $5, 'prepared', $6)
           RETURNING id"#,
    )
    .bind(idempotency_key)
    .bind(request_hash)
    .bind(resource_id)
    .bind(&logical_path)
    .bind(request.expected_fingerprint.as_deref())
    .bind(request_payload)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(PreparedOperation {
        operation_id,
        resource_id,
        state: "prepared".to_string(),
        committed_fingerprint: None,
        requested_reference: Some(logical_path),
    })
}

pub async fn mark_filesystem_committed(
    state: &AppState,
    operation_id: Uuid,
    logical_path: &str,
    fingerprint: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE resource_operations
           SET state = 'filesystem_committed', committed_reference = $2,
               committed_revision = $3, updated_at = now()
           WHERE id = $1 AND state IN ('prepared', 'reconciling', 'filesystem_committed')"#,
    )
    .bind(operation_id)
    .bind(logical_path)
    .bind(fingerprint)
    .execute(&state.db)
    .await?;
    Ok(())
}

/// Terminalize an operation that failed a pre-commit compare-and-set or
/// destination check. A prepared row is durable retry evidence, but it is not
/// evidence that bytes reached the filesystem; leaving it claimable would make
/// the reconciliation worker retry an operation that can never prove commit
/// and eventually misclassify an ordinary stale write as compensation work.
pub async fn mark_precommit_conflict(
    state: &AppState,
    operation_id: Uuid,
    code: &str,
) -> AppResult<()> {
    let mut tx = state.db.begin().await?;
    let resource_id = sqlx::query_scalar::<_, Option<Uuid>>(
        r#"UPDATE resource_operations
           SET state = 'conflict', last_error_code = $2,
               completed_at = now(), updated_at = now(),
               reconcile_lease_owner = NULL, reconcile_lease_expires_at = NULL
           WHERE id = $1 AND state = 'prepared'
           RETURNING resource_id"#,
    )
    .bind(operation_id)
    .bind(code)
    .fetch_optional(&mut *tx)
    .await?
    .flatten();
    if let Some(resource_id) = resource_id {
        sqlx::query(
            r#"UPDATE drive_resources
               SET lifecycle_state = 'missing', updated_at = now()
               WHERE id = $1 AND lifecycle_state = 'reconciling'
                 AND current_path IS NULL AND current_revision = 0"#,
        )
        .bind(resource_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn project_content_commit(
    state: &AppState,
    prepared: &PreparedOperation,
    projection: ContentCommitProjection<'_>,
) -> AppResult<()> {
    let logical_path = normalize_logical_drive_path(projection.logical_path)?;
    let mut tx = state.db.begin().await?;
    let (current_revision, lifecycle_revision, lifecycle_state) =
        sqlx::query_as::<_, (i64, i64, String)>(
            r#"SELECT current_revision, lifecycle_revision, lifecycle_state
               FROM drive_resources WHERE id = $1 FOR UPDATE"#,
        )
        .bind(prepared.resource_id)
        .fetch_one(&mut *tx)
        .await?;
    let effect_kind = if current_revision == 0 {
        "created"
    } else {
        "updated"
    };
    let revision = current_revision + 1;
    let sequence = revision + lifecycle_revision;
    sqlx::query(
        r#"UPDATE drive_resources
           SET lifecycle_state = 'active', current_path = $2, canonical_path = $2,
               current_revision = $3, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(prepared.resource_id)
    .bind(&logical_path)
    .bind(revision)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO resource_revisions
             (resource_kind, resource_id, revision, fingerprint, size_bytes,
              source, actor_kind, actor_id)
           VALUES ('drive', $1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(prepared.resource_id)
    .bind(revision)
    .bind(projection.fingerprint)
    .bind(projection.size as i64)
    .bind(projection.source)
    .bind(&projection.actor.kind)
    .bind(projection.actor.id.as_deref())
    .execute(&mut *tx)
    .await?;
    let effect_id = insert_run_effect(
        &mut tx,
        projection.actor,
        RunEffectProjection {
            operation_id: prepared.operation_id,
            resource_id: prepared.resource_id,
            effect_kind,
            before_reference: None,
            after_reference: Some(&logical_path),
            revision: projection.fingerprint,
            sequence,
        },
    )
    .await?;
    project_artifact(
        &mut tx,
        projection.actor,
        prepared.resource_id,
        effect_id,
        effect_kind,
        sequence,
        projection.artifact,
    )
    .await?;
    sqlx::query(
        r#"INSERT INTO resource_outbox
             (operation_id, resource_id, resource_sequence, event_kind, payload)
           VALUES ($1, $2, $3, 'resource_content_committed',
                   jsonb_build_object('resourceId', $2, 'sequence', $3,
                                      'lifecycleState', 'active'))
           ON CONFLICT DO NOTHING"#,
    )
    .bind(prepared.operation_id)
    .bind(prepared.resource_id)
    .bind(sequence)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE resource_operations
           SET state = 'completed', committed_reference = $2,
               committed_revision = $3, updated_at = now(), completed_at = now(),
               last_error_code = NULL, reconcile_lease_owner = NULL,
               reconcile_lease_expires_at = NULL
           WHERE id = $1"#,
    )
    .bind(prepared.operation_id)
    .bind(&logical_path)
    .bind(projection.fingerprint)
    .execute(&mut *tx)
    .await?;
    if lifecycle_state != "active" && lifecycle_state != "reconciling" {
        return Err(AppError::Conflict(
            "resource lifecycle changed before content projection".to_string(),
        ));
    }
    tx.commit().await?;
    Ok(())
}

pub async fn mark_operation_reconciling(
    state: &AppState,
    operation_id: Uuid,
    code: &str,
) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE resource_operations
           SET state = 'reconciling', last_error_code = $2, updated_at = now()
           WHERE id = $1 AND state <> 'completed'"#,
    )
    .bind(operation_id)
    .bind(code)
    .execute(&state.db)
    .await?;
    Ok(())
}

pub async fn operation_status(state: &AppState, id: Uuid) -> AppResult<ResourceOperationStatus> {
    let row = sqlx::query_as::<_, OperationRow>(
        r#"SELECT id, resource_id, operation_kind, state, committed_reference,
                  committed_revision, last_error_code, updated_at
           FROM resource_operations WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("resource operation not found".to_string()))?;
    Ok(ResourceOperationStatus {
        id: row.id.to_string(),
        resource_id: row.resource_id.map(|id| id.to_string()),
        operation_kind: row.operation_kind,
        state: row.state,
        committed_reference: row.committed_reference,
        committed_revision: row.committed_revision,
        last_error_code: row.last_error_code,
        updated_at: row.updated_at.to_rfc3339(),
    })
}

pub async fn prepare_lifecycle_operation(
    state: &AppState,
    request: PrepareLifecycleOperation<'_>,
) -> AppResult<PreparedOperation> {
    let operation_key = request.operation_key;
    let operation_kind = request.operation_kind;
    let known_resource_id = request.known_resource_id;
    let logical_path = request.logical_path;
    let requested_reference = request.requested_reference;
    let expected_revision = request.expected_revision;
    let actor = request.actor;
    let resource_kind = request.resource_kind;
    let trash_entry_id = request.trash_entry_id;
    validate_operation_key(operation_key)?;
    if !matches!(operation_kind, "move" | "trash" | "restore" | "purge") {
        return Err(AppError::BadRequest(
            "unsupported resource lifecycle operation".to_string(),
        ));
    }
    if !matches!(resource_kind, "file" | "directory") {
        return Err(AppError::BadRequest(
            "invalid lifecycle resource kind".to_string(),
        ));
    }
    let path = normalize_logical_drive_path(logical_path)?;
    let requested_reference = requested_reference
        .map(normalize_logical_drive_path)
        .transpose()?;
    let key = format!("lifecycle:{operation_key}");
    let request = serde_json::json!({
        "version": 2,
        "operationKind": operation_kind,
        "path": path,
        "requestedReference": requested_reference,
        "expectedRevision": expected_revision,
        "actor": actor,
        "resourceKind": resource_kind,
        "trashEntryId": trash_entry_id,
    });
    let request_hash = hex::encode(Sha256::digest(serde_json::to_vec(&request).map_err(
        |error| AppError::Internal(format!("lifecycle operation hash failed: {error}")),
    )?));
    let request_payload = serde_json::to_value(LifecycleOperationIntent {
        version: 1,
        operation_kind: operation_kind.to_string(),
        logical_path: path.clone(),
        requested_reference: requested_reference.clone(),
        actor: actor.clone(),
        resource_kind: resource_kind.to_string(),
        trash_entry_id,
    })
    .map_err(|error| AppError::Internal(format!("lifecycle intent encode failed: {error}")))?;
    let mut tx = state.db.begin().await?;
    if let Some(row) = sqlx::query_as::<_, (Uuid, String, Option<Uuid>, String, Option<String>, Option<String>)>(
        "SELECT id, request_hash, resource_id, state, committed_revision, requested_reference FROM resource_operations WHERE idempotency_key = $1 FOR UPDATE",
    )
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?
    {
        if row.1 != request_hash {
            return Err(AppError::Conflict(
                "operation key was already used for a different lifecycle request".to_string(),
            ));
        }
        let resource_id = row.2.ok_or_else(|| {
            AppError::Internal("lifecycle operation is missing its resource".to_string())
        })?;
        tx.commit().await?;
        return Ok(PreparedOperation {
            operation_id: row.0,
            resource_id,
            state: row.3,
            committed_fingerprint: row.4,
            requested_reference: row.5,
        });
    }
    let resource_id = if let Some(resource_id) = known_resource_id {
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM drive_resources WHERE id = $1 FOR UPDATE")
            .bind(resource_id)
            .fetch_optional(&mut *tx)
            .await?
    } else {
        sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id FROM drive_resources
               WHERE provider = 'local_vm' AND canonical_path = $1
                 AND lifecycle_state = 'active' FOR UPDATE"#,
        )
        .bind(&path)
        .fetch_optional(&mut *tx)
        .await?
    }
    .ok_or_else(|| AppError::Conflict("Drive resource identity is unavailable".to_string()))?;
    if let Some(expected) = expected_revision {
        let actual = sqlx::query_scalar::<_, i64>(
            "SELECT lifecycle_revision FROM drive_resources WHERE id = $1",
        )
        .bind(resource_id)
        .fetch_one(&mut *tx)
        .await?
        .to_string();
        if expected != actual {
            return Err(AppError::Conflict(
                "Drive resource lifecycle changed since it was observed".to_string(),
            ));
        }
    }
    let operation_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO resource_operations
             (idempotency_key, request_hash, operation_kind, resource_id,
              before_reference, requested_reference, expected_revision, state,
              request_payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'prepared', $8) RETURNING id"#,
    )
    .bind(key)
    .bind(request_hash)
    .bind(operation_kind)
    .bind(resource_id)
    .bind(&path)
    .bind(requested_reference.as_deref())
    .bind(expected_revision)
    .bind(request_payload)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(PreparedOperation {
        operation_id,
        resource_id,
        state: "prepared".to_string(),
        committed_fingerprint: None,
        requested_reference,
    })
}

pub async fn set_lifecycle_requested_reference(
    state: &AppState,
    operation_id: Uuid,
    requested_reference: &str,
) -> AppResult<String> {
    let reference = normalize_logical_drive_path(requested_reference)?;
    let updated = sqlx::query_scalar::<_, String>(
        r#"UPDATE resource_operations
           SET requested_reference = $2,
               request_payload = jsonb_set(request_payload, '{requestedReference}', to_jsonb($2::text)),
               updated_at = now()
           WHERE id = $1 AND state IN ('prepared', 'reconciling')
             AND committed_revision IS NULL
             AND (requested_reference IS NULL OR requested_reference = $2)
           RETURNING requested_reference"#,
    )
    .bind(operation_id)
    .bind(&reference)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        AppError::Conflict("lifecycle destination changed before commit".to_string())
    })?;
    Ok(updated)
}

pub async fn project_lifecycle_commit(
    state: &AppState,
    prepared: &PreparedOperation,
    effect_kind: &str,
    lifecycle_state: &str,
    current_reference: Option<&str>,
    actor: &ResourceActor,
    trash_projection: Option<&TrashProjection>,
) -> AppResult<i64> {
    if !matches!(effect_kind, "moved" | "trashed" | "restored" | "purged")
        || !matches!(lifecycle_state, "active" | "trashed" | "purged" | "missing")
    {
        return Err(AppError::BadRequest(
            "invalid lifecycle projection".to_string(),
        ));
    }
    let normalized_reference = current_reference
        .map(normalize_logical_drive_path)
        .transpose()?;
    let mut tx = state.db.begin().await?;
    let (before_reference, content_revision, lifecycle_revision) =
        sqlx::query_as::<_, (Option<String>, i64, i64)>(
            "SELECT current_path, current_revision, lifecycle_revision FROM drive_resources WHERE id = $1 FOR UPDATE",
        )
        .bind(prepared.resource_id)
        .fetch_one(&mut *tx)
        .await?;
    let next_lifecycle = lifecycle_revision + 1;
    let sequence = content_revision + next_lifecycle;
    let active_reference = if lifecycle_state == "active" {
        normalized_reference.as_deref()
    } else {
        None
    };
    sqlx::query(
        r#"UPDATE drive_resources
           SET lifecycle_state = $2, current_path = $3, canonical_path = $3,
               lifecycle_revision = $4, updated_at = now(),
               purged_at = CASE WHEN $2 = 'purged' THEN now() ELSE purged_at END
           WHERE id = $1"#,
    )
    .bind(prepared.resource_id)
    .bind(lifecycle_state)
    .bind(active_reference)
    .bind(next_lifecycle)
    .execute(&mut *tx)
    .await?;
    let revision = format!("lifecycle:{next_lifecycle}");
    let effect_id = insert_run_effect(
        &mut tx,
        actor,
        RunEffectProjection {
            operation_id: prepared.operation_id,
            resource_id: prepared.resource_id,
            effect_kind,
            before_reference: before_reference.as_deref(),
            after_reference: normalized_reference.as_deref(),
            revision: &revision,
            sequence,
        },
    )
    .await?;
    update_artifact_lifecycle(
        &mut tx,
        actor,
        prepared.resource_id,
        effect_id,
        effect_kind,
        lifecycle_state,
        sequence,
    )
    .await?;
    if let Some(projection) = trash_projection {
        match projection {
            TrashProjection::Created {
                id,
                original_path,
                trash_path,
                kind,
                size_bytes,
            } => {
                sqlx::query(
                    r#"INSERT INTO drive_trash_entries
                         (id, original_path, trash_path, kind, size_bytes,
                          resource_id, operation_id)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)
                       ON CONFLICT (id) DO UPDATE SET
                         resource_id = EXCLUDED.resource_id,
                         operation_id = EXCLUDED.operation_id"#,
                )
                .bind(id)
                .bind(original_path)
                .bind(trash_path)
                .bind(kind)
                .bind(size_bytes)
                .bind(prepared.resource_id)
                .bind(prepared.operation_id)
                .execute(&mut *tx)
                .await?;
            }
            TrashProjection::Restored { id } => {
                sqlx::query(
                    "UPDATE drive_trash_entries SET restored_at = now() WHERE id = $1 AND resource_id = $2",
                )
                .bind(id)
                .bind(prepared.resource_id)
                .execute(&mut *tx)
                .await?;
            }
            TrashProjection::Purged { id } => {
                sqlx::query(
                    "UPDATE drive_trash_entries SET purged_at = now() WHERE id = $1 AND resource_id = $2",
                )
                .bind(id)
                .bind(prepared.resource_id)
                .execute(&mut *tx)
                .await?;
            }
        }
    }
    sqlx::query(
        r#"INSERT INTO resource_outbox
             (operation_id, resource_id, resource_sequence, event_kind, payload)
           VALUES ($1, $2, $3, 'artifact_lifecycle_changed',
                   jsonb_build_object('resourceId', $2, 'sequence', $3,
                                      'lifecycleState', $4))
           ON CONFLICT DO NOTHING"#,
    )
    .bind(prepared.operation_id)
    .bind(prepared.resource_id)
    .bind(sequence)
    .bind(lifecycle_state)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE resource_operations
           SET state = 'completed', committed_reference = $2,
               committed_revision = $3, completed_at = now(), updated_at = now(),
               last_error_code = NULL, reconcile_lease_owner = NULL,
               reconcile_lease_expires_at = NULL WHERE id = $1"#,
    )
    .bind(prepared.operation_id)
    .bind(normalized_reference.as_deref())
    .bind(&revision)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(sequence)
}

pub async fn ensure_existing_resource(
    state: &AppState,
    logical_path: &str,
    kind: &str,
) -> AppResult<Uuid> {
    let path = normalize_logical_drive_path(logical_path)?;
    sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO drive_resources
             (kind, lifecycle_state, current_path, canonical_path)
           VALUES ($1, 'active', $2, $2)
           ON CONFLICT (provider, canonical_path) WHERE lifecycle_state = 'active'
           DO UPDATE SET updated_at = drive_resources.updated_at
           RETURNING id"#,
    )
    .bind(kind)
    .bind(path)
    .fetch_one(&state.db)
    .await
    .map_err(Into::into)
}

pub async fn prepare_directory_move(
    state: &AppState,
    operation_id: Uuid,
    source_physical_path: &Path,
    source_logical_path: &str,
) -> AppResult<usize> {
    const MAX_DIRECTORY_MOVE_ENTRIES: usize = 10_000;
    let source_logical_path = normalize_logical_drive_path(source_logical_path)?;
    let mut pending = vec![(
        source_physical_path.to_path_buf(),
        source_logical_path.clone(),
    )];
    let mut descendants = Vec::new();
    while let Some((physical, logical)) = pending.pop() {
        for entry in std::fs::read_dir(&physical)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                return Err(AppError::BadRequest(
                    "directory moves do not follow symbolic links".to_string(),
                ));
            }
            let child_logical = format!(
                "{}/{}",
                logical.trim_end_matches('/'),
                entry.file_name().to_string_lossy()
            );
            let kind = if file_type.is_dir() {
                "directory"
            } else if file_type.is_file() {
                "file"
            } else {
                return Err(AppError::BadRequest(
                    "directory move contains an unsupported filesystem entry".to_string(),
                ));
            };
            descendants.push((child_logical.clone(), kind));
            if descendants.len() > MAX_DIRECTORY_MOVE_ENTRIES {
                return Err(AppError::PayloadTooLarge(format!(
                    "directory move exceeds {MAX_DIRECTORY_MOVE_ENTRIES} entries"
                )));
            }
            if file_type.is_dir() {
                pending.push((entry.path(), child_logical));
            }
        }
    }
    for (logical_path, kind) in &descendants {
        ensure_existing_resource(state, logical_path, kind).await?;
    }
    sqlx::query(
        r#"UPDATE resource_operations
           SET directory_move_pending = true, updated_at = now()
           WHERE id = $1 AND operation_kind = 'move'"#,
    )
    .bind(operation_id)
    .execute(&state.db)
    .await?;
    Ok(descendants.len())
}

pub async fn project_directory_descendant_paths(
    state: &AppState,
    operation_id: Uuid,
    root_resource_id: Uuid,
    old_prefix: &str,
    new_prefix: &str,
) -> AppResult<usize> {
    let old_prefix = normalize_logical_drive_path(old_prefix)?;
    let new_prefix = normalize_logical_drive_path(new_prefix)?;
    let mut tx = state.db.begin().await?;
    let pending = sqlx::query_scalar::<_, bool>(
        "SELECT directory_move_pending FROM resource_operations WHERE id = $1 FOR UPDATE",
    )
    .bind(operation_id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(false);
    if !pending {
        tx.commit().await?;
        return Ok(0);
    }
    let moved = sqlx::query(
        r#"UPDATE drive_resources
           SET current_path = $2 || substr(current_path, char_length($1) + 1),
               canonical_path = $2 || substr(canonical_path, char_length($1) + 1),
               updated_at = now()
           WHERE provider = 'local_vm' AND lifecycle_state = 'active'
             AND canonical_path LIKE $1 || '/%'"#,
    )
    .bind(&old_prefix)
    .bind(&new_prefix)
    .execute(&mut *tx)
    .await?;
    let sequence = sqlx::query_scalar::<_, i64>(
        "SELECT current_revision + lifecycle_revision FROM drive_resources WHERE id = $1",
    )
    .bind(root_resource_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO resource_outbox
             (operation_id, resource_id, resource_sequence, event_kind, payload)
           VALUES ($1, $2, $3, 'resource_prefix_moved',
                   jsonb_build_object('resourceId', $2, 'sequence', $3,
                                      'oldPrefix', $4, 'newPrefix', $5,
                                      'descendantCount', $6))
           ON CONFLICT DO NOTHING"#,
    )
    .bind(operation_id)
    .bind(root_resource_id)
    .bind(sequence)
    .bind(&old_prefix)
    .bind(&new_prefix)
    .bind(i64::try_from(moved.rows_affected()).unwrap_or(i64::MAX))
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE resource_operations
           SET directory_move_pending = false, reconcile_lease_owner = NULL,
               reconcile_lease_expires_at = NULL, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(operation_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(moved.rows_affected() as usize)
}

pub async fn active_resource_id_for_path(
    db: &sqlx::PgPool,
    logical_path: &str,
) -> AppResult<Option<Uuid>> {
    let path = normalize_logical_drive_path(logical_path)?;
    Ok(sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id FROM drive_resources
           WHERE provider = 'local_vm' AND canonical_path = $1
             AND lifecycle_state = 'active'"#,
    )
    .bind(path)
    .fetch_optional(db)
    .await?)
}

pub async fn active_resource_sequence_for_path(
    db: &sqlx::PgPool,
    logical_path: &str,
) -> AppResult<Option<(Uuid, i64)>> {
    let path = normalize_logical_drive_path(logical_path)?;
    Ok(sqlx::query_as::<_, (Uuid, i64)>(
        r#"SELECT id, current_revision + lifecycle_revision
           FROM drive_resources
           WHERE provider = 'local_vm' AND canonical_path = $1
             AND lifecycle_state = 'active'"#,
    )
    .bind(path)
    .fetch_optional(db)
    .await?)
}

pub async fn validate_artifact_source_session(
    state: &AppState,
    logical_path: &str,
    session_id: Uuid,
) -> AppResult<()> {
    let path = normalize_logical_drive_path(logical_path)?;
    let allowed = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1
             FROM drive_resources dr
             INNER JOIN artifacts a ON a.resource_id = dr.id
             INNER JOIN session_artifact_links l ON l.artifact_id = a.id
             INNER JOIN chat_sessions s ON s.id = l.session_id
             WHERE dr.provider = 'local_vm' AND dr.canonical_path = $1
               AND dr.lifecycle_state = 'active' AND l.session_id = $2
               AND s.deleting_at IS NULL)"#,
    )
    .bind(path)
    .bind(session_id)
    .fetch_one(&state.db)
    .await?;
    if !allowed {
        return Err(AppError::Conflict(
            "artifact source session is unavailable or no longer linked".to_string(),
        ));
    }
    Ok(())
}

pub async fn reconcile_existing_drive(state: &AppState, maximum: usize) -> AppResult<usize> {
    let root = state.config.agent_data_dir.join("drive");
    if !root.exists() {
        return Ok(0);
    }
    let mut pending = vec![(root, "/drive".to_string())];
    let mut reconciled = 0;
    while let Some((physical, logical)) = pending.pop() {
        if reconciled >= maximum {
            break;
        }
        let metadata = std::fs::metadata(&physical)?;
        ensure_existing_resource(
            state,
            &logical,
            if metadata.is_dir() {
                "directory"
            } else {
                "file"
            },
        )
        .await?;
        reconciled += 1;
        if metadata.is_dir() {
            for entry in std::fs::read_dir(&physical)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if logical == "/drive" && name == ".trash" {
                    continue;
                }
                pending.push((
                    entry.path(),
                    format!("{}/{}", logical.trim_end_matches('/'), name),
                ));
            }
        }
    }
    Ok(reconciled)
}

pub async fn reconcile_existing_trash(state: &AppState, maximum: usize) -> AppResult<usize> {
    let rows = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"SELECT id, trash_path, kind FROM drive_trash_entries
           WHERE resource_id IS NULL AND restored_at IS NULL AND purged_at IS NULL
           ORDER BY deleted_at, id
           LIMIT $1"#,
    )
    .bind(i64::try_from(maximum).unwrap_or(i64::MAX))
    .fetch_all(&state.db)
    .await?;
    let mut reconciled = 0;
    for (trash_id, trash_path, stored_kind) in rows {
        let resolved = resolve_drive_path(&state.config.agent_data_dir, &trash_path)?;
        let actual_kind = if resolved.physical_path.is_file() {
            "file"
        } else if resolved.physical_path.is_dir() {
            "directory"
        } else {
            continue;
        };
        if actual_kind != stored_kind {
            continue;
        }
        let mut tx = state.db.begin().await?;
        let still_unresolved = sqlx::query_scalar::<_, bool>(
            "SELECT resource_id IS NULL FROM drive_trash_entries WHERE id = $1 FOR UPDATE",
        )
        .bind(trash_id)
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(false);
        if !still_unresolved {
            tx.commit().await?;
            continue;
        }
        let resource_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO drive_resources(kind, lifecycle_state, lifecycle_revision)
               VALUES ($1, 'trashed', 1) RETURNING id"#,
        )
        .bind(actual_kind)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("UPDATE drive_trash_entries SET resource_id = $2 WHERE id = $1")
            .bind(trash_id)
            .bind(resource_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        reconciled += 1;
    }
    Ok(reconciled)
}

async fn actor_effect_context(
    tx: &mut Transaction<'_, Postgres>,
    actor: &ResourceActor,
) -> AppResult<Option<ActorEffectContext>> {
    if let Some(run_id) = actor.run_id {
        return Ok(sqlx::query_as::<_, (Option<Uuid>, String, Option<Uuid>)>(
            "SELECT session_id, agent_profile, parent_run_id FROM agent_runs WHERE id = $1",
        )
        .bind(run_id)
        .fetch_optional(&mut **tx)
        .await?
        .map(|(session_id, agent_profile, parent_run_id)| {
            (Some(run_id), session_id, Some(agent_profile), parent_run_id)
        }));
    }
    let Some(session_id) = actor.source_session_id else {
        return Ok(None);
    };
    let active = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id = $1 AND deleting_at IS NULL)",
    )
    .bind(session_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(active.then_some((None, Some(session_id), None, None)))
}

async fn insert_run_effect(
    tx: &mut Transaction<'_, Postgres>,
    actor: &ResourceActor,
    projection: RunEffectProjection<'_>,
) -> AppResult<Option<Uuid>> {
    let context = actor_effect_context(tx, actor).await?;
    let Some((run_id, session_id, agent_profile, parent_run_id)) = context else {
        return Ok(None);
    };
    let effect_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO run_resource_effects
             (run_id, session_id, invocation_id, agent_profile, parent_run_id,
              operation_id, resource_kind, resource_id, effect_kind,
              before_reference, after_reference, observed_revision, resource_sequence)
           VALUES ($1, $2, $3, $4, $5, $6, 'drive', $7, $8, $9, $10, $11, $12)
           ON CONFLICT DO NOTHING RETURNING id"#,
    )
    .bind(run_id)
    .bind(session_id)
    .bind(actor.invocation_id.as_deref())
    .bind(agent_profile.as_deref())
    .bind(parent_run_id)
    .bind(projection.operation_id)
    .bind(projection.resource_id)
    .bind(projection.effect_kind)
    .bind(projection.before_reference)
    .bind(projection.after_reference)
    .bind(projection.revision)
    .bind(projection.sequence)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(effect_id)
}

async fn project_artifact(
    tx: &mut Transaction<'_, Postgres>,
    actor: &ResourceActor,
    resource_id: Uuid,
    effect_id: Option<Uuid>,
    effect_kind: &str,
    sequence: i64,
    classification: Option<&ArtifactClassification>,
) -> AppResult<()> {
    let actor_context = actor_effect_context(tx, actor).await?;
    let session_context = actor_context
        .as_ref()
        .and_then(|(run_id, session_id, _, _)| session_id.map(|session| (*run_id, session)));
    let existing_artifact =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM artifacts WHERE resource_id = $1 FOR UPDATE")
            .bind(resource_id)
            .fetch_optional(&mut **tx)
            .await?;
    let artifact_id = match (existing_artifact, classification, session_context) {
        (Some(id), _, _) => Some(id),
        (None, Some(classification), Some((Some(run_id), session_id)))
            if effect_kind == "created" =>
        {
            Some(
                sqlx::query_scalar::<_, Uuid>(
                    r#"INSERT INTO artifacts
                         (origin_run_id, origin_session_id, source_effect_id, resource_id,
                          artifact_type, title, mime_type, lifecycle_state, lifecycle_sequence)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
                       RETURNING id"#,
                )
                .bind(run_id)
                .bind(session_id)
                .bind(effect_id)
                .bind(resource_id)
                .bind(&classification.artifact_type)
                .bind(&classification.title)
                .bind(&classification.mime_type)
                .bind(sequence)
                .fetch_one(&mut **tx)
                .await?,
            )
        }
        _ => None,
    };
    let (Some(artifact_id), Some((run_id, session_id)), Some(effect_id)) =
        (artifact_id, session_context, effect_id)
    else {
        return Ok(());
    };
    let relationship = if effect_kind == "created" {
        "created"
    } else {
        "modified"
    };
    sqlx::query(
        r#"INSERT INTO session_artifact_links
             (session_id, artifact_id, relationship_kind, first_run_id, last_run_id,
              first_effect_id, last_effect_id)
           VALUES ($1, $2, $3, $4, $4, $5, $5)
           ON CONFLICT (session_id, artifact_id) DO UPDATE SET
             relationship_kind = CASE
               WHEN session_artifact_links.relationship_kind = 'created' THEN 'created'
               ELSE EXCLUDED.relationship_kind END,
             last_run_id = EXCLUDED.last_run_id,
             last_effect_id = EXCLUDED.last_effect_id,
             last_activity_at = now()"#,
    )
    .bind(session_id)
    .bind(artifact_id)
    .bind(relationship)
    .bind(run_id)
    .bind(effect_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE artifacts SET lifecycle_state = 'active', lifecycle_sequence = $2, updated_at = now() WHERE id = $1",
    )
    .bind(artifact_id)
    .bind(sequence)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn update_artifact_lifecycle(
    tx: &mut Transaction<'_, Postgres>,
    actor: &ResourceActor,
    resource_id: Uuid,
    effect_id: Option<Uuid>,
    effect_kind: &str,
    lifecycle_state: &str,
    sequence: i64,
) -> AppResult<()> {
    let artifact_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM artifacts WHERE resource_id = $1 FOR UPDATE")
            .bind(resource_id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some(artifact_id) = artifact_id else {
        return Ok(());
    };
    sqlx::query(
        "UPDATE artifacts SET lifecycle_state = $2, lifecycle_sequence = $3, updated_at = now() WHERE id = $1",
    )
    .bind(artifact_id)
    .bind(lifecycle_state)
    .bind(sequence)
    .execute(&mut **tx)
    .await?;
    let relationship = match effect_kind {
        "trashed" | "purged" => Some("deleted"),
        "restored" => Some("restored"),
        _ => None,
    };
    let (Some(relationship), Some(run_id), Some(effect_id)) =
        (relationship, actor.run_id, effect_id)
    else {
        return Ok(());
    };
    let session_id =
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT session_id FROM agent_runs WHERE id = $1")
            .bind(run_id)
            .fetch_optional(&mut **tx)
            .await?
            .flatten();
    let Some(session_id) = session_id else {
        return Ok(());
    };
    sqlx::query(
        r#"INSERT INTO session_artifact_links
             (session_id, artifact_id, relationship_kind, first_run_id, last_run_id,
              first_effect_id, last_effect_id)
           VALUES ($1, $2, $3, $4, $4, $5, $5)
           ON CONFLICT (session_id, artifact_id) DO UPDATE SET
             relationship_kind = CASE
               WHEN session_artifact_links.relationship_kind = 'created' THEN 'created'
               WHEN EXCLUDED.relationship_kind = 'restored' THEN 'restored'
               ELSE EXCLUDED.relationship_kind END,
             last_run_id = EXCLUDED.last_run_id,
             last_effect_id = EXCLUDED.last_effect_id,
             last_activity_at = now()"#,
    )
    .bind(session_id)
    .bind(artifact_id)
    .bind(relationship)
    .bind(run_id)
    .bind(effect_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn validate_operation_key(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        return Err(AppError::BadRequest(
            "operation key must be a 1-128 character ASCII token".to_string(),
        ));
    }
    Ok(())
}

fn content_request_hash(
    request: &PrepareContentOperation,
    logical_path: &str,
) -> AppResult<String> {
    let value = ContentRequestHash {
        version: 1,
        path: logical_path,
        expected_fingerprint: request.expected_fingerprint.as_deref(),
        content_sha256: &request.content_sha256,
        content_size: request.content_size,
        source: &request.source,
        actor_kind: &request.actor.kind,
        actor_id: request.actor.id.as_deref(),
        run_id: request.actor.run_id,
        invocation_id: request.actor.invocation_id.as_deref(),
        source_session_id: request.actor.source_session_id,
        artifact_type: request
            .artifact
            .as_ref()
            .map(|value| value.artifact_type.as_str()),
        artifact_title: request.artifact.as_ref().map(|value| value.title.as_str()),
    };
    let bytes = serde_json::to_vec(&value)
        .map_err(|error| AppError::Internal(format!("operation hash encode failed: {error}")))?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

pub fn artifact_classification(
    artifact_type: &str,
    title: &str,
    logical_path: &str,
) -> AppResult<ArtifactClassification> {
    if !matches!(
        artifact_type,
        "document" | "report" | "image" | "archive" | "attachment" | "export"
    ) {
        return Err(AppError::BadRequest("invalid artifact type".to_string()));
    }
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(AppError::BadRequest(
            "artifact title must contain 1 to 200 characters".to_string(),
        ));
    }
    Ok(ArtifactClassification {
        artifact_type: artifact_type.to_string(),
        title: title.to_string(),
        mime_type: mime_type_for_path(Path::new(logical_path)).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::content_security::ContentOrigin;
    use crate::services::workspace_content::{AdmissionActor, AdmissionOutcome, AdmissionRequest};

    #[sqlx::test(migrations = "./migrations")]
    async fn content_receipts_preserve_identity_across_sessions_and_revert(pool: sqlx::PgPool) {
        let data_dir = std::env::temp_dir().join(format!("mymy-resource-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(data_dir.join("drive/shared")).unwrap();
        let state = AppState::new(pool.clone(), test_config(data_dir));
        let run_a = insert_run(&pool, "artifact-a").await;
        let run_b = insert_run(&pool, "artifact-b").await;
        let path = "/drive/shared/finance-report.md";

        let first = commit(
            &state,
            TestCommit {
                path,
                content: "version A",
                expected: None,
                operation_key: "artifact-create-1",
                run_id: run_a,
                invocation_id: "invoke-create",
                artifact: Some(artifact_classification("report", "Finance report", path).unwrap()),
            },
        )
        .await;
        let retry = commit(
            &state,
            TestCommit {
                path,
                content: "version A",
                expected: None,
                operation_key: "artifact-create-1",
                run_id: run_a,
                invocation_id: "invoke-create",
                artifact: Some(artifact_classification("report", "Finance report", path).unwrap()),
            },
        )
        .await;
        assert_eq!(first.0, retry.0);

        let second = commit(
            &state,
            TestCommit {
                path,
                content: "version A prime",
                expected: Some(&first.1),
                operation_key: "artifact-update-1",
                run_id: run_b,
                invocation_id: "invoke-update",
                artifact: None,
            },
        )
        .await;
        let third = commit(
            &state,
            TestCommit {
                path,
                content: "version A",
                expected: Some(&second.1),
                operation_key: "artifact-revert-1",
                run_id: run_b,
                invocation_id: "invoke-revert",
                artifact: None,
            },
        )
        .await;
        assert_ne!(second.1, third.1);

        let resource_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM drive_resources")
            .fetch_one(&pool)
            .await
            .unwrap();
        let revision_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM resource_revisions")
                .fetch_one(&pool)
                .await
                .unwrap();
        let artifact_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM artifacts")
            .fetch_one(&pool)
            .await
            .unwrap();
        let relationships = sqlx::query_as::<_, (String,)>(
            "SELECT relationship_kind FROM session_artifact_links ORDER BY relationship_kind",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(resource_count, 1);
        assert_eq!(revision_count, 3);
        assert_eq!(artifact_count, 1);
        assert_eq!(
            relationships,
            vec![("created".to_string(),), ("modified".to_string(),)]
        );

        let session_a =
            sqlx::query_scalar::<_, Uuid>("SELECT session_id FROM agent_runs WHERE id = $1")
                .bind(run_a)
                .fetch_one(&pool)
                .await
                .unwrap();
        let session_b =
            sqlx::query_scalar::<_, Uuid>("SELECT session_id FROM agent_runs WHERE id = $1")
                .bind(run_b)
                .fetch_one(&pool)
                .await
                .unwrap();
        let page_a = crate::services::artifacts::list_session_artifacts(
            &state,
            session_a,
            crate::models::artifact::SessionArtifactsQuery {
                cursor: None,
                limit: 50,
            },
        )
        .await
        .unwrap();
        let page_b = crate::services::artifacts::list_session_artifacts(
            &state,
            session_b,
            crate::models::artifact::SessionArtifactsQuery {
                cursor: None,
                limit: 50,
            },
        )
        .await
        .unwrap();
        assert_eq!(page_a.artifacts.len(), 1);
        assert_eq!(page_b.artifacts.len(), 1);
        assert_eq!(page_a.artifacts[0].id, page_b.artifacts[0].id);
        assert_eq!(page_a.artifacts[0].relationship_kind, "created");
        assert_eq!(page_b.artifacts[0].relationship_kind, "modified");

        let provenance_a = crate::services::artifacts::list_run_provenance(&state, run_a)
            .await
            .unwrap();
        let provenance_b = crate::services::artifacts::list_run_provenance(&state, run_b)
            .await
            .unwrap();
        assert_eq!(provenance_a.artifacts.len(), 1);
        assert_eq!(provenance_a.effects.len(), 1);
        assert_eq!(provenance_a.effects[0].effect_kind, "created");
        assert_eq!(provenance_b.artifacts.len(), 1);
        assert_eq!(provenance_b.effects.len(), 2);
        assert!(provenance_b
            .effects
            .iter()
            .all(|effect| effect.effect_kind == "updated"));
        assert_eq!(provenance_a.artifacts[0].id, provenance_b.artifacts[0].id);

        let resource_id = Uuid::parse_str(&page_a.artifacts[0].resource_id).unwrap();
        let reverse = crate::services::artifacts::list_resource_provenance(&state, resource_id)
            .await
            .unwrap();
        assert_eq!(reverse.lifecycle_state, "active");
        assert_eq!(reverse.runs.len(), 2);
        assert!(reverse
            .runs
            .iter()
            .any(|link| link.run_id == run_a.to_string()));
        assert!(reverse
            .runs
            .iter()
            .any(|link| link.run_id == run_b.to_string()));

        sqlx::query("UPDATE agent_runs SET status = 'completed' WHERE id = $1")
            .bind(run_a)
            .execute(&pool)
            .await
            .unwrap();
        crate::services::chat::delete_session(&state, session_a)
            .await
            .unwrap();
        let reverse_after_session_delete =
            crate::services::artifacts::list_resource_provenance(&state, resource_id)
                .await
                .unwrap();
        assert_eq!(reverse_after_session_delete.runs.len(), 1);
        assert_eq!(
            reverse_after_session_delete.runs[0].run_id,
            run_b.to_string()
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM artifacts")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session_artifact_links")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert!(state
            .config
            .agent_data_dir
            .join("drive/shared/finance-report.md")
            .exists());

        crate::services::drive::delete_path(&state, path, Some("artifact-trash-1"), None)
            .await
            .unwrap();
        let trash = crate::services::drive::list_trash(&state).await.unwrap();
        let trash_id = Uuid::parse_str(&trash.entries[0].id).unwrap();
        let trashed_page = crate::services::artifacts::list_session_artifacts(
            &state,
            session_b,
            crate::models::artifact::SessionArtifactsQuery {
                cursor: None,
                limit: 50,
            },
        )
        .await
        .unwrap();
        assert_eq!(trashed_page.artifacts[0].lifecycle_state, "trashed");
        let original_resource_id = trashed_page.artifacts[0].resource_id.clone();

        let restored = crate::services::drive::restore_trash(
            &state,
            trash_id,
            Some("artifact-restore-1"),
            trash.entries[0].lifecycle_revision.as_deref(),
        )
        .await
        .unwrap();
        assert_eq!(restored.restored_path, path);
        crate::services::drive::delete_path(&state, path, Some("artifact-trash-2"), None)
            .await
            .unwrap();
        let trash_again = crate::services::drive::list_trash(&state).await.unwrap();
        let purge_id = Uuid::parse_str(&trash_again.entries[0].id).unwrap();
        crate::services::drive::purge_trash(
            &state,
            purge_id,
            Some("artifact-purge-1"),
            trash_again.entries[0].lifecycle_revision.as_deref(),
        )
        .await
        .unwrap();
        let purged_page = crate::services::artifacts::list_session_artifacts(
            &state,
            session_b,
            crate::models::artifact::SessionArtifactsQuery {
                cursor: None,
                limit: 50,
            },
        )
        .await
        .unwrap();
        assert_eq!(purged_page.artifacts[0].lifecycle_state, "purged");

        commit(
            &state,
            TestCommit {
                path,
                content: "new unrelated report",
                expected: None,
                operation_key: "artifact-path-reuse",
                run_id: run_b,
                invocation_id: "invoke-path-reuse",
                artifact: Some(
                    artifact_classification("report", "Replacement report", path).unwrap(),
                ),
            },
        )
        .await;
        let reused_page = crate::services::artifacts::list_session_artifacts(
            &state,
            session_b,
            crate::models::artifact::SessionArtifactsQuery {
                cursor: None,
                limit: 50,
            },
        )
        .await
        .unwrap();
        assert_eq!(reused_page.artifacts.len(), 2);
        assert!(reused_page
            .artifacts
            .iter()
            .any(|artifact| artifact.lifecycle_state == "purged"
                && artifact.resource_id == original_resource_id));
        assert!(reused_page
            .artifacts
            .iter()
            .any(|artifact| artifact.lifecycle_state == "active"
                && artifact.resource_id != original_resource_id));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn worker_recovers_content_committed_before_projection(pool: sqlx::PgPool) {
        let data_dir =
            std::env::temp_dir().join(format!("mymy-resource-recovery-{}", Uuid::new_v4()));
        std::fs::create_dir_all(data_dir.join("drive/shared")).unwrap();
        let state = AppState::new(pool.clone(), test_config(data_dir.clone()));
        let run_id = insert_run(&pool, "recovery-agent").await;
        let content = b"recoverable report";
        let content_hash = hex::encode(Sha256::digest(content));
        let logical_path = "/drive/shared/recovered.md";
        let prepared = prepare_content_operation(
            &state,
            &PrepareContentOperation {
                operation_key: "crash-before-projection".to_string(),
                logical_path: logical_path.to_string(),
                expected_fingerprint: None,
                content_sha256: content_hash.clone(),
                content_size: content.len() as u64,
                source: ContentOrigin::AgentGenerated.as_str().to_string(),
                actor: ResourceActor {
                    kind: "agent".to_string(),
                    id: Some("recovery-agent".to_string()),
                    run_id: Some(run_id),
                    invocation_id: Some("recovery-invocation".to_string()),
                    source_session_id: None,
                },
                artifact: Some(
                    artifact_classification("report", "Recovered report", logical_path).unwrap(),
                ),
            },
        )
        .await
        .unwrap();
        std::fs::write(data_dir.join("drive/shared/recovered.md"), content).unwrap();
        sqlx::query(
            "UPDATE resource_operations SET updated_at = now() - interval '1 minute' WHERE id = $1",
        )
        .bind(prepared.operation_id)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(reconcile_pending_operations(&state, 1).await.unwrap(), 1);
        let status = operation_status(&state, prepared.operation_id)
            .await
            .unwrap();
        assert_eq!(status.state, "completed");
        assert_eq!(
            status.committed_revision.as_deref(),
            Some(content_hash.as_str())
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM resource_revisions WHERE resource_id = $1",
            )
            .bind(prepared.resource_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM artifacts WHERE resource_id = $1")
                .bind(prepared.resource_id)
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn worker_terminalizes_cancelled_precommit_without_compensation(pool: sqlx::PgPool) {
        let data_dir =
            std::env::temp_dir().join(format!("mymy-cancelled-precommit-{}", Uuid::new_v4()));
        std::fs::create_dir_all(data_dir.join("drive/shared")).unwrap();
        let state = AppState::new(pool.clone(), test_config(data_dir.clone()));
        let run_id = insert_run(&pool, "cancelled-precommit-agent").await;
        let logical_path = "/drive/shared/cancelled.md";
        commit(
            &state,
            TestCommit {
                path: logical_path,
                content: "original bytes",
                expected: None,
                operation_key: "cancelled-precommit-initial",
                run_id,
                invocation_id: "cancelled-precommit-initial-invocation",
                artifact: None,
            },
        )
        .await;
        let replacement = b"replacement never committed";
        let prepared = prepare_content_operation(
            &state,
            &PrepareContentOperation {
                operation_key: "cancelled-before-write".to_string(),
                logical_path: logical_path.to_string(),
                expected_fingerprint: Some("observed-before-cancellation".to_string()),
                content_sha256: hex::encode(Sha256::digest(replacement)),
                content_size: replacement.len() as u64,
                source: ContentOrigin::EditorOutput.as_str().to_string(),
                actor: ResourceActor {
                    kind: "user".to_string(),
                    id: Some("user".to_string()),
                    run_id: None,
                    invocation_id: Some("cancelled-before-write".to_string()),
                    source_session_id: None,
                },
                artifact: None,
            },
        )
        .await
        .unwrap();
        sqlx::query(
            "UPDATE resource_operations SET updated_at = now() - interval '1 minute' WHERE id = $1",
        )
        .bind(prepared.operation_id)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(reconcile_pending_operations(&state, 1).await.unwrap(), 1);
        let status = operation_status(&state, prepared.operation_id)
            .await
            .unwrap();
        assert_eq!(status.state, "conflict");
        assert_eq!(
            status.last_error_code.as_deref(),
            Some("prepared_bytes_not_committed")
        );
        assert_eq!(
            std::fs::read(data_dir.join("drive/shared/cancelled.md")).unwrap(),
            b"original bytes"
        );
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn stale_precommit_write_is_terminal_and_not_reconciled(pool: sqlx::PgPool) {
        let data_dir =
            std::env::temp_dir().join(format!("mymy-precommit-conflict-{}", Uuid::new_v4()));
        std::fs::create_dir_all(data_dir.join("drive/shared")).unwrap();
        let state = AppState::new(pool.clone(), test_config(data_dir.clone()));
        let run_id = insert_run(&pool, "precommit-conflict-agent").await;
        let logical_path = "/drive/shared/precommit-conflict.md";
        commit(
            &state,
            TestCommit {
                path: logical_path,
                content: "current bytes",
                expected: None,
                operation_key: "precommit-initial",
                run_id,
                invocation_id: "precommit-initial-invocation",
                artifact: None,
            },
        )
        .await;

        let error = state
            .workspace_content
            .admit_bytes(
                &state,
                AdmissionRequest {
                    desired_path: logical_path.to_string(),
                    file_name: "precommit-conflict.md".to_string(),
                    origin: ContentOrigin::AgentGenerated,
                    actor: AdmissionActor::agent(Some("precommit-conflict-agent"), Some(run_id))
                        .with_invocation(Some("precommit-stale-invocation")),
                    expected_fingerprint: Some("stale-revision".to_string()),
                    allow_overwrite: true,
                    enqueue_s3_sync: false,
                    operation_key: Some("precommit-stale".to_string()),
                    artifact: None,
                },
                b"stale replacement",
            )
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Conflict(_)));

        let (operation_id, state_name, error_code) =
            sqlx::query_as::<_, (Uuid, String, Option<String>)>(
                r#"SELECT id, state, last_error_code
               FROM resource_operations
               WHERE idempotency_key = 'content:precommit-stale'"#,
            )
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(state_name, "conflict");
        assert_eq!(error_code.as_deref(), Some("revision_mismatch"));

        sqlx::query(
            "UPDATE resource_operations SET updated_at = now() - interval '1 minute' WHERE id = $1",
        )
        .bind(operation_id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(reconcile_pending_operations(&state, 10).await.unwrap(), 0);
        assert_eq!(
            std::fs::read(data_dir.join("drive/shared/precommit-conflict.md")).unwrap(),
            b"current bytes"
        );
        assert_eq!(
            std::fs::read_dir(crate::services::workspace_content::pending_root(&state))
                .map(|entries| entries.count())
                .unwrap_or(0),
            0
        );
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn session_delete_fence_waits_for_runs_and_admitted_saves(pool: sqlx::PgPool) {
        let data_dir = std::env::temp_dir().join(format!("mymy-session-fence-{}", Uuid::new_v4()));
        let state = AppState::new(pool.clone(), test_config(data_dir));
        let run_id = insert_run(&pool, "session-fence-agent").await;
        let session_id =
            sqlx::query_scalar::<_, Uuid>("SELECT session_id FROM agent_runs WHERE id = $1")
                .bind(run_id)
                .fetch_one(&pool)
                .await
                .unwrap();

        let active_error = crate::services::chat::delete_session(&state, session_id)
            .await
            .unwrap_err();
        assert!(matches!(active_error, AppError::Conflict(_)));
        assert_eq!(
            sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
                "SELECT deleting_at FROM chat_sessions WHERE id = $1",
            )
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            None
        );

        sqlx::query("UPDATE agent_runs SET status = 'completed' WHERE id = $1")
            .bind(run_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            r#"INSERT INTO document_editor_save_receipts
                 (idempotency_key, drive_path, editor_kind, expected_fingerprint,
                  request_hash, result_content_hash, source_session_id)
               VALUES ('pending-session-save', '/drive/shared/report.md', 'markdown',
                       'before', 'request', 'after', $1)"#,
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();
        let save_error = crate::services::chat::delete_session(&state, session_id)
            .await
            .unwrap_err();
        assert!(matches!(save_error, AppError::Conflict(_)));
        assert!(sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
            "SELECT deleting_at FROM chat_sessions WHERE id = $1",
        )
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .is_some());
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT state FROM session_deletion_operations WHERE session_id = $1",
            )
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            "waiting_for_saves"
        );

        sqlx::query(
            "UPDATE document_editor_save_receipts SET status = 'committed' WHERE idempotency_key = 'pending-session-save'",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            crate::services::chat::reconcile_session_deletions(&state, 10)
                .await
                .unwrap(),
            1
        );
        assert!(!sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM chat_sessions WHERE id = $1)",
        )
        .bind(session_id)
        .fetch_one(&pool)
        .await
        .unwrap());
        assert!(crate::services::chat::delete_session(&state, session_id)
            .await
            .unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn agent_lifecycle_effects_attach_only_after_commit(pool: sqlx::PgPool) {
        let data_dir =
            std::env::temp_dir().join(format!("mymy-agent-lifecycle-{}", Uuid::new_v4()));
        std::fs::create_dir_all(data_dir.join("drive/shared")).unwrap();
        let state = AppState::new(pool.clone(), test_config(data_dir));
        let creator_run = insert_run(&pool, "artifact-creator").await;
        let lifecycle_run = insert_run(&pool, "artifact-lifecycle").await;
        let lifecycle_session =
            sqlx::query_scalar::<_, Uuid>("SELECT session_id FROM agent_runs WHERE id = $1")
                .bind(lifecycle_run)
                .fetch_one(&pool)
                .await
                .unwrap();
        let path = "/drive/shared/lifecycle-report.md";
        commit(
            &state,
            TestCommit {
                path,
                content: "report",
                expected: None,
                operation_key: "lifecycle-create",
                run_id: creator_run,
                invocation_id: "create-report",
                artifact: Some(
                    artifact_classification("report", "Lifecycle report", path).unwrap(),
                ),
            },
        )
        .await;
        let actor = ResourceActor {
            kind: "agent".to_string(),
            id: Some("artifact-lifecycle".to_string()),
            run_id: Some(lifecycle_run),
            invocation_id: Some("trash-report".to_string()),
            source_session_id: None,
        };
        crate::services::drive::delete_path_with_actor(
            &state,
            path,
            Some("agent-lifecycle-trash"),
            None,
            actor.clone(),
        )
        .await
        .unwrap();
        let trashed = crate::services::artifacts::list_session_artifacts(
            &state,
            lifecycle_session,
            crate::models::artifact::SessionArtifactsQuery {
                cursor: None,
                limit: 50,
            },
        )
        .await
        .unwrap();
        assert_eq!(trashed.artifacts.len(), 1);
        assert_eq!(trashed.artifacts[0].relationship_kind, "deleted");

        let trash = crate::services::drive::list_trash(&state).await.unwrap();
        let trash_id = Uuid::parse_str(&trash.entries[0].id).unwrap();
        let restore_actor = ResourceActor {
            invocation_id: Some("restore-report".to_string()),
            ..actor
        };
        crate::services::drive::restore_trash_with_actor(
            &state,
            trash_id,
            Some("agent-lifecycle-restore"),
            trash.entries[0].lifecycle_revision.as_deref(),
            restore_actor,
        )
        .await
        .unwrap();
        let restored = crate::services::artifacts::list_session_artifacts(
            &state,
            lifecycle_session,
            crate::models::artifact::SessionArtifactsQuery {
                cursor: None,
                limit: 50,
            },
        )
        .await
        .unwrap();
        assert_eq!(restored.artifacts[0].relationship_kind, "restored");
        assert_eq!(restored.artifacts[0].lifecycle_state, "active");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn historical_trash_payload_gains_identity_and_can_restore(pool: sqlx::PgPool) {
        let data_dir =
            std::env::temp_dir().join(format!("mymy-trash-reconcile-{}", Uuid::new_v4()));
        let trash_id = Uuid::new_v4();
        let payload_dir = data_dir.join("drive/.trash").join(trash_id.to_string());
        std::fs::create_dir_all(&payload_dir).unwrap();
        std::fs::write(payload_dir.join("old.md"), "historical").unwrap();
        let trash_path = format!("/drive/.trash/{trash_id}/old.md");
        sqlx::query(
            r#"INSERT INTO drive_trash_entries
                 (id, original_path, trash_path, kind, size_bytes)
               VALUES ($1, '/drive/shared/old.md', $2, 'file', 10)"#,
        )
        .bind(trash_id)
        .bind(&trash_path)
        .execute(&pool)
        .await
        .unwrap();
        let state = AppState::new(pool.clone(), test_config(data_dir.clone()));
        assert_eq!(reconcile_existing_trash(&state, 10).await.unwrap(), 1);
        let resource_id = sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT resource_id FROM drive_trash_entries WHERE id = $1",
        )
        .bind(trash_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(resource_id.is_some());
        let restored = crate::services::drive::restore_trash(
            &state,
            trash_id,
            Some("historical-trash-restore"),
            Some("1"),
        )
        .await
        .unwrap();
        assert_eq!(restored.restored_path, "/drive/shared/old.md");
        assert!(data_dir.join("drive/shared/old.md").is_file());
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn directory_move_preserves_descendant_identity_and_recovers_prefix_projection(
        pool: sqlx::PgPool,
    ) {
        let data_dir = std::env::temp_dir().join(format!("mymy-directory-move-{}", Uuid::new_v4()));
        std::fs::create_dir_all(data_dir.join("drive/shared/folder/sub")).unwrap();
        std::fs::write(
            data_dir.join("drive/shared/folder/sub/report.md"),
            "directory report",
        )
        .unwrap();
        let state = AppState::new(pool.clone(), test_config(data_dir.clone()));
        let descendant_id =
            ensure_existing_resource(&state, "/drive/shared/folder/sub/report.md", "file")
                .await
                .unwrap();
        let moved = crate::services::drive::move_path(
            &state,
            "/drive/shared/folder",
            "/drive/shared/renamed",
            Some("directory-prefix-move"),
            None,
        )
        .await
        .unwrap();
        let operation_id = Uuid::parse_str(&moved.operation_id).unwrap();
        let current_path = sqlx::query_scalar::<_, Option<String>>(
            "SELECT current_path FROM drive_resources WHERE id = $1",
        )
        .bind(descendant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            current_path.as_deref(),
            Some("/drive/shared/renamed/sub/report.md")
        );

        sqlx::query(
            r#"UPDATE drive_resources
               SET current_path = '/drive/shared/folder/sub/report.md',
                   canonical_path = '/drive/shared/folder/sub/report.md'
               WHERE id = $1"#,
        )
        .bind(descendant_id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"UPDATE resource_operations
               SET directory_move_pending = true,
                   updated_at = now() - interval '1 minute'
               WHERE id = $1"#,
        )
        .bind(operation_id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(reconcile_pending_operations(&state, 1).await.unwrap(), 1);
        let recovered_path = sqlx::query_scalar::<_, Option<String>>(
            "SELECT current_path FROM drive_resources WHERE id = $1",
        )
        .bind(descendant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            recovered_path.as_deref(),
            Some("/drive/shared/renamed/sub/report.md")
        );
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn worker_recovers_move_and_trash_after_filesystem_rename(pool: sqlx::PgPool) {
        let data_dir =
            std::env::temp_dir().join(format!("mymy-lifecycle-recovery-{}", Uuid::new_v4()));
        std::fs::create_dir_all(data_dir.join("drive/shared")).unwrap();
        std::fs::write(data_dir.join("drive/shared/move.md"), "move").unwrap();
        std::fs::write(data_dir.join("drive/shared/trash.md"), "trash").unwrap();
        let state = AppState::new(pool.clone(), test_config(data_dir.clone()));
        let actor = ResourceActor::user();

        let move_resource = ensure_existing_resource(&state, "/drive/shared/move.md", "file")
            .await
            .unwrap();
        let move_operation = prepare_lifecycle_operation(
            &state,
            PrepareLifecycleOperation {
                operation_key: "recover-move",
                operation_kind: "move",
                known_resource_id: Some(move_resource),
                logical_path: "/drive/shared/move.md",
                requested_reference: Some("/drive/shared/moved.md"),
                expected_revision: None,
                actor: &actor,
                resource_kind: "file",
                trash_entry_id: None,
            },
        )
        .await
        .unwrap();
        std::fs::rename(
            data_dir.join("drive/shared/move.md"),
            data_dir.join("drive/shared/moved.md"),
        )
        .unwrap();
        sqlx::query(
            "UPDATE resource_operations SET updated_at = now() - interval '1 minute' WHERE id = $1",
        )
        .bind(move_operation.operation_id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(reconcile_pending_operations(&state, 1).await.unwrap(), 1);
        assert_eq!(
            operation_status(&state, move_operation.operation_id)
                .await
                .unwrap()
                .committed_reference
                .as_deref(),
            Some("/drive/shared/moved.md")
        );

        let trash_resource = ensure_existing_resource(&state, "/drive/shared/trash.md", "file")
            .await
            .unwrap();
        let trash_operation = prepare_lifecycle_operation(
            &state,
            PrepareLifecycleOperation {
                operation_key: "recover-trash",
                operation_kind: "trash",
                known_resource_id: Some(trash_resource),
                logical_path: "/drive/shared/trash.md",
                requested_reference: None,
                expected_revision: None,
                actor: &actor,
                resource_kind: "file",
                trash_entry_id: None,
            },
        )
        .await
        .unwrap();
        let trash_dir = data_dir
            .join("drive/.trash")
            .join(trash_operation.operation_id.to_string());
        std::fs::create_dir_all(&trash_dir).unwrap();
        std::fs::rename(
            data_dir.join("drive/shared/trash.md"),
            trash_dir.join("trash.md"),
        )
        .unwrap();
        sqlx::query(
            "UPDATE resource_operations SET updated_at = now() - interval '1 minute' WHERE id = $1",
        )
        .bind(trash_operation.operation_id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(reconcile_pending_operations(&state, 1).await.unwrap(), 1);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT lifecycle_state FROM drive_resources WHERE id = $1",
            )
            .bind(trash_resource)
            .fetch_one(&pool)
            .await
            .unwrap(),
            "trashed"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM drive_trash_entries WHERE resource_id = $1",
            )
            .bind(trash_resource)
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn worker_recovers_restore_and_purge_after_filesystem_commit(pool: sqlx::PgPool) {
        let data_dir =
            std::env::temp_dir().join(format!("mymy-restore-purge-recovery-{}", Uuid::new_v4()));
        std::fs::create_dir_all(data_dir.join("drive/shared")).unwrap();
        let state = AppState::new(pool.clone(), test_config(data_dir.clone()));
        let run_id = insert_run(&pool, "restore-purge-recovery").await;
        let path = "/drive/shared/recover-lifecycle.md";
        commit(
            &state,
            TestCommit {
                path,
                content: "recover lifecycle",
                expected: None,
                operation_key: "restore-purge-create",
                run_id,
                invocation_id: "restore-purge-create-invocation",
                artifact: Some(artifact_classification("report", "Recovery report", path).unwrap()),
            },
        )
        .await;

        crate::services::drive::delete_path(&state, path, Some("restore-purge-first-trash"), None)
            .await
            .unwrap();
        let first_trash = crate::services::drive::list_trash(&state)
            .await
            .unwrap()
            .entries
            .into_iter()
            .next()
            .unwrap();
        let first_trash_id = Uuid::parse_str(&first_trash.id).unwrap();
        let resource_id = Uuid::parse_str(
            &sqlx::query_scalar::<_, String>(
                "SELECT resource_id::text FROM drive_trash_entries WHERE id = $1",
            )
            .bind(first_trash_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        )
        .unwrap();
        let restore = prepare_lifecycle_operation(
            &state,
            PrepareLifecycleOperation {
                operation_key: "restore-crash-after-rename",
                operation_kind: "restore",
                known_resource_id: Some(resource_id),
                logical_path: path,
                requested_reference: None,
                expected_revision: first_trash.lifecycle_revision.as_deref(),
                actor: &ResourceActor::user(),
                resource_kind: "file",
                trash_entry_id: Some(first_trash_id),
            },
        )
        .await
        .unwrap();
        set_lifecycle_requested_reference(&state, restore.operation_id, path)
            .await
            .unwrap();
        let trash_physical = resolve_drive_path(&data_dir, &first_trash.trash_path)
            .unwrap()
            .physical_path;
        let active_physical = resolve_drive_path(&data_dir, path).unwrap().physical_path;
        std::fs::rename(&trash_physical, &active_physical).unwrap();
        sqlx::query(
            "UPDATE resource_operations SET updated_at = now() - interval '1 minute' WHERE id = $1",
        )
        .bind(restore.operation_id)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(reconcile_pending_operations(&state, 1).await.unwrap(), 1);
        assert_eq!(
            operation_status(&state, restore.operation_id)
                .await
                .unwrap()
                .state,
            "completed"
        );
        assert!(sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
            "SELECT restored_at FROM drive_trash_entries WHERE id = $1",
        )
        .bind(first_trash_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .is_some());

        crate::services::drive::delete_path(&state, path, Some("restore-purge-second-trash"), None)
            .await
            .unwrap();
        let second_trash = crate::services::drive::list_trash(&state)
            .await
            .unwrap()
            .entries
            .into_iter()
            .find(|entry| entry.id != first_trash.id)
            .unwrap();
        let second_trash_id = Uuid::parse_str(&second_trash.id).unwrap();
        let purge = prepare_lifecycle_operation(
            &state,
            PrepareLifecycleOperation {
                operation_key: "purge-crash-after-unlink",
                operation_kind: "purge",
                known_resource_id: Some(resource_id),
                logical_path: path,
                requested_reference: None,
                expected_revision: second_trash.lifecycle_revision.as_deref(),
                actor: &ResourceActor::user(),
                resource_kind: "file",
                trash_entry_id: Some(second_trash_id),
            },
        )
        .await
        .unwrap();
        let purge_physical = resolve_drive_path(&data_dir, &second_trash.trash_path)
            .unwrap()
            .physical_path;
        std::fs::remove_file(&purge_physical).unwrap();
        sqlx::query(
            "UPDATE resource_operations SET updated_at = now() - interval '1 minute' WHERE id = $1",
        )
        .bind(purge.operation_id)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(reconcile_pending_operations(&state, 1).await.unwrap(), 1);
        assert_eq!(
            operation_status(&state, purge.operation_id)
                .await
                .unwrap()
                .state,
            "completed"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT lifecycle_state FROM drive_resources WHERE id = $1",
            )
            .bind(resource_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            "purged"
        );
        assert!(sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
            "SELECT purged_at FROM drive_trash_entries WHERE id = $1",
        )
        .bind(second_trash_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .is_some());
        let _ = std::fs::remove_dir_all(data_dir);
    }

    async fn insert_run(pool: &sqlx::PgPool, profile: &str) -> Uuid {
        let session_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO chat_sessions(agent_id, profile) VALUES ($1, $1) RETURNING id",
        )
        .bind(profile)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO agent_runs
                 (session_id, agent_profile, trigger_type, status, objective, prompt_version)
               VALUES ($1, $2, 'chat', 'running', 'resource integration test', 'test')
               RETURNING id"#,
        )
        .bind(session_id)
        .bind(profile)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    struct TestCommit<'a> {
        path: &'a str,
        content: &'a str,
        expected: Option<&'a str>,
        operation_key: &'a str,
        run_id: Uuid,
        invocation_id: &'a str,
        artifact: Option<ArtifactClassification>,
    }

    async fn commit(state: &AppState, request: TestCommit<'_>) -> (Uuid, String) {
        match state
            .workspace_content
            .admit_bytes(
                state,
                AdmissionRequest {
                    desired_path: request.path.to_string(),
                    file_name: "finance-report.md".to_string(),
                    origin: ContentOrigin::AgentGenerated,
                    actor: AdmissionActor::agent(Some("resource-test"), Some(request.run_id))
                        .with_invocation(Some(request.invocation_id)),
                    expected_fingerprint: request.expected.map(str::to_string),
                    allow_overwrite: request.expected.is_some(),
                    enqueue_s3_sync: false,
                    operation_key: Some(request.operation_key.to_string()),
                    artifact: request.artifact,
                },
                request.content.as_bytes(),
            )
            .await
            .unwrap()
        {
            AdmissionOutcome::Committed {
                fingerprint,
                operation_id,
                ..
            } => (operation_id, fingerprint.hash),
            other => panic!("unexpected admission outcome: {other:?}"),
        }
    }

    fn test_config(agent_data_dir: std::path::PathBuf) -> crate::config::Config {
        crate::config::Config {
            database_url: String::new(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir,
            auth_cookie_secure: false,
            cron_tick_interval_secs: 60,
            cron_timezone: "UTC".to_string(),
            cron_output_keep: 10,
            drive_s3_bucket: None,
            drive_s3_region: None,
            drive_s3_endpoint: None,
            sandbox_runner_url: None,
            sandbox_preview_host: "127.0.0.1".to_string(),
        }
    }
}
