use async_trait::async_trait;
use futures::{stream::BoxStream, StreamExt};
use uuid::Uuid;

use crate::agent::providers::types::ModelInfo;
use crate::agent::providers::{self, LlmProvider, Message, ProviderError, StreamDelta, ToolSchema};
use crate::error::{AppError, AppResult};
use crate::services::llm_providers;
use crate::state::AppState;

pub(super) fn parse_runtime_provider_id(id: &str) -> AppResult<Uuid> {
    Uuid::parse_str(id)
        .map_err(|err| AppError::Internal(format!("invalid runtime provider id: {err}")))
}

pub(super) struct DbRotatingProvider {
    pub(super) state: AppState,
    pub(super) provider_id: Uuid,
    pub(super) model_override: Option<String>,
}

#[async_trait]
impl LlmProvider for DbRotatingProvider {
    async fn stream(
        &self,
        system_prompt: &str,
        messages: &[Message],
        tools: &[ToolSchema],
    ) -> Result<BoxStream<'_, Result<StreamDelta, ProviderError>>, ProviderError> {
        let state = self.state.clone();
        let provider_id = self.provider_id;
        let model_override = self.model_override.clone();
        let system_prompt = system_prompt.to_string();
        let messages = messages.to_vec();
        let tools = tools.to_vec();
        let stream = async_stream::stream! {
            let mut last_error = None;
            for attempt in 1..=3 {
                let mut resolved = match llm_providers::resolve_runtime_config_with_credential(&state, provider_id).await {
                    Ok(resolved) => resolved,
                    Err(err) => {
                        yield Err(ProviderError::InvalidResponse(format!("provider config resolution failed: {err}")));
                        return;
                    }
                };
                if let Some(model) = model_override.as_ref() {
                    resolved.config.model = model.clone();
                }
                let credential_id = resolved.credential_id;
                let provider = providers::create_provider(&resolved.config);
                let mut inner = match provider.stream(&system_prompt, &messages, &tools).await {
                    Ok(inner) => inner,
                    Err(ProviderError::RateLimited { retry_after_secs }) => {
                        if let Err(err) = llm_providers::mark_credential_rate_limited(
                            &state,
                            provider_id,
                            credential_id,
                            retry_after_secs,
                        )
                        .await
                        {
                            tracing::warn!(error = %err, "failed to mark pooled credential rate-limited");
                        }
                        last_error = Some(ProviderError::RateLimited { retry_after_secs });
                        if attempt < 3 && credential_id.is_some() {
                            continue;
                        }
                        break;
                    }
                    Err(err) => {
                        yield Err(err);
                        return;
                    }
                };
                while let Some(delta) = inner.next().await {
                    if let Err(ProviderError::RateLimited { retry_after_secs }) = &delta {
                        if let Err(err) = llm_providers::mark_credential_rate_limited(
                            &state,
                            provider_id,
                            credential_id,
                            *retry_after_secs,
                        )
                        .await
                        {
                            tracing::warn!(error = %err, "failed to mark pooled credential rate-limited");
                        }
                    }
                    yield delta;
                }
                return;
            }
            yield Err(last_error.unwrap_or(ProviderError::RateLimited {
                retry_after_secs: Some(60),
            }));
        };
        Ok(Box::pin(stream))
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let mut last_error = None;
        for attempt in 1..=3 {
            let mut resolved = llm_providers::resolve_runtime_config_with_credential(
                &self.state,
                self.provider_id,
            )
            .await
            .map_err(|err| {
                ProviderError::InvalidResponse(format!("provider config resolution failed: {err}"))
            })?;
            if let Some(model) = self.model_override.as_ref() {
                resolved.config.model = model.clone();
            }
            let credential_id = resolved.credential_id;
            let provider = providers::create_provider(&resolved.config);
            match provider.list_models().await {
                Ok(models) => return Ok(models),
                Err(ProviderError::RateLimited { retry_after_secs }) => {
                    if let Err(err) = llm_providers::mark_credential_rate_limited(
                        &self.state,
                        self.provider_id,
                        credential_id,
                        retry_after_secs,
                    )
                    .await
                    {
                        tracing::warn!(error = %err, "failed to mark pooled credential rate-limited");
                    }
                    last_error = Some(ProviderError::RateLimited { retry_after_secs });
                    if attempt < 3 && credential_id.is_some() {
                        continue;
                    }
                    break;
                }
                Err(err) => return Err(err),
            }
        }
        Err(last_error.unwrap_or(ProviderError::RateLimited {
            retry_after_secs: Some(60),
        }))
    }
}
