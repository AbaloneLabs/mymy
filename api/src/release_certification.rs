//! Executed local release certification against isolated PostgreSQL state.
//!
//! These tests are ignored in the ordinary unit lane because they are bounded
//! performance/endurance gates, not correctness shortcuts. They compose the
//! same service boundaries and durable workers used by the server, print their
//! deterministic seed and fixture revision, and emit machine-readable evidence
//! when `MYMY_RELEASE_EVIDENCE_DIR` is set.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result};
use futures::future::try_join_all;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::config::Config;
use crate::error::AppError;
use crate::models::agent::CreateAgentRequest;
use crate::models::agent_run::EnqueueChatRunRequest;
use crate::models::chat::CreateSessionRequest;
use crate::models::content_security::{ContentOrigin, DeleteQuarantineRequest};
use crate::models::document_editor::{
    WriteDocumentEditorModelRequest, DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION,
};
use crate::models::runtime_memory::UpdateMemoryRuntimeSettings;
use crate::models::search::{WorkspaceSearchDomain, WorkspaceSearchRequest, WorkspaceSearchScope};
use crate::services::resource_identity::{
    ArtifactClassification, PrepareContentOperation, ResourceActor,
};
use crate::services::workspace_content::{AdmissionActor, AdmissionOutcome, AdmissionRequest};
use crate::services::{
    agent_runs, agents, chat, content_quarantine, document_editor, drive, resource_identity,
    runtime_memory, search,
};
use crate::state::AppState;

const OVERLAP_TEST_ID: &str = "LOC-02-integrated-overlap";
const LONG_TEST_ID: &str = "LOC-05-long-reconciliation";
const LONG_CHILD_ENV: &str = "MYMY_LONG_CERT_CHILD";
const LONG_DATABASE_ENV: &str = "MYMY_LONG_CERT_DATABASE";
const LONG_ROOT_ENV: &str = "MYMY_LONG_CERT_ROOT";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseThresholds {
    fixture_revision: String,
    iterations: usize,
    tail_observation_ms: u64,
    maximum_p95_ms: BTreeMap<String, u64>,
    maximum_queue_age_ms: u64,
    maximum_rss_growth_bytes: u64,
    maximum_fd_growth: u64,
    maximum_database_connections: i64,
}

