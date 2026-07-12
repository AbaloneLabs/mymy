//! Environment configuration loaded at startup.

use std::env;
use std::path::PathBuf;

const DEFAULT_DATABASE_URL: &str = "postgres://mymy:mymy@db:5432/mymy";
const DEFAULT_PORT: u16 = 33697;
const DEFAULT_CORS_ORIGIN: &str = "http://localhost:33696,http://127.0.0.1:33696";
const DEFAULT_AGENT_DATA_DIR: &str = "data/agent";
const DEFAULT_CRON_TICK_INTERVAL_SECS: u64 = 60;
const DEFAULT_CRON_TIMEZONE: &str = "UTC";
const DEFAULT_CRON_OUTPUT_KEEP: usize = 50;
const DEFAULT_SANDBOX_PREVIEW_HOST: &str = "127.0.0.1";
const DEFAULT_CONTENT_MAX_ITEM_BYTES: u64 = 256 * 1024 * 1024;
const DEFAULT_QUARANTINE_MAX_PENDING_BYTES: u64 = 1024 * 1024 * 1024;
const DEFAULT_QUARANTINE_RETENTION_DAYS: u64 = 30;

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

        let database_url = env_string("DATABASE_URL", DEFAULT_DATABASE_URL);
        let port = env_parse("PORT", DEFAULT_PORT);

        let cors_origins = env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| DEFAULT_CORS_ORIGIN.to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let agent_data_dir = env::var("MYMY_AGENT_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_AGENT_DATA_DIR));
        let auth_cookie_secure = env_parse("AUTH_COOKIE_SECURE", false);
        let cron_tick_interval_secs = env_parse_positive(
            "MYMY_CRON_TICK_INTERVAL_SECS",
            DEFAULT_CRON_TICK_INTERVAL_SECS,
        );
        let cron_timezone = env_string("MYMY_CRON_TIMEZONE", DEFAULT_CRON_TIMEZONE);
        let cron_output_keep =
            env_parse_positive("MYMY_CRON_OUTPUT_KEEP", DEFAULT_CRON_OUTPUT_KEEP);
        let drive_s3_bucket = env_optional("MYMY_DRIVE_S3_BUCKET");
        let drive_s3_region = env_optional("MYMY_DRIVE_S3_REGION");
        let drive_s3_endpoint = env_optional("MYMY_DRIVE_S3_ENDPOINT");
        let sandbox_runner_url = env_optional("MYMY_SANDBOX_RUNNER_URL");
        let sandbox_preview_host = env::var("MYMY_SANDBOX_PREVIEW_HOST")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_SANDBOX_PREVIEW_HOST.to_string());

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

    /// Maximum bytes accepted for one staged content item. Deployments may
    /// lower, but never raise, the native engine's compiled safety ceiling.
    pub fn content_max_item_bytes(&self) -> u64 {
        env_parse_positive(
            "MYMY_CONTENT_MAX_ITEM_BYTES",
            DEFAULT_CONTENT_MAX_ITEM_BYTES,
        )
        .min(DEFAULT_CONTENT_MAX_ITEM_BYTES)
    }

    /// Aggregate bytes retained for unresolved user review.
    pub fn quarantine_max_pending_bytes(&self) -> u64 {
        env_parse_positive(
            "MYMY_QUARANTINE_MAX_PENDING_BYTES",
            DEFAULT_QUARANTINE_MAX_PENDING_BYTES,
        )
        .min(DEFAULT_QUARANTINE_MAX_PENDING_BYTES)
    }

    /// Days a pending review item remains available before expiration.
    pub fn quarantine_retention_days(&self) -> u64 {
        env_parse_positive(
            "MYMY_QUARANTINE_RETENTION_DAYS",
            DEFAULT_QUARANTINE_RETENTION_DAYS,
        )
        .min(DEFAULT_QUARANTINE_RETENTION_DAYS)
    }

    /// The standalone API is local-only unless a deployment explicitly opts
    /// into a wider bind and supplies the corresponding TLS/origin controls.
    pub fn bind_host(&self) -> String {
        env_string("MYMY_BIND_HOST", "127.0.0.1")
    }

    /// Optional first-start override for the local bootstrap PIN. It is never
    /// persisted as plaintext and is ignored after a credential exists.
    pub fn initial_pin(&self) -> Option<String> {
        env_optional("MYMY_INITIAL_PIN")
    }

    pub fn validate_network_security(&self) -> Result<(), String> {
        let bind_host = self.bind_host();
        let loopback = matches!(bind_host.as_str(), "127.0.0.1" | "::1" | "localhost");
        let loopback_publish = env_parse("MYMY_LOOPBACK_PUBLISH", false);
        if loopback || loopback_publish {
            return Ok(());
        }
        if !self.auth_cookie_secure {
            return Err(
                "non-loopback API binding requires AUTH_COOKIE_SECURE=true or an explicitly loopback-only publisher"
                    .to_string(),
            );
        }
        if self.cors_origins.is_empty()
            || self
                .cors_origins
                .iter()
                .any(|origin| !origin.starts_with("https://"))
        {
            return Err(
                "non-loopback API binding requires one or more explicit HTTPS CORS origins"
                    .to_string(),
            );
        }
        Ok(())
    }
}

fn env_string(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_parse<T>(key: &str, default: T) -> T
where
    T: std::str::FromStr,
{
    env::var(key)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn env_parse_positive<T>(key: &str, default: T) -> T
where
    T: std::str::FromStr + PartialOrd + From<u8> + Copy,
{
    env::var(key)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > T::from(0))
        .unwrap_or(default)
}

fn env_optional(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
