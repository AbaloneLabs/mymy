use super::*;

use crate::models::llm_provider::{
    ApiFormatOption, CreateAgentCredentialRequest, UpdateAgentCredentialRequest,
};

#[test]
fn curated_openai_for_default_host() {
    let config = ProviderConfig {
        api_format: Some(providers::ApiFormat::Openai),
        base_url: "https://api.openai.com/v1".to_string(),
        api_key: "sk-test".to_string(),
        model: "gpt-4o".to_string(),
        max_tokens: 1024,
    };
    let models = curated_models(&config);
    assert!(models.iter().any(|m| m.id == "gpt-4o"));
    assert!(models.iter().all(|m| m.is_curated));
}

#[test]
fn curated_ollama_for_localhost() {
    let config = ProviderConfig {
        api_format: Some(providers::ApiFormat::Openai),
        base_url: "http://localhost:11434/v1".to_string(),
        api_key: "ollama".to_string(),
        model: "llama3".to_string(),
        max_tokens: 1024,
    };
    let models = curated_models(&config);
    assert!(models.iter().any(|m| m.id == "llama3"));
}

#[test]
fn curated_anthropic_for_claude() {
    let config = ProviderConfig {
        api_format: Some(providers::ApiFormat::Anthropic),
        base_url: "https://api.anthropic.com/v1".to_string(),
        api_key: "sk-test".to_string(),
        model: "claude-sonnet-4-5".to_string(),
        max_tokens: 1024,
    };
    let models = curated_models(&config);
    assert!(models.iter().any(|m| m.id == "claude-sonnet-4-5-20250514"));
}

