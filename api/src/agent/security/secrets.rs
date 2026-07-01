//! Secret source abstraction.
//!
//! Tools ask for logical secret names through this layer instead of reading
//! process state directly. Keeping env/config/vault lookups behind one ordered
//! resolver makes secret access explicit and keeps future tool integrations
//! from learning where each credential is stored.

use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use serde::Serialize;
use thiserror::Error;

use super::SecretString;

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("secret source {source_name} failed: {message}")]
    Source {
        source_name: &'static str,
        message: String,
    },
    #[error("secret not found: {0}")]
    NotFound(String),
}

impl SecretError {
    fn source(source: &'static str, error: impl std::fmt::Display) -> Self {
        Self::Source {
            source_name: source,
            message: error.to_string(),
        }
    }
}

#[async_trait]
pub trait SecretSource: Send + Sync {
    fn name(&self) -> &'static str;
    fn is_available(&self) -> bool;
    async fn get(&self, key: &str) -> Result<Option<SecretString>, SecretError>;
}

#[derive(Debug, Default)]
pub struct EnvSecretSource;

#[async_trait]
impl SecretSource for EnvSecretSource {
    fn name(&self) -> &'static str {
        "env"
    }

    fn is_available(&self) -> bool {
        true
    }

    async fn get(&self, key: &str) -> Result<Option<SecretString>, SecretError> {
        Ok(std::env::var(key).ok().map(SecretString::new))
    }
}

#[derive(Debug, Default)]
pub struct ConfigSecretSource {
    values: BTreeMap<String, SecretString>,
}

impl ConfigSecretSource {
    pub fn new(values: BTreeMap<String, SecretString>) -> Self {
        Self { values }
    }
}

#[async_trait]
impl SecretSource for ConfigSecretSource {
    fn name(&self) -> &'static str {
        "config"
    }

    fn is_available(&self) -> bool {
        !self.values.is_empty()
    }

    async fn get(&self, key: &str) -> Result<Option<SecretString>, SecretError> {
        Ok(self.values.get(key).cloned())
    }
}

#[derive(Debug, Clone)]
pub struct BitwardenSecretSource {
    server_url: String,
    access_token: SecretString,
    client: reqwest::Client,
}

impl BitwardenSecretSource {
    pub fn from_env() -> Option<Self> {
        let server_url = std::env::var("MYMY_BITWARDEN_SERVER_URL").ok()?;
        let access_token = std::env::var("MYMY_BITWARDEN_ACCESS_TOKEN").ok()?;
        Some(Self::new(server_url, SecretString::new(access_token)))
    }

    pub fn new(server_url: String, access_token: SecretString) -> Self {
        Self {
            server_url: server_url.trim_end_matches('/').to_string(),
            access_token,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl SecretSource for BitwardenSecretSource {
    fn name(&self) -> &'static str {
        "bitwarden"
    }

    fn is_available(&self) -> bool {
        !self.server_url.is_empty() && !self.access_token.is_empty()
    }

    async fn get(&self, key: &str) -> Result<Option<SecretString>, SecretError> {
        let url = format!(
            "{}/api/secrets/{}",
            self.server_url,
            encode_path_segment(key)
        );
        let response = self
            .client
            .get(url)
            .bearer_auth(self.access_token.reveal())
            .send()
            .await
            .map_err(|error| SecretError::source(self.name(), error))?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(SecretError::source(
                self.name(),
                format!("unexpected status {}", response.status()),
            ));
        }

        let body = response
            .json::<serde_json::Value>()
            .await
            .map_err(|error| SecretError::source(self.name(), error))?;
        let value = body
            .pointer("/value")
            .or_else(|| body.pointer("/data/value"))
            .or_else(|| body.pointer("/secret/value"))
            .and_then(serde_json::Value::as_str);
        Ok(value.map(SecretString::new))
    }
}

#[derive(Default)]
pub struct SecretResolver {
    sources: RwLock<Vec<Arc<dyn SecretSource>>>,
}

impl SecretResolver {
    pub fn new(sources: Vec<Arc<dyn SecretSource>>) -> Self {
        Self {
            sources: RwLock::new(sources),
        }
    }

    pub fn default_chain() -> Self {
        let resolver = Self::new(vec![]);
        resolver.add_source(Arc::new(EnvSecretSource));
        resolver.add_source(Arc::new(ConfigSecretSource::new(BTreeMap::new())));
        if let Some(bitwarden) = BitwardenSecretSource::from_env() {
            resolver.add_source(Arc::new(bitwarden));
        }
        resolver
    }

    pub fn add_source(&self, source: Arc<dyn SecretSource>) {
        self.sources
            .write()
            .expect("secret resolver lock")
            .push(source);
    }

    pub async fn resolve(&self, key: &str) -> Result<SecretString, SecretError> {
        let sources = self.sources.read().expect("secret resolver lock").clone();
        for source in sources {
            if !source.is_available() {
                continue;
            }
            if let Some(value) = source.get(key).await? {
                return Ok(value);
            }
        }
        Err(SecretError::NotFound(key.to_string()))
    }

    pub fn statuses(&self) -> Vec<SecretSourceStatus> {
        self.sources
            .read()
            .expect("secret resolver lock")
            .iter()
            .map(|source| SecretSourceStatus {
                name: source.name(),
                configured: source.is_available(),
            })
            .collect()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretSourceStatus {
    pub name: &'static str,
    pub configured: bool,
}

pub async fn source_statuses() -> Vec<SecretSourceStatus> {
    let resolver = SecretResolver::default_chain();
    if let Ok(key) = std::env::var("MYMY_SECRET_STATUS_PROBE_KEY") {
        let _ = resolver.resolve(&key).await;
    }
    let mut statuses = resolver.statuses();
    if statuses.iter().all(|status| status.name != "bitwarden") {
        statuses.push(SecretSourceStatus {
            name: "bitwarden",
            configured: false,
        });
    }
    statuses
}

fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StaticSource {
        name: &'static str,
        value: Option<SecretString>,
    }

    #[async_trait]
    impl SecretSource for StaticSource {
        fn name(&self) -> &'static str {
            self.name
        }

        fn is_available(&self) -> bool {
            true
        }

        async fn get(&self, _key: &str) -> Result<Option<SecretString>, SecretError> {
            Ok(self.value.clone())
        }
    }

    #[tokio::test]
    async fn resolver_uses_sources_in_order() {
        let resolver = SecretResolver::new(vec![
            Arc::new(StaticSource {
                name: "empty",
                value: None,
            }),
            Arc::new(StaticSource {
                name: "second",
                value: Some(SecretString::new("resolved-secret")),
            }),
        ]);
        let secret = resolver.resolve("API_KEY").await.unwrap();
        assert_eq!(secret.reveal(), "resolved-secret");
    }

    #[test]
    fn path_segments_are_percent_encoded() {
        assert_eq!(encode_path_segment("folder/key 1"), "folder%2Fkey%201");
    }
}
