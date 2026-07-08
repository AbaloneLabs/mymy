//! Anthropic native messages provider.
//!
//! Implements Anthropic's Messages API (`POST /v1/messages`), which uses
//! a different wire format from OpenAI:
//!
//! - System prompt is a top-level `system` parameter, not a message.
//! - Tool definitions use `input_schema` instead of `parameters`.
//! - Tool calls are content blocks (`type: "tool_use"`), not a separate
//!   `tool_calls` array.
//! - Tool results are user messages with `type: "tool_result"` blocks.
//! - Streaming uses typed SSE events (`message_start`, `content_block_start`,
//!   `content_block_delta`, `content_block_stop`, `message_delta`,
//!   `message_stop`).
//!
//! Wire format reference: https://docs.anthropic.com/en/api/messages

use async_trait::async_trait;
use futures::stream::BoxStream;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};

use super::types::{ModelInfo, StreamDelta};
use super::{
    map_http_error, parse_retry_after, Message, ProviderConfig, ProviderError, ToolSchema,
};

mod models;
mod request;
mod sse;

use models::AnthropicModelsResponse;
use request::MessagesRequest;
use sse::parse_anthropic_sse;

pub struct AnthropicProvider {
    config: ProviderConfig,
    http: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(config: ProviderConfig, http: reqwest::Client) -> Self {
        Self { config, http }
    }

    fn messages_url(&self) -> String {
        format!("{}/messages", self.config.base_url.trim_end_matches('/'))
    }

    fn models_url(&self) -> String {
        format!("{}/models", self.config.base_url.trim_end_matches('/'))
    }

    fn auth_headers(&self) -> Result<HeaderMap, ProviderError> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            "x-api-key",
            HeaderValue::from_str(&self.config.api_key)
                .map_err(|_| ProviderError::Auth("invalid API key characters".into()))?,
        );
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        Ok(headers)
    }
}

#[async_trait]
impl super::LlmProvider for AnthropicProvider {
    async fn stream(
        &self,
        system_prompt: &str,
        messages: &[Message],
        tools: &[ToolSchema],
    ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
        let body = MessagesRequest::build(
            &self.config.model,
            self.config.max_tokens,
            system_prompt,
            messages,
            tools,
        );

        let response = self
            .http
            .post(self.messages_url())
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
        let stream = parse_anthropic_sse(byte_stream);
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

        let listing: AnthropicModelsResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::InvalidResponse(format!("models parse error: {e}")))?;

        Ok(listing
            .data
            .into_iter()
            .map(|model| ModelInfo {
                display_name: model.display_name.unwrap_or_else(|| model.id.clone()),
                id: model.id,
                is_curated: false,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests;
