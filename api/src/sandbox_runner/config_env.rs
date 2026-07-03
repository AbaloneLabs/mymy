//! Environment parsing helpers for the sandbox runner.
//!
//! The runner is configured almost entirely through environment variables
//! because it may run as a sidecar container, a local development process, or a
//! privileged Firecracker host process. Keeping parsing small and explicit here
//! avoids spreading stringly-typed configuration across backend code.

use std::path::PathBuf;

pub(crate) fn path(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub(crate) fn u32(key: &str) -> Option<u32> {
    std::env::var(key).ok().and_then(|value| value.parse().ok())
}

pub(crate) fn u8(key: &str) -> Option<u8> {
    std::env::var(key).ok().and_then(|value| value.parse().ok())
}

pub(crate) fn u64(key: &str) -> Option<u64> {
    std::env::var(key).ok().and_then(|value| value.parse().ok())
}

pub(crate) fn flag(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}
