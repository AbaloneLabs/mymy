//! Environment configuration loaded at startup.

use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    /// Comma-separated list of allowed CORS origins.
    pub cors_origins: Vec<String>,
    /// Whether auth cookies should include the Secure attribute.
    pub auth_cookie_secure: bool,
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

        let auth_cookie_secure = env::var("AUTH_COOKIE_SECURE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(false);

        Self {
            database_url,
            port,
            cors_origins,
            auth_cookie_secure,
        }
    }
}
