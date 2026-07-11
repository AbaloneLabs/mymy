//! Durable quarantine lifecycle for content awaiting a human decision.
//!
//! Pending bytes are stored by random server keys outside Drive. Database rows
//! expose only fixed finding codes and bounded actor metadata. Approval uses an
//! optimistic version and idempotency key, re-inspects the exact staged bytes,
//! and commits through `WorkspaceContentService` without overwriting a target.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::content_security::{
    ApproveQuarantineRequest, ContentOrigin, ContentSafetyFinding, ContentSafetyReport,
    ContentSafetyVerdict, DeleteQuarantineRequest, QuarantineDecisionResponse, QuarantineItem,
    QuarantineListQuery, QuarantineListResponse,
};
use crate::services::drive;
use crate::services::file_observations::fingerprint_path;
use crate::services::workspace_content::{
    ensure_private_directory, pending_root, read_staged_bounded, remove_staged, AdmissionRequest,
    StagedContent,
};
use crate::state::AppState;

const LIST_LIMIT: i64 = 50;
const RECONCILE_INTERVAL_SECS: u64 = 60 * 60;
const ORPHAN_GRACE_SECS: u64 = 15 * 60;
const APPROVING_GRACE_MINUTES: i32 = 5;
const QUOTA_ADVISORY_LOCK: i64 = 0x4d59_4d59_4351;

#[derive(Debug, FromRow)]
struct QuarantineRow {
    id: Uuid,
    desired_path: String,
    normalized_name: String,
    detected_type: String,
    origin_kind: String,
    actor_kind: String,
    actor_id: Option<String>,
    sha256: String,
    size: i64,
    storage_key: Uuid,
    findings: Value,
    policy_version: String,
    status: String,
    version: i64,
    approval_idempotency_key: Option<String>,
    committed_fingerprint: Option<String>,
    #[sqlx(rename = "target_fingerprint")]
    _target_fingerprint: Option<String>,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

pub fn start_worker(state: Arc<AppState>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(RECONCILE_INTERVAL_SECS));
        loop {
            interval.tick().await;
            if let Err(error) = reconcile(&state).await {
                tracing::warn!(error = %error, "content quarantine reconciliation failed");
            }
        }
    })
}

pub async fn store_pending(
    state: &AppState,
    request: &AdmissionRequest,
    desired_path: &str,
    staged: &StagedContent,
    report: &ContentSafetyReport,
    target_fingerprint: Option<&str>,
) -> AppResult<Uuid> {
    ensure_private_directory(&pending_root(state)).await?;
    let pending_path = storage_path(state, staged.storage_key);
    tokio::fs::rename(&staged.path, &pending_path).await?;

    let result = store_pending_row(
        state,
        request,
        desired_path,
        staged,
        report,
        target_fingerprint,
    )
    .await;
    if result.is_err() {
        if let Err(error) = tokio::fs::remove_file(&pending_path).await {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(error = %error, "failed to remove unreferenced quarantine object");
            }
        }
    }
    result
}

async fn store_pending_row(
    state: &AppState,
    request: &AdmissionRequest,
    desired_path: &str,
    staged: &StagedContent,
    report: &ContentSafetyReport,
    target_fingerprint: Option<&str>,
) -> AppResult<Uuid> {
    let actor_id = bounded_label(request.actor.id.as_deref());
    let provider_ref = bounded_reference(request.actor.provider_ref.as_deref());
    let findings = serde_json::to_value(&report.findings)
        .map_err(|error| AppError::Internal(format!("finding serialization failed: {error}")))?;
    let retention_days = i32::try_from(state.config.quarantine_retention_days())
        .map_err(|_| AppError::Internal("quarantine retention conversion failed".to_string()))?;
    let size = i64::try_from(staged.size)
        .map_err(|_| AppError::PayloadTooLarge("content size cannot be stored".to_string()))?;

    let mut transaction = state.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(QUOTA_ADVISORY_LOCK)
        .execute(&mut *transaction)
        .await?;
    let pending_bytes = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(size), 0)::BIGINT FROM content_quarantine_items WHERE status IN ('pending', 'approving')",
    )
    .fetch_one(&mut *transaction)
    .await?;
    let maximum = i64::try_from(state.config.quarantine_max_pending_bytes()).unwrap_or(i64::MAX);
    if pending_bytes.saturating_add(size) > maximum {
        transaction.rollback().await?;
        return Err(AppError::quarantine_capacity_exceeded());
    }

    let id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO content_quarantine_items (
               desired_path, normalized_name, detected_type, origin_kind,
               actor_kind, actor_id, agent_run_id, provider_ref, sha256, size,
               storage_key, findings, policy_version, expires_at,
               target_fingerprint
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   now() + make_interval(days => $14), $15)
           RETURNING id"#,
    )
    .bind(desired_path)
    .bind(&report.normalized_name)
    .bind(&report.detected_type)
    .bind(request.origin.as_str())
    .bind(request.actor.kind)
    .bind(actor_id)
    .bind(request.actor.agent_run_id)
    .bind(provider_ref)
    .bind(&report.sha256)
    .bind(size)
    .bind(staged.storage_key)
    .bind(findings)
    .bind(&report.policy_version)
    .bind(retention_days)
    .bind(target_fingerprint)
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;

    metrics::counter!(
        "mymy_content_quarantine_transitions_total",
        "transition" => "created",
        "origin" => request.origin.as_str(),
    )
    .increment(1);
    Ok(id)
}

