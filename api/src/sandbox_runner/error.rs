//! Error type for the sandbox runner HTTP surface.
//!
//! The runner intentionally keeps errors compact and JSON serializable because
//! the API process consumes them over HTTP and turns them into user-facing
//! sandbox errors.

use axum::Json;

#[derive(Debug, thiserror::Error)]
pub(crate) enum RunnerError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("unavailable: {0}")]
    Unavailable(String),
    #[error("execution error: {0}")]
    Execution(String),
}

impl axum::response::IntoResponse for RunnerError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            RunnerError::BadRequest(_) => axum::http::StatusCode::BAD_REQUEST,
            RunnerError::NotFound(_) => axum::http::StatusCode::NOT_FOUND,
            RunnerError::Unavailable(_) => axum::http::StatusCode::SERVICE_UNAVAILABLE,
            RunnerError::Execution(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = Json(serde_json::json!({ "error": self.to_string() }));
        (status, body).into_response()
    }
}
