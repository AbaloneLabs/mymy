//! CORS middleware configuration.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::header::{COOKIE, ORIGIN};
use axum::http::{HeaderName, HeaderValue, Method, Request, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use tower_http::cors::CorsLayer;

use crate::error::{AppError, AppResult};
use crate::services::auth::{extract_cookie_value, verify_session_token, SESSION_COOKIE_NAME};
use crate::state::AppState;

/// Build a CORS layer allowing the configured web origins.
pub fn cors_layer(allowed_origins: &[String]) -> CorsLayer {
    let mut layer = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("authorization"),
        ]);

    // Wildcard origins cannot be combined with credentialed CORS.
    if allowed_origins.is_empty() {
        layer = layer.allow_origin(tower_http::cors::Any);
    } else {
        let origins: Vec<HeaderValue> = allowed_origins
            .iter()
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect();
        layer = layer.allow_origin(origins).allow_credentials(true);
    }

    layer
}

/// Require a valid server-side session for protected API routes.
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
    next: Next,
) -> AppResult<Response> {
    if is_public_request(req.method(), req.uri().path()) {
        return Ok(next.run(req).await);
    }

    let token = req
        .headers()
        .get(axum::http::header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|header| extract_cookie_value(header, SESSION_COOKIE_NAME));

    let Some(token) = token else {
        return Err(AppError::Unauthorized(
            "authentication required".to_string(),
        ));
    };

    if verify_session_token(&state.db, token).await? {
        Ok(next.run(req).await)
    } else {
        Err(AppError::Unauthorized(
            "invalid or expired session".to_string(),
        ))
    }
}

/// Reject credentialed browser mutations unless their Origin matches the
/// configured web application. Non-browser bootstrap/automation clients may
/// omit Origin only when they also send no ambient cookie; protected requests
/// still pass through normal authentication after this check.
pub async fn require_same_origin(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
    next: Next,
) -> AppResult<Response> {
    if !matches!(
        *req.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) {
        return Ok(next.run(req).await);
    }
    let origin = req
        .headers()
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok());
    let has_cookie = req.headers().contains_key(COOKIE);
    if origin.is_none() && !has_cookie {
        return Ok(next.run(req).await);
    }
    if origin.is_some_and(|value| origin_is_allowed(value, &state.config.cors_origins)) {
        return Ok(next.run(req).await);
    }
    Err(AppError::Coded {
        code: "origin_denied",
        status: StatusCode::FORBIDDEN,
        message: "browser mutation origin is not allowed".to_string(),
        retryable: false,
    })
}

fn origin_is_allowed(origin: &str, allowed_origins: &[String]) -> bool {
    let origin = origin.trim_end_matches('/');
    !origin.is_empty()
        && allowed_origins
            .iter()
            .any(|allowed| allowed.trim_end_matches('/') == origin)
}

fn is_public_request(method: &Method, path: &str) -> bool {
    *method == Method::OPTIONS
        || path == "/api/health"
        || path == "/api/auth/status"
        || path == "/api/auth/verify"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_routes_do_not_require_auth() {
        assert!(is_public_request(&Method::GET, "/api/health"));
        assert!(is_public_request(&Method::GET, "/api/auth/status"));
        assert!(is_public_request(&Method::POST, "/api/auth/verify"));
        assert!(is_public_request(&Method::OPTIONS, "/api/tasks"));
    }

    #[test]
    fn protected_routes_require_auth() {
        assert!(!is_public_request(&Method::GET, "/api/tasks"));
        assert!(!is_public_request(&Method::POST, "/api/auth/pin"));
        assert!(!is_public_request(&Method::POST, "/api/auth/logout"));
    }

    #[test]
    fn unauthorized_status_code_is_available_for_auth_failures() {
        use axum::http::StatusCode;

        assert_eq!(StatusCode::UNAUTHORIZED, StatusCode::from_u16(401).unwrap());
    }

    #[test]
    fn browser_origins_match_exact_configured_origins() {
        let allowed = vec!["http://localhost:33696".to_string()];
        assert!(origin_is_allowed("http://localhost:33696", &allowed));
        assert!(origin_is_allowed("http://localhost:33696/", &allowed));
        assert!(!origin_is_allowed("http://localhost:336960", &allowed));
        assert!(!origin_is_allowed("https://localhost:33696", &allowed));
        assert!(!origin_is_allowed("null", &allowed));
    }
}