pub async fn list(
    state: &AppState,
    query: QuarantineListQuery,
) -> AppResult<QuarantineListResponse> {
    validate_status_filter(&query.status)?;
    let cursor = query
        .cursor
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::BadRequest("invalid quarantine cursor".to_string()))?;

    let mut rows = if let Some(cursor) = cursor {
        sqlx::query_as::<_, QuarantineRow>(
            r#"SELECT id, desired_path, normalized_name, detected_type, origin_kind,
                      actor_kind, actor_id, sha256, size, storage_key, findings,
                      policy_version, status, version, approval_idempotency_key,
                      committed_fingerprint, target_fingerprint, created_at, expires_at
                 FROM content_quarantine_items
                WHERE status = $1
                  AND (created_at, id) < (
                      SELECT created_at, id FROM content_quarantine_items WHERE id = $2
                  )
                ORDER BY created_at DESC, id DESC
                LIMIT $3"#,
        )
        .bind(&query.status)
        .bind(cursor)
        .bind(LIST_LIMIT + 1)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, QuarantineRow>(
            r#"SELECT id, desired_path, normalized_name, detected_type, origin_kind,
                      actor_kind, actor_id, sha256, size, storage_key, findings,
                      policy_version, status, version, approval_idempotency_key,
                      committed_fingerprint, target_fingerprint, created_at, expires_at
                 FROM content_quarantine_items
                WHERE status = $1
                ORDER BY created_at DESC, id DESC
                LIMIT $2"#,
        )
        .bind(&query.status)
        .bind(LIST_LIMIT + 1)
        .fetch_all(&state.db)
        .await?
    };

    let next_cursor = if rows.len() as i64 > LIST_LIMIT {
        rows.truncate(LIST_LIMIT as usize);
        rows.last().map(|row| row.id.to_string())
    } else {
        None
    };
    let items = rows
        .into_iter()
        .map(row_to_public_item)
        .collect::<AppResult<Vec<_>>>()?;
    Ok(QuarantineListResponse { items, next_cursor })
}

