//! Auth (PIN) handlers.
//!
//! - GET  /api/auth/status  → check whether explicit owner bootstrap completed
//! - POST /api/auth/verify  → verify PIN and create a server-side session
//! - POST /api/auth/logout  → clear the current server-side session
//! - POST /api/auth/pin     → change PIN

use std::{convert::Infallible, net::SocketAddr, sync::Arc};

use axum::extract::{ConnectInfo, FromRequestParts, State};
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{request::Parts, HeaderMap, HeaderValue};
use axum::routing::{get, post};
use axum::Json;
use axum::Router;

use crate::agent::crypto;
use crate::error::{AppError, AppResult};
use crate::models::auth::{
    AuthStatusResponse, LogoutResponse, PinChangeRequest, PinChangeResponse, PinVerifyRequest,
    PinVerifyResponse,
};
use crate::services::auth::{
    auth_initialized, authenticate_pin_from_source, change_pin, expired_session_cookie,
    extract_cookie_value, recovery_scope_for_session, revoke_session, session_cookie,
    verify_session_token, SESSION_COOKIE_NAME,
};
use crate::state::AppState;

pub struct ClientSource(String);

impl<S> FromRequestParts<S> for ClientSource
where
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let source = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(address)| address.ip().to_string())
            .unwrap_or_else(|| "local-test-harness".to_string());
        Ok(Self(source))
    }
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/auth/status", get(auth_status))
        .route("/api/auth/verify", post(auth_verify))
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/auth/pin", post(auth_change_pin))
}

/// GET /api/auth/status
///
/// Returns whether explicit owner bootstrap has initialized a non-default PIN.
pub async fn auth_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> AppResult<Json<AuthStatusResponse>> {
    let initialized = auth_initialized(&state.db).await?;
    // A valid cookie is not enough after a server restart because encrypted
    // LLM provider keys require the PIN-derived key that only exists in
    // memory after an explicit PIN verification. Treat that state as locked
    // so provider setup does not fail later with a confusing 401.
    let token = session_token(&headers);
    let authenticated = initialized
        && match token {
            Some(token) => {
                verify_session_token(&state.db, token).await?
                    && state.encryption_key.read().await.is_some()
            }
            None => false,
        };

    Ok(Json(AuthStatusResponse {
        initialized,
        authenticated,
        recovery_scope_id: authenticated
            .then(|| recovery_scope_for_session(token.expect("authenticated token exists"))),
    }))
}

/// POST /api/auth/verify
pub async fn auth_verify(
    State(state): State<Arc<AppState>>,
    ClientSource(source): ClientSource,
    Json(req): Json<PinVerifyRequest>,
) -> AppResult<(HeaderMap, Json<PinVerifyResponse>)> {
    let session = authenticate_pin_from_source(&state.db, &req.pin, &source).await?;
    let valid = session.is_some();

    let mut headers = HeaderMap::new();
    let recovery_scope_id = session
        .as_ref()
        .map(|session| recovery_scope_for_session(&session.token));
    if let Some(session) = session {
        // Cache the HKDF-derived encryption key for this session so that
        // API key encrypt/decrypt operations don't need to re-prompt for PIN.
        let enc_key = crypto::derive_key(&req.pin);
        *state.encryption_key.write().await = Some(enc_key);
        state.agent_run_notify.notify_waiters();

        headers.insert(
            SET_COOKIE,
            HeaderValue::from_str(&session_cookie(&session, state.config.auth_cookie_secure))
                .map_err(|e| AppError::Internal(format!("invalid session cookie: {e}")))?,
        );
    }

    Ok((
        headers,
        Json(PinVerifyResponse {
            valid,
            authenticated: valid,
            recovery_scope_id,
        }),
    ))
}

/// POST /api/auth/logout
pub async fn auth_logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> AppResult<(HeaderMap, Json<LogoutResponse>)> {
    if let Some(token) = session_token(&headers) {
        revoke_session(&state.db, token).await?;
    }

    // Clear the cached encryption key on logout.
    *state.encryption_key.write().await = None;

    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        SET_COOKIE,
        HeaderValue::from_str(&expired_session_cookie(state.config.auth_cookie_secure))
            .map_err(|e| AppError::Internal(format!("invalid session cookie: {e}")))?,
    );

    Ok((response_headers, Json(LogoutResponse { success: true })))
}

/// POST /api/auth/pin
pub async fn auth_change_pin(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PinChangeRequest>,
) -> AppResult<(HeaderMap, Json<PinChangeResponse>)> {
    // The service verifies the current credential and atomically rotates every
    // encrypted provider key, the PIN hash, and all active sessions.
    change_pin(&state.db, &req.current, &req.next).await?;

    // PIN rotation revokes every session. Keep no derived key active until the
    // owner explicitly authenticates again under the new credential.
    *state.encryption_key.write().await = None;
    state.agent_run_notify.notify_waiters();

    let mut headers = HeaderMap::new();
    headers.insert(
        SET_COOKIE,
        HeaderValue::from_str(&expired_session_cookie(state.config.auth_cookie_secure))
            .map_err(|e| AppError::Internal(format!("invalid session cookie: {e}")))?,
    );
    Ok((headers, Json(PinChangeResponse { success: true })))
}

fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|header| extract_cookie_value(header, SESSION_COOKIE_NAME))
}
