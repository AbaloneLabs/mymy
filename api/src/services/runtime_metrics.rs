//! Low-cardinality runtime metrics and the Prometheus scrape recorder.
//!
//! Durable events remain the source for individual-run investigation. These
//! metrics intentionally aggregate by bounded runtime enums only, avoiding run,
//! session, project, path, prompt, and credential values in metric labels.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use tokio::task::JoinHandle;

use crate::state::AppState;

static PROMETHEUS_HANDLE: OnceLock<PrometheusHandle> = OnceLock::new();
const RUN_STATUSES: &[&str] = &[
    "queued",
    "running",
    "waiting_decision",
    "completed",
    "failed",
    "cancelled",
];

pub fn install() -> anyhow::Result<()> {
    let handle = PrometheusBuilder::new().install_recorder()?;
    PROMETHEUS_HANDLE
        .set(handle)
        .map_err(|_| anyhow::anyhow!("runtime metrics recorder was already initialized"))?;
    describe();
    Ok(())
}

pub fn render() -> String {
    PROMETHEUS_HANDLE
        .get()
        .map(PrometheusHandle::render)
        .unwrap_or_default()
}

pub fn start_runtime_metrics_collector(state: Arc<AppState>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        loop {
            interval.tick().await;
            if let Err(err) = refresh_runtime_gauges(&state).await {
                tracing::warn!(error = %err, "runtime metric projection failed");
            }
        }
    })
}

async fn refresh_runtime_gauges(state: &AppState) -> sqlx::Result<()> {
    let counts = sqlx::query_as::<_, (String, i64)>(
        "SELECT status, COUNT(*)::bigint FROM agent_runs GROUP BY status",
    )
    .fetch_all(&state.db)
    .await?;
    for status in RUN_STATUSES {
        let count = counts
            .iter()
            .find_map(|(candidate, count)| (candidate == status).then_some(*count))
            .unwrap_or(0);
        metrics::gauge!("mymy_agent_runs", "status" => *status).set(count as f64);
    }
    let stale = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM agent_runs WHERE status = 'running' AND lease_expires_at < now()",
    )
    .fetch_one(&state.db)
    .await?;
    metrics::gauge!("mymy_agent_runs_stale").set(stale as f64);
    metrics::gauge!("mymy_database_pool_connections").set(f64::from(state.db.size()));
    metrics::gauge!("mymy_database_pool_idle_connections").set(state.db.num_idle() as f64);
    Ok(())
}

fn describe() {
    metrics::describe_counter!(
        "mymy_agent_runs_started_total",
        "Durable agent runs claimed by trigger"
    );
    metrics::describe_counter!(
        "mymy_agent_runs_finished_total",
        "Durable agent runs reaching a terminal or waiting state"
    );
    metrics::describe_counter!(
        "mymy_agent_run_lease_recoveries_total",
        "Expired run leases reconciled"
    );
    metrics::describe_counter!(
        "mymy_agent_event_append_failures_total",
        "Failed durable user-event appends"
    );
    metrics::describe_counter!(
        "mymy_agent_provider_retries_total",
        "Bounded provider retries by cause"
    );
    metrics::describe_histogram!(
        "mymy_agent_run_duration_seconds",
        "Wall-clock run claim duration"
    );
    metrics::describe_histogram!(
        "mymy_agent_tool_duration_seconds",
        "Tool invocation duration by bounded effect and outcome"
    );
    metrics::describe_histogram!(
        "mymy_agent_event_append_duration_seconds",
        "Durable event append latency"
    );
    metrics::describe_counter!(
        "mymy_document_editor_mutations_total",
        "Document save and conflict-copy outcomes by bounded operation and editor kind"
    );
    metrics::describe_histogram!(
        "mymy_document_editor_mutation_duration_seconds",
        "Document save and conflict-copy latency by bounded outcome"
    );
    metrics::describe_counter!(
        "mymy_ooxml_admissions_total",
        "OOXML package admissions by bounded outcome"
    );
    metrics::describe_counter!(
        "mymy_ooxml_rejections_total",
        "OOXML package rejections by bounded class and reason"
    );
    metrics::describe_histogram!(
        "mymy_ooxml_declared_expanded_bytes",
        "Declared aggregate OOXML expanded bytes after admission"
    );
    metrics::describe_counter!(
        "mymy_document_conversion_failures_total",
        "Bounded document conversion failures by operation and reason"
    );
    metrics::describe_histogram!(
        "mymy_document_conversion_duration_seconds",
        "Dedicated document conversion wall time by operation and outcome"
    );
    metrics::describe_counter!(
        "mymy_document_malware_scans_total",
        "Document malware scan outcomes without document-derived labels"
    );
    metrics::describe_gauge!("mymy_agent_runs", "Current durable run count by status");
    metrics::describe_gauge!(
        "mymy_agent_runs_stale",
        "Running leases already past expiry"
    );
    metrics::describe_gauge!(
        "mymy_database_pool_connections",
        "Open PostgreSQL pool connections"
    );
    metrics::describe_gauge!(
        "mymy_database_pool_idle_connections",
        "Idle PostgreSQL pool connections"
    );
}