#[derive(Debug, Default)]
struct RuntimeSamples {
    elapsed_ms: BTreeMap<String, Vec<u64>>,
    maximum_queue_age_ms: u64,
    maximum_rss_bytes: u64,
    maximum_file_descriptors: u64,
    maximum_database_connections: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LatencySummary {
    samples: usize,
    p50_ms: u64,
    p95_ms: u64,
    maximum_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlapEvidence {
    test_id: &'static str,
    state: &'static str,
    fixture_revision: String,
    seed: String,
    candidate_commit: String,
    thresholds: ReleaseThresholds,
    latencies: BTreeMap<String, LatencySummary>,
    maximum_queue_age_ms: u64,
    rss_baseline_bytes: u64,
    maximum_rss_bytes: u64,
    file_descriptors_baseline: u64,
    maximum_file_descriptors: u64,
    maximum_database_connections: i64,
    watermarks: BTreeMap<String, i64>,
    exact_counts: BTreeMap<String, i64>,
    delayed_tail_work: BTreeMap<String, i64>,
    cleanup: BTreeMap<String, i64>,
}

struct IterationOutput {
    session_id: Uuid,
    artifact_path: String,
    editor_path: String,
    quarantine_id: Uuid,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LongReleaseThresholds {
    fixture_revision: String,
    minimum_duration_seconds: u64,
    cycle_interval_ms: u64,
    minimum_cycles: usize,
    minimum_process_restarts: usize,
    drive_file_slots: usize,
    trash_retention_cycles: usize,
    tail_observation_ms: u64,
    maximum_workspace_snapshots: i64,
    maximum_drive_search_document_growth: i64,
    maximum_live_trash_entries: i64,
    maximum_document_snapshots: i64,
    maximum_temporary_files: i64,
    maximum_table_growth_bytes: i64,
    maximum_index_growth_bytes: i64,
    maximum_row_growth_per_cycle: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelationSizes {
    table_bytes: i64,
    index_bytes: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LongReleaseEvidence {
    test_id: &'static str,
    state: &'static str,
    fixture_revision: String,
    seed: String,
    candidate_commit: String,
    thresholds: LongReleaseThresholds,
    observed_duration_seconds: u64,
    cycles: usize,
    process_restarts: usize,
    distinct_processes: usize,
    cursor_expiry_rejections: usize,
    trash_retention_checks: usize,
    row_baseline: BTreeMap<String, i64>,
    row_maximum: BTreeMap<String, i64>,
    row_final: BTreeMap<String, i64>,
    relation_size_baseline: RelationSizes,
    relation_size_maximum: RelationSizes,
    settled_watermarks: BTreeMap<String, i64>,
    delayed_tail_work: BTreeMap<String, i64>,
    cleanup: BTreeMap<String, i64>,
    isolated_database_teardown: &'static str,
}

#[derive(Debug)]
struct RetainedTrash {
    id: Uuid,
    created_cycle: usize,
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "local release gate: runs bounded overlapping production workloads"]
async fn integrated_overlap_reaches_every_durable_watermark(pool: PgPool) {
    run_integrated_overlap(pool)
        .await
        .expect("integrated overlap certification must pass");
}

#[test]
fn long_release_thresholds_require_hours_scale_and_restarts() {
    let thresholds = long_release_thresholds().expect("long release thresholds must parse");
    validate_long_threshold_contract(&thresholds)
        .expect("long release thresholds must preserve the certification scope");
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "local release gate: runs two hours with repeated worker process restarts"]
async fn long_running_reconciliation_stays_bounded_and_cleans_up(pool: PgPool) {
    run_long_release_certification(pool)
        .await
        .expect("long reconciliation certification must pass");
}

/// A plain ignored test is used as the restart worker so the parent
/// certification can launch a genuinely separate OS process against its
/// already-migrated isolated database. Keeping the child entry point inside
/// the test binary means it composes production services without adding a
/// diagnostic mode or environment-triggered branch to the shipped API.
#[tokio::test]
#[ignore = "invoked only by the LOC-05 parent certification"]
async fn long_release_reconciliation_worker_child() {
    run_long_release_worker_child()
        .await
        .expect("long release child worker must settle its durable queues");
}

fn long_release_thresholds() -> Result<LongReleaseThresholds> {
    Ok(serde_json::from_str(include_str!(
        "../tests/fixtures/local_long_release_thresholds.json"
    ))?)
}

fn validate_long_threshold_contract(thresholds: &LongReleaseThresholds) -> Result<()> {
    anyhow::ensure!(
        thresholds.minimum_duration_seconds >= 7_200,
        "long release certification must run for at least two wall-clock hours"
    );
    anyhow::ensure!(
        thresholds.minimum_cycles >= 120 && thresholds.minimum_process_restarts >= 120,
        "long release certification must cross at least 120 restart boundaries"
    );
    anyhow::ensure!(
        thresholds.cycle_interval_ms > 0
            && (thresholds.minimum_cycles as u64).saturating_mul(thresholds.cycle_interval_ms)
                >= thresholds.minimum_duration_seconds.saturating_mul(1_000),
        "cycle cadence does not span the committed duration"
    );
    anyhow::ensure!(
        thresholds.drive_file_slots >= 2 && thresholds.trash_retention_cycles >= 2,
        "long release fixture requires multiple index slots and retention boundaries"
    );
    let expected_growth_keys = [
        "documentEditorSaveReceipts",
        "driveResources",
        "driveTrashEntries",
        "memoryExtractionBatches",
        "resourceOperations",
        "resourceOutbox",
        "resourceOutboxDeliveries",
        "resourceRevisions",
    ];
    anyhow::ensure!(
        thresholds
            .maximum_row_growth_per_cycle
            .keys()
            .map(String::as_str)
            .eq(expected_growth_keys),
        "long release row-growth budgets must cover the exact durable tables"
    );
    anyhow::ensure!(
        thresholds
            .maximum_row_growth_per_cycle
            .values()
            .all(|value| *value > 0),
        "long release row-growth budgets must be positive"
    );
    Ok(())
}

async fn run_long_release_worker_child() -> Result<()> {
    anyhow::ensure!(
        std::env::var(LONG_CHILD_ENV).as_deref() == Ok("1"),
        "long release child cannot be invoked without its parent boundary"
    );
    let base_url = std::env::var("DATABASE_URL").context("DATABASE_URL is unavailable")?;
    let database_name =
        std::env::var(LONG_DATABASE_ENV).context("long release database is unavailable")?;
    let root = PathBuf::from(
        std::env::var_os(LONG_ROOT_ENV).context("long release Drive root is unavailable")?,
    );
    let options = PgConnectOptions::from_str(&base_url)?.database(&database_name);
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;
    let state = AppState::new(pool.clone(), test_config(root));

    // This ordering matches API startup: reconcile a filesystem commit before
    // projecting consumers, then let every durable downstream worker observe
    // the resulting outbox and memory inputs in the new process.
    resource_identity::reconcile_pending_operations(&state, 10_000).await?;
    resource_identity::reconcile_existing_drive(&state, 10_000).await?;
    resource_identity::reconcile_existing_trash(&state, 10_000).await?;
    settle_workers(&state, 10_000).await?;
    pool.close().await;
    Ok(())
}

async fn run_long_release_certification(pool: PgPool) -> Result<()> {
    let thresholds = long_release_thresholds()?;
    validate_long_threshold_contract(&thresholds)?;
    let seed = std::env::var("MYMY_RELEASE_SEED")
        .unwrap_or_else(|_| "local-long-reconciliation-001".to_string());
    validate_seed(&seed)?;
    let profile = format!("long-{seed}");
    let principal = format!("long-release-{seed}");
    let root = std::env::temp_dir().join(format!("mymy-{profile}-{}", Uuid::new_v4()));
    let database_name: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&pool)
        .await?;
    let initial_state = AppState::new(pool.clone(), test_config(root.clone()));
    *initial_state.encryption_key.write().await = Some([11_u8; 32]);

    agents::create_agent(
        &initial_state,
        CreateAgentRequest {
            profile: Some(profile.clone()),
            name: format!("Long release {seed}"),
            role: Some("Local release certification".to_string()),
            description: Some("Long-running reconciliation workload".to_string()),
        },
    )
    .await?;
    let settings = runtime_memory::get_runtime_settings(&initial_state, &profile).await?;
    runtime_memory::update_runtime_settings(
        &initial_state,
        &profile,
        UpdateMemoryRuntimeSettings {
            automatic_recall_enabled: false,
            inferred_extraction_enabled: true,
            semantic_indexing_enabled: false,
            expected_settings_revision: settings.settings_revision,
        },
    )
    .await?;
    let session = chat::create_session(
        &initial_state,
        CreateSessionRequest {
            project_id: None,
            profile: Some(profile.clone()),
        },
    )
    .await?;
    let session_id = Uuid::parse_str(&session.session.id)?;
    let editor_path = format!("/drive/shared/release-{seed}-long-editor.md");
    let search_term = format!("long-release-{seed}");
    create_long_base_files(
        &initial_state,
        &seed,
        &editor_path,
        &search_term,
        thresholds.drive_file_slots,
    )
    .await?;
    // Establish the same startup-discovery baseline as the child processes.
    // Agent workspace metadata is created outside the content journal by
    // design; counting its one-time discovery as per-cycle churn would hide a
    // real slope behind an initialization artifact.
    resource_identity::reconcile_existing_drive(&initial_state, 10_000).await?;
    resource_identity::reconcile_existing_trash(&initial_state, 10_000).await?;
    settle_workers(&initial_state, 10_000).await?;

    let row_baseline = long_row_counts(&initial_state).await?;
    let mut row_maximum = row_baseline.clone();
    let relation_size_baseline = long_relation_sizes(&initial_state).await?;
    let mut relation_size_maximum = relation_size_baseline.clone();
    let mut retained_trash = VecDeque::new();
    let mut process_ids = std::collections::BTreeSet::new();
    let mut process_restarts = 0_usize;
    let mut cursor_expiry_rejections = 0_usize;
    let mut trash_retention_checks = 0_usize;
    let started = Instant::now();
    let minimum_duration = Duration::from_secs(thresholds.minimum_duration_seconds);
    let cycle_interval = Duration::from_millis(thresholds.cycle_interval_ms);
    let mut cycles = 0_usize;

    while started.elapsed() < minimum_duration || cycles < thresholds.minimum_cycles {
        let cycle_started = Instant::now();
        let state = AppState::new(pool.clone(), test_config(root.clone()));
        *state.encryption_key.write().await = Some([11_u8; 32]);
        prepare_long_cycle(
            &state,
            &profile,
            &seed,
            &search_term,
            session_id,
            &editor_path,
            cycles,
            thresholds.drive_file_slots,
            thresholds.trash_retention_cycles,
            &mut retained_trash,
            &mut trash_retention_checks,
        )
        .await?;
        drop(state);

        let process_id = spawn_long_release_worker(&database_name, &root).await?;
        process_ids.insert(process_id);
        process_restarts += 1;

        let state = AppState::new(pool.clone(), test_config(root.clone()));
        cursor_expiry_rejections +=
            certify_expired_workspace_cursor(&state, &principal, &search_term).await?;
        let counts = long_row_counts(&state).await?;
        update_row_maximum(&mut row_maximum, &counts);
        let sizes = long_relation_sizes(&state).await?;
        relation_size_maximum.table_bytes =
            relation_size_maximum.table_bytes.max(sizes.table_bytes);
        relation_size_maximum.index_bytes =
            relation_size_maximum.index_bytes.max(sizes.index_bytes);
        validate_long_cycle_bounds(
            &state,
            &thresholds,
            &row_baseline,
            &counts,
            &relation_size_baseline,
            &sizes,
            cycles + 1,
            &profile,
            &principal,
            &editor_path,
        )
        .await?;
        cycles += 1;
        if cycles.is_multiple_of(10) {
            eprintln!(
                "release-certification test={} cycles={} restarts={} elapsed_seconds={}",
                LONG_TEST_ID,
                cycles,
                process_restarts,
                started.elapsed().as_secs()
            );
        }
        let remaining = cycle_interval.saturating_sub(cycle_started.elapsed());
        if !remaining.is_zero() {
            tokio::time::sleep(remaining).await;
        }
    }

    anyhow::ensure!(
        started.elapsed() >= minimum_duration,
        "long release run ended before its wall-clock duration"
    );
    anyhow::ensure!(
        process_restarts >= thresholds.minimum_process_restarts,
        "long release run did not cross enough process restarts"
    );
    anyhow::ensure!(
        process_ids.len() == process_restarts,
        "worker process identity was reused during restart certification"
    );

    tokio::time::sleep(Duration::from_millis(thresholds.tail_observation_ms)).await;
    let tail_process_id = spawn_long_release_worker(&database_name, &root).await?;
    process_ids.insert(tail_process_id);
    process_restarts += 1;
    let final_state = AppState::new(pool.clone(), test_config(root.clone()));
    let delayed_tail_work = pending_work(&final_state).await?;
    anyhow::ensure!(
        delayed_tail_work.values().all(|count| *count == 0),
        "long release delayed tail produced work: {delayed_tail_work:?}"
    );
    let row_final = long_row_counts(&final_state).await?;
    let settled_watermarks = long_settled_watermarks(&final_state, &profile).await?;
    anyhow::ensure!(
        settled_watermarks.values().all(|value| *value > 0),
        "long release watermark was not reached: {settled_watermarks:?}"
    );

    cleanup_long_release(
        &final_state,
        &profile,
        &seed,
        &principal,
        session_id,
        &editor_path,
        thresholds.drive_file_slots,
        &mut retained_trash,
    )
    .await?;
    settle_workers(&final_state, 10_000).await?;
    let mut cleanup = long_cleanup_counts(&final_state, &profile, &seed, &principal).await?;
    anyhow::ensure!(
        cleanup.values().all(|count| *count == 0),
        "long release cleanup left residual state: {cleanup:?}"
    );
    if root.exists() {
        std::fs::remove_dir_all(&root)?;
    }
    cleanup.insert("temporaryRootExists".to_string(), i64::from(root.exists()));
    anyhow::ensure!(
        cleanup.values().all(|count| *count == 0),
        "long release temporary root survived cleanup: {cleanup:?}"
    );

    let evidence = LongReleaseEvidence {
        test_id: LONG_TEST_ID,
        state: "passed",
        fixture_revision: thresholds.fixture_revision.clone(),
        seed: seed.clone(),
        candidate_commit: std::env::var("CI_COMMIT_SHA")
            .unwrap_or_else(|_| "working-tree".to_string()),
        thresholds,
        observed_duration_seconds: started.elapsed().as_secs(),
        cycles,
        process_restarts,
        distinct_processes: process_ids.len(),
        cursor_expiry_rejections,
        trash_retention_checks,
        row_baseline,
        row_maximum,
        row_final,
        relation_size_baseline,
        relation_size_maximum,
        settled_watermarks,
        delayed_tail_work,
        cleanup,
        isolated_database_teardown: "sqlx-test-database-drop-after-success",
    };
    emit_evidence("loc05-long-reconciliation.json", &evidence)?;
    eprintln!(
        "release-certification test={} seed={} revision={} duration_seconds={} cycles={} restarts={} result=passed",
        LONG_TEST_ID,
        seed,
        evidence.fixture_revision,
        evidence.observed_duration_seconds,
        cycles,
        process_restarts
    );
    Ok(())
}

async fn create_long_base_files(
    state: &AppState,
    seed: &str,
    editor_path: &str,
    search_term: &str,
    drive_file_slots: usize,
) -> Result<()> {
    let mut paths = vec![(
        editor_path.to_string(),
        format!("{search_term} editor baseline\n"),
    )];
    paths.extend((0..drive_file_slots).map(|slot| {
        (
            long_slot_path(seed, slot),
            format!("{search_term} slot {slot:03} baseline\n"),
        )
    }));
    for (index, (path, content)) in paths.into_iter().enumerate() {
        let file_name = Path::new(&path)
            .file_name()
            .and_then(|value| value.to_str())
            .context("long release file name is invalid")?
            .to_string();
        expect_committed(
            state
                .workspace_content
                .admit_bytes(
                    state,
                    AdmissionRequest {
                        desired_path: path,
                        file_name,
                        origin: ContentOrigin::UserEdit,
                        actor: AdmissionActor::user(),
                        expected_fingerprint: None,
                        allow_overwrite: false,
                        enqueue_s3_sync: false,
                        operation_key: Some(format!("release-{seed}-long-base-{index:03}")),
                        artifact: None,
                    },
                    content.as_bytes(),
                )
                .await?,
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn prepare_long_cycle(
    state: &AppState,
    profile: &str,
    seed: &str,
    search_term: &str,
    session_id: Uuid,
    editor_path: &str,
    cycle: usize,
    drive_file_slots: usize,
    trash_retention_cycles: usize,
    retained_trash: &mut VecDeque<RetainedTrash>,
    trash_retention_checks: &mut usize,
) -> Result<()> {
    let message = format!(
        "Please remember my preferred long release lane is {search_term}-{cycle:04} for certification"
    );
    let admitted = agent_runs::enqueue_chat_run(
        state,
        session_id,
        EnqueueChatRunRequest {
            client_request_id: format!("release-{seed}-long-chat-{cycle:04}"),
            text: message.clone(),
            use_moa: false,
            moa_preset_id: None,
        },
    )
    .await?;
    let input_id = Uuid::parse_str(&admitted.input.id)?;
    chat::materialize_release_fixture_input(state, session_id, input_id, &message).await?;
    agent_runs::drain_release_fixture_runs(state, profile).await?;

    let opened = document_editor::read_model(state, editor_path).await?;
    let mut model = opened.model.clone();
    model["content"] = json!(format!("{search_term} editor cycle {cycle:04}\n"));
    document_editor::write_model(
        state,
        WriteDocumentEditorModelRequest {
            path: editor_path.to_string(),
            editor_kind: opened.editor_kind,
            model,
            model_schema_version: DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION,
            required_capabilities: opened.capabilities,
            idempotency_key: format!("release-{seed}-long-editor-{cycle:04}"),
            expected_fingerprint: opened.fingerprint,
            source_session_id: None,
        },
    )
    .await?;

    // Leave one content operation exactly at the crash-after-filesystem-write
    // boundary. The parent then drops all process-local state, and only the
    // independently launched child may recognize and project these bytes.
    let slot = cycle % drive_file_slots;
    let slot_path = long_slot_path(seed, slot);
    let current = drive::read_file(state, &slot_path).await?;
    let bytes = format!("{search_term} slot {slot:03} crash cycle {cycle:04}\n").into_bytes();
    let content_hash = hex::encode(Sha256::digest(&bytes));
    let prepared = resource_identity::prepare_content_operation(
        state,
        &PrepareContentOperation {
            operation_key: format!("release-{seed}-long-crash-{cycle:04}"),
            logical_path: slot_path.clone(),
            expected_fingerprint: Some(current.fingerprint),
            content_sha256: content_hash,
            content_size: bytes.len() as u64,
            source: ContentOrigin::UserEdit.as_str().to_string(),
            actor: ResourceActor::user(),
            artifact: None,
        },
    )
    .await?;
    let resolved = drive::resolve_drive_path(&state.config.agent_data_dir, &slot_path)?;
    std::fs::write(&resolved.physical_path, &bytes)?;
    sqlx::query(
        r#"UPDATE resource_operations
           SET updated_at = now() - interval '1 minute', reconcile_after = now()
           WHERE id = $1"#,
    )
    .bind(prepared.operation_id)
    .execute(&state.db)
    .await?;

    let trash_path = format!("/drive/shared/release-{seed}-long-trash-{cycle:04}.md");
    expect_committed(
        state
            .workspace_content
            .admit_bytes(
                state,
                AdmissionRequest {
                    desired_path: trash_path.clone(),
                    file_name: format!("release-{seed}-long-trash-{cycle:04}.md"),
                    origin: ContentOrigin::UserEdit,
                    actor: AdmissionActor::user(),
                    expected_fingerprint: None,
                    allow_overwrite: false,
                    enqueue_s3_sync: false,
                    operation_key: Some(format!("release-{seed}-long-trash-base-{cycle:04}")),
                    artifact: None,
                },
                format!("{search_term} retained trash cycle {cycle:04}\n").as_bytes(),
            )
            .await?,
    )?;
    drive::delete_path(
        state,
        &trash_path,
        Some(&format!("release-{seed}-long-trash-delete-{cycle:04}")),
        None,
    )
    .await?;
    let trash = drive::list_trash(state).await?;
    let entry = trash
        .entries
        .iter()
        .find(|entry| entry.original_path == trash_path)
        .context("new long release trash entry is unavailable")?;
    retained_trash.push_back(RetainedTrash {
        id: Uuid::parse_str(&entry.id)?,
        created_cycle: cycle,
    });

    for retained in retained_trash.iter() {
        let (trash_path, terminal): (String, bool) = sqlx::query_as(
            r#"SELECT trash_path, (restored_at IS NOT NULL OR purged_at IS NOT NULL)
               FROM drive_trash_entries WHERE id = $1"#,
        )
        .bind(retained.id)
        .fetch_one(&state.db)
        .await?;
        anyhow::ensure!(
            !terminal,
            "retained trash became terminal before its policy boundary"
        );
        let physical = drive::resolve_drive_path(&state.config.agent_data_dir, &trash_path)?;
        anyhow::ensure!(
            physical.physical_path.is_file(),
            "retained trash payload disappeared across a restart boundary"
        );
        *trash_retention_checks += 1;
    }
    while retained_trash
        .front()
        .is_some_and(|entry| cycle.saturating_sub(entry.created_cycle) >= trash_retention_cycles)
    {
        let retained = retained_trash
            .pop_front()
            .context("retained trash queue unexpectedly empty")?;
        let lifecycle_revision = sqlx::query_scalar::<_, i64>(
            r#"SELECT lifecycle_revision FROM drive_resources
               WHERE id = (SELECT resource_id FROM drive_trash_entries WHERE id = $1)"#,
        )
        .bind(retained.id)
        .fetch_one(&state.db)
        .await?;
        drive::purge_trash(
            state,
            retained.id,
            Some(&format!("release-{seed}-long-trash-purge-{cycle:04}")),
            Some(&lifecycle_revision.to_string()),
        )
        .await?;
    }
    Ok(())
}

fn long_slot_path(seed: &str, slot: usize) -> String {
    format!("/drive/shared/release-{seed}-long-slot-{slot:03}.md")
}

async fn spawn_long_release_worker(database_name: &str, root: &Path) -> Result<u32> {
    let executable = std::env::current_exe().context("current test executable is unavailable")?;
    let mut child = Command::new(executable)
        .arg("--exact")
        .arg("release_certification::long_release_reconciliation_worker_child")
        .arg("--ignored")
        .env(LONG_CHILD_ENV, "1")
        .env(LONG_DATABASE_ENV, database_name)
        .env(LONG_ROOT_ENV, root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("long release worker process could not start")?;
    let process_id = child
        .id()
        .context("long release worker has no process id")?;
    let status = tokio::time::timeout(Duration::from_secs(30), child.wait())
        .await
        .context("long release worker process exceeded 30 seconds")??;
    anyhow::ensure!(
        status.success(),
        "long release worker process exited with status {status}"
    );
    Ok(process_id)
}

async fn certify_expired_workspace_cursor(
    state: &AppState,
    principal: &str,
    search_term: &str,
) -> Result<usize> {
    let request = |cursor: Option<String>| WorkspaceSearchRequest {
        query: search_term.to_string(),
        domains: vec![WorkspaceSearchDomain::Drive],
        scope: WorkspaceSearchScope::AllPermitted,
        limit: 1,
        cursor,
    };
    let first = search::workspace_search(
        state,
        request(None),
        None,
        principal,
        "long-release-drive-read-v1",
    )
    .await?;
    anyhow::ensure!(
        first.hits.len() == 1,
        "long release Drive search did not return its first page"
    );
    let cursor = first
        .next_cursor
        .context("long release Drive search did not create a continuation")?;
    sqlx::query(
        r#"UPDATE workspace_search_snapshots
           SET expires_at = now() - interval '1 second'
           WHERE principal_key = $1"#,
    )
    .bind(principal)
    .execute(&state.db)
    .await?;
    let error = match search::workspace_search(
        state,
        request(Some(cursor)),
        None,
        principal,
        "long-release-drive-read-v1",
    )
    .await
    {
        Ok(_) => anyhow::bail!("expired long release cursor was accepted"),
        Err(error) => error,
    };
    anyhow::ensure!(
        matches!(
            error,
            AppError::Coded {
                code: "workspace_search_cursor_restart",
                ..
            }
        ),
        "expired long release cursor returned the wrong error: {error}"
    );

    // Starting a fresh query is the production expiry collector. It must
    // delete the abandoned chain before storing exactly one replacement.
    let replacement = search::workspace_search(
        state,
        request(None),
        None,
        principal,
        "long-release-drive-read-v1",
    )
    .await?;
    anyhow::ensure!(
        replacement.hits.len() == 1,
        "fresh search after cursor expiry did not recover"
    );
    let (total, expired): (i64, i64) = sqlx::query_as(
        r#"SELECT COUNT(*), COUNT(*) FILTER (WHERE expires_at <= now())
           FROM workspace_search_snapshots WHERE principal_key = $1"#,
    )
    .bind(principal)
    .fetch_one(&state.db)
    .await?;
    anyhow::ensure!(
        total == 1 && expired == 0,
        "workspace cursor expiry collector did not remain bounded"
    );
    sqlx::query(
        r#"UPDATE workspace_search_snapshots
           SET expires_at = now() - interval '1 second'
           WHERE principal_key = $1"#,
    )
    .bind(principal)
    .execute(&state.db)
    .await?;
    Ok(1)
}

async fn long_row_counts(state: &AppState) -> Result<BTreeMap<String, i64>> {
    let queries = [
        ("driveResources", "SELECT COUNT(*) FROM drive_resources"),
        (
            "driveTrashEntries",
            "SELECT COUNT(*) FROM drive_trash_entries",
        ),
        (
            "resourceOperations",
            "SELECT COUNT(*) FROM resource_operations",
        ),
        (
            "resourceRevisions",
            "SELECT COUNT(*) FROM resource_revisions",
        ),
        ("resourceOutbox", "SELECT COUNT(*) FROM resource_outbox"),
        (
            "resourceOutboxDeliveries",
            "SELECT COUNT(*) FROM resource_outbox_deliveries",
        ),
        (
            "documentEditorSaveReceipts",
            "SELECT COUNT(*) FROM document_editor_save_receipts",
        ),
        (
            "documentRevisionSnapshots",
            "SELECT COUNT(*) FROM document_revision_snapshots",
        ),
        (
            "memoryExtractionBatches",
            "SELECT COUNT(*) FROM memory_extraction_batches",
        ),
        (
            "workspaceSearchSnapshots",
            "SELECT COUNT(*) FROM workspace_search_snapshots",
        ),
        (
            "driveSearchDocuments",
            "SELECT COUNT(*) FROM drive_search_documents",
        ),
    ];
    let mut counts = BTreeMap::new();
    for (name, query) in queries {
        counts.insert(
            name.to_string(),
            sqlx::query_scalar(query).fetch_one(&state.db).await?,
        );
    }
    Ok(counts)
}

async fn long_relation_sizes(state: &AppState) -> Result<RelationSizes> {
    let relation_names = vec![
        "drive_resources",
        "drive_search_documents",
        "drive_trash_entries",
        "resource_operations",
        "resource_revisions",
        "resource_outbox",
        "resource_outbox_deliveries",
        "document_editor_save_receipts",
        "document_revision_snapshots",
        "memory_extraction_batches",
        "workspace_search_snapshots",
    ];
    let (table_bytes, index_bytes): (i64, i64) = sqlx::query_as(
        r#"SELECT
               COALESCE(SUM(pg_table_size(c.oid)), 0)::bigint,
               COALESCE(SUM(pg_indexes_size(c.oid)), 0)::bigint
           FROM pg_class c
           INNER JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = current_schema() AND c.relname = ANY($1)"#,
    )
    .bind(&relation_names)
    .fetch_one(&state.db)
    .await?;
    Ok(RelationSizes {
        table_bytes,
        index_bytes,
    })
}

fn update_row_maximum(maximum: &mut BTreeMap<String, i64>, current: &BTreeMap<String, i64>) {
    for (key, value) in current {
        maximum
            .entry(key.clone())
            .and_modify(|maximum| *maximum = (*maximum).max(*value))
            .or_insert(*value);
    }
}

#[allow(clippy::too_many_arguments)]
async fn validate_long_cycle_bounds(
    state: &AppState,
    thresholds: &LongReleaseThresholds,
    baseline: &BTreeMap<String, i64>,
    current: &BTreeMap<String, i64>,
    size_baseline: &RelationSizes,
    sizes: &RelationSizes,
    cycles: usize,
    profile: &str,
    principal: &str,
    editor_path: &str,
) -> Result<()> {
    for (key, maximum_per_cycle) in &thresholds.maximum_row_growth_per_cycle {
        let baseline = baseline
            .get(key)
            .with_context(|| format!("missing long release baseline for {key}"))?;
        let observed = current
            .get(key)
            .with_context(|| format!("missing long release row count for {key}"))?;
        let allowed = maximum_per_cycle.saturating_mul(i64::try_from(cycles)?);
        anyhow::ensure!(
            observed.saturating_sub(*baseline) <= allowed,
            "{key} grew by {} rows after {cycles} cycles; budget is {allowed}",
            observed.saturating_sub(*baseline)
        );
    }
    anyhow::ensure!(
        current
            .get("workspaceSearchSnapshots")
            .copied()
            .unwrap_or(i64::MAX)
            <= thresholds.maximum_workspace_snapshots,
        "workspace search snapshots exceeded their absolute bound"
    );
    anyhow::ensure!(
        current
            .get("driveSearchDocuments")
            .and_then(|value| {
                baseline
                    .get("driveSearchDocuments")
                    .map(|baseline| value.saturating_sub(*baseline))
            })
            .unwrap_or(i64::MAX)
            <= thresholds.maximum_drive_search_document_growth,
        "Drive search documents grew beyond their initialized live-set bound"
    );
    let live_trash = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM drive_trash_entries WHERE restored_at IS NULL AND purged_at IS NULL",
    )
    .fetch_one(&state.db)
    .await?;
    anyhow::ensure!(
        live_trash <= thresholds.maximum_live_trash_entries,
        "live trash entries exceeded their retention bound"
    );
    let snapshots = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM document_revision_snapshots WHERE drive_path = $1",
    )
    .bind(editor_path)
    .fetch_one(&state.db)
    .await?;
    anyhow::ensure!(
        snapshots <= thresholds.maximum_document_snapshots,
        "document revision snapshots exceeded their per-path bound"
    );
    let principal_snapshots = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM workspace_search_snapshots WHERE principal_key = $1",
    )
    .bind(principal)
    .fetch_one(&state.db)
    .await?;
    anyhow::ensure!(
        principal_snapshots <= thresholds.maximum_workspace_snapshots,
        "principal workspace snapshots exceeded their bound"
    );
    let memory_cursors = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM memory_extraction_cursors
           WHERE agent_profile = $1 AND last_message_id IS NOT NULL"#,
    )
    .bind(profile)
    .fetch_one(&state.db)
    .await?;
    anyhow::ensure!(
        memory_cursors == 1,
        "memory extraction cursor did not converge"
    );
    let pending = pending_work(state).await?;
    anyhow::ensure!(
        pending.values().all(|count| *count == 0),
        "long release cycle did not settle: {pending:?}"
    );
    let temporary_files = count_temporary_files(&state.config.agent_data_dir)? as i64;
    anyhow::ensure!(
        temporary_files <= thresholds.maximum_temporary_files,
        "temporary files exceeded their committed bound"
    );
    anyhow::ensure!(
        sizes.table_bytes.saturating_sub(size_baseline.table_bytes)
            <= thresholds.maximum_table_growth_bytes,
        "long release table bytes exceeded their committed bound"
    );
    anyhow::ensure!(
        sizes.index_bytes.saturating_sub(size_baseline.index_bytes)
            <= thresholds.maximum_index_growth_bytes,
        "long release index bytes exceeded their committed bound"
    );
    Ok(())
}

async fn long_settled_watermarks(state: &AppState, profile: &str) -> Result<BTreeMap<String, i64>> {
    let mut values = BTreeMap::new();
    values.insert(
        "completedResourceOperations".to_string(),
        sqlx::query_scalar("SELECT COUNT(*) FROM resource_operations WHERE state = 'completed'")
            .fetch_one(&state.db)
            .await?,
    );
    values.insert(
        "deliveredDriveOutbox".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM resource_outbox_deliveries WHERE consumer = 'drive_search_v1'",
        )
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "driveIndexedDocuments".to_string(),
        sqlx::query_scalar("SELECT COUNT(*) FROM drive_search_documents")
            .fetch_one(&state.db)
            .await?,
    );
    values.insert(
        "memoryCommittedBatches".to_string(),
        sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM memory_extraction_batches
               WHERE agent_profile = $1 AND state IN ('committed', 'shadow_complete', 'skipped')"#,
        )
        .bind(profile)
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "memoryCursorMessage".to_string(),
        sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM memory_extraction_cursors
               WHERE agent_profile = $1 AND last_message_id IS NOT NULL"#,
        )
        .bind(profile)
        .fetch_one(&state.db)
        .await?,
    );
    Ok(values)
}

#[allow(clippy::too_many_arguments)]
async fn cleanup_long_release(
    state: &AppState,
    profile: &str,
    seed: &str,
    principal: &str,
    session_id: Uuid,
    editor_path: &str,
    drive_file_slots: usize,
    retained_trash: &mut VecDeque<RetainedTrash>,
) -> Result<()> {
    while let Some(retained) = retained_trash.pop_front() {
        let lifecycle_revision = sqlx::query_scalar::<_, i64>(
            r#"SELECT lifecycle_revision FROM drive_resources
               WHERE id = (SELECT resource_id FROM drive_trash_entries WHERE id = $1)"#,
        )
        .bind(retained.id)
        .fetch_one(&state.db)
        .await?;
        drive::purge_trash(
            state,
            retained.id,
            Some(&format!(
                "release-{seed}-long-final-retained-purge-{}",
                retained.id
            )),
            Some(&lifecycle_revision.to_string()),
        )
        .await?;
    }

    let mut paths = vec![editor_path.to_string()];
    paths.extend((0..drive_file_slots).map(|slot| long_slot_path(seed, slot)));
    for (index, path) in paths.iter().enumerate() {
        drive::delete_path(
            state,
            path,
            Some(&format!("release-{seed}-long-cleanup-delete-{index:03}")),
            None,
        )
        .await?;
    }
    let trash = drive::list_trash(state).await?;
    for entry in trash.entries {
        if !entry
            .original_path
            .contains(&format!("release-{seed}-long-"))
        {
            continue;
        }
        drive::purge_trash(
            state,
            Uuid::parse_str(&entry.id)?,
            Some(&format!("release-{seed}-long-cleanup-purge-{}", entry.id)),
            entry.lifecycle_revision.as_deref(),
        )
        .await?;
    }
    chat::delete_session(state, session_id).await?;
    for _ in 0..100 {
        if chat::reconcile_session_deletions(state, 1_000).await? == 0 {
            break;
        }
    }
    agents::delete_agent(state, profile).await?;
    sqlx::query("DELETE FROM workspace_search_snapshots WHERE principal_key = $1")
        .bind(principal)
        .execute(&state.db)
        .await?;
    Ok(())
}

async fn long_cleanup_counts(
    state: &AppState,
    profile: &str,
    seed: &str,
    principal: &str,
) -> Result<BTreeMap<String, i64>> {
    let mut values = BTreeMap::new();
    values.insert(
        "agent".to_string(),
        sqlx::query_scalar("SELECT COUNT(*) FROM native_agents WHERE profile = $1")
            .bind(profile)
            .fetch_one(&state.db)
            .await?,
    );
    values.insert(
        "sessions".to_string(),
        sqlx::query_scalar("SELECT COUNT(*) FROM chat_sessions WHERE profile = $1")
            .bind(profile)
            .fetch_one(&state.db)
            .await?,
    );
    values.insert(
        "activeDriveResources".to_string(),
        sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM drive_resources
               WHERE lifecycle_state = 'active' AND current_path LIKE $1"#,
        )
        .bind(format!("%release-{seed}-long-%"))
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "liveTrashEntries".to_string(),
        sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM drive_trash_entries
               WHERE original_path LIKE $1 AND restored_at IS NULL AND purged_at IS NULL"#,
        )
        .bind(format!("%release-{seed}-long-%"))
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "pendingResourceOperations".to_string(),
        sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM resource_operations
               WHERE state NOT IN ('completed', 'conflict', 'failed')"#,
        )
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "undeliveredDriveOutbox".to_string(),
        sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM resource_outbox o
               LEFT JOIN resource_outbox_deliveries d
                 ON d.consumer = 'drive_search_v1' AND d.outbox_id = o.id
               WHERE d.outbox_id IS NULL"#,
        )
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "workspaceSearchSnapshots".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM workspace_search_snapshots WHERE principal_key = $1",
        )
        .bind(principal)
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "temporaryFiles".to_string(),
        count_temporary_files(&state.config.agent_data_dir)? as i64,
    );
    values.insert(
        "visibleFixtureFiles".to_string(),
        count_matching_files(
            &state.config.agent_data_dir.join("drive"),
            &format!("release-{seed}-long-"),
        )? as i64,
    );
    Ok(values)
}

