//! Environment configuration loaded at startup.

use std::env;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    /// Comma-separated list of allowed CORS origins.
    pub cors_origins: Vec<String>,
    /// Directory for native agent runtime state such as memory, skills, cron jobs, and extensions.
    pub agent_data_dir: PathBuf,
    /// Whether auth cookies should include the Secure attribute.
    pub auth_cookie_secure: bool,
    /// Cron ticker interval in seconds.
    pub cron_tick_interval_secs: u64,
    /// IANA timezone used for cron expression scheduling.
    pub cron_timezone: String,
    /// Maximum number of output files retained per cron job.
    pub cron_output_keep: usize,
    /// Optional S3 bucket used by the Drive sync layer.
    pub drive_s3_bucket: Option<String>,
    /// Optional S3 region used by the Drive sync layer.
    pub drive_s3_region: Option<String>,
    /// Optional S3-compatible endpoint for self-hosted object storage.
    pub drive_s3_endpoint: Option<String>,
    /// Optional sandbox runner HTTP endpoint.
    pub sandbox_runner_url: Option<String>,
    /// Hostname the API uses for runner-started preview servers.
    pub sandbox_preview_host: String,
}

impl Config {
    /// Load configuration from environment variables (with sensible defaults).
    ///
    /// Reads `.env` if present (via dotenvy::dotenv).
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();

        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://mymy:mymy@db:5432/mymy".to_string());

        let port = env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(33697);

        let cors_origins = env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:33696".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let agent_data_dir = env::var("MYMY_AGENT_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/agent"));
        let auth_cookie_secure = env::var("AUTH_COOKIE_SECURE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(false);
        let cron_tick_interval_secs = env::var("MYMY_CRON_TICK_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|value| *value > 0)
            .unwrap_or(60);
        let cron_timezone = env::var("MYMY_CRON_TIMEZONE").unwrap_or_else(|_| "UTC".to_string());
        let cron_output_keep = env::var("MYMY_CRON_OUTPUT_KEEP")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|value| *value > 0)
            .unwrap_or(50);
        let drive_s3_bucket = env_optional("MYMY_DRIVE_S3_BUCKET");
        let drive_s3_region = env_optional("MYMY_DRIVE_S3_REGION");
        let drive_s3_endpoint = env_optional("MYMY_DRIVE_S3_ENDPOINT");
        let sandbox_runner_url = env_optional("MYMY_SANDBOX_RUNNER_URL");
        let sandbox_preview_host = env::var("MYMY_SANDBOX_PREVIEW_HOST")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "127.0.0.1".to_string());

        Self {
            database_url,
            port,
            cors_origins,
            agent_data_dir,
            auth_cookie_secure,
            cron_tick_interval_secs,
            cron_timezone,
            cron_output_keep,
            drive_s3_bucket,
            drive_s3_region,
            drive_s3_endpoint,
            sandbox_runner_url,
            sandbox_preview_host,
        }
    }
}

fn env_optional(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
