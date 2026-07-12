//! mymy API — entry point.
//!
//! Starts an axum server on the configured port, runs DB migrations,
//! and wires up all route handlers.

mod agent;
mod config;
mod error;
mod handlers;
mod middleware;
mod models;
#[cfg(test)]
mod release_scope;
mod services;
mod state;

use std::sync::Arc;

use axum::middleware::from_fn_with_state;
use axum::Router;
use sqlx::migrate::Migrator;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tokio::task::JoinHandle;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::state::AppState;

type BackgroundWorkers = (
    JoinHandle<()>,
    JoinHandle<()>,
    JoinHandle<()>,
    JoinHandle<()>,
    Option<JoinHandle<()>>,
    JoinHandle<()>,
    JoinHandle<()>,
    JoinHandle<()>,
);

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    services::runtime_metrics::install()?;

    let cfg = Config::from_env();
    run(cfg).await
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .event_format(agent::security::RedactingFormatter)
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("mymy_api=info,tower_http=info")),
        )
        .init();
}

async fn run(cfg: Config) -> anyhow::Result<()> {
    agent::security::verify_ca_bundle()?;
    cfg.validate_network_security()
        .map_err(anyhow::Error::msg)?;
    tracing::info!(port = cfg.port, "starting mymy-api");

    let pool = connect_database(&cfg).await?;
    apply_migrations(&pool).await?;
    services::auth::initialize_auth_state(&pool, cfg.initial_pin().as_deref()).await?;
    let port = cfg.port;
    let state = Arc::new(AppState::new(pool, cfg));
    agent::tools::builtin::validate_builtin_catalog(state.clone())?;
    match services::resource_identity::reconcile_pending_operations(&state, 10_000).await {
        Ok(count) => tracing::info!(
            count,
            "reconciled incomplete resource operations at startup"
        ),
        Err(error) => {
            tracing::error!(error = %error, "resource operation startup reconciliation failed")
        }
    }
    match services::resource_identity::reconcile_existing_drive(&state, 10_000).await {
        Ok(count) => tracing::info!(count, "reconciled existing Drive resource identities"),
        Err(error) => {
            tracing::error!(error = %error, "Drive resource identity reconciliation failed")
        }
    }
    match services::resource_identity::reconcile_existing_trash(&state, 10_000).await {
        Ok(count) => tracing::info!(count, "reconciled historical Drive trash identities"),
        Err(error) => tracing::error!(error = %error, "Drive trash identity reconciliation failed"),
    }
    services::cron::quarantine_legacy_jobs(&state).await?;
    let _background_workers = start_background_workers(state.clone());
    let app = build_router(state.clone(), &state.config);

    serve_http(app, &state.config.bind_host(), port).await
}

async fn connect_database(cfg: &Config) -> anyhow::Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(&cfg.database_url)
        .await
        .map_err(Into::into)
}

async fn apply_migrations(pool: &PgPool) -> anyhow::Result<()> {
    let migrator = sqlx::migrate!("./migrations");
    reconcile_rewritten_migration_checksums(pool, &migrator).await?;

    migrator.run(pool).await.map_err(|e| {
        tracing::error!(error = ?e, "migration failed");
        e
    })?;
    tracing::info!("database migrations applied");

    Ok(())
}

fn start_background_workers(state: Arc<AppState>) -> BackgroundWorkers {
    (
        services::cron::start_cron_ticker(state.clone()),
        services::agent_runs::start_agent_run_worker(state.clone()),
        services::proactive::start_proactive_coordinator(state.clone()),
        services::runtime_metrics::start_runtime_metrics_collector(state.clone()),
        services::drive_sync::start_drive_sync_worker(state.clone()),
        services::content_quarantine::start_worker(state.clone()),
        services::resource_identity::start_worker(state.clone()),
        services::runtime_memory::start_extraction_worker(state),
    )
}

async fn serve_http(app: Router, bind_host: &str, port: u16) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind((bind_host, port)).await?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}

async fn reconcile_rewritten_migration_checksums(
    pool: &PgPool,
    migrator: &Migrator,
) -> anyhow::Result<()> {
    const REWRITTEN_MIGRATIONS: &[i64] = &[1, 4, 21, 22, 29, 30, 31, 36];

    let table_exists: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations')::text")
            .fetch_one(pool)
            .await?;

    if table_exists.is_none() {
        return Ok(());
    }

    // Historical migrations were intentionally rewritten during the native
    // agent runtime cleanup so fresh databases no longer create obsolete
    // schema. Existing databases still contain SQLx's checksum record for the
    // old files, so startup must reconcile only those known versions before
    // normal migration validation runs. This keeps checksum protection intact
    // for every other migration while allowing the repository to keep a clean
    // fresh schema.
    for migration in migrator
        .iter()
        .filter(|migration| REWRITTEN_MIGRATIONS.contains(&migration.version))
    {
        let result = sqlx::query(
            r#"
            UPDATE _sqlx_migrations
               SET checksum = $2
             WHERE version = $1
               AND success = true
               AND checksum <> $2
            "#,
        )
        .bind(migration.version)
        .bind(migration.checksum.as_ref().to_vec())
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            tracing::info!(
                version = migration.version,
                "reconciled intentionally rewritten migration checksum"
            );
        }
    }

    Ok(())
}

