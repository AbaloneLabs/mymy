//! Filesystem guardrails for agent tools.
//!
//! These checks are defense in depth. They are not a sandbox, but they stop
//! accidental reads/writes of common credential stores and give the model a
//! visible error instead of a secret.

use std::path::{Component, Path};

use crate::agent::tools::ToolError;

const SENSITIVE_NAMES: &[&str] = &[
    ".env",
    ".envrc",
    ".bash_profile",
    ".bashrc",
    ".profile",
    ".zprofile",
    ".zshrc",
    ".npmrc",
    ".pypirc",
    ".git-credentials",
    ".anthropic_oauth.json",
    ".netrc",
    ".pgpass",
    "auth.json",
    "auth.lock",
    "google_oauth.json",
    "webhook_subscriptions.json",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "authorized_keys",
    "known_hosts",
    "credentials",
    "credentials.json",
];

const SENSITIVE_DIRS: &[&str] = &[
    ".ssh",
    ".aws",
    ".azure",
    ".docker",
    ".gnupg",
    ".kube",
    "mcp-tokens",
    "pairing",
];

pub fn ensure_read_allowed(path: &Path) -> Result<(), ToolError> {
    if is_sensitive_path(path) {
        return Err(ToolError::Coded {
            code: "protected_path_denied",
            message: "reading a protected credential path is blocked".to_string(),
        });
    }
    Ok(())
}

pub fn ensure_write_allowed(path: &Path) -> Result<(), ToolError> {
    if is_sensitive_path(path) {
        return Err(ToolError::Coded {
            code: "protected_path_denied",
            message: "writing a protected credential path is blocked".to_string(),
        });
    }
    Ok(())
}

pub fn is_sensitive_path(path: &Path) -> bool {
    let mut in_sensitive_dir = false;
    for component in path.components() {
        let Component::Normal(part) = component else {
            continue;
        };
        let value = part.to_string_lossy();
        if SENSITIVE_DIRS.iter().any(|dir| value == *dir) {
            in_sensitive_dir = true;
        }
        if SENSITIVE_NAMES.iter().any(|name| value == *name) {
            return true;
        }
        if value.starts_with(".env.") && !is_env_template(&value) {
            return true;
        }
        if value.ends_with(".pem") || value.ends_with(".key") {
            return true;
        }
    }
    in_sensitive_dir
}

fn is_env_template(value: &str) -> bool {
    matches!(
        value,
        ".env.example" | ".env.sample" | ".env.template" | ".env.defaults"
    ) || value.ends_with(".example")
        || value.ends_with(".sample")
        || value.ends_with(".template")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_common_credential_paths() {
        assert!(is_sensitive_path(Path::new("/workspace/.env")));
        assert!(is_sensitive_path(Path::new("/workspace/.env.local")));
        assert!(is_sensitive_path(Path::new("/workspace/.ssh/id_ed25519")));
        assert!(is_sensitive_path(Path::new("/workspace/cert.pem")));
        assert!(!is_sensitive_path(Path::new("/workspace/.env.example")));
        assert!(!is_sensitive_path(Path::new(
            "/workspace/.env.production.example"
        )));
    }

    #[test]
    fn allows_regular_source_paths() {
        assert!(!is_sensitive_path(Path::new("/workspace/src/main.rs")));
    }
}
