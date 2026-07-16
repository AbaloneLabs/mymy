//! Compile-time release certification admission.
//!
//! This module is absent from normal builds. When the `release-harness`
//! feature is selected, callers still need an authenticated owner session and
//! a purpose-bound header token. Fixture admission composes production agent,
//! chat, lease, tool, Decision, Drive, Wiki, and quarantine services; it never
//! inserts browser-shaped rows or returns mock projections.

use std::sync::Arc;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use uuid::Uuid;

use crate::agent::execution::ToolExecutionContext;
use crate::agent::tools::builtin::{self, BuiltinSessionConfig, BuiltinToolConfig};
use crate::agent::tools::ToolRegistry;
use crate::error::{AppError, AppResult};
use crate::models::agent::CreateAgentRequest;
use crate::models::agent_run::EnqueueChatRunRequest;
use crate::models::artifact::SessionArtifactsQuery;
use crate::models::chat::CreateSessionRequest;
use crate::models::content_security::{ContentOrigin, QuarantineListQuery};
use crate::models::knowledge::{AttachKnowledgeResourceRequest, CreateKnowledgeArticleRequest};
use crate::services::workspace_content::{AdmissionActor, AdmissionOutcome, AdmissionRequest};
use crate::services::{
    agent_permissions, agent_runs, agents, artifacts, chat, decisions, knowledge,
};
use crate::state::AppState;

