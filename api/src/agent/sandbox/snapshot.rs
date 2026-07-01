//! Session snapshot model for local execution.
//!
//! The current local backend starts a fresh process for every execution, so it
//! does not restore shell aliases or functions yet. Keeping the snapshot type
//! explicit documents the boundary needed by persistent shell backends.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionSnapshot {
    pub env: BTreeMap<String, String>,
    pub aliases: BTreeMap<String, String>,
    pub functions: BTreeMap<String, String>,
}

impl SessionSnapshot {
    pub fn capture_allowed_env() -> Self {
        Self {
            env: crate::agent::sandbox::scrub::scrubbed_env()
                .into_iter()
                .collect::<BTreeMap<_, _>>(),
            aliases: BTreeMap::new(),
            functions: BTreeMap::new(),
        }
    }
}
