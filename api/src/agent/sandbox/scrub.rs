//! Environment scrubbing for code execution.
//!
//! The allowlist keeps interpreter startup practical while preventing common
//! secret-bearing variables from crossing into user code. This is defense in
//! depth; the tool also redacts captured output before it is returned.

use std::collections::HashMap;

const SAFE_KEYS: &[&str] = &["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];
const SAFE_PREFIXES: &[&str] = &["PYTHON", "RUST_BACKTRACE"];
const SECRET_MARKERS: &[&str] = &[
    "API_KEY",
    "AUTH",
    "COOKIE",
    "CREDENTIAL",
    "PASSWORD",
    "SECRET",
    "SESSION",
    "TOKEN",
];

pub fn scrubbed_env() -> HashMap<String, String> {
    let mut env = HashMap::new();
    for (key, value) in std::env::vars() {
        if is_safe_env_key(&key) {
            env.insert(key, value);
        }
    }
    env.insert("PYTHONNOUSERSITE".to_string(), "1".to_string());
    env
}

fn is_safe_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    if SECRET_MARKERS.iter().any(|marker| upper.contains(marker)) {
        return false;
    }
    SAFE_KEYS.contains(&upper.as_str())
        || SAFE_PREFIXES
            .iter()
            .any(|prefix| upper == *prefix || upper.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_key_filter_blocks_secret_names() {
        assert!(!is_safe_env_key("OPENAI_API_KEY"));
        assert!(!is_safe_env_key("SESSION_COOKIE"));
        assert!(is_safe_env_key("PATH"));
        assert!(is_safe_env_key("PYTHONNOUSERSITE"));
    }

    #[test]
    fn scrubbed_env_excludes_secret_names() {
        let env = scrubbed_env();
        assert!(!env.keys().any(|key| key.contains("TOKEN")));
        assert!(env.contains_key("PYTHONNOUSERSITE"));
    }
}