pub async fn approve(
    state: &AppState,
    id: Uuid,
    request: ApproveQuarantineRequest,
) -> AppResult<QuarantineDecisionResponse> {
    validate_idempotency_key(&request.idempotency_key)?;
    let existing = load_row(state, id).await?;
    if existing.status == "approved"
        && existing.approval_idempotency_key.as_deref() == Some(&request.idempotency_key)
    {
        return Ok(decision_response(
            &existing,
            Some(existing.desired_path.clone()),
        ));
    }
    if existing.status != "pending" || existing.version != request.expected_version {
        return Err(AppError::stale_quarantine_version());
    }

    let destination = request
        .destination_path
        .as_deref()
        .unwrap_or(&existing.desired_path);
    let destination = drive::normalize_logical_drive_path(destination)?;
    let destination_name = Path::new(&destination)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::BadRequest("approval destination must name a file".to_string()))?
        .to_string();

    let claimed = sqlx::query(
        r#"UPDATE content_quarantine_items
              SET status = 'approving', version = version + 1, updated_at = now(),
                  approval_idempotency_key = $4, desired_path = $5
            WHERE id = $1 AND status = 'pending' AND version = $2
              AND expires_at > now() AND policy_version = $3"#,
    )
    .bind(id)
    .bind(request.expected_version)
    .bind(&existing.policy_version)
    .bind(&request.idempotency_key)
    .bind(&destination)
    .execute(&state.db)
    .await?;
    if claimed.rows_affected() != 1 {
        return Err(AppError::stale_quarantine_version());
    }

    let staged = staged_from_row(state, &existing);
    let bytes = match read_staged_bounded(state, &staged).await {
        Ok(bytes) => bytes,
        Err(error) => {
            reject_claimed(state, id, request.expected_version + 1, &staged).await?;
            return Err(error);
        }
    };
    let sha256 = hex::encode(Sha256::digest(&bytes));
    if sha256 != existing.sha256 || bytes.len() as i64 != existing.size {
        reject_claimed(state, id, request.expected_version + 1, &staged).await?;
        return Err(AppError::content_policy_changed());
    }

    let origin = parse_origin(&existing.origin_kind)?;
    let report = state
        .content_safety
        .inspect(&destination_name, &bytes, origin);
    if report.verdict == ContentSafetyVerdict::Reject {
        reject_claimed(state, id, request.expected_version + 1, &staged).await?;
        return Err(AppError::content_policy_changed());
    }

    let fingerprint = match state
        .workspace_content
        .release_reviewed(state, &destination, &staged)
        .await
    {
        Ok(fingerprint) => fingerprint,
        Err(error) => {
            sqlx::query(
                r#"UPDATE content_quarantine_items
                      SET status = 'pending', version = version + 1, updated_at = now(),
                          approval_idempotency_key = NULL
                    WHERE id = $1 AND status = 'approving' AND version = $2"#,
            )
            .bind(id)
            .bind(request.expected_version + 1)
            .execute(&state.db)
            .await?;
            return Err(error);
        }
    };

    let final_version = request.expected_version + 2;
    sqlx::query(
        r#"UPDATE content_quarantine_items
              SET status = 'approved', version = version + 1, updated_at = now(),
                  decided_at = now(), decided_by = 'user', committed_fingerprint = $3
            WHERE id = $1 AND status = 'approving' AND version = $2"#,
    )
    .bind(id)
    .bind(request.expected_version + 1)
    .bind(&fingerprint.hash)
    .execute(&state.db)
    .await?;
    metrics::counter!(
        "mymy_content_quarantine_transitions_total",
        "transition" => "approved"
    )
    .increment(1);
    Ok(QuarantineDecisionResponse {
        id: id.to_string(),
        status: "approved".to_string(),
        version: final_version,
        committed_path: Some(destination),
        fingerprint: Some(fingerprint.hash),
    })
}

pub async fn delete(
    state: &AppState,
    id: Uuid,
    request: DeleteQuarantineRequest,
) -> AppResult<QuarantineDecisionResponse> {
    let row = load_row(state, id).await?;
    if row.status == "deleted" {
        return Ok(decision_response(&row, None));
    }
    let result = sqlx::query(
        r#"UPDATE content_quarantine_items
              SET status = 'deleted', version = version + 1, updated_at = now(),
                  decided_at = now(), decided_by = 'user'
            WHERE id = $1 AND status = 'pending' AND version = $2"#,
    )
    .bind(id)
    .bind(request.expected_version)
    .execute(&state.db)
    .await?;
    if result.rows_affected() != 1 {
        return Err(AppError::stale_quarantine_version());
    }
    let staged = staged_from_row(state, &row);
    remove_staged(&staged).await;
    metrics::counter!(
        "mymy_content_quarantine_transitions_total",
        "transition" => "deleted"
    )
    .increment(1);
    Ok(QuarantineDecisionResponse {
        id: id.to_string(),
        status: "deleted".to_string(),
        version: request.expected_version + 1,
        committed_path: None,
        fingerprint: None,
    })
}

pub async fn pending_count(state: &AppState) -> AppResult<i64> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM content_quarantine_items WHERE status IN ('pending', 'approving')",
    )
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)
}

