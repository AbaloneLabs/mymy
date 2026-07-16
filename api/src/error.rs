//! Unified error type mapping domain errors to HTTP responses.

use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("resource not found: {0}")]
    NotFound(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("unauthorized: {0}")]
    Unauthorized(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("payload too large: {0}")]
    PayloadTooLarge(String),

    #[error("unsupported media: {0}")]
    UnsupportedMedia(String),

    #[error("service unavailable: {0}")]
    ServiceUnavailable(String),

    #[error("{message}")]
    Coded {
        code: &'static str,
        status: StatusCode,
        message: String,
        retryable: bool,
    },

    #[error("internal error: {0}")]
    Internal(String),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message, retryable) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "not_found", msg.clone(), false),
            AppError::BadRequest(msg) => {
                (StatusCode::BAD_REQUEST, "bad_request", msg.clone(), false)
            }
            AppError::Unauthorized(msg) => {
                (StatusCode::UNAUTHORIZED, "unauthorized", msg.clone(), false)
            }
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "conflict", msg.clone(), false),
            AppError::PayloadTooLarge(msg) => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                msg.clone(),
                false,
            ),
            AppError::UnsupportedMedia(msg) => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media",
                msg.clone(),
                false,
            ),
            AppError::ServiceUnavailable(msg) => {
                tracing::warn!(error = %msg, "service unavailable");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "service_unavailable",
                    msg.clone(),
                    true,
                )
            }
            AppError::Coded {
                code,
                status,
                message,
                retryable,
            } => (*status, *code, message.clone(), *retryable),
            AppError::Internal(msg) => {
                tracing::error!(error = %msg, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    msg.clone(),
                    false,
                )
            }
            AppError::Database(e) => {
                tracing::error!(error = ?e, "database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "database_error",
                    "database error".to_string(),
                    false,
                )
            }
            AppError::Io(e) => {
                tracing::error!(error = ?e, "io error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "io_error",
                    "io error".to_string(),
                    false,
                )
            }
        };

        let mut response = if retryable {
            (
                status,
                Json(json!({ "error": message, "code": code, "retryable": true })),
            )
                .into_response()
        } else {
            (status, Json(json!({ "error": message, "code": code }))).into_response()
        };
        if retryable {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
        }
        response
    }
}

impl AppError {
    pub fn coded(code: &'static str, status: StatusCode, message: impl Into<String>) -> Self {
        Self::Coded {
            code,
            status,
            message: message.into(),
            retryable: false,
        }
    }

    pub fn content_quarantined() -> Self {
        Self::coded(
            "content_quarantined",
            StatusCode::LOCKED,
            "This file is suspicious and remains outside visible storage until the separate quarantine review lifecycle completes.",
        )
    }

    pub fn content_rejected() -> Self {
        Self::coded(
            "content_rejected",
            StatusCode::UNPROCESSABLE_ENTITY,
            "The file does not pass the current content policy.",
        )
    }

    pub fn quarantine_capacity_exceeded() -> Self {
        Self::coded(
            "quarantine_capacity_exceeded",
            StatusCode::INSUFFICIENT_STORAGE,
            "Pending content review storage is full.",
        )
    }

    pub fn stale_quarantine_version() -> Self {
        Self::coded(
            "stale_quarantine_version",
            StatusCode::CONFLICT,
            "This review item changed in another session.",
        )
    }

    pub fn quarantine_destination_conflict() -> Self {
        Self::coded(
            "quarantine_destination_conflict",
            StatusCode::CONFLICT,
            "A file already exists at the requested destination.",
        )
    }

    pub fn content_policy_changed() -> Self {
        Self::coded(
            "content_policy_changed",
            StatusCode::UNPROCESSABLE_ENTITY,
            "The file cannot be released under the current content policy.",
        )
    }

    pub fn drive_hardlink_rejected() -> Self {
        Self::coded(
            "drive_hardlink_rejected",
            StatusCode::LOCKED,
            "This Drive file has multiple filesystem links and cannot be accessed or replaced safely.",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn service_unavailable_is_explicitly_retryable() {
        let response = AppError::ServiceUnavailable("capacity unavailable".into()).into_response();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers().get(header::RETRY_AFTER).unwrap(), "1");
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["retryable"], true);
    }
}
