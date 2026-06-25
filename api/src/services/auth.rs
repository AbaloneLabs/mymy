//! Auth service — argon2 PIN hashing, verification, and server-side sessions.

use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

use crate::error::{AppError, AppResult};
use crate::services::audit::log_audit_safe;

pub const SESSION_COOKIE_NAME: &str = "mymy_session";
const SESSION_TTL_DAYS: i64 = 7;
const MAX_PIN_FAILURES: i32 = 5;
const PIN_LOCKOUT_MINUTES: i64 = 5;

/// Hash a plaintext PIN using argon2.
pub fn hash_pin(pin: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("hash failed: {e}")))?;
    Ok(hash.to_string())
}

/// Verify a plaintext PIN against a stored argon2 hash.
pub fn verify_pin(pin: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(pin.as_bytes(), &parsed)
        .is_ok()
}

/// The default PIN seeded on first run.
pub const DEFAULT_PIN: &str = "mymy";

#[derive(Debug)]
pub struct AuthSession {
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

/// Ensure the singleton auth metadata row exists.
pub async fn ensure_pin_initialized(db: &PgPool) -> AppResult<()> {
    let row = sqlx::query!("SELECT pin_hash FROM app_meta WHERE id = true")
        .fetch_optional(db)
        .await?;

    if row.is_some() {
        return Ok(());
    }

    let hash = hash_pin(DEFAULT_PIN)?;
    sqlx::query!(
        "INSERT INTO app_meta (id, pin_hash) VALUES (true, $1) ON CONFLICT DO NOTHING",
        hash
    )
    .execute(db)
    .await?;
    tracing::info!("seeded default PIN on first run");

    Ok(())
}

/// Verify a PIN, apply failure lockout behavior, and create a session on success.
pub async fn authenticate_pin(db: &PgPool, pin: &str) -> AppResult<Option<AuthSession>> {
    if pin_lockout_active(db).await? {
        return Ok(None);
    }

    let row = sqlx::query!("SELECT pin_hash FROM app_meta WHERE id = true")
        .fetch_optional(db)
        .await?;

    let valid = match row {
        Some(row) => verify_pin(pin, &row.pin_hash),
        None => false,
    };

    if !valid {
        record_pin_failure(db).await?;
        return Ok(None);
    }

    clear_pin_failures(db).await?;
    create_session(db).await.map(Some)
}

/// Change the current PIN after verifying the existing PIN.
pub async fn change_pin(db: &PgPool, current: &str, next: &str) -> AppResult<()> {
    if next.len() < 4 {
        return Err(AppError::BadRequest(
            "new PIN must be at least 4 characters".to_string(),
        ));
    }

    let row = sqlx::query!("SELECT pin_hash FROM app_meta WHERE id = true")
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::Internal("app_meta not initialized".to_string()))?;

    if !verify_pin(current, &row.pin_hash) {
        return Err(AppError::Unauthorized(
            "current PIN is incorrect".to_string(),
        ));
    }

    let new_hash = hash_pin(next)?;
    sqlx::query!(
        "UPDATE app_meta SET pin_hash = $1 WHERE id = true",
        new_hash
    )
    .execute(db)
    .await?;

    // Security-sensitive: log that a PIN change occurred, but never include
    // the hash value or plaintext PIN.
    log_audit_safe(
        db,
        "user",
        "user",
        "update",
        "pin",
        None,
        Some(serde_json::json!({ "after": { "changed": true } })),
    )
    .await;

    Ok(())
}

/// Create a new server-side session and return the raw cookie token.
pub async fn create_session(db: &PgPool) -> AppResult<AuthSession> {
    cleanup_expired_sessions(db).await?;

    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let token_hash = hash_session_token(&token);
    let expires_at = Utc::now() + Duration::days(SESSION_TTL_DAYS);

    sqlx::query(
        r#"INSERT INTO auth_sessions (token_hash, expires_at)
           VALUES ($1, $2)"#,
    )
    .bind(token_hash)
    .bind(expires_at)
    .execute(db)
    .await?;

    Ok(AuthSession { token, expires_at })
}

/// Check whether a raw session token matches an unexpired server-side session.
pub async fn verify_session_token(db: &PgPool, token: &str) -> AppResult<bool> {
    if token.trim().is_empty() {
        return Ok(false);
    }

    let token_hash = hash_session_token(token);
    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1 FROM auth_sessions
               WHERE token_hash = $1 AND expires_at > now()
           )"#,
    )
    .bind(token_hash)
    .fetch_one(db)
    .await?;

    Ok(exists)
}

/// Revoke one session token if present.
pub async fn revoke_session(db: &PgPool, token: &str) -> AppResult<()> {
    let token_hash = hash_session_token(token);
    sqlx::query("DELETE FROM auth_sessions WHERE token_hash = $1")
        .bind(token_hash)
        .execute(db)
        .await?;
    Ok(())
}

/// Build the Set-Cookie header value for an active auth session.
pub fn session_cookie(session: &AuthSession, secure: bool) -> String {
    let secure_attr = if secure { "; Secure" } else { "" };
    format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
        SESSION_COOKIE_NAME,
        session.token,
        (session.expires_at - Utc::now()).num_seconds().max(0),
        secure_attr,
    )
}

/// Build the Set-Cookie header value that clears the auth session cookie.
pub fn expired_session_cookie(secure: bool) -> String {
    let secure_attr = if secure { "; Secure" } else { "" };
    format!(
        "{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{}",
        SESSION_COOKIE_NAME, secure_attr,
    )
}

