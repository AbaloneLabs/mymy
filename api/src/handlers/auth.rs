//! Auth (PIN) handlers.
//!
//! - GET  /api/auth/status  → check if PIN initialized (seed "mymy" on first run)
//! - POST /api/auth/verify  → verify PIN and create a server-side session
//! - POST /api/auth/logout  → clear the current server-side session
//! - POST /api/auth/pin     → change PIN

use std::sync::Arc;

use axum::extract::State;
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue};
use axum::routing::{get, post};
use axum::Json;
use axum::Router;

use crate::error::{AppError, AppResult};
use crate::models::auth::{
    AuthStatusResponse, LogoutResponse, PinChangeRequest, PinChangeResponse, PinVerifyRequest,
    PinVerifyResponse,
};
use crate::services::auth::{
    authenticate_pin, change_pin, ensure_pin_initialized, expired_session_cookie,
    extract_cookie_value, revoke_session, session_cookie, verify_session_token,
    SESSION_COOKIE_NAME,
};
use crate::state::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/auth/status", get(auth_status))
        .route("/api/auth/verify", post(auth_verify))
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/auth/pin", post(auth_change_pin))
}

/// GET /api/auth/status
///
/// Returns whether the PIN has been initialized. On the very first call
/// (empty app_meta table), seeds the default PIN "mymy".
pub async fn auth_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> AppResult<Json<AuthStatusResponse>> {
    ensure_pin_initialized(&state.db).await?;
    let authenticated = session_is_valid(&state, &headers).await?;

    Ok(Json(AuthStatusResponse {
        initialized: true,
        authenticated,
    }))
}

/// POST /api/auth/verify
pub async fn auth_verify(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PinVerifyRequest>,
) -> AppResult<(HeaderMap, Json<PinVerifyResponse>)> {
    let session = authenticate_pin(&state.db, &req.pin).await?;
    let valid = session.is_some();

    let mut headers = HeaderMap::new();
    if let Some(session) = session {
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
) -> AppResult<Json<PinChangeResponse>> {
    change_pin(&state.db, &req.current, &req.next).await?;
    Ok(Json(PinChangeResponse { success: true }))
}

async fn session_is_valid(state: &AppState, headers: &HeaderMap) -> AppResult<bool> {
    let Some(token) = session_token(headers) else {
        return Ok(false);
    };
    verify_session_token(&state.db, token).await
}

fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|header| extract_cookie_value(header, SESSION_COOKIE_NAME))
}
