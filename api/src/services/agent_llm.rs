//! Per-agent LLM selection and effective runtime resolution.
//!
//! The global default remains authoritative when no agent settings row exists.
//! Optional provider and model overrides are resolved independently so agents
//! can share one encrypted provider connection while choosing different model
//! identifiers. Runtime resolution can reuse a durable run snapshot, preventing
//! retries from silently changing models after an administrator edits defaults.

use sqlx::FromRow;
use uuid::Uuid;

use crate::agent::providers::ProviderConfig;
use crate::error::{AppError, AppResult};
use crate::models::agent::{AgentLlmSettingsView, UpdateAgentLlmSettings};
use crate::services::llm_providers;
use crate::state::AppState;

const MAX_MODEL_CHARS: usize = 256;

#[derive(Debug, Clone, FromRow)]
struct AgentSettingsRow {
    provider_id: Option<Uuid>,
    model: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct ProviderMetadata {
    id: Uuid,
    label: String,
    model: String,
    enabled: bool,
}

#[derive(Debug, Clone)]
pub struct ValidatedAgentLlmSettings {
    pub provider_id: Option<Uuid>,
    pub model: Option<String>,
}

pub struct ResolvedAgentLlm {
    pub provider_id: Uuid,
    pub provider_label: String,
    pub model: String,
    pub selection_source: String,
    pub config: ProviderConfig,
}

#[derive(Debug, FromRow)]
struct RunLlmSnapshot {
    llm_provider_id: Option<Uuid>,
    llm_provider_label: Option<String>,
    llm_model: Option<String>,
    llm_selection_source: Option<String>,
}

pub async fn settings_view(
    state: &AppState,
    agent_profile: &str,
) -> AppResult<AgentLlmSettingsView> {
    let settings = fetch_agent_settings(state, agent_profile).await?;
    let inherits_global = settings.is_none();
    let configured_provider_id = settings.as_ref().and_then(|row| row.provider_id);
    let configured_model = settings.as_ref().and_then(|row| row.model.clone());
    let provider = match configured_provider_id {
        Some(provider_id) => provider_metadata(state, provider_id).await?,
        None => default_provider_metadata(state, false).await?,
    };
    let resolved_model = configured_model
        .clone()
        .or_else(|| provider.as_ref().map(|row| row.model.clone()));

    Ok(AgentLlmSettingsView {
        inherits_global,
        provider_id: configured_provider_id.map(|id| id.to_string()),
        model: configured_model,
        resolved_provider_id: provider.as_ref().map(|row| row.id.to_string()),
        resolved_provider_label: provider.as_ref().map(|row| row.label.clone()),
        resolved_model,
        resolved_provider_enabled: provider.as_ref().map(|row| row.enabled),
    })
}

pub async fn validate_settings(
    state: &AppState,
    settings: UpdateAgentLlmSettings,
) -> AppResult<ValidatedAgentLlmSettings> {
    let model = match settings.model {
        Some(model) => {
            let model = model.trim().to_string();
            if model.is_empty() {
                None
            } else if model.chars().count() > MAX_MODEL_CHARS {
                return Err(AppError::BadRequest(format!(
                    "agent model must be at most {MAX_MODEL_CHARS} characters"
                )));
            } else {
                Some(model)
            }
        }
        None => None,
    };

    if let Some(provider_id) = settings.provider_id {
        let provider = provider_metadata(state, provider_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("provider {provider_id} not found")))?;
        if !provider.enabled {
            return Err(AppError::Conflict(format!(
                "provider {} is disabled",
                provider.label
            )));
        }
    } else if model.is_some() && default_provider_metadata(state, true).await?.is_none() {
        return Err(AppError::Conflict(
            "an enabled global default provider is required for a model-only override".to_string(),
        ));
    }

    Ok(ValidatedAgentLlmSettings {
        provider_id: settings.provider_id,
        model,
    })
}

pub async fn replace_settings(
    state: &AppState,
    agent_profile: &str,
    settings: &ValidatedAgentLlmSettings,
) -> AppResult<()> {
    if settings.provider_id.is_none() && settings.model.is_none() {
        sqlx::query("DELETE FROM agent_llm_settings WHERE agent_profile = $1")
            .bind(agent_profile)
            .execute(&state.db)
            .await?;
        return Ok(());
    }

    sqlx::query(
        r#"INSERT INTO agent_llm_settings (agent_profile, provider_id, model)
           VALUES ($1, $2, $3)
           ON CONFLICT (agent_profile) DO UPDATE SET
             provider_id = EXCLUDED.provider_id,
             model = EXCLUDED.model,
             updated_at = now()"#,
    )
    .bind(agent_profile)
    .bind(settings.provider_id)
    .bind(settings.model.as_deref())
    .execute(&state.db)
    .await?;
    Ok(())
}