fn count_temporary_files(root: &Path) -> Result<usize> {
    if !root.exists() {
        return Ok(0);
    }
    let mut count = 0_usize;
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        for entry in std::fs::read_dir(path)? {
            let path = entry?.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            let under_temporary_directory = path.components().any(|component| {
                matches!(
                    component.as_os_str().to_str(),
                    Some("staging" | ".staging" | "tmp")
                )
            });
            if under_temporary_directory
                || name.ends_with(".tmp")
                || name.ends_with(".partial")
                || name.starts_with(".mymy-write-")
            {
                count += 1;
            }
        }
    }
    Ok(count)
}

fn count_matching_files(root: &Path, needle: &str) -> Result<usize> {
    if !root.exists() {
        return Ok(0);
    }
    let mut count = 0_usize;
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        for entry in std::fs::read_dir(path)? {
            let path = entry?.path();
            if path.is_dir() {
                pending.push(path);
            } else if path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.contains(needle))
            {
                count += 1;
            }
        }
    }
    Ok(count)
}

async fn run_integrated_overlap(pool: PgPool) -> Result<()> {
    let thresholds: ReleaseThresholds = serde_json::from_str(include_str!(
        "../tests/fixtures/local_release_thresholds.json"
    ))?;
    let seed =
        std::env::var("MYMY_RELEASE_SEED").unwrap_or_else(|_| "local-overlap-001".to_string());
    validate_seed(&seed)?;
    let profile = format!("overlap-{seed}");
    let root = std::env::temp_dir().join(format!("mymy-{profile}-{}", Uuid::new_v4()));
    let state = Arc::new(AppState::new(pool.clone(), test_config(root.clone())));
    *state.encryption_key.write().await = Some([7_u8; 32]);

    agents::create_agent(
        &state,
        CreateAgentRequest {
            profile: Some(profile.clone()),
            name: format!("Overlap {seed}"),
            role: Some("Local release certification".to_string()),
            description: Some("Integrated durable workload".to_string()),
        },
    )
    .await?;
    let settings = runtime_memory::get_runtime_settings(&state, &profile).await?;
    runtime_memory::update_runtime_settings(
        &state,
        &profile,
        UpdateMemoryRuntimeSettings {
            automatic_recall_enabled: false,
            inferred_extraction_enabled: true,
            semantic_indexing_enabled: false,
            expected_settings_revision: settings.settings_revision,
        },
    )
    .await?;

    let mut sessions = Vec::with_capacity(thresholds.iterations);
    let mut editor_paths = Vec::with_capacity(thresholds.iterations);
    for index in 0..thresholds.iterations {
        let session = chat::create_session(
            &state,
            CreateSessionRequest {
                project_id: None,
                profile: Some(profile.clone()),
            },
        )
        .await?;
        sessions.push(Uuid::parse_str(&session.session.id)?);
        let editor_path = format!("/drive/shared/release-{seed}-editor-{index:03}.md");
        expect_committed(
            state
                .workspace_content
                .admit_bytes(
                    &state,
                    AdmissionRequest {
                        desired_path: editor_path.clone(),
                        file_name: format!("release-{seed}-editor-{index:03}.md"),
                        origin: ContentOrigin::UserEdit,
                        actor: AdmissionActor::user(),
                        expected_fingerprint: None,
                        allow_overwrite: false,
                        enqueue_s3_sync: false,
                        operation_key: Some(format!("release-{seed}-editor-base-{index:03}")),
                        artifact: None,
                    },
                    format!("overlap editor baseline {index}\n").as_bytes(),
                )
                .await?,
        )?;
        editor_paths.push(editor_path);
    }
    settle_workers(&state, 10_000).await?;

    let rss_baseline = resident_set_bytes()?;
    let fd_baseline = open_file_descriptors()?;
    let samples = Arc::new(Mutex::new(RuntimeSamples {
        maximum_rss_bytes: rss_baseline,
        maximum_file_descriptors: fd_baseline,
        ..RuntimeSamples::default()
    }));
    let stop_sampler = CancellationToken::new();
    let sampler = spawn_worker_sampler(state.clone(), samples.clone(), stop_sampler.clone());

    let workload_started = Instant::now();
    let tasks = sessions.into_iter().zip(editor_paths).enumerate().map(
        |(index, (session_id, editor_path))| {
            run_overlap_iteration(
                state.clone(),
                samples.clone(),
                profile.clone(),
                seed.clone(),
                index,
                session_id,
                editor_path,
            )
        },
    );
    let outputs = try_join_all(tasks).await?;
    let workload_elapsed = workload_started.elapsed();
    anyhow::ensure!(
        workload_elapsed < Duration::from_secs(30),
        "overlap workload starved for {workload_elapsed:?}"
    );

    agent_runs::drain_release_fixture_runs(&state, &profile).await?;
    settle_workers(&state, 10_000).await?;
    tokio::time::sleep(Duration::from_millis(thresholds.tail_observation_ms)).await;
    let delayed_tail_work = pending_work(&state).await?;
    anyhow::ensure!(
        delayed_tail_work.values().all(|count| *count == 0),
        "post-load delayed tail produced work: {delayed_tail_work:?}"
    );
    anyhow::ensure!(
        search::reconcile_drive_search_index(&state, 10_000).await? == 0,
        "Drive index reported a false settled state"
    );
    anyhow::ensure!(
        runtime_memory::run_extraction_pass(&state, 100).await? == 0,
        "memory extraction reported a false settled state"
    );

    stop_sampler.cancel();
    sampler.await.context("worker sampler join failed")??;
    sample_runtime(&state, &samples).await?;

    let exact_counts = exact_counts(&state, &profile, &seed).await?;
    let expected = i64::try_from(thresholds.iterations)?;
    for key in [
        "chatMessages",
        "artifacts",
        "quarantineItems",
        "editorSaveReceipts",
        "inferredMemories",
    ] {
        anyhow::ensure!(
            exact_counts.get(key) == Some(&expected),
            "{key} side effects were not exactly once: {exact_counts:?}"
        );
    }
    let watermarks = durable_watermarks(&state, &profile).await?;
    anyhow::ensure!(
        watermarks.values().all(|value| *value > 0),
        "durable watermark was not reached: {watermarks:?}"
    );

    let samples = Arc::try_unwrap(samples)
        .map_err(|_| anyhow::anyhow!("runtime sampler still has owners"))?
        .into_inner();
    let latencies = summarize_latencies(&samples.elapsed_ms);
    validate_thresholds(&thresholds, &latencies, &samples, rss_baseline, fd_baseline)?;

    cleanup_overlap(&state, &profile, &seed, &outputs).await?;
    let cleanup = cleanup_counts(&state, &profile, &seed).await?;
    anyhow::ensure!(
        cleanup.values().all(|count| *count == 0),
        "overlap cleanup left residual state: {cleanup:?}"
    );
    if root.exists() {
        std::fs::remove_dir_all(&root)?;
    }
    anyhow::ensure!(
        !root.exists(),
        "temporary release directory survived cleanup"
    );

    let evidence = OverlapEvidence {
        test_id: OVERLAP_TEST_ID,
        state: "passed",
        fixture_revision: thresholds.fixture_revision.clone(),
        seed: seed.clone(),
        candidate_commit: std::env::var("CI_COMMIT_SHA")
            .unwrap_or_else(|_| "working-tree".to_string()),
        thresholds,
        latencies,
        maximum_queue_age_ms: samples.maximum_queue_age_ms,
        rss_baseline_bytes: rss_baseline,
        maximum_rss_bytes: samples.maximum_rss_bytes,
        file_descriptors_baseline: fd_baseline,
        maximum_file_descriptors: samples.maximum_file_descriptors,
        maximum_database_connections: samples.maximum_database_connections,
        watermarks,
        exact_counts,
        delayed_tail_work,
        cleanup,
    };
    emit_evidence("loc02-overlap.json", &evidence)?;
    eprintln!(
        "release-certification test={} seed={} revision={} result=passed",
        OVERLAP_TEST_ID, seed, evidence.fixture_revision
    );
    Ok(())
}