pub fn extract_cookie_value<'a>(cookie_header: &'a str, name: &str) -> Option<&'a str> {
    cookie_header.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == name).then_some(value)
    })
}

fn hash_session_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex::encode(digest)
}

async fn cleanup_expired_sessions(db: &PgPool) -> AppResult<()> {
    sqlx::query("DELETE FROM auth_sessions WHERE expires_at <= now()")
        .execute(db)
        .await?;
    Ok(())
}

pub async fn pin_lockout_active(db: &PgPool) -> AppResult<bool> {
    let locked_until = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        r#"SELECT locked_until FROM auth_pin_failures WHERE id = true"#,
    )
    .fetch_optional(db)
    .await?
    .flatten();
    Ok(matches!(locked_until, Some(until) if until > Utc::now()))
}

pub async fn record_pin_failure(db: &PgPool) -> AppResult<()> {
    let row = sqlx::query!(
        r#"SELECT failed_count, locked_until
           FROM auth_pin_failures
           WHERE id = true"#,
    )
    .fetch_optional(db)
    .await?;

    let now = Utc::now();
    let current_count = row.as_ref().map(|r| r.failed_count).unwrap_or(0);
    let current_lock = row.as_ref().and_then(|r| r.locked_until);
    let next = next_pin_failure_state(now, current_count, current_lock);

    sqlx::query!(
        r#"INSERT INTO auth_pin_failures (id, failed_count, locked_until)
           VALUES (true, $1, $2)
           ON CONFLICT (id) DO UPDATE SET
             failed_count = EXCLUDED.failed_count,
             locked_until = EXCLUDED.locked_until"#,
        next.failed_count,
        next.locked_until,
    )
    .execute(db)
    .await?;

    Ok(())
}

pub async fn clear_pin_failures(db: &PgPool) -> AppResult<()> {
    sqlx::query!(
        r#"INSERT INTO auth_pin_failures (id, failed_count, locked_until)
           VALUES (true, 0, NULL)
           ON CONFLICT (id) DO UPDATE SET failed_count = 0, locked_until = NULL"#
    )
    .execute(db)
    .await?;
    Ok(())
}

#[derive(Debug, PartialEq)]
struct PinFailureState {
    failed_count: i32,
    locked_until: Option<DateTime<Utc>>,
}

fn next_pin_failure_state(
    now: DateTime<Utc>,
    failed_count: i32,
    locked_until: Option<DateTime<Utc>>,
) -> PinFailureState {
    if matches!(locked_until, Some(until) if until > now) {
        return PinFailureState {
            failed_count,
            locked_until,
        };
    }

    let next_count = failed_count.saturating_add(1);
    if next_count >= MAX_PIN_FAILURES {
        PinFailureState {
            failed_count: next_count,
            locked_until: Some(now + Duration::minutes(PIN_LOCKOUT_MINUTES)),
        }
    } else {
        PinFailureState {
            failed_count: next_count,
            locked_until: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_named_cookie_value() {
        let header = "theme=dark; mymy_session=abc123; other=value";
        assert_eq!(
            extract_cookie_value(header, SESSION_COOKIE_NAME),
            Some("abc123"),
        );
    }

    #[test]
    fn expired_cookie_clears_session_cookie() {
        let cookie = expired_session_cookie(false);
        assert!(cookie.starts_with("mymy_session=;"));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("Max-Age=0"));
    }

    #[test]
    fn session_cookie_can_include_secure_attribute() {
        let session = AuthSession {
            token: "token".to_string(),
            expires_at: Utc::now() + Duration::minutes(5),
        };
        assert!(!session_cookie(&session, false).contains("; Secure"));
        assert!(session_cookie(&session, true).contains("; Secure"));
    }

    #[test]
    fn pin_failure_state_locks_after_max_failures() {
        let now = Utc::now();
        let state = next_pin_failure_state(now, MAX_PIN_FAILURES - 1, None);
        assert_eq!(state.failed_count, MAX_PIN_FAILURES);
        assert!(state.locked_until.is_some());
    }

    #[test]
    fn pin_failure_state_preserves_active_lockout() {
        let now = Utc::now();
        let locked_until = now + Duration::minutes(1);
        let state = next_pin_failure_state(now, 8, Some(locked_until));
        assert_eq!(
            state,
            PinFailureState {
                failed_count: 8,
                locked_until: Some(locked_until)
            }
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn db_session_lifecycle_verifies_and_revokes_token(pool: sqlx::PgPool) {
        let session = create_session(&pool)
            .await
            .expect("session should be created");

        assert!(verify_session_token(&pool, &session.token)
            .await
            .expect("session verification should query DB"));

        revoke_session(&pool, &session.token)
            .await
            .expect("session should be revoked");

        assert!(!verify_session_token(&pool, &session.token)
            .await
            .expect("revoked session verification should query DB"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn db_pin_failure_lockout_clears_after_valid_pin(pool: sqlx::PgPool) {
        clear_pin_failures(&pool)
            .await
            .expect("pin failures should be reset");

        for _ in 0..MAX_PIN_FAILURES {
            record_pin_failure(&pool)
                .await
                .expect("pin failure should be recorded");
        }

        assert!(pin_lockout_active(&pool)
            .await
            .expect("lockout state should query DB"));

        clear_pin_failures(&pool)
            .await
            .expect("pin failures should clear after valid PIN");

        assert!(!pin_lockout_active(&pool)
            .await
            .expect("cleared lockout state should query DB"));
    }
}
