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
const MAX_PIN_FAILURE_SOURCE_ROWS: i64 = 10_000;

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

/// Published by older releases and retained only to detect unsafe upgrades.
const LEGACY_DEFAULT_PIN: &str = "mymy";
const MINIMUM_PIN_CHARS: usize = 8;

#[derive(Debug)]
pub struct AuthSession {
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

/// Lock a fresh installation until an explicit initial PIN is supplied, and
/// remediate legacy installations that still use the published credential.
/// `MYMY_INITIAL_PIN` is consumed only for this one-time transition and can be
/// removed from the environment after startup succeeds.
pub async fn initialize_auth_state(db: &PgPool, initial_pin: Option<&str>) -> AppResult<()> {
    let initial_pin = initial_pin.map(str::trim).filter(|pin| !pin.is_empty());
    if let Some(pin) = initial_pin {
        validate_new_pin(pin)?;
    }
    let row = sqlx::query!("SELECT pin_hash, bootstrap_required FROM app_meta WHERE id = true")
        .fetch_optional(db)
        .await?;
    match row {
        None => {
            if let Some(pin) = initial_pin {
                let hash = hash_pin(pin)?;
                sqlx::query!(
                    r#"INSERT INTO app_meta (id, pin_hash, bootstrap_required)
                       VALUES (true, $1, false) ON CONFLICT DO NOTHING"#,
                    hash
                )
                .execute(db)
                .await?;
                clear_pin_failures(db).await?;
                tracing::info!("initialized owner credential from one-time configuration");
            } else {
                tracing::warn!(
                    "authentication is bootstrap-locked; set MYMY_INITIAL_PIN and restart"
                );
            }
        }
        Some(row) if verify_pin(LEGACY_DEFAULT_PIN, &row.pin_hash) => {
            if let Some(pin) = initial_pin {
                let hash = hash_pin(pin)?;
                let mut transaction = db.begin().await?;
                sqlx::query("SELECT id FROM app_meta WHERE id = true FOR UPDATE")
                    .fetch_one(&mut *transaction)
                    .await?;
                crate::services::llm_providers::reencrypt_all_keys_for_pin_in_transaction(
                    &mut transaction,
                    LEGACY_DEFAULT_PIN,
                    pin,
                )
                .await?;
                sqlx::query(
                    r#"UPDATE app_meta
                       SET pin_hash = $1, bootstrap_required = false
                       WHERE id = true"#,
                )
                .bind(hash)
                .execute(&mut *transaction)
                .await?;
                sqlx::query("DELETE FROM auth_sessions")
                    .execute(&mut *transaction)
                    .await?;
                sqlx::query("DELETE FROM auth_pin_failures")
                    .execute(&mut *transaction)
                    .await?;
                sqlx::query("DELETE FROM auth_pin_source_failures")
                    .execute(&mut *transaction)
                    .await?;
                transaction.commit().await?;
                tracing::warn!("replaced legacy default credential and revoked all sessions");
            } else {
                let mut transaction = db.begin().await?;
                sqlx::query("UPDATE app_meta SET bootstrap_required = true WHERE id = true")
                    .execute(&mut *transaction)
                    .await?;
                sqlx::query("DELETE FROM auth_sessions")
                    .execute(&mut *transaction)
                    .await?;
                transaction.commit().await?;
                tracing::warn!(
                    "legacy default credential detected; sessions revoked and bootstrap locked"
                );
            }
        }
        Some(_) => {}
    }
    Ok(())
}

pub async fn auth_initialized(db: &PgPool) -> AppResult<bool> {
    Ok(sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1 FROM app_meta
             WHERE id = true AND bootstrap_required = false
           )"#,
    )
    .fetch_one(db)
    .await?)
}

/// Verify a PIN, apply failure lockout behavior, and create a session on success.
#[cfg(test)]
pub async fn authenticate_pin(db: &PgPool, pin: &str) -> AppResult<Option<AuthSession>> {
    authenticate_pin_from_source(db, pin, "local").await
}