async fn run_overlap_iteration(
    state: Arc<AppState>,
    samples: Arc<Mutex<RuntimeSamples>>,
    profile: String,
    seed: String,
    index: usize,
    session_id: Uuid,
    editor_path: String,
) -> Result<IterationOutput> {
    let message = format!(
        "Please remember my preferred release lane is overlap-{index:03} for certification"
    );
    let started = Instant::now();
    let admitted = agent_runs::enqueue_chat_run(
        &state,
        session_id,
        EnqueueChatRunRequest {
            client_request_id: format!("release-{seed}-chat-{index:03}"),
            text: message.clone(),
            use_moa: false,
            moa_preset_id: None,
        },
    )
    .await?;
    record_elapsed(&samples, "chatAdmission", started.elapsed()).await;
    let run = admitted
        .run
        .context("chat admission did not allocate a run")?;
    let run_id = Uuid::parse_str(&run.id)?;
    let input_id = Uuid::parse_str(&admitted.input.id)?;
    chat::materialize_release_fixture_input(&state, session_id, input_id, &message).await?;

    let artifact_path = format!("/drive/shared/release-{seed}-artifact-{index:03}.md");
    let artifact = async {
        let started = Instant::now();
        let outcome = state
            .workspace_content
            .admit_bytes(
                &state,
                AdmissionRequest {
                    desired_path: artifact_path.clone(),
                    file_name: format!("release-{seed}-artifact-{index:03}.md"),
                    origin: ContentOrigin::AgentGenerated,
                    actor: AdmissionActor::agent(Some(&profile), Some(run_id))
                        .with_invocation(Some(&format!("release-{seed}-artifact-{index:03}")))
                        .with_source_session(Some(session_id)),
                    expected_fingerprint: None,
                    allow_overwrite: false,
                    enqueue_s3_sync: false,
                    operation_key: Some(format!("release-{seed}-artifact-{index:03}")),
                    artifact: Some(ArtifactClassification {
                        artifact_type: "report".to_string(),
                        title: format!("Overlap artifact {index:03}"),
                        mime_type: "text/markdown".to_string(),
                    }),
                },
                format!("overlap artifact {index}\n").as_bytes(),
            )
            .await?;
        expect_committed(outcome)?;
        record_elapsed(&samples, "artifactCommit", started.elapsed()).await;
        Result::<()>::Ok(())
    };
    let editor = async {
        let started = Instant::now();
        let opened = document_editor::read_model(&state, &editor_path).await?;
        let mut model = opened.model.clone();
        model["content"] = json!(format!("overlap editor revision {index}\n"));
        document_editor::write_model(
            &state,
            WriteDocumentEditorModelRequest {
                path: editor_path.clone(),
                editor_kind: opened.editor_kind,
                model,
                model_schema_version: DOCUMENT_EDITOR_MODEL_SCHEMA_VERSION,
                required_capabilities: opened.capabilities,
                idempotency_key: format!("release-{seed}-editor-save-{index:03}"),
                expected_fingerprint: opened.fingerprint,
                source_session_id: None,
            },
        )
        .await?;
        record_elapsed(&samples, "editorSave", started.elapsed()).await;
        Result::<()>::Ok(())
    };
    let quarantine = async {
        let started = Instant::now();
        let outcome = state
            .workspace_content
            .admit_bytes(
                &state,
                AdmissionRequest {
                    desired_path: format!("/drive/shared/release-{seed}-quarantine-{index:03}.exe"),
                    file_name: format!("release-{seed}-quarantine-{index:03}.exe"),
                    origin: ContentOrigin::UserUpload,
                    actor: AdmissionActor::user(),
                    expected_fingerprint: None,
                    allow_overwrite: false,
                    enqueue_s3_sync: false,
                    operation_key: Some(format!("release-{seed}-quarantine-{index:03}")),
                    artifact: None,
                },
                b"MZ\x90\0 bounded overlap executable",
            )
            .await?;
        let AdmissionOutcome::Quarantined { id } = outcome else {
            anyhow::bail!("overlap executable was not quarantined");
        };
        record_elapsed(&samples, "quarantineAdmission", started.elapsed()).await;
        Result::<Uuid>::Ok(id)
    };
    let (_, _, quarantine_id) = tokio::try_join!(artifact, editor, quarantine)?;
    Ok(IterationOutput {
        session_id,
        artifact_path,
        editor_path,
        quarantine_id,
    })
}