pub async fn capacity_available(state: &AppState) -> AppResult<bool> {
    let bytes = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(size), 0)::BIGINT FROM content_quarantine_items WHERE status IN ('pending', 'approving')",
    )
    .fetch_one(&state.db)
    .await?;
    Ok(bytes < i64::try_from(state.config.quarantine_max_pending_bytes()).unwrap_or(i64::MAX))
}

pub async fn reconcile(state: &AppState) -> AppResult<()> {
    ensure_private_directory(&crate::services::workspace_content::quarantine_root(state)).await?;
    ensure_private_directory(&crate::services::workspace_content::staging_root(state)).await?;
    ensure_private_directory(&pending_root(state)).await?;
    expire_pending(state).await?;
    reconcile_approving(state).await?;
    remove_orphan_files(state).await?;
    Ok(())
}

async fn expire_pending(state: &AppState) -> AppResult<()> {
    let keys = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE content_quarantine_items
              SET status = 'expired', version = version + 1, updated_at = now(),
                  decided_at = now(), decided_by = 'retention'
            WHERE status = 'pending' AND expires_at <= now()
            RETURNING storage_key"#,
    )
    .fetch_all(&state.db)
    .await?;
    for key in keys {
        remove_path(&storage_path(state, key)).await;
    }
    Ok(())
}

async fn reconcile_approving(state: &AppState) -> AppResult<()> {
    let rows = sqlx::query_as::<_, QuarantineRow>(
        r#"SELECT id, desired_path, normalized_name, detected_type, origin_kind,
                  actor_kind, actor_id, sha256, size, storage_key, findings,
                  policy_version, status, version, approval_idempotency_key,
                  committed_fingerprint, target_fingerprint, created_at, expires_at
             FROM content_quarantine_items
            WHERE status = 'approving'
              AND updated_at < now() - make_interval(mins => $1)"#,
    )
    .bind(APPROVING_GRACE_MINUTES)
    .fetch_all(&state.db)
    .await?;
    for row in rows {
        let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, &row.desired_path)?;
        let committed = if resolved.physical_path.is_file() {
            fingerprint_path(&resolved.physical_path)
                .await
                .ok()
                .is_some_and(|fingerprint| fingerprint.hash == row.sha256)
        } else {
            false
        };
        if committed {
            sqlx::query(
                r#"UPDATE content_quarantine_items
                      SET status = 'approved', version = version + 1, updated_at = now(),
                          decided_at = now(), decided_by = 'reconciler',
                          committed_fingerprint = sha256
                    WHERE id = $1 AND status = 'approving' AND version = $2"#,
            )
            .bind(row.id)
            .bind(row.version)
            .execute(&state.db)
            .await?;
            remove_path(&storage_path(state, row.storage_key)).await;
        } else {
            sqlx::query(
                r#"UPDATE content_quarantine_items
                      SET status = 'pending', version = version + 1, updated_at = now(),
                          approval_idempotency_key = NULL
                    WHERE id = $1 AND status = 'approving' AND version = $2"#,
            )
            .bind(row.id)
            .bind(row.version)
            .execute(&state.db)
            .await?;
        }
    }
    Ok(())
}

async fn remove_orphan_files(state: &AppState) -> AppResult<()> {
    let referenced = sqlx::query_scalar::<_, Uuid>(
        "SELECT storage_key FROM content_quarantine_items WHERE status IN ('pending', 'approving')",
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect::<HashSet<_>>();
    remove_unreferenced_in_directory(&pending_root(state), &referenced).await?;
    remove_unreferenced_in_directory(
        &crate::services::workspace_content::staging_root(state),
        &HashSet::new(),
    )
    .await?;
    Ok(())
}

async fn remove_unreferenced_in_directory(
    directory: &Path,
    referenced: &HashSet<Uuid>,
) -> AppResult<()> {
    let mut entries = tokio::fs::read_dir(directory).await?;
    while let Some(entry) = entries.next_entry().await? {
        let Some(key) = entry
            .file_name()
            .to_str()
            .and_then(|name| Uuid::parse_str(name).ok())
        else {
            continue;
        };
        if referenced.contains(&key) || !older_than_grace(&entry.path()).await {
            continue;
        }
        remove_path(&entry.path()).await;
    }
    Ok(())
}

async fn older_than_grace(path: &Path) -> bool {
    tokio::fs::metadata(path)
        .await
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age >= Duration::from_secs(ORPHAN_GRACE_SECS))
}