const HARNESS_HEADER: &str = "x-mymy-release-harness";
const PAGINATION_DECISION_COUNT: usize = 23;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/release-harness/fixtures", post(create_fixtures))
        .route(
            "/api/release-harness/fixtures/artifact-link",
            post(link_artifact_fixture),
        )
        .route(
            "/api/release-harness/fixtures/cleanup",
            post(cleanup_fixtures),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureRequest {
    seed: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureResponse {
    fixture_revision: &'static str,
    seed: String,
    agent_profile: String,
    artifact: ArtifactFixture,
    decisions: DecisionFixture,
    quarantine: QuarantineFixture,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactFixture {
    creator_session_id: String,
    secondary_session_id: String,
    creator_run_id: String,
    artifact_id: String,
    resource_id: String,
    path: String,
    fingerprint: String,
    wiki_id: String,
    wiki_title: String,
    wiki_link_title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArtifactLinkRequest {
    seed: String,
    agent_profile: String,
    session_id: Uuid,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactLinkResponse {
    session_id: String,
    run_id: String,
    fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupResponse {
    sessions_remaining: i64,
    decisions_remaining: i64,
    quarantine_pending: i64,
    release_files_remaining: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DecisionFixture {
    choice_id: String,
    input_id: String,
    pagination_ids: Vec<String>,
    total_pending: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuarantineFixture {
    session_id: String,
    run_id: String,
    item_id: String,
    file_name: String,
    desired_path: String,
    tool_error_code: String,
}

async fn create_fixtures(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<FixtureRequest>,
) -> AppResult<Json<FixtureResponse>> {
    authorize(&headers)?;
    let seed = validate_seed(&request.seed)?;
    let profile = format!("release-{seed}");
    let created = agents::create_agent(
        &state,
        CreateAgentRequest {
            profile: Some(profile.clone()),
            name: format!("Release {seed}"),
            role: Some("Release certification agent".to_string()),
            description: Some("Deterministic local release fixture".to_string()),
        },
    )
    .await?;
    let profile = created.agent.profile;

    let artifact = create_artifact_fixture(&state, &profile, &seed).await?;
    let decisions = create_decision_fixture(&state, &profile, &seed).await?;
    let quarantine = create_quarantine_fixture(&state, &profile, &seed).await?;

    Ok(Json(FixtureResponse {
        fixture_revision: "july11-stateful-browser-v1",
        seed,
        agent_profile: profile,
        artifact,
        decisions,
        quarantine,
    }))
}

async fn create_artifact_fixture(
    state: &Arc<AppState>,
    profile: &str,
    seed: &str,
) -> AppResult<ArtifactFixture> {
    let creator_session = create_session(state, profile).await?;
    let creator = create_claimed_run(state, creator_session, seed, "artifact-create").await?;
    let path = format!("/drive/shared/release-{seed}-artifact.md");
    let creator_registry = registry(state, profile, creator_session).await?;
    let created = require_tool_success(
        &creator_registry
            .execute_with_context(
                &creator.for_invocation("write-artifact"),
                "write_file",
                &serde_json::json!({
                    "path": path,
                    "content": format!("release fixture {seed}\nversion A\n"),
                    "artifactTitle": format!("Release artifact {seed}"),
                    "artifactType": "report"
                })
                .to_string(),
            )
            .await,
    )?;
    let fingerprint = created
        .pointer("/data/fingerprint")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Internal("release artifact fingerprint is missing".to_string()))?
        .to_string();
    agent_runs::complete_release_fixture_run(state, &creator).await?;

    let first_page = artifacts::list_session_artifacts(
        state,
        creator_session,
        SessionArtifactsQuery {
            cursor: None,
            limit: 50,
        },
    )
    .await?;
    let projected = first_page
        .artifacts
        .into_iter()
        .find(|artifact| artifact.current_path.as_deref() == Some(path.as_str()))
        .ok_or_else(|| AppError::Internal("release artifact was not projected".to_string()))?;

    let secondary_session = create_session(state, profile).await?;

    let wiki_title = format!("Release Wiki {seed}");
    let wiki = knowledge::create(
        state,
        CreateKnowledgeArticleRequest {
            parent_id: None,
            project_id: None,
            node_type: Some("article".to_string()),
            title: wiki_title.clone(),
            slug: None,
            content: Some("Release artifact provenance".to_string()),
            excerpt: None,
            tags: vec!["release".to_string()],
            status: Some("published".to_string()),
            sort_order: None,
        },
    )
    .await?;
    let wiki_id = Uuid::parse_str(&wiki.article.id)
        .map_err(|error| AppError::Internal(format!("release Wiki id is invalid: {error}")))?;
    let wiki_link_title = format!("Artifact {seed}");
    knowledge::attach_resource(
        state,
        wiki_id,
        AttachKnowledgeResourceRequest {
            resource_ref: path.clone(),
            title: Some(wiki_link_title.clone()),
            sort_order: 0,
        },
    )
    .await?;

    Ok(ArtifactFixture {
        creator_session_id: creator_session.to_string(),
        secondary_session_id: secondary_session.to_string(),
        creator_run_id: creator.run_id.to_string(),
        artifact_id: projected.id,
        resource_id: projected.resource_id,
        path,
        fingerprint,
        wiki_id: wiki_id.to_string(),
        wiki_title,
        wiki_link_title,
    })
}

async fn link_artifact_fixture(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ArtifactLinkRequest>,
) -> AppResult<Json<ArtifactLinkResponse>> {
    authorize(&headers)?;
    let seed = validate_seed(&request.seed)?;
    if request.agent_profile != format!("release-{seed}") {
        return Err(AppError::BadRequest(
            "artifact link profile does not match the fixture seed".to_string(),
        ));
    }
    let session_profile = sqlx::query_scalar::<_, String>(
        "SELECT profile FROM chat_sessions WHERE id = $1 AND deleting_at IS NULL",
    )
    .bind(request.session_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("release secondary session is missing".to_string()))?;
    if session_profile != request.agent_profile {
        return Err(AppError::BadRequest(
            "artifact link session belongs to a different agent".to_string(),
        ));
    }
    let run =
        create_claimed_run(&state, request.session_id, &seed, "artifact-secondary-link").await?;
    let registry = registry(&state, &request.agent_profile, request.session_id).await?;
    let observed = require_tool_success(
        &registry
            .execute_with_context(
                &run.for_invocation("read-artifact"),
                "read_file",
                &serde_json::json!({ "path": request.path }).to_string(),
            )
            .await,
    )?;
    let fingerprint = observed
        .pointer("/data/fingerprint")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Internal("release artifact fingerprint is missing".to_string()))?;
    let patched = require_tool_success(
        &registry
            .execute_with_context(
                &run.for_invocation("patch-artifact"),
                "patch_file",
                &serde_json::json!({
                    "path": request.path,
                    "old_string": "version A",
                    "new_string": "version A prime",
                    "expectedFingerprint": fingerprint
                })
                .to_string(),
            )
            .await,
    )?;
    let fingerprint = patched
        .pointer("/data/fingerprint")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Internal("patched artifact fingerprint is missing".to_string()))?
        .to_string();
    agent_runs::complete_release_fixture_run(&state, &run).await?;
    Ok(Json(ArtifactLinkResponse {
        session_id: request.session_id.to_string(),
        run_id: run.run_id.to_string(),
        fingerprint,
    }))
}

async fn cleanup_fixtures(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<FixtureRequest>,
) -> AppResult<Json<CleanupResponse>> {
    authorize(&headers)?;
    let seed = validate_seed(&request.seed)?;
    let profile = format!("release-{seed}");
    purge_release_trash(&state, &seed).await?;
    for (index, path) in release_active_file_paths(&state.config.agent_data_dir, &seed)?
        .into_iter()
        .enumerate()
    {
        crate::services::drive::delete_path(
            &state,
            &path,
            Some(&format!("release-{seed}-cleanup-trash-{index}")),
            None,
        )
        .await?;
    }
    purge_release_trash(&state, &seed).await?;

    let pending = crate::services::content_quarantine::list(
        &state,
        QuarantineListQuery {
            status: "pending".to_string(),
            cursor: None,
        },
    )
    .await?;
    for item in pending.items.into_iter().filter(|item| {
        item.desired_path
            .contains(&format!("release-{seed}-agent.exe"))
    }) {
        crate::services::content_quarantine::delete(
            &state,
            Uuid::parse_str(&item.id).map_err(|error| {
                AppError::Internal(format!("release quarantine id is invalid: {error}"))
            })?,
            crate::models::content_security::DeleteQuarantineRequest {
                expected_version: item.version,
            },
        )
        .await?;
    }

    let wiki_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM knowledge_articles WHERE title = $1 ORDER BY id",
    )
    .bind(format!("Release Wiki {seed}"))
    .fetch_all(&state.db)
    .await?;
    for wiki_id in wiki_ids {
        knowledge::delete(&state, wiki_id).await?;
    }

    let pending_decision_ids = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT d.id FROM decisions d
           INNER JOIN agent_runs r ON r.id = d.run_id
           WHERE r.agent_profile = $1 AND d.status = 'pending'
           ORDER BY d.created_at, d.id"#,
    )
    .bind(&profile)
    .fetch_all(&state.db)
    .await?;
    for decision_id in pending_decision_ids {
        decisions::dismiss_decision(&state, decision_id, "release-harness-cleanup").await?;
    }
    agent_runs::drain_release_fixture_runs(&state, &profile).await?;

    let session_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM chat_sessions WHERE profile = $1 ORDER BY created_at DESC",
    )
    .bind(&profile)
    .fetch_all(&state.db)
    .await?;
    for session_id in session_ids {
        chat::delete_session(&state, session_id).await?;
    }
    for _ in 0..10 {
        if chat::reconcile_session_deletions(&state, 1_000).await? == 0 {
            break;
        }
    }
    if agents::first_agent_profile(&state).await?.as_deref() == Some(profile.as_str())
        || sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM native_agents WHERE profile = $1)",
        )
        .bind(&profile)
        .fetch_one(&state.db)
        .await?
    {
        agents::delete_agent(&state, &profile).await?;
    }

    let sessions_remaining =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM chat_sessions WHERE profile = $1")
            .bind(&profile)
            .fetch_one(&state.db)
            .await?;
    let decisions_remaining = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM decisions d
           INNER JOIN agent_runs r ON r.id = d.run_id
           WHERE r.agent_profile = $1"#,
    )
    .bind(&profile)
    .fetch_one(&state.db)
    .await?;
    let quarantine_pending = crate::services::content_quarantine::pending_count(&state).await?;
    let release_files_remaining = release_files(&state.config.agent_data_dir, &seed)?;
    if sessions_remaining != 0
        || decisions_remaining != 0
        || quarantine_pending != 0
        || release_files_remaining != 0
    {
        return Err(AppError::Conflict(
            "release fixture cleanup did not reach zero residual state".to_string(),
        ));
    }
    Ok(Json(CleanupResponse {
        sessions_remaining,
        decisions_remaining,
        quarantine_pending,
        release_files_remaining,
    }))
}