fn spawn_worker_sampler(
    state: Arc<AppState>,
    samples: Arc<Mutex<RuntimeSamples>>,
    stop: CancellationToken,
) -> tokio::task::JoinHandle<Result<()>> {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = stop.cancelled() => return Ok(()),
                _ = tokio::time::sleep(Duration::from_millis(10)) => {
                    let started = Instant::now();
                    let indexed = search::reconcile_drive_search_index(&state, 256).await?;
                    if indexed > 0 {
                        record_elapsed(&samples, "driveIndexPass", started.elapsed()).await;
                    }
                    let started = Instant::now();
                    let extracted = runtime_memory::run_extraction_pass(&state, 64).await?;
                    if extracted > 0 {
                        record_elapsed(&samples, "memoryExtractionPass", started.elapsed()).await;
                    }
                    resource_identity::reconcile_pending_operations(&state, 256).await?;
                    content_quarantine::reconcile(&state).await?;
                    sample_runtime(&state, &samples).await?;
                }
            }
        }
    })
}

async fn settle_workers(state: &AppState, maximum: usize) -> Result<()> {
    for _ in 0..100 {
        let indexed = search::reconcile_drive_search_index(state, maximum).await?;
        let extracted = runtime_memory::run_extraction_pass(state, maximum).await?;
        let reconciled = resource_identity::reconcile_pending_operations(state, maximum).await?;
        content_quarantine::reconcile(state).await?;
        if indexed == 0 && extracted == 0 && reconciled == 0 {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    anyhow::bail!("release workers did not settle within 100 passes")
}

async fn sample_runtime(state: &AppState, samples: &Arc<Mutex<RuntimeSamples>>) -> Result<()> {
    let queue_age_ms = sqlx::query_scalar::<_, i64>(
        r#"SELECT COALESCE(MAX(FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) * 1000))::bigint, 0)
           FROM (
             SELECT created_at FROM agent_runs
             WHERE status IN ('queued', 'running', 'waiting_decision')
             UNION ALL
             SELECT created_at FROM memory_extraction_batches
             WHERE state IN ('queued', 'processing', 'failed')
             UNION ALL
             SELECT created_at FROM resource_operations
             WHERE state NOT IN ('completed', 'conflict', 'failed')
           ) pending"#,
    )
    .fetch_one(&state.db)
    .await?
    .max(0) as u64;
    let connections = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()",
    )
    .fetch_one(&state.db)
    .await?;
    let rss = resident_set_bytes()?;
    let fds = open_file_descriptors()?;
    let mut samples = samples.lock().await;
    samples.maximum_queue_age_ms = samples.maximum_queue_age_ms.max(queue_age_ms);
    samples.maximum_database_connections = samples.maximum_database_connections.max(connections);
    samples.maximum_rss_bytes = samples.maximum_rss_bytes.max(rss);
    samples.maximum_file_descriptors = samples.maximum_file_descriptors.max(fds);
    Ok(())
}

async fn record_elapsed(samples: &Arc<Mutex<RuntimeSamples>>, key: &str, elapsed: Duration) {
    samples
        .lock()
        .await
        .elapsed_ms
        .entry(key.to_string())
        .or_default()
        .push(elapsed.as_millis().try_into().unwrap_or(u64::MAX));
}

fn summarize_latencies(elapsed: &BTreeMap<String, Vec<u64>>) -> BTreeMap<String, LatencySummary> {
    elapsed
        .iter()
        .map(|(key, values)| {
            let mut values = values.clone();
            values.sort_unstable();
            let p50 = percentile(&values, 50);
            let p95 = percentile(&values, 95);
            let maximum = values.last().copied().unwrap_or_default();
            (
                key.clone(),
                LatencySummary {
                    samples: values.len(),
                    p50_ms: p50,
                    p95_ms: p95,
                    maximum_ms: maximum,
                },
            )
        })
        .collect()
}

fn percentile(values: &[u64], percentile: usize) -> u64 {
    if values.is_empty() {
        return 0;
    }
    values[(values.len() * percentile).div_ceil(100).saturating_sub(1)]
}

fn validate_thresholds(
    thresholds: &ReleaseThresholds,
    latencies: &BTreeMap<String, LatencySummary>,
    samples: &RuntimeSamples,
    rss_baseline: u64,
    fd_baseline: u64,
) -> Result<()> {
    for (key, maximum) in &thresholds.maximum_p95_ms {
        let observed = latencies
            .get(key)
            .with_context(|| format!("missing latency samples for {key}"))?;
        anyhow::ensure!(
            observed.p95_ms <= *maximum,
            "{key} p95 {} ms exceeded {} ms",
            observed.p95_ms,
            maximum
        );
    }
    anyhow::ensure!(
        samples.maximum_queue_age_ms <= thresholds.maximum_queue_age_ms,
        "queue age {} ms exceeded {} ms",
        samples.maximum_queue_age_ms,
        thresholds.maximum_queue_age_ms
    );
    anyhow::ensure!(
        samples.maximum_rss_bytes.saturating_sub(rss_baseline)
            <= thresholds.maximum_rss_growth_bytes,
        "RSS growth exceeded the committed budget"
    );
    anyhow::ensure!(
        samples.maximum_file_descriptors.saturating_sub(fd_baseline)
            <= thresholds.maximum_fd_growth,
        "file descriptor growth exceeded the committed budget"
    );
    anyhow::ensure!(
        samples.maximum_database_connections <= thresholds.maximum_database_connections,
        "database connection count exceeded the committed budget"
    );
    Ok(())
}

async fn pending_work(state: &AppState) -> Result<BTreeMap<String, i64>> {
    let mut values = BTreeMap::new();
    values.insert(
        "agentRuns".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM agent_runs WHERE status IN ('queued', 'running', 'waiting_decision')",
        )
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "memoryBatches".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM memory_extraction_batches WHERE state IN ('queued', 'processing', 'failed')",
        )
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "resourceOperations".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM resource_operations WHERE state NOT IN ('completed', 'conflict', 'failed')",
        )
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "driveOutbox".to_string(),
        sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM resource_outbox o
               LEFT JOIN resource_outbox_deliveries d
                 ON d.consumer = 'drive_search_v1' AND d.outbox_id = o.id
               WHERE d.outbox_id IS NULL"#,
        )
        .fetch_one(&state.db)
        .await?,
    );
    Ok(values)
}

