//! Canonical identity and version comparison for durable approvals.
//!
//! Proposed actions are hashed from their complete JSON value, while resource
//! versions accept exact opaque fingerprints and normalized RFC3339 instants.
//! Keeping both rules pure makes stale-approval behavior deterministic.

use chrono::DateTime;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub(super) fn versions_equal(expected: &str, current: &str) -> bool {
    match (
        DateTime::parse_from_rfc3339(expected),
        DateTime::parse_from_rfc3339(current),
    ) {
        (Ok(expected), Ok(current)) => expected == current,
        _ => expected == current,
    }
}

pub(super) fn hash_value(value: &Value) -> Result<String, String> {
    let bytes = serde_json::to_vec(value).map_err(|err| err.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equivalent_rfc3339_offsets_compare_as_the_same_instant() {
        assert!(versions_equal(
            "2026-07-11T10:00:00+09:00",
            "2026-07-11T01:00:00Z"
        ));
    }

    #[test]
    fn action_hash_changes_with_target_version() {
        let first = hash_value(&serde_json::json!({ "id": "a", "version": 1 })).unwrap();
        let second = hash_value(&serde_json::json!({ "id": "a", "version": 2 })).unwrap();
        assert_ne!(first, second);
    }
}