fn build_router(state: Arc<AppState>, cfg: &Config) -> Router {
    let cors = middleware::cors_layer(&cfg.cors_origins);

    Router::new()
        .merge(handlers::routes())
        .merge(handlers::metrics_routes())
        .layer(from_fn_with_state(state.clone(), middleware::require_auth))
        .layer(from_fn_with_state(
            state.clone(),
            middleware::require_same_origin,
        ))
        .layer(cors)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    use axum::body::{to_bytes, Body};
    use axum::http::header::{CONTENT_TYPE, COOKIE, ORIGIN, SET_COOKIE};
    use axum::http::{Method, Request, StatusCode};
    use tower::util::ServiceExt;

    use crate::services::auth::{clear_pin_failures, hash_pin};

    #[sqlx::test(migrations = "./migrations")]
    async fn auth_session_cookie_allows_and_revokes_protected_access(pool: sqlx::PgPool) {
        let pin = "2468";
        seed_pin(&pool, pin).await;
        let cfg = test_config();
        let state = Arc::new(AppState::new(pool, cfg.clone()));
        let app = build_router(state, &cfg);

        let unauthorized = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/projects")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let verified = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/verify")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(r#"{{"pin":"{pin}"}}"#)))
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(verified.status(), StatusCode::OK);

        let session_cookie = verified
            .headers()
            .get(SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .expect("auth verify should set a session cookie")
            .to_string();

        let authorized = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/projects")
                    .header(COOKIE, &session_cookie)
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(authorized.status(), StatusCode::OK);

        let cross_origin = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/logout")
                    .header(COOKIE, &session_cookie)
                    .header(ORIGIN, "https://attacker.invalid")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(cross_origin.status(), StatusCode::FORBIDDEN);

        let logout = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/logout")
                    .header(COOKIE, &session_cookie)
                    .header(ORIGIN, "http://localhost")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(logout.status(), StatusCode::OK);
        assert!(
            logout
                .headers()
                .get(SET_COOKIE)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.contains("Max-Age=0")),
            "logout should clear the session cookie"
        );

        let revoked = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/projects")
                    .header(COOKIE, &session_cookie)
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn auth_status_requires_cached_encryption_key(pool: sqlx::PgPool) {
        let pin = "2468";
        seed_pin(&pool, pin).await;

        let cfg = test_config();
        let state = Arc::new(AppState::new(pool, cfg.clone()));
        let app = build_router(state.clone(), &cfg);

        let verified = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/verify")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(r#"{{"pin":"{pin}"}}"#)))
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(verified.status(), StatusCode::OK);

        let session_cookie = verified
            .headers()
            .get(SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .expect("auth verify should set a session cookie")
            .to_string();

        // Simulate a server restart: the DB-backed session survives, but the
        // PIN-derived encryption key is intentionally memory-only and must be
        // restored through explicit PIN verification.
        *state.encryption_key.write().await = None;

        let status = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/auth/status")
                    .header(COOKIE, session_cookie)
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(status.status(), StatusCode::OK);

        let body = to_bytes(status.into_body(), usize::MAX)
            .await
            .expect("body should be readable");
        let json: serde_json::Value =
            serde_json::from_slice(&body).expect("status should return JSON");
        assert_eq!(json["authenticated"], false);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn user_workspace_search_is_authenticated_and_session_bound(pool: sqlx::PgPool) {
        let pin = "2468";
        seed_pin(&pool, pin).await;
        for index in 0..2 {
            sqlx::query("INSERT INTO notes(title, content) VALUES ($1, 'HTTP search evidence')")
                .bind(format!("HTTP federated result {index}"))
                .execute(&pool)
                .await
                .unwrap();
        }
        let cfg = test_config();
        let state = Arc::new(AppState::new(pool, cfg.clone()));
        let app = build_router(state, &cfg);
        let body = r#"{"query":"HTTP federated","domains":["notes"],"scope":"all_permitted","projectId":null,"limit":1,"cursor":null}"#;

        let unauthorized = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/search/workspace")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let first_cookie = authenticate_http(&app, pin).await;
        let first = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/search/workspace")
                    .header(CONTENT_TYPE, "application/json")
                    .header(COOKIE, &first_cookie)
                    .header(ORIGIN, "http://localhost")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let first_json: serde_json::Value =
            serde_json::from_slice(&to_bytes(first.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(first_json["hits"].as_array().unwrap().len(), 1);
        let cursor = first_json["nextCursor"].as_str().unwrap();

        let second_cookie = authenticate_http(&app, pin).await;
        let continuation_body = serde_json::json!({
            "query": "HTTP federated",
            "domains": ["notes"],
            "scope": "all_permitted",
            "projectId": null,
            "limit": 1,
            "cursor": cursor,
        });
        let cross_session = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/search/workspace")
                    .header(CONTENT_TYPE, "application/json")
                    .header(COOKIE, second_cookie)
                    .header(ORIGIN, "http://localhost")
                    .body(Body::from(continuation_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_session.status(), StatusCode::CONFLICT);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn authenticated_http_cannot_create_or_update_a_removed_no_agent_job(pool: sqlx::PgPool) {
        let pin = "2468";
        seed_pin(&pool, pin).await;
        sqlx::query(
            r#"INSERT INTO native_agents
                 (profile, name, drive_path, sandbox_status)
               VALUES ('cron-security-test', 'Cron security test',
                       '/drive/agents/cron-security-test', 'ready')"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut cfg = test_config();
        let agent_data_dir =
            std::env::temp_dir().join(format!("mymy-http-cron-security-{}", uuid::Uuid::new_v4()));
        cfg.agent_data_dir = agent_data_dir.clone();
        let state = Arc::new(AppState::new(pool.clone(), cfg.clone()));
        let app = build_router(state, &cfg);
        let verified = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/verify")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(r#"{{"pin":"{pin}"}}"#)))
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(verified.status(), StatusCode::OK);
        let session_cookie = verified
            .headers()
            .get(SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .expect("auth verify should set a session cookie")
            .to_string();

        let rejected_create = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/cron/jobs")
                    .header(CONTENT_TYPE, "application/json")
                    .header(COOKIE, &session_cookie)
                    .header(ORIGIN, "http://localhost")
                    .body(Body::from(
                        r#"{"title":"Blocked","prompt":"hidden","schedule":"every 1h","agentProfile":"cron-security-test","mode":"no_agent"}"#,
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");

        assert_eq!(rejected_create.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let created = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/cron/jobs")
                    .header(CONTENT_TYPE, "application/json")
                    .header(COOKIE, &session_cookie)
                    .header(ORIGIN, "http://localhost")
                    .body(Body::from(
                        r#"{"title":"Agent job","prompt":"Review tasks","schedule":"every 1h","agentProfile":"cron-security-test"}"#,
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(created.status(), StatusCode::OK);
        let body = to_bytes(created.into_body(), usize::MAX)
            .await
            .expect("body should be readable");
        let json: serde_json::Value =
            serde_json::from_slice(&body).expect("cron response should be JSON");
        let job_id = json["jobs"][0]["id"]
            .as_str()
            .expect("created job should have an id");

        let rejected_update = app
            .oneshot(
                Request::builder()
                    .method(Method::PATCH)
                    .uri(format!("/api/cron/jobs/{job_id}"))
                    .header(CONTENT_TYPE, "application/json")
                    .header(COOKIE, session_cookie)
                    .header(ORIGIN, "http://localhost")
                    .body(Body::from(r#"{"mode":"no_agent"}"#))
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");
        assert_eq!(rejected_update.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let audit_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM audit_logs WHERE entity_type = 'cron_job'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(audit_count, 1);
        let stored = sqlx::query_as::<_, (String, String)>(
            "SELECT title, prompt FROM cron_jobs WHERE id = $1",
        )
        .bind(uuid::Uuid::parse_str(job_id).expect("job id should be a UUID"))
        .fetch_one(&pool)
        .await
        .expect("accepted agent job should be stored in PostgreSQL");
        assert_eq!(
            stored,
            ("Agent job".to_string(), "Review tasks".to_string())
        );
        assert!(!agent_data_dir.join("cron/jobs.json").exists());
        let _ = std::fs::remove_dir_all(agent_data_dir);
    }

    async fn seed_pin(pool: &sqlx::PgPool, pin: &str) {
        let hash = hash_pin(pin).expect("PIN hash should be created");
        sqlx::query!(
            "INSERT INTO app_meta (id, pin_hash) VALUES (true, $1)
             ON CONFLICT (id) DO UPDATE SET pin_hash = $1",
            hash
        )
        .execute(pool)
        .await
        .expect("test PIN should be seeded");

        clear_pin_failures(pool)
            .await
            .expect("pin failures should be cleared");
    }

    async fn authenticate_http(app: &Router, pin: &str) -> String {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/verify")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(r#"{{"pin":"{pin}"}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response
            .headers()
            .get(SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .expect("authentication should set a session cookie")
            .to_string()
    }

    fn test_config() -> Config {
        Config {
            database_url: "postgres://sqlx-test".to_string(),
            port: 0,
            cors_origins: vec!["http://localhost".to_string()],
            agent_data_dir: std::env::temp_dir().join("mymy-test-agent"),
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