async fn exact_counts(
    state: &AppState,
    profile: &str,
    seed: &str,
) -> Result<BTreeMap<String, i64>> {
    let mut values = BTreeMap::new();
    values.insert(
        "chatMessages".to_string(),
        sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM chat_messages m
               INNER JOIN chat_sessions s ON s.id = m.session_id
               WHERE s.profile = $1 AND m.role = 'user'"#,
        )
        .bind(profile)
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "artifacts".to_string(),
        sqlx::query_scalar("SELECT COUNT(*) FROM artifacts WHERE title LIKE 'Overlap artifact %'")
            .fetch_one(&state.db)
            .await?,
    );
    values.insert(
        "quarantineItems".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM content_quarantine_items WHERE desired_path LIKE $1",
        )
        .bind(format!("%release-{seed}-quarantine-%"))
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "editorSaveReceipts".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM document_editor_save_receipts WHERE idempotency_key LIKE $1",
        )
        .bind(format!("release-{seed}-editor-save-%"))
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "inferredMemories".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM agent_memories WHERE agent_profile = $1 AND origin = 'conversation_inferred'",
        )
        .bind(profile)
        .fetch_one(&state.db)
        .await?,
    );
    Ok(values)
}

async fn durable_watermarks(state: &AppState, profile: &str) -> Result<BTreeMap<String, i64>> {
    let mut values = BTreeMap::new();
    values.insert(
        "memoryLifecycleRevision".to_string(),
        runtime_memory::current_memory_lifecycle_revision(state, profile).await?,
    );
    values.insert(
        "memoryCursorCount".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM memory_extraction_cursors WHERE agent_profile = $1 AND last_message_id IS NOT NULL",
        )
        .bind(profile)
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "driveIndexedDocuments".to_string(),
        sqlx::query_scalar("SELECT COUNT(*) FROM drive_search_documents")
            .fetch_one(&state.db)
            .await?,
    );
    values.insert(
        "completedResourceOperations".to_string(),
        sqlx::query_scalar("SELECT COUNT(*) FROM resource_operations WHERE state = 'completed'")
            .fetch_one(&state.db)
            .await?,
    );
    Ok(values)
}

