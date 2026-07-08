//! OpenAI-compatible chat/completions provider.
//!
//! This implementation covers providers that expose an OpenAI-compatible
//! `/chat/completions` endpoint. Request construction, SSE parsing, and
//! model-list DTOs are split out so the HTTP provider stays focused on
//! transport and provider-level errors.

use async_trait::async_trait;
use futures::stream::BoxStream;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

use super::types::{ModelInfo, StreamDelta};
use super::{
    map_http_error, parse_retry_after, Message, ProviderConfig, ProviderError, ToolSchema,
};

mod curated;
mod models;
mod request;
mod sse;

use models::ModelsListResponse;
use request::ChatCompletionsRequest;
use sse::parse_sse_stream;

pub struct OpenAiProvider {
    config: ProviderConfig,
    http: reqwest::Client,
}

impl OpenAiProvider {
    pub fn new(config: ProviderConfig, http: reqwest::Client) -> Self {
        Self { config, http }
    }

    fn completions_url(&self) -> String {
        format!(
            "{}/chat/completions",
            self.config.base_url.trim_end_matches('/')
        )
    }

    fn models_url(&self) -> String {
        format!("{}/models", self.config.base_url.trim_end_matches('/'))
    }

    fn auth_headers(&self) -> Result<HeaderMap, ProviderError> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let auth = format!("Bearer {}", self.config.api_key);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&auth)
                .map_err(|_| ProviderError::Auth("invalid API key characters".into()))?,
        );
        Ok(headers)
    }
}

#[async_trait]
impl super::LlmProvider for OpenAiProvider {
    async fn stream(
        &self,
        system_prompt: &str,
        messages: &[Message],
        tools: &[ToolSchema],
    ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
        let body = ChatCompletionsRequest::build(
            &self.config.model,
            self.config.max_tokens,
            system_prompt,
            messages,
            tools,
        );

        let response = self
            .http
            .post(self.completions_url())
            .headers(self.auth_headers()?)
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let retry_after = parse_retry_after(response.headers());
            let body = response.text().await.unwrap_or_default();
            return Err(map_http_error(status, body, retry_after));
        }

        let byte_stream = response.bytes_stream();
        let stream = parse_sse_stream(byte_stream);
        Ok(Box::pin(stream))
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let response = self
            .http
            .get(self.models_url())
            .headers(self.auth_headers()?)
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::HttpStatus { status, body });
        }

        let listing: ModelsListResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::InvalidResponse(format!("models parse error: {e}")))?;

        Ok(listing
            .data
            .into_iter()
            .map(|model| ModelInfo {
                display_name: model.id.clone(),
                id: model.id,
                is_curated: false,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests;