/// Authenticate with a source-scoped failure budget. The raw address is never
/// persisted; purpose hashing keeps operational metadata from becoming a
/// reusable client-identity store.
pub async fn authenticate_pin_from_source(
    db: &PgPool,
    pin: &str,
    source: &str,
) -> AppResult<Option<AuthSession>> {
    let source_hash = pin_failure_bucket(db, &pin_failure_source_hash(source)).await?;
    if pin_lockout_active_for_source(db, &source_hash).await? {
        return Ok(None);
    }

    let mut transaction = db.begin().await?;
    let row = sqlx::query_scalar::<_, String>(
        r#"SELECT pin_hash FROM app_meta
           WHERE id = true AND bootstrap_required = false
           FOR UPDATE"#,
    )
    .fetch_optional(&mut *transaction)
    .await?;

    let valid = match row {
        Some(pin_hash) => verify_pin(pin, &pin_hash),
        None => false,
    };

    if !valid {
        transaction.rollback().await?;
        record_pin_failure_for_source(db, &source_hash).await?;
        return Ok(None);
    }

    crate::services::llm_providers::migrate_legacy_keys_for_pin_in_transaction(
        &mut transaction,
        pin,
    )
    .await?;
    sqlx::query("DELETE FROM auth_pin_source_failures WHERE source_hash = $1")
        .bind(&source_hash)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "DELETE FROM auth_pin_source_failures WHERE updated_at < now() - interval '24 hours'",
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM auth_sessions WHERE expires_at <= now()")
        .execute(&mut *transaction)
        .await?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let expires_at = Utc::now() + Duration::days(SESSION_TTL_DAYS);
    sqlx::query(
        r#"INSERT INTO auth_sessions (token_hash, expires_at)
           VALUES ($1, $2)"#,
    )
    .bind(hash_session_token(&token))
    .bind(expires_at)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(Some(AuthSession { token, expires_at }))
}

/// Change the current PIN after verifying the existing PIN.
pub async fn change_pin(db: &PgPool, current: &str, next: &str) -> AppResult<()> {
    validate_new_pin(next)?;

    let mut transaction = db.begin().await?;
    let pin_hash = sqlx::query_scalar::<_, String>(
        "SELECT pin_hash FROM app_meta WHERE id = true AND bootstrap_required = false FOR UPDATE",
    )
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::Internal("app_meta not initialized".to_string()))?;

    if !verify_pin(current, &pin_hash) {
        return Err(AppError::Unauthorized(
            "current PIN is incorrect".to_string(),
        ));
    }

    crate::services::llm_providers::reencrypt_all_keys_for_pin_in_transaction(
        &mut transaction,
        current,
        next,
    )
    .await?;
    let new_hash = hash_pin(next)?;
    sqlx::query("UPDATE app_meta SET pin_hash = $1, bootstrap_required = false WHERE id = true")
        .bind(new_hash)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM auth_sessions")
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

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

fn validate_new_pin(pin: &str) -> AppResult<()> {
    if pin.chars().count() < MINIMUM_PIN_CHARS || pin == LEGACY_DEFAULT_PIN {
        return Err(AppError::BadRequest(format!(
            "new PIN must contain at least {MINIMUM_PIN_CHARS} characters and cannot use the legacy default"
        )));
    }
    Ok(())
}

/// Create a new server-side session and return the raw cookie token.
#[cfg(test)]
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

pub async fn verify_recent_session_token(
    db: &PgPool,
    token: &str,
    maximum_age_minutes: i32,
) -> AppResult<bool> {
    if token.trim().is_empty() || maximum_age_minutes <= 0 {
        return Ok(false);
    }
    let token_hash = hash_session_token(token);
    Ok(sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
             SELECT 1 FROM auth_sessions
             WHERE token_hash = $1 AND expires_at > now()
               AND created_at >= now() - make_interval(mins => $2)
           )"#,
    )
    .bind(token_hash)
    .bind(maximum_age_minutes)
    .fetch_one(db)
    .await?)
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