async fn reject_claimed(
    state: &AppState,
    id: Uuid,
    version: i64,
    staged: &StagedContent,
) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE content_quarantine_items
              SET status = 'rejected', version = version + 1, updated_at = now(),
                  decided_at = now(), decided_by = 'policy'
            WHERE id = $1 AND status = 'approving' AND version = $2"#,
    )
    .bind(id)
    .bind(version)
    .execute(&state.db)
    .await?;
    remove_staged(staged).await;
    Ok(())
}

async fn load_row(state: &AppState, id: Uuid) -> AppResult<QuarantineRow> {
    sqlx::query_as::<_, QuarantineRow>(
        r#"SELECT id, desired_path, normalized_name, detected_type, origin_kind,
                  actor_kind, actor_id, sha256, size, storage_key, findings,
                  policy_version, status, version, approval_idempotency_key,
                  committed_fingerprint, target_fingerprint, created_at, expires_at
             FROM content_quarantine_items WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("content review item not found".to_string()))
}

fn row_to_public_item(row: QuarantineRow) -> AppResult<QuarantineItem> {
    let findings: Vec<ContentSafetyFinding> = serde_json::from_value(row.findings)
        .map_err(|error| AppError::Internal(format!("stored finding decode failed: {error}")))?;
    Ok(QuarantineItem {
        id: row.id.to_string(),
        desired_path: row.desired_path,
        normalized_name: row.normalized_name,
        detected_type: row.detected_type,
        origin: parse_origin(&row.origin_kind)?,
        actor_kind: row.actor_kind,
        actor_label: row.actor_id,
        size: u64::try_from(row.size)
            .map_err(|_| AppError::Internal("stored quarantine size is invalid".to_string()))?,
        findings,
        policy_version: row.policy_version,
        status: row.status,
        version: row.version,
        created_at: row.created_at,
        expires_at: row.expires_at,
    })
}

fn staged_from_row(state: &AppState, row: &QuarantineRow) -> StagedContent {
    StagedContent {
        storage_key: row.storage_key,
        path: storage_path(state, row.storage_key),
        size: u64::try_from(row.size).unwrap_or(u64::MAX),
        sha256: row.sha256.clone(),
    }
}

fn storage_path(state: &AppState, storage_key: Uuid) -> PathBuf {
    pending_root(state).join(storage_key.to_string())
}

fn parse_origin(value: &str) -> AppResult<ContentOrigin> {
    match value {
        "user_edit" => Ok(ContentOrigin::UserEdit),
        "user_upload" => Ok(ContentOrigin::UserUpload),
        "agent_generated" => Ok(ContentOrigin::AgentGenerated),
        "agent_download" => Ok(ContentOrigin::AgentDownload),
        "s3_download" => Ok(ContentOrigin::S3Download),
        "connector_import" => Ok(ContentOrigin::ConnectorImport),
        "editor_output" => Ok(ContentOrigin::EditorOutput),
        _ => Err(AppError::Internal(
            "stored content origin is invalid".to_string(),
        )),
    }
}

fn validate_status_filter(value: &str) -> AppResult<()> {
    if matches!(
        value,
        "pending" | "approving" | "approved" | "deleted" | "expired" | "rejected"
    ) {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "invalid quarantine status filter".to_string(),
        ))
    }
}

fn validate_idempotency_key(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(AppError::BadRequest(
            "idempotency key must be a 1-128 character ASCII token".to_string(),
        ));
    }
    Ok(())
}

fn bounded_label(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .filter(|value| value.chars().all(|character| !character.is_control()))
        .map(str::to_string)
}

fn bounded_reference(value: Option<&str>) -> Option<String> {
    bounded_label(value).filter(|value| !value.contains("://"))
}

fn decision_response(
    row: &QuarantineRow,
    committed_path: Option<String>,
) -> QuarantineDecisionResponse {
    QuarantineDecisionResponse {
        id: row.id.to_string(),
        status: row.status.clone(),
        version: row.version,
        committed_path,
        fingerprint: row.committed_fingerprint.clone(),
    }
}