fn release_files(agent_data_dir: &std::path::Path, seed: &str) -> AppResult<usize> {
    let drive = agent_data_dir.join("drive");
    if !drive.exists() {
        return Ok(0);
    }
    let marker = format!("release-{seed}");
    let mut pending = vec![drive];
    let mut count = 0;
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if entry.file_name().to_string_lossy().contains(&marker) {
                count += 1;
            }
        }
    }
    Ok(count)
}

async fn purge_release_trash(state: &AppState, seed: &str) -> AppResult<()> {
    let marker = format!("release-{seed}");
    let entries = crate::services::drive::list_trash(state)
        .await?
        .entries
        .into_iter()
        .filter(|entry| entry.original_path.contains(&marker))
        .collect::<Vec<_>>();
    for entry in entries {
        crate::services::drive::purge_trash(
            state,
            Uuid::parse_str(&entry.id).map_err(|error| {
                AppError::Internal(format!("release trash id is invalid: {error}"))
            })?,
            Some(&format!("release-{seed}-cleanup-purge-{}", entry.id)),
            entry.lifecycle_revision.as_deref(),
        )
        .await?;
    }
    Ok(())
}

fn release_active_file_paths(
    agent_data_dir: &std::path::Path,
    seed: &str,
) -> AppResult<Vec<String>> {
    let drive = agent_data_dir.join("drive");
    if !drive.exists() {
        return Ok(Vec::new());
    }
    let marker = format!("release-{seed}");
    let mut pending = vec![drive.clone()];
    let mut paths = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            if path == drive.join(".trash") {
                continue;
            }
            if path.is_dir() {
                pending.push(path);
            } else if entry.file_name().to_string_lossy().contains(&marker) {
                let relative = path.strip_prefix(&drive).map_err(|error| {
                    AppError::Internal(format!("release file escaped Drive root: {error}"))
                })?;
                paths.push(format!("/drive/{}", relative.to_string_lossy()));
            }
        }
    }
    Ok(paths)
}