/// Resolve the immutable provider/model identity for one run. A populated run
/// snapshot wins over current settings; only a first attempt consults the live
/// agent override and global default.
pub async fn resolve_for_run(
    state: &AppState,
    agent_profile: &str,
    run_id: Uuid,
) -> AppResult<ResolvedAgentLlm> {
    let snapshot = sqlx::query_as::<_, RunLlmSnapshot>(
        r#"SELECT llm_provider_id, llm_provider_label, llm_model,
                  llm_selection_source
           FROM agent_runs WHERE id = $1"#,
    )
    .bind(run_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("agent run {run_id} not found")))?;

    if let (Some(provider_id), Some(model), Some(selection_source)) = (
        snapshot.llm_provider_id,
        snapshot.llm_model,
        snapshot.llm_selection_source,
    ) {
        let provider = provider_metadata(state, provider_id)
            .await?
            .ok_or_else(|| {
                AppError::Conflict(format!(
                    "provider {provider_id} selected by run {run_id} no longer exists"
                ))
            })?;
        let mut config = llm_providers::resolve_runtime_config(state, provider_id).await?;
        config.model = model.clone();
        return Ok(ResolvedAgentLlm {
            provider_id,
            provider_label: snapshot.llm_provider_label.unwrap_or(provider.label),
            model,
            selection_source,
            config,
        });
    }

    let settings = fetch_agent_settings(state, agent_profile).await?;
    let provider_id = match settings.as_ref().and_then(|row| row.provider_id) {
        Some(provider_id) => provider_id,
        None => {
            default_provider_metadata(state, true)
                .await?
                .ok_or_else(|| AppError::NotFound("no default LLM provider configured".into()))?
                .id
        }
    };
    let provider = provider_metadata(state, provider_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("provider {provider_id} not found")))?;
    if !provider.enabled {
        return Err(AppError::Conflict(format!(
            "provider {} assigned to agent {agent_profile} is disabled",
            provider.label
        )));
    }
    let model = settings
        .as_ref()
        .and_then(|row| row.model.clone())
        .unwrap_or_else(|| provider.model.clone());
    let mut config = llm_providers::resolve_runtime_config(state, provider_id).await?;
    config.model = model.clone();

    Ok(ResolvedAgentLlm {
        provider_id,
        provider_label: provider.label,
        model,
        selection_source: if settings.is_some() {
            "agent_override".to_string()
        } else {
            "global_default".to_string()
        },
        config,
    })
}

async fn fetch_agent_settings(
    state: &AppState,
    agent_profile: &str,
) -> AppResult<Option<AgentSettingsRow>> {
    Ok(sqlx::query_as::<_, AgentSettingsRow>(
        "SELECT provider_id, model FROM agent_llm_settings WHERE agent_profile = $1",
    )
    .bind(agent_profile)
    .fetch_optional(&state.db)
    .await?)
}

async fn provider_metadata(
    state: &AppState,
    provider_id: Uuid,
) -> AppResult<Option<ProviderMetadata>> {
    Ok(sqlx::query_as::<_, ProviderMetadata>(
        "SELECT id, label, model, enabled FROM llm_providers WHERE id = $1",
    )
    .bind(provider_id)
    .fetch_optional(&state.db)
    .await?)
}

