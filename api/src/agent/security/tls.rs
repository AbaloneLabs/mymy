//! TLS/CA bundle startup validation.
//!
//! HTTP clients will do certificate validation during requests. This guard
//! catches broken CA bundle environment variables before the first provider or
//! webhook call fails with a less actionable transport error.

use std::path::Path;

const CA_BUNDLE_ENV_VARS: &[&str] = &[
    "MYMY_CA_BUNDLE",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
];

#[derive(Debug, thiserror::Error)]
pub enum TlsConfigError {
    #[error("{env_var} points to a missing CA bundle: {path}")]
    Missing { env_var: String, path: String },
    #[error("{env_var} must point to a CA bundle file, not a directory: {path}")]
    NotFile { env_var: String, path: String },
    #[error("{env_var} points to an empty CA bundle: {path}")]
    Empty { env_var: String, path: String },
}

pub fn verify_ca_bundle() -> Result<(), TlsConfigError> {
    for env_var in CA_BUNDLE_ENV_VARS {
        let Ok(path) = std::env::var(env_var) else {
            continue;
        };
        validate_bundle(env_var, &path)?;
    }
    Ok(())
}

fn validate_bundle(env_var: &str, path: &str) -> Result<(), TlsConfigError> {
    let path_ref = Path::new(path);
    if !path_ref.exists() {
        return Err(TlsConfigError::Missing {
            env_var: env_var.to_string(),
            path: path.to_string(),
        });
    }
    let metadata = std::fs::metadata(path_ref).map_err(|_| TlsConfigError::Missing {
        env_var: env_var.to_string(),
        path: path.to_string(),
    })?;
    if !metadata.is_file() {
        return Err(TlsConfigError::NotFile {
            env_var: env_var.to_string(),
            path: path.to_string(),
        });
    }
    if metadata.len() == 0 {
        return Err(TlsConfigError::Empty {
            env_var: env_var.to_string(),
            path: path.to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_bundle_reports_env_var() {
        let err = validate_bundle("SSL_CERT_FILE", "/definitely/not/here.pem").unwrap_err();
        assert!(err.to_string().contains("SSL_CERT_FILE"));
    }
}
