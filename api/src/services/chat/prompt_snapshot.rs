use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::agent::prompt::{PromptParts, PROMPT_VERSION};
use crate::agent::providers::ToolSchema;
use crate::agent::tools::ToolCapability;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::repository::ChatSessionRow;

pub(super) async fn resolve_prompt_snapshot(
    state: &AppState,
    session: &ChatSessionRow,
    current: &PromptParts,
    tool_schema_fingerprint: &str,
) -> AppResult<PromptParts> {
    let prompt_fingerprint = prompt_snapshot_fingerprint(
        &session.profile,
        session.project_id,
        &current.stable,
        &current.context,
        tool_schema_fingerprint,
    );
    let cached_stable = session.system_prompt_stable.as_deref();
    let cached_context = session.system_prompt_context.as_deref();
    let cache_matches = session.system_prompt_fingerprint.as_deref() == Some(&prompt_fingerprint)
        && session.tool_schema_fingerprint.as_deref() == Some(tool_schema_fingerprint)
        && cached_stable.is_some()
        && cached_context.is_some();

    if cache_matches {
        return Ok(PromptParts {
            stable: cached_stable.unwrap_or_default().to_string(),
            context: cached_context.unwrap_or_default().to_string(),
            volatile: current.volatile.clone(),
        });
    }

    sqlx::query!(
        r#"UPDATE chat_sessions SET
             system_prompt_stable = $2,
             system_prompt_context = $3,
             system_prompt_fingerprint = $4,
             tool_schema_fingerprint = $5,
             prompt_snapshot_created_at = COALESCE(prompt_snapshot_created_at, now()),
             prompt_snapshot_updated_at = now()
           WHERE id = $1"#,
        session.id,
        current.stable.as_str(),
        current.context.as_str(),
        &prompt_fingerprint,
        tool_schema_fingerprint,
    )
    .execute(&state.db)
    .await?;

    Ok(current.clone())
}

pub(super) fn fingerprint_tool_schemas(
    schemas: &[ToolSchema],
    capabilities: &[(String, ToolCapability)],
) -> AppResult<String> {
    let json = serde_json::to_string(&(schemas, capabilities))
        .map_err(|err| AppError::Internal(format!("tool schema fingerprint failed: {err}")))?;
    Ok(hash_segments(["tool-schema-v2", &json]))
}

fn prompt_snapshot_fingerprint(
    profile: &str,
    project_id: Option<Uuid>,
    stable: &str,
    context: &str,
    tool_schema_fingerprint: &str,
) -> String {
    let project = project_id.map(|id| id.to_string()).unwrap_or_default();
    hash_segments([
        "chat-prompt-v2",
        PROMPT_VERSION,
        profile,
        &project,
        stable,
        context,
        tool_schema_fingerprint,
    ])
}

fn hash_segments<'a>(segments: impl IntoIterator<Item = &'a str>) -> String {
    let mut hasher = Sha256::new();
    for segment in segments {
        hasher.update(segment.as_bytes());
        hasher.update(b"\0");
    }
    hex::encode(hasher.finalize())
}