fn test_state(pool: sqlx::PgPool) -> AppState {
    AppState::new(
        pool,
        crate::config::Config {
            database_url: String::new(),
            port: 0,
            cors_origins: vec![],
            agent_data_dir: std::env::temp_dir().join("mymy-test-agent"),
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

#[sqlx::test(migrations = "./migrations")]
async fn db_create_and_list_provider(pool: sqlx::PgPool) {
    let state = test_state(pool);

    let key = crypto::derive_key("test-pin");
    *state.encryption_key.write().await = Some(key);

    let req = CreateLlmProviderRequest {
        label: "Test OpenAI".to_string(),
        api_format: ApiFormatOption::Openai,
        base_url: "https://api.openai.com/v1".to_string(),
        api_key: "sk-test-1234567890abcdef".to_string(),
        model: "gpt-4o".to_string(),
        max_tokens: 8192,
        preset: Some("openai".to_string()),
    };
    let created = create_provider(&state, req)
        .await
        .expect("create should succeed");
    assert_eq!(created.provider.label, "Test OpenAI");
    assert_eq!(created.provider.model, "gpt-4o");
    assert!(
        created.provider.is_default,
        "first provider should be default"
    );

    let list = list_providers(&state).await.expect("list should succeed");
    assert_eq!(list.providers.len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn db_update_provider_preserves_key(pool: sqlx::PgPool) {
    let state = test_state(pool);
    let key = crypto::derive_key("test-pin");
    *state.encryption_key.write().await = Some(key);

    let created = create_provider(
        &state,
        CreateLlmProviderRequest {
            label: "Original".to_string(),
            api_format: ApiFormatOption::Openai,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-original-key-12345".to_string(),
            model: "gpt-4o".to_string(),
            max_tokens: 4096,
            preset: None,
        },
    )
    .await
    .expect("create should succeed");

    let id: Uuid = created.provider.id.parse().expect("valid uuid");

    let updated = update_provider(
        &state,
        id,
        UpdateLlmProviderRequest {
            label: Some("Updated".to_string()),
            api_format: None,
            base_url: None,
            api_key: None,
            model: None,
            max_tokens: None,
            enabled: None,
        },
    )
    .await
    .expect("update should succeed");

    assert_eq!(updated.provider.label, "Updated");

    let config = resolve_runtime_config(&state, id)
        .await
        .expect("runtime config should resolve");
    assert_eq!(config.api_key, "sk-original-key-12345");
}

#[sqlx::test(migrations = "./migrations")]
async fn db_pooled_credential_overrides_provider_key(pool: sqlx::PgPool) {
    let state = test_state(pool);
    let key = crypto::derive_key("test-pin");
    *state.encryption_key.write().await = Some(key);

    let created = create_provider(
        &state,
        CreateLlmProviderRequest {
            label: "Provider".to_string(),
            api_format: ApiFormatOption::Openai,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-primary-key".to_string(),
            model: "gpt-4o".to_string(),
            max_tokens: 4096,
            preset: None,
        },
    )
    .await
    .expect("create provider");
    let provider_id: Uuid = created.provider.id.parse().unwrap();

    create_credential(
        &state,
        provider_id,
        CreateAgentCredentialRequest {
            label: "secondary".to_string(),
            api_key: "sk-secondary-key".to_string(),
        },
    )
    .await
    .expect("create credential");

    let config = resolve_runtime_config(&state, provider_id)
        .await
        .expect("runtime config");
    assert_eq!(config.api_key, "sk-secondary-key");

    let credentials = list_credentials(&state, provider_id)
        .await
        .expect("credentials list")
        .credentials;
    assert_eq!(credentials[0].request_count, 1);

    let credential_id: Uuid = credentials[0].id.parse().unwrap();
    update_credential(
        &state,
        provider_id,
        credential_id,
        UpdateAgentCredentialRequest {
            status: Some("dead".to_string()),
        },
    )
    .await
    .expect("mark dead");

    let fallback = resolve_runtime_config(&state, provider_id)
        .await
        .expect("fallback runtime config");
    assert_eq!(fallback.api_key, "sk-primary-key");
}

#[sqlx::test(migrations = "./migrations")]
async fn db_set_default_only_one(pool: sqlx::PgPool) {
    let state = test_state(pool);
    let key = crypto::derive_key("test-pin");
    *state.encryption_key.write().await = Some(key);

    let p1 = create_provider(
        &state,
        CreateLlmProviderRequest {
            label: "P1".to_string(),
            api_format: ApiFormatOption::Openai,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-key-1-123456789".to_string(),
            model: "gpt-4o".to_string(),
            max_tokens: 4096,
            preset: None,
        },
    )
    .await
    .expect("create p1");
    let p2 = create_provider(
        &state,
        CreateLlmProviderRequest {
            label: "P2".to_string(),
            api_format: ApiFormatOption::Anthropic,
            base_url: "https://api.anthropic.com/v1".to_string(),
            api_key: "sk-key-2-123456789".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            max_tokens: 4096,
            preset: None,
        },
    )
    .await
    .expect("create p2");

    let id1: Uuid = p1.provider.id.parse().unwrap();
    let id2: Uuid = p2.provider.id.parse().unwrap();

    set_default(&state, id2).await.expect("set default p2");

    let list = list_providers(&state).await.expect("list");
    let defaults: Vec<_> = list.providers.iter().filter(|p| p.is_default).collect();
    assert_eq!(defaults.len(), 1, "exactly one default");
    assert_eq!(defaults[0].id, p2.provider.id);

    set_default(&state, id1).await.expect("set default p1");
    let list = list_providers(&state).await.expect("list");
    let defaults: Vec<_> = list.providers.iter().filter(|p| p.is_default).collect();
    assert_eq!(defaults.len(), 1);
    assert_eq!(defaults[0].id, p1.provider.id);
}

#[sqlx::test(migrations = "./migrations")]
async fn db_delete_promotes_new_default(pool: sqlx::PgPool) {
    let state = test_state(pool);
    let key = crypto::derive_key("test-pin");
    *state.encryption_key.write().await = Some(key);

    let p1 = create_provider(
        &state,
        CreateLlmProviderRequest {
            label: "P1".to_string(),
            api_format: ApiFormatOption::Openai,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-key-1-123456789".to_string(),
            model: "gpt-4o".to_string(),
            max_tokens: 4096,
            preset: None,
        },
    )
    .await
    .expect("create p1");
    let p2 = create_provider(
        &state,
        CreateLlmProviderRequest {
            label: "P2".to_string(),
            api_format: ApiFormatOption::Openai,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-key-2-123456789".to_string(),
            model: "gpt-4o-mini".to_string(),
            max_tokens: 4096,
            preset: None,
        },
    )
    .await
    .expect("create p2");

    let id1: Uuid = p1.provider.id.parse().unwrap();

    delete_provider(&state, id1).await.expect("delete p1");

    let list = list_providers(&state).await.expect("list");
    assert_eq!(list.providers.len(), 1);
    assert!(
        list.providers[0].is_default,
        "remaining provider should be promoted to default"
    );
    assert_eq!(list.providers[0].id, p2.provider.id);
}

#[sqlx::test(migrations = "./migrations")]
async fn db_pin_change_reencrypts_keys(pool: sqlx::PgPool) {
    let state = test_state(pool);
    let old_key = crypto::derive_key("old-pin");
    let new_key = crypto::derive_key("new-pin");
    *state.encryption_key.write().await = Some(old_key);

    let created = create_provider(
        &state,
        CreateLlmProviderRequest {
            label: "Test".to_string(),
            api_format: ApiFormatOption::Openai,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-secret-123456789".to_string(),
            model: "gpt-4o".to_string(),
            max_tokens: 4096,
            preset: None,
        },
    )
    .await
    .expect("create");

    let id: Uuid = created.provider.id.parse().unwrap();

    let mut transaction = state.db.begin().await.expect("begin rotation");
    reencrypt_all_keys_for_pin_in_transaction(&mut transaction, "old-pin", "new-pin")
        .await
        .expect("reencrypt");
    transaction.commit().await.expect("commit rotation");

    *state.encryption_key.write().await = Some(new_key);

    let config = resolve_runtime_config(&state, id)
        .await
        .expect("should resolve with new key");
    assert_eq!(config.api_key, "sk-secret-123456789");
}

#[sqlx::test(migrations = "./migrations")]
async fn db_encryption_key_required_for_create(pool: sqlx::PgPool) {
    let state = test_state(pool);

    let result = create_provider(
        &state,
        CreateLlmProviderRequest {
            label: "Test".to_string(),
            api_format: ApiFormatOption::Openai,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4o".to_string(),
            max_tokens: 4096,
            preset: None,
        },
    )
    .await;

    assert!(result.is_err(), "should fail without encryption key");
}