async fn create_decision_fixture(
    state: &Arc<AppState>,
    profile: &str,
    seed: &str,
) -> AppResult<DecisionFixture> {
    let choice = create_choice_decision(
        state,
        profile,
        seed,
        "choice",
        format!("Choose release channel {seed}"),
        vec!["stable".to_string(), "canary".to_string()],
    )
    .await?;
    let input = create_choice_decision(
        state,
        profile,
        seed,
        "input",
        format!("Provide release note {seed}"),
        Vec::new(),
    )
    .await?;

    let mut pagination_ids = Vec::with_capacity(PAGINATION_DECISION_COUNT);
    for index in 0..PAGINATION_DECISION_COUNT {
        let decision = create_choice_decision(
            state,
            profile,
            seed,
            &format!("page-{index}"),
            format!("Pagination decision {index:02} for {seed}"),
            vec!["continue".to_string(), "stop".to_string()],
        )
        .await?;
        pagination_ids.push(decision.id.to_string());
    }

    Ok(DecisionFixture {
        choice_id: choice.id.to_string(),
        input_id: input.id.to_string(),
        total_pending: PAGINATION_DECISION_COUNT + 2,
        pagination_ids,
    })
}

async fn create_choice_decision(
    state: &Arc<AppState>,
    profile: &str,
    seed: &str,
    suffix: &str,
    question: String,
    choices: Vec<String>,
) -> AppResult<crate::agent::execution::DurableDecision> {
    let session = create_session(state, profile).await?;
    let run = create_claimed_run(state, session, seed, suffix).await?;
    let coordinator = run
        .decisions
        .as_ref()
        .ok_or_else(|| AppError::Internal("release Decision coordinator is missing".to_string()))?;
    let decision = coordinator
        .create_choice(&run, &question, &choices, true, &[])
        .await
        .map_err(AppError::Conflict)?;
    agent_runs::pause_release_fixture_run(state, &run, decision.id).await?;
    Ok(decision)
}

async fn create_quarantine_fixture(
    state: &Arc<AppState>,
    profile: &str,
    seed: &str,
) -> AppResult<QuarantineFixture> {
    let session = create_session(state, profile).await?;
    let run = create_claimed_run(state, session, seed, "quarantine").await?;
    let registry = registry(state, profile, session).await?;
    let file_name = format!("release-{seed}-agent.exe");
    let desired_path = format!("/drive/shared/{file_name}");
    let quarantine_id = match state
        .workspace_content
        .admit_bytes(
            state,
            AdmissionRequest {
                desired_path: desired_path.clone(),
                file_name: file_name.clone(),
                origin: ContentOrigin::UserUpload,
                actor: AdmissionActor::user(),
                expected_fingerprint: None,
                allow_overwrite: false,
                enqueue_s3_sync: false,
                operation_key: Some(format!("release-{seed}-quarantine-upload")),
                artifact: None,
            },
            b"MZ\x90\0 deterministic release executable",
        )
        .await?
    {
        AdmissionOutcome::Quarantined { id } => id,
        AdmissionOutcome::Committed { .. } | AdmissionOutcome::Rejected => {
            return Err(AppError::Internal(
                "external release fixture was not quarantined".to_string(),
            ));
        }
    };
    let output = registry
        .execute_with_context(
            &run.for_invocation("quarantine-read"),
            "read_file",
            &serde_json::json!({ "path": desired_path }).to_string(),
        )
        .await;
    let envelope: Value = serde_json::from_str(&output)
        .map_err(|error| AppError::Internal(format!("tool envelope decode failed: {error}")))?;
    if envelope.get("ok").and_then(Value::as_bool) != Some(false) {
        return Err(AppError::Internal(
            "agent file tool unexpectedly read quarantined bytes".to_string(),
        ));
    }
    let tool_error_code = envelope
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    agent_runs::complete_release_fixture_run(state, &run).await?;
    let pending = crate::services::content_quarantine::list(
        state,
        QuarantineListQuery {
            status: "pending".to_string(),
            cursor: None,
        },
    )
    .await?;
    let item = pending
        .items
        .into_iter()
        .find(|item| item.id == quarantine_id.to_string())
        .ok_or_else(|| AppError::Internal("agent quarantine item is missing".to_string()))?;
    Ok(QuarantineFixture {
        session_id: session.to_string(),
        run_id: run.run_id.to_string(),
        item_id: item.id,
        file_name,
        desired_path,
        tool_error_code,
    })
}