async fn remove_path(path: &Path) {
    if let Err(error) = tokio::fs::remove_file(path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(error = %error, "failed to remove private quarantine object");
        }
    }
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use super::*;
    use crate::config::Config;
    use crate::models::content_security::ContentSafetyVerdict;
    use crate::services::workspace_content::{AdmissionActor, AdmissionOutcome, AdmissionRequest};

    #[sqlx::test(migrations = "./migrations")]
    async fn suspicious_content_remains_outside_drive_until_reinspected_and_approved(pool: PgPool) {
        let root = test_root();
        let state = AppState::new(pool, test_config(root.clone()));
        let desired_path = "/drive/invoice.pdf";
        let bytes = b"MZ\x90\0bounded executable fixture";

        let outcome = state
            .workspace_content
            .admit_bytes(&state, user_upload(desired_path, "invoice.pdf"), bytes)
            .await
            .unwrap();
        let id = match outcome {
            AdmissionOutcome::Quarantined { id } => id,
            other => panic!("expected quarantine, got {other:?}"),
        };
        let drive_path = root.join("drive/invoice.pdf");
        assert!(!drive_path.exists());
        assert!(matches!(
            state
                .workspace_content
                .ensure_not_quarantined(&state, desired_path)
                .await,
            Err(AppError::Coded {
                code: "content_quarantined",
                ..
            })
        ));

        let pending = list(
            &state,
            QuarantineListQuery {
                status: "pending".to_string(),
                cursor: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(pending.items.len(), 1);
        assert_eq!(pending.items[0].id, id.to_string());
        assert_eq!(pending.items[0].desired_path, desired_path);

        let approved = approve(
            &state,
            id,
            ApproveQuarantineRequest {
                expected_version: 1,
                idempotency_key: "approval-attempt-1".to_string(),
                destination_path: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(approved.status, "approved");
        assert_eq!(std::fs::read(&drive_path).unwrap(), bytes);
        state
            .workspace_content
            .ensure_not_quarantined(&state, desired_path)
            .await
            .unwrap();

        let repeated = approve(
            &state,
            id,
            ApproveQuarantineRequest {
                expected_version: 1,
                idempotency_key: "approval-attempt-1".to_string(),
                destination_path: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(repeated.fingerprint, approved.fingerprint);
        let _ = std::fs::remove_dir_all(root);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn deletion_is_idempotent_and_destination_conflicts_never_overwrite(pool: PgPool) {
        let root = test_root();
        let state = AppState::new(pool, test_config(root.clone()));
        let desired_path = "/drive/review.pdf";
        let bytes = b"%PDF-1.7\nrestricted fixture\n%%EOF";

        let first = state
            .workspace_content
            .admit_bytes(&state, user_upload(desired_path, "review.pdf"), bytes)
            .await
            .unwrap();
        let first_id = match first {
            AdmissionOutcome::Quarantined { id } => id,
            other => panic!("expected quarantine, got {other:?}"),
        };
        let deleted = delete(
            &state,
            first_id,
            DeleteQuarantineRequest {
                expected_version: 1,
            },
        )
        .await
        .unwrap();
        assert_eq!(deleted.status, "deleted");
        let repeated = delete(
            &state,
            first_id,
            DeleteQuarantineRequest {
                expected_version: 1,
            },
        )
        .await
        .unwrap();
        assert_eq!(repeated.status, "deleted");

        let second = state
            .workspace_content
            .admit_bytes(&state, user_upload(desired_path, "review.pdf"), bytes)
            .await
            .unwrap();
        let second_id = match second {
            AdmissionOutcome::Quarantined { id } => id,
            other => panic!("expected quarantine, got {other:?}"),
        };
        let drive_path = root.join("drive/review.pdf");
        std::fs::write(&drive_path, b"existing destination").unwrap();
        let conflict = approve(
            &state,
            second_id,
            ApproveQuarantineRequest {
                expected_version: 1,
                idempotency_key: "conflicting-approval".to_string(),
                destination_path: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(
            conflict,
            AppError::Coded {
                code: "quarantine_destination_conflict",
                ..
            }
        ));
        assert_eq!(std::fs::read(&drive_path).unwrap(), b"existing destination");
        let _ = std::fs::remove_dir_all(root);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn structurally_invalid_archives_are_rejected_without_visible_or_pending_state(
        pool: PgPool,
    ) {
        use std::io::{Cursor, Write};
        use zip::write::SimpleFileOptions;
        use zip::ZipWriter;

        let root = test_root();
        let state = AppState::new(pool, test_config(root.clone()));
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("../escape.txt", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"bounded fixture").unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let outcome = state
            .workspace_content
            .admit_bytes(
                &state,
                user_upload("/drive/invalid.zip", "invalid.zip"),
                &bytes,
            )
            .await
            .unwrap();
        assert!(matches!(outcome, AdmissionOutcome::Rejected));
        assert!(!root.join("drive/invalid.zip").exists());
        assert_eq!(pending_count(&state).await.unwrap(), 0);
        let report = state
            .content_safety
            .inspect("invalid.zip", &bytes, ContentOrigin::UserUpload);
        assert_eq!(report.verdict, ContentSafetyVerdict::Reject);
        let _ = std::fs::remove_dir_all(root);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn tampered_pending_bytes_are_rejected_and_never_reach_drive(pool: PgPool) {
        let root = test_root();
        let state = AppState::new(pool, test_config(root.clone()));
        let desired_path = "/drive/tampered.pdf";
        let outcome = state
            .workspace_content
            .admit_bytes(
                &state,
                user_upload(desired_path, "tampered.pdf"),
                b"%PDF-1.7\nreview fixture\n%%EOF",
            )
            .await
            .unwrap();
        let id = match outcome {
            AdmissionOutcome::Quarantined { id } => id,
            other => panic!("expected quarantine, got {other:?}"),
        };
        let row = load_row(&state, id).await.unwrap();
        let private_path = storage_path(&state, row.storage_key);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&private_path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        tokio::fs::write(&private_path, b"changed after inspection")
            .await
            .unwrap();

        let error = approve(
            &state,
            id,
            ApproveQuarantineRequest {
                expected_version: 1,
                idempotency_key: "tamper-check".to_string(),
                destination_path: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(
            error,
            AppError::Coded {
                code: "content_policy_changed",
                ..
            }
        ));
        assert!(!root.join("drive/tampered.pdf").exists());
        assert!(!private_path.exists());
        assert_eq!(load_row(&state, id).await.unwrap().status, "rejected");
        let _ = std::fs::remove_dir_all(root);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn expiry_removes_private_bytes_and_clears_the_access_guard(pool: PgPool) {
        let root = test_root();
        let state = AppState::new(pool, test_config(root.clone()));
        let desired_path = "/drive/expired.pdf";
        let outcome = state
            .workspace_content
            .admit_bytes(
                &state,
                user_upload(desired_path, "expired.pdf"),
                b"%PDF-1.7\nreview fixture\n%%EOF",
            )
            .await
            .unwrap();
        let id = match outcome {
            AdmissionOutcome::Quarantined { id } => id,
            other => panic!("expected quarantine, got {other:?}"),
        };
        let row = load_row(&state, id).await.unwrap();
        let private_path = storage_path(&state, row.storage_key);
        sqlx::query("UPDATE content_quarantine_items SET expires_at = now() - interval '1 second' WHERE id = $1")
            .bind(id)
            .execute(&state.db)
            .await
            .unwrap();

        reconcile(&state).await.unwrap();

        assert_eq!(load_row(&state, id).await.unwrap().status, "expired");
        assert!(!private_path.exists());
        state
            .workspace_content
            .ensure_not_quarantined(&state, desired_path)
            .await
            .unwrap();
        let _ = std::fs::remove_dir_all(root);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn concurrent_approve_and_delete_produce_one_terminal_decision(pool: PgPool) {
        let root = test_root();
        let state = AppState::new(pool, test_config(root.clone()));
        let outcome = state
            .workspace_content
            .admit_bytes(
                &state,
                user_upload("/drive/race.pdf", "race.pdf"),
                b"%PDF-1.7\nreview fixture\n%%EOF",
            )
            .await
            .unwrap();
        let id = match outcome {
            AdmissionOutcome::Quarantined { id } => id,
            other => panic!("expected quarantine, got {other:?}"),
        };
        let (approval, deletion) = tokio::join!(
            approve(
                &state,
                id,
                ApproveQuarantineRequest {
                    expected_version: 1,
                    idempotency_key: "race-approval".to_string(),
                    destination_path: None,
                }
            ),
            delete(
                &state,
                id,
                DeleteQuarantineRequest {
                    expected_version: 1
                }
            )
        );
        assert_ne!(approval.is_ok(), deletion.is_ok());
        let status = load_row(&state, id).await.unwrap().status;
        assert!(matches!(status.as_str(), "approved" | "deleted"));
        assert_eq!(root.join("drive/race.pdf").exists(), status == "approved");
        let _ = std::fs::remove_dir_all(root);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn replacement_candidate_does_not_hide_the_existing_trusted_revision(pool: PgPool) {
        let root = test_root();
        let state = AppState::new(pool, test_config(root.clone()));
        let drive_path = root.join("drive/report.pdf");
        std::fs::create_dir_all(drive_path.parent().unwrap()).unwrap();
        std::fs::write(&drive_path, b"trusted existing revision").unwrap();

        let outcome = state
            .workspace_content
            .admit_bytes(
                &state,
                user_upload("/drive/report.pdf", "report.pdf"),
                b"MZ\x90\0suspicious replacement",
            )
            .await
            .unwrap();
        let id = match outcome {
            AdmissionOutcome::Quarantined { id } => id,
            other => panic!("expected quarantine, got {other:?}"),
        };

        state
            .workspace_content
            .ensure_not_quarantined(&state, "/drive/report.pdf")
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(&drive_path).unwrap(),
            b"trusted existing revision"
        );
        let error = approve(
            &state,
            id,
            ApproveQuarantineRequest {
                expected_version: 1,
                idempotency_key: "replacement-conflict".to_string(),
                destination_path: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(
            error,
            AppError::Coded {
                code: "quarantine_destination_conflict",
                ..
            }
        ));
        assert_eq!(
            std::fs::read(&drive_path).unwrap(),
            b"trusted existing revision"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn capacity_exhaustion_fails_closed_and_removes_the_unreferenced_object(pool: PgPool) {
        let root = test_root();
        let state = AppState::new(pool, test_config(root.clone()));
        sqlx::query(
            r#"INSERT INTO content_quarantine_items
                   (desired_path, normalized_name, detected_type, origin_kind,
                    actor_kind, sha256, size, storage_key, findings,
                    policy_version, expires_at)
               VALUES ('/drive/seed.bin', 'seed.bin', 'application/octet-stream',
                       'user_upload', 'user', $1, $2, $3, '[]'::jsonb,
                       'mymy-native-1', now() + interval '1 day')"#,
        )
        .bind("0".repeat(64))
        .bind(i64::try_from(state.config.quarantine_max_pending_bytes()).unwrap())
        .bind(Uuid::new_v4())
        .execute(&state.db)
        .await
        .unwrap();

        let error = state
            .workspace_content
            .admit_bytes(
                &state,
                user_upload("/drive/overflow.pdf", "overflow.pdf"),
                b"MZ\x90\0capacity fixture",
            )
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            AppError::Coded {
                code: "quarantine_capacity_exceeded",
                ..
            }
        ));
        assert!(!root.join("drive/overflow.pdf").exists());
        let pending_entries = std::fs::read_dir(pending_root(&state))
            .unwrap()
            .filter_map(Result::ok)
            .count();
        assert_eq!(pending_entries, 0);
        let _ = std::fs::remove_dir_all(root);
    }

    fn user_upload(path: &str, file_name: &str) -> AdmissionRequest {
        AdmissionRequest {
            desired_path: path.to_string(),
            file_name: file_name.to_string(),
            origin: ContentOrigin::UserUpload,
            actor: AdmissionActor::user(),
            expected_fingerprint: None,
            allow_overwrite: true,
            enqueue_s3_sync: false,
        }
    }

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!("mymy-content-quarantine-{}", Uuid::new_v4()))
    }

    fn test_config(agent_data_dir: PathBuf) -> Config {
        Config {
            database_url: "postgres://mymy:mymy@localhost/mymy".to_string(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir,
            auth_cookie_secure: false,
            cron_tick_interval_secs: 60,
            cron_timezone: "UTC".to_string(),
            cron_output_keep: 50,
            drive_s3_bucket: None,
            drive_s3_region: None,
            drive_s3_endpoint: None,
            sandbox_runner_url: None,
            sandbox_preview_host: "127.0.0.1".to_string(),
        }
    }
}