async fn default_provider_metadata(
    state: &AppState,
    require_enabled: bool,
) -> AppResult<Option<ProviderMetadata>> {
    Ok(sqlx::query_as::<_, ProviderMetadata>(
        r#"SELECT id, label, model, enabled FROM llm_providers
           WHERE is_default = true AND (enabled OR NOT $1)
           LIMIT 1"#,
    )
    .bind(require_enabled)
    .fetch_optional(&state.db)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::crypto;
    use crate::models::llm_provider::{ApiFormatOption, CreateLlmProviderRequest};

    fn test_state(pool: sqlx::PgPool) -> AppState {
        AppState::new(
            pool,
            crate::config::Config {
                database_url: String::new(),
                port: 0,
                cors_origins: vec![],
                agent_data_dir: std::env::temp_dir().join("mymy-agent-llm-test"),
                auth_cookie_secure: false,
                cron_tick_interval_secs: 60,
                cron_timezone: "UTC".to_string(),
                cron_output_keep: 50,
                drive_s3_bucket: None,
                drive_s3_region: None,
                drive_s3_endpoint: None,
                sandbox_runner_url: None,
                sandbox_preview_host: "127.0.0.1".to_string(),
            },
        )
    }

    async fn insert_agent(state: &AppState, profile: &str) {
        sqlx::query(
            r#"INSERT INTO native_agents
                 (profile, name, status, model, drive_path, sandbox_status)
               VALUES ($1, $1, 'idle', 'unknown', '/drive/agents/' || $1, 'ready')"#,
        )
        .bind(profile)
        .execute(&state.db)
        .await
        .expect("agent fixture should insert");
    }

    async fn create_test_provider(state: &AppState, label: &str, model: &str) -> Uuid {
        crate::services::llm_providers::create_provider(
            state,
            CreateLlmProviderRequest {
                label: label.to_string(),
                api_format: ApiFormatOption::Openai,
                base_url: "http://localhost:9999/v1".to_string(),
                api_key: format!("test-key-{label}"),
                model: model.to_string(),
                max_tokens: 4096,
                preset: None,
            },
        )
        .await
        .expect("provider fixture should insert")
        .provider
        .id
        .parse()
        .expect("provider id should be a UUID")
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn settings_inherit_global_and_allow_model_only_override(pool: sqlx::PgPool) {
        let state = test_state(pool);
        *state.encryption_key.write().await = Some(crypto::derive_key("test-pin"));
        insert_agent(&state, "elena").await;
        let provider_id = create_test_provider(&state, "Local", "default-model").await;

        let inherited = settings_view(&state, "elena")
            .await
            .expect("inherited settings should resolve");
        assert!(inherited.inherits_global);
        let provider_id_text = provider_id.to_string();
        assert_eq!(
            inherited.resolved_provider_id.as_deref(),
            Some(provider_id_text.as_str())
        );
        assert_eq!(inherited.resolved_model.as_deref(), Some("default-model"));

        let override_settings = validate_settings(
            &state,
            UpdateAgentLlmSettings {
                provider_id: None,
                model: Some("special-model".to_string()),
            },
        )
        .await
        .expect("model-only override should validate");
        replace_settings(&state, "elena", &override_settings)
            .await
            .expect("override should persist");

        let overridden = settings_view(&state, "elena")
            .await
            .expect("override should resolve");
        assert!(!overridden.inherits_global);
        assert_eq!(overridden.provider_id, None);
        assert_eq!(overridden.model.as_deref(), Some("special-model"));
        assert_eq!(overridden.resolved_model.as_deref(), Some("special-model"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn run_snapshot_keeps_provider_and_model_after_agent_setting_changes(pool: sqlx::PgPool) {
        let state = test_state(pool);
        *state.encryption_key.write().await = Some(crypto::derive_key("test-pin"));
        insert_agent(&state, "elena").await;
        let first_provider = create_test_provider(&state, "First", "first-default").await;
        let second_provider = create_test_provider(&state, "Second", "second-default").await;
        let run_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO agent_runs
                 (agent_profile, trigger_type, status, objective, prompt_version)
               VALUES ('elena', 'wake', 'running', 'test', 'test-v1')
               RETURNING id"#,
        )
        .fetch_one(&state.db)
        .await
        .expect("run fixture should insert");

        let initial = resolve_for_run(&state, "elena", run_id)
            .await
            .expect("default selection should resolve");
        assert_eq!(initial.provider_id, first_provider);
        assert_eq!(initial.model, "first-default");
        sqlx::query(
            r#"UPDATE agent_runs SET
                 llm_provider_id = $2,
                 llm_provider_label = $3,
                 llm_model = $4,
                 llm_selection_source = $5
               WHERE id = $1"#,
        )
        .bind(run_id)
        .bind(initial.provider_id)
        .bind(&initial.provider_label)
        .bind(&initial.model)
        .bind(&initial.selection_source)
        .execute(&state.db)
        .await
        .expect("run snapshot should persist");

        let changed = validate_settings(
            &state,
            UpdateAgentLlmSettings {
                provider_id: Some(second_provider),
                model: Some("second-special".to_string()),
            },
        )
        .await
        .expect("new agent setting should validate");
        replace_settings(&state, "elena", &changed)
            .await
            .expect("new agent setting should persist");

        let retried = resolve_for_run(&state, "elena", run_id)
            .await
            .expect("snapshotted retry should resolve");
        assert_eq!(retried.provider_id, first_provider);
        assert_eq!(retried.model, "first-default");
        assert_eq!(retried.selection_source, "global_default");
    }
}