async fn cleanup_overlap(
    state: &AppState,
    profile: &str,
    seed: &str,
    outputs: &[IterationOutput],
) -> Result<()> {
    for output in outputs {
        let version = sqlx::query_scalar::<_, i64>(
            "SELECT version FROM content_quarantine_items WHERE id = $1",
        )
        .bind(output.quarantine_id)
        .fetch_one(&state.db)
        .await?;
        content_quarantine::delete(
            state,
            output.quarantine_id,
            DeleteQuarantineRequest {
                expected_version: version,
            },
        )
        .await?;
        for path in [&output.artifact_path, &output.editor_path] {
            drive::delete_path(
                state,
                path,
                Some(&format!("release-{seed}-cleanup-{}", Uuid::new_v4())),
                None,
            )
            .await?;
        }
    }
    let trash = drive::list_trash(state).await?;
    for entry in trash.entries {
        if !entry.original_path.contains(&format!("release-{seed}-")) {
            continue;
        }
        drive::purge_trash(
            state,
            Uuid::parse_str(&entry.id)?,
            Some(&format!("release-{seed}-purge-{}", Uuid::new_v4())),
            entry.lifecycle_revision.as_deref(),
        )
        .await?;
    }
    for output in outputs {
        chat::delete_session(state, output.session_id).await?;
    }
    for _ in 0..100 {
        if chat::reconcile_session_deletions(state, 1_000).await? == 0 {
            break;
        }
    }
    agents::delete_agent(state, profile).await?;
    Ok(())
}

