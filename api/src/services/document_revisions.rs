//! Durable provenance for file revisions visible in the document editor.
//!
//! A fingerprint tells the browser that bytes changed but not who changed
//! them. Recording the actor at the commit boundary lets a dirty editor state
//! distinguish an agent save from another user-facing write without exposing
//! document content in an event stream. Files changed outside mymy simply have
//! no matching record and remain classified as an unknown external revision.

use crate::error::AppResult;
use crate::models::document_editor::{DocumentRevisionActorKind, DocumentRevisionProvenance};
use crate::state::AppState;

#[derive(Debug, Clone, Copy)]
pub enum RevisionActor<'a> {
    User,
    Agent(&'a str),
}

impl<'a> RevisionActor<'a> {
    fn kind(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Agent(_) => "agent",
        }
    }

    fn id(self) -> Option<&'a str> {
        match self {
            Self::Agent(profile) => Some(profile),
            Self::User => None,
        }
    }
}

pub async fn record_document_revision(
    state: &AppState,
    drive_path: &str,
    fingerprint: &str,
    actor: RevisionActor<'_>,
    source: &str,
    operation_key: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        r#"
        INSERT INTO document_revision_events
            (drive_path, fingerprint, actor_kind, actor_id, source, operation_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (operation_key) WHERE operation_key IS NOT NULL DO NOTHING
        "#,
    )
    .bind(drive_path)
    .bind(fingerprint)
    .bind(actor.kind())
    .bind(actor.id())
    .bind(source)
    .bind(operation_key)
    .execute(&state.db)
    .await?;
    Ok(())
}

pub async fn revision_provenance(
    state: &AppState,
    drive_path: &str,
    fingerprint: &str,
) -> AppResult<Option<DocumentRevisionProvenance>> {
    let row = sqlx::query_as::<_, RevisionProvenanceRow>(
        r#"
        SELECT actor_kind, actor_id, source, created_at
          FROM document_revision_events
         WHERE drive_path = $1 AND fingerprint = $2
         ORDER BY created_at DESC, id DESC
         LIMIT 1
        "#,
    )
    .bind(drive_path)
    .bind(fingerprint)
    .fetch_optional(&state.db)
    .await?;
    Ok(row.and_then(RevisionProvenanceRow::into_model))
}

#[derive(Debug, sqlx::FromRow)]
struct RevisionProvenanceRow {
    actor_kind: String,
    actor_id: Option<String>,
    source: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

impl RevisionProvenanceRow {
    fn into_model(self) -> Option<DocumentRevisionProvenance> {
        let actor_kind = match self.actor_kind.as_str() {
            "user" => DocumentRevisionActorKind::User,
            "agent" => DocumentRevisionActorKind::Agent,
            "system" => DocumentRevisionActorKind::System,
            _ => return None,
        };
        Some(DocumentRevisionProvenance {
            actor_kind,
            actor_id: self.actor_id,
            source: self.source,
            created_at: self.created_at.to_rfc3339(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    #[sqlx::test(migrations = "./migrations")]
    async fn revision_event_is_idempotent_and_resolves_exact_fingerprint(pool: PgPool) {
        let state = AppState::new(pool, test_config());
        record_document_revision(
            &state,
            "/drive/shared/report.md",
            "revision-a",
            RevisionActor::Agent("writer"),
            "native-file-tool",
            Some("operation-a"),
        )
        .await
        .unwrap();
        record_document_revision(
            &state,
            "/drive/shared/report.md",
            "revision-a",
            RevisionActor::Agent("writer"),
            "native-file-tool",
            Some("operation-a"),
        )
        .await
        .unwrap();

        let provenance = revision_provenance(&state, "/drive/shared/report.md", "revision-a")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(provenance.actor_kind, DocumentRevisionActorKind::Agent);
        assert_eq!(provenance.actor_id.as_deref(), Some("writer"));
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM document_revision_events WHERE operation_key = 'operation-a'",
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    fn test_config() -> crate::config::Config {
        crate::config::Config {
            database_url: "postgres://sqlx-test".to_string(),
            port: 0,
            cors_origins: Vec::new(),
            agent_data_dir: std::env::temp_dir().join("mymy-revision-event-test"),
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