async fn create_session(state: &AppState, profile: &str) -> AppResult<Uuid> {
    let response = chat::create_session(
        state,
        CreateSessionRequest {
            project_id: None,
            profile: Some(profile.to_string()),
        },
    )
    .await?;
    Uuid::parse_str(&response.session.id)
        .map_err(|error| AppError::Internal(format!("release session id is invalid: {error}")))
}

async fn create_claimed_run(
    state: &AppState,
    session_id: Uuid,
    seed: &str,
    suffix: &str,
) -> AppResult<ToolExecutionContext> {
    let response = agent_runs::enqueue_chat_run(
        state,
        session_id,
        EnqueueChatRunRequest {
            client_request_id: format!("release-{seed}-{suffix}"),
            text: format!("Deterministic release fixture {suffix}"),
            use_moa: false,
            moa_preset_id: None,
        },
    )
    .await?;
    let run = response
        .run
        .ok_or_else(|| AppError::Internal("release run was not admitted".to_string()))?;
    let run_id = Uuid::parse_str(&run.id)
        .map_err(|error| AppError::Internal(format!("release run id is invalid: {error}")))?;
    agent_runs::claim_release_fixture_run(state, run_id).await
}

async fn registry(
    state: &Arc<AppState>,
    profile: &str,
    session_id: Uuid,
) -> AppResult<ToolRegistry> {
    let policy = agent_permissions::load_policy(state, profile).await?;
    let agent_data_dir = state.config.agent_data_dir.clone();
    let config = BuiltinToolConfig::for_session(BuiltinSessionConfig {
        working_dir: agent_data_dir.join("drive/agents").join(profile),
        allowed_roots: vec![agent_data_dir.join("drive/shared")],
        agent_data_dir,
        session_id,
        agent_profile: profile.to_string(),
        project_id: None,
        sandbox_runner_url: state.config.sandbox_runner_url.clone(),
        sandbox_preview_host: state.config.sandbox_preview_host.clone(),
        db: state.db.clone(),
        extension_settings_key: None,
        app_state: state.clone(),
        permission_policy: policy.clone(),
    });
    let mut registry = ToolRegistry::new();
    builtin::register_all(&mut registry, &config);
    builtin::register_agent_toolsets(&mut registry, &policy);
    registry
        .validate_catalog()
        .map_err(|error| AppError::Internal(format!("release tool catalog invalid: {error}")))?;
    Ok(registry)
}

fn require_tool_success(output: &str) -> AppResult<Value> {
    let value: Value = serde_json::from_str(output)
        .map_err(|error| AppError::Internal(format!("tool result decode failed: {error}")))?;
    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(AppError::Conflict(
            value
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("release_tool_failed")
                .to_string(),
        ));
    }
    Ok(value)
}

fn authorize(headers: &HeaderMap) -> AppResult<()> {
    let expected = std::env::var("MYMY_RELEASE_HARNESS_TOKEN").map_err(|_| {
        AppError::NotFound("release harness is not enabled for this process".to_string())
    })?;
    let supplied = headers
        .get(HARNESS_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let expected = Sha256::digest(expected.as_bytes());
    let supplied = Sha256::digest(supplied.as_bytes());
    let mismatch = expected
        .iter()
        .zip(supplied.iter())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        });
    if mismatch != 0 {
        return Err(AppError::Unauthorized(
            "release harness token is invalid".to_string(),
        ));
    }
    Ok(())
}

fn validate_seed(seed: &str) -> AppResult<String> {
    let seed = seed.trim().to_ascii_lowercase();
    if seed.is_empty()
        || seed.len() > 40
        || !seed
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(AppError::BadRequest(
            "release fixture seed must be a 1-40 character ASCII token".to_string(),
        ));
    }
    Ok(seed)
}