/// Derive a public, purpose-separated namespace for browser-local sensitive
/// state. The raw cookie remains HttpOnly and authoritative; this identifier
/// only prevents one authenticated session from discovering another session's
/// recovery records after logout or account-boundary changes.
pub fn recovery_scope_for_session(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"mymy-browser-recovery-scope-v1\0");
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
async fn cleanup_expired_sessions(db: &PgPool) -> AppResult<()> {
    sqlx::query("DELETE FROM auth_sessions WHERE expires_at <= now()")
        .execute(db)
        .await?;
    Ok(())
}

#[cfg(test)]
pub async fn pin_lockout_active(db: &PgPool) -> AppResult<bool> {
    pin_lockout_active_for_source(db, &pin_failure_source_hash("local")).await
}

async fn pin_lockout_active_for_source(db: &PgPool, source_hash: &str) -> AppResult<bool> {
    let locked_until = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        r#"SELECT locked_until FROM auth_pin_source_failures WHERE source_hash = $1"#,
    )
    .bind(source_hash)
    .fetch_optional(db)
    .await?
    .flatten();
    Ok(matches!(locked_until, Some(until) if until > Utc::now()))
}

async fn pin_failure_bucket(db: &PgPool, requested_hash: &str) -> AppResult<String> {
    sqlx::query(
        "DELETE FROM auth_pin_source_failures WHERE updated_at < now() - interval '24 hours'",
    )
    .execute(db)
    .await?;
    let (known, count) = sqlx::query_as::<_, (bool, i64)>(
        r#"SELECT EXISTS(
               SELECT 1 FROM auth_pin_source_failures WHERE source_hash = $1
           ), COUNT(*) FROM auth_pin_source_failures"#,
    )
    .bind(requested_hash)
    .fetch_one(db)
    .await?;
    if known || count < MAX_PIN_FAILURE_SOURCE_ROWS {
        return Ok(requested_hash.to_string());
    }
    // A distributed source-rotation attack must not grow authentication state
    // without bound. Excess unseen sources share a purpose-separated overflow
    // budget, while already tracked owner sources retain independent access.
    Ok(pin_failure_source_hash("overflow-source-budget"))
}

#[cfg(test)]
pub async fn record_pin_failure(db: &PgPool) -> AppResult<()> {
    record_pin_failure_for_source(db, &pin_failure_source_hash("local")).await
}