async fn cleanup_counts(
    state: &AppState,
    profile: &str,
    seed: &str,
) -> Result<BTreeMap<String, i64>> {
    let mut values = BTreeMap::new();
    values.insert(
        "sessions".to_string(),
        sqlx::query_scalar("SELECT COUNT(*) FROM chat_sessions WHERE profile = $1")
            .bind(profile)
            .fetch_one(&state.db)
            .await?,
    );
    values.insert(
        "agent".to_string(),
        sqlx::query_scalar("SELECT COUNT(*) FROM native_agents WHERE profile = $1")
            .bind(profile)
            .fetch_one(&state.db)
            .await?,
    );
    values.insert(
        "activeDriveResources".to_string(),
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM drive_resources WHERE lifecycle_state = 'active' AND current_path LIKE $1",
        )
        .bind(format!("%release-{seed}-%"))
        .fetch_one(&state.db)
        .await?,
    );
    values.insert(
        "pendingQuarantine".to_string(),
        content_quarantine::pending_count(state).await?,
    );
    values.insert(
        "temporaryFiles".to_string(),
        count_files(&state.config.agent_data_dir.join("staging"))? as i64,
    );
    Ok(values)
}

fn expect_committed(outcome: AdmissionOutcome) -> Result<()> {
    match outcome {
        AdmissionOutcome::Committed { .. } => Ok(()),
        AdmissionOutcome::Quarantined { .. } => {
            anyhow::bail!("trusted overlap content quarantined")
        }
        AdmissionOutcome::Rejected => anyhow::bail!("trusted overlap content rejected"),
    }
}

fn resident_set_bytes() -> Result<u64> {
    let status = std::fs::read_to_string("/proc/self/status")?;
    let kib = status
        .lines()
        .find_map(|line| line.strip_prefix("VmRSS:"))
        .and_then(|value| value.split_whitespace().next())
        .context("VmRSS is unavailable")?
        .parse::<u64>()?;
    Ok(kib.saturating_mul(1_024))
}

fn open_file_descriptors() -> Result<u64> {
    Ok(std::fs::read_dir("/proc/self/fd")?.count() as u64)
}

fn count_files(root: &Path) -> Result<usize> {
    if !root.exists() {
        return Ok(0);
    }
    let mut count = 0;
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        for entry in std::fs::read_dir(path)? {
            let path = entry?.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                count += 1;
            }
        }
    }
    Ok(count)
}

fn emit_evidence(name: &str, evidence: &impl Serialize) -> Result<()> {
    let Some(directory) = std::env::var_os("MYMY_RELEASE_EVIDENCE_DIR") else {
        return Ok(());
    };
    let directory = PathBuf::from(directory);
    std::fs::create_dir_all(&directory)?;
    let bytes = serde_json::to_vec_pretty(evidence)?;
    std::fs::write(directory.join(name), bytes)?;
    Ok(())
}

fn validate_seed(seed: &str) -> Result<()> {
    anyhow::ensure!(
        !seed.is_empty()
            && seed.len() <= 40
            && seed
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-'),
        "release seed must be a 1-40 character ASCII token"
    );
    Ok(())
}

fn test_config(agent_data_dir: PathBuf) -> Config {
    Config {
        database_url: String::new(),
        port: 0,
        cors_origins: vec!["http://127.0.0.1".to_string()],
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