async fn record_pin_failure_for_source(db: &PgPool, source_hash: &str) -> AppResult<()> {
    let row = sqlx::query!(
        r#"SELECT failed_count, locked_until
           FROM auth_pin_source_failures
           WHERE source_hash = $1"#,
        source_hash,
    )
    .fetch_optional(db)
    .await?;

    let now = Utc::now();
    let current_count = row.as_ref().map(|r| r.failed_count).unwrap_or(0);
    let current_lock = row.as_ref().and_then(|r| r.locked_until);
    let next = next_pin_failure_state(now, current_count, current_lock);

    sqlx::query!(
        r#"INSERT INTO auth_pin_source_failures
           (source_hash, failed_count, locked_until, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (source_hash) DO UPDATE SET
             failed_count = EXCLUDED.failed_count,
             locked_until = EXCLUDED.locked_until,
             updated_at = now()"#,
        source_hash,
        next.failed_count,
        next.locked_until,
    )
    .execute(db)
    .await?;

    Ok(())
}

pub async fn clear_pin_failures(db: &PgPool) -> AppResult<()> {
    sqlx::query("DELETE FROM auth_pin_source_failures")
        .execute(db)
        .await?;
    Ok(())
}

fn pin_failure_source_hash(source: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"mymy-pin-failure-source-v1\0");
    hasher.update(source.as_bytes());
    hex::encode(hasher.finalize())
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
    fn browser_recovery_scope_is_stable_and_purpose_separated() {
        let token = "high-entropy-session-token";
        let scope = recovery_scope_for_session(token);
        assert_eq!(scope, recovery_scope_for_session(token));
        assert_ne!(scope, hash_session_token(token));
        assert_ne!(scope, recovery_scope_for_session("another-session-token"));
        assert!(!scope.contains(token));
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
        assert!(verify_recent_session_token(&pool, &session.token, 15)
            .await
            .expect("fresh session should satisfy step-up policy"));

        sqlx::query("UPDATE auth_sessions SET created_at = now() - interval '16 minutes'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!verify_recent_session_token(&pool, &session.token, 15)
            .await
            .expect("old session should not satisfy step-up policy"));

        revoke_session(&pool, &session.token)
            .await
            .expect("session should be revoked");

        assert!(!verify_session_token(&pool, &session.token)
            .await
            .expect("revoked session verification should query DB"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn fresh_install_stays_locked_without_explicit_owner_pin(pool: sqlx::PgPool) {
        initialize_auth_state(&pool, None).await.unwrap();
        assert!(!auth_initialized(&pool).await.unwrap());
        assert!(authenticate_pin(&pool, LEGACY_DEFAULT_PIN)
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM app_meta")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn explicit_owner_pin_initializes_once_and_authenticates(pool: sqlx::PgPool) {
        let pin = "private-owner-pin";
        initialize_auth_state(&pool, Some(pin)).await.unwrap();
        assert!(auth_initialized(&pool).await.unwrap());
        assert!(authenticate_pin(&pool, pin).await.unwrap().is_some());

        initialize_auth_state(&pool, Some("different-owner-pin"))
            .await
            .unwrap();
        assert!(authenticate_pin(&pool, pin).await.unwrap().is_some());
        assert!(authenticate_pin(&pool, "different-owner-pin")
            .await
            .unwrap()
            .is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn successful_login_atomically_upgrades_legacy_credential_kdf(pool: sqlx::PgPool) {
        let pin = "legacy-upgrade-owner-pin";
        initialize_auth_state(&pool, Some(pin)).await.unwrap();
        let legacy_key = crate::agent::crypto::derive_legacy_key(pin);
        let encrypted = crate::agent::crypto::encrypt_api_key(&legacy_key, "provider-secret")
            .expect("legacy fixture encryption");
        sqlx::query(
            r#"INSERT INTO llm_providers
               (label, api_format, base_url, encrypted_key, key_nonce, model,
                key_derivation_version)
               VALUES ('legacy', 'openai', 'https://example.invalid', $1, $2,
                       'model', 1)"#,
        )
        .bind(encrypted.ciphertext_hex)
        .bind(encrypted.nonce_hex)
        .execute(&pool)
        .await
        .unwrap();

        assert!(authenticate_pin_from_source(&pool, pin, "login-upgrade")
            .await
            .unwrap()
            .is_some());
        let row = sqlx::query_as::<_, (String, String, i16)>(
            "SELECT encrypted_key, key_nonce, key_derivation_version FROM llm_providers",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.2, 2);
        assert_eq!(
            crate::agent::crypto::decrypt_api_key(
                &crate::agent::crypto::derive_key(pin),
                &crate::agent::crypto::EncryptedKey {
                    ciphertext_hex: row.0,
                    nonce_hex: row.1,
                },
            )
            .unwrap(),
            "provider-secret"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn pin_rotation_rolls_back_credential_and_session_changes_on_decryption_failure(
        pool: sqlx::PgPool,
    ) {
        let current = "current-owner-pin";
        let next = "replacement-owner-pin";
        sqlx::query("INSERT INTO app_meta (id, pin_hash) VALUES (true, $1)")
            .bind(hash_pin(current).unwrap())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            r#"INSERT INTO llm_providers
               (label, api_format, base_url, encrypted_key, key_nonce, model)
               VALUES ('corrupt', 'openai', 'https://example.invalid', 'not-hex', 'not-hex', 'model')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let session = create_session(&pool).await.unwrap();

        assert!(change_pin(&pool, current, next).await.is_err());
        assert!(verify_session_token(&pool, &session.token).await.unwrap());
        let persisted_hash =
            sqlx::query_scalar::<_, String>("SELECT pin_hash FROM app_meta WHERE id = true")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(verify_pin(current, &persisted_hash));
        assert!(!verify_pin(next, &persisted_hash));
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT encrypted_key FROM llm_providers")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "not-hex"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn login_waiting_behind_pin_rotation_cannot_create_an_old_pin_session(
        pool: sqlx::PgPool,
    ) {
        let current = "serialized-current-pin";
        let next = "serialized-replacement-pin";
        initialize_auth_state(&pool, Some(current)).await.unwrap();
        let mut rotation = pool.begin().await.unwrap();
        sqlx::query("SELECT id FROM app_meta WHERE id = true FOR UPDATE")
            .fetch_one(&mut *rotation)
            .await
            .unwrap();

        let login_pool = pool.clone();
        let waiting_login = tokio::spawn(async move {
            authenticate_pin_from_source(&login_pool, current, "rotation-race")
                .await
                .unwrap()
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        sqlx::query("UPDATE app_meta SET pin_hash = $1 WHERE id = true")
            .bind(hash_pin(next).unwrap())
            .execute(&mut *rotation)
            .await
            .unwrap();
        sqlx::query("DELETE FROM auth_sessions")
            .execute(&mut *rotation)
            .await
            .unwrap();
        rotation.commit().await.unwrap();

        assert!(waiting_login.await.unwrap().is_none());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM auth_sessions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        assert!(authenticate_pin_from_source(&pool, next, "rotation-race")
            .await
            .unwrap()
            .is_some());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn legacy_default_is_locked_and_sessions_are_revoked_until_remediated(
        pool: sqlx::PgPool,
    ) {
        let legacy_hash = hash_pin(LEGACY_DEFAULT_PIN).unwrap();
        sqlx::query("INSERT INTO app_meta (id, pin_hash) VALUES (true, $1)")
            .bind(legacy_hash)
            .execute(&pool)
            .await
            .unwrap();
        let old_session = create_session(&pool).await.unwrap();

        initialize_auth_state(&pool, None).await.unwrap();
        assert!(!auth_initialized(&pool).await.unwrap());
        assert!(!verify_session_token(&pool, &old_session.token)
            .await
            .unwrap());
        assert!(authenticate_pin(&pool, LEGACY_DEFAULT_PIN)
            .await
            .unwrap()
            .is_none());

        let replacement = "replacement-owner-pin";
        initialize_auth_state(&pool, Some(replacement))
            .await
            .unwrap();
        assert!(auth_initialized(&pool).await.unwrap());
        assert!(authenticate_pin(&pool, replacement)
            .await
            .unwrap()
            .is_some());
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

    #[sqlx::test(migrations = "./migrations")]
    async fn pin_failure_lockout_does_not_let_one_source_deny_another(pool: sqlx::PgPool) {
        let pin = "source-isolated-owner-pin";
        initialize_auth_state(&pool, Some(pin)).await.unwrap();

        for _ in 0..MAX_PIN_FAILURES {
            assert!(
                authenticate_pin_from_source(&pool, "wrong-pin", "192.0.2.10")
                    .await
                    .unwrap()
                    .is_none()
            );
        }

        assert!(authenticate_pin_from_source(&pool, pin, "192.0.2.10")
            .await
            .unwrap()
            .is_none());
        assert!(authenticate_pin_from_source(&pool, pin, "192.0.2.11")
            .await
            .unwrap()
            .is_some());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM auth_pin_source_failures")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }
}
