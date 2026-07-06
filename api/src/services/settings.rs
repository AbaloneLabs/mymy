//! Settings domain operations.
//!
//! Settings responses intentionally do not expose stored API tokens.

use crate::error::AppResult;
use crate::models::settings::{
    AppSettings, GitSystemConfig, GitSystemType, Language, SecurityStatusResponse,
    SettingsResponse, UpdateSettingsRequest,
};
use crate::services::audit::log_audit_safe;
use crate::state::AppState;
use sqlx::FromRow;

/// Single-row app settings.
#[derive(Debug, FromRow)]
struct AppSettingsRow {
    language: String,
}

/// Git system configuration row for settings responses.
///
/// `api_token` is deliberately excluded so stored secrets are not serialized
/// back to clients.
#[derive(Debug, FromRow)]
struct GitSystemConfigRow {
    r#type: String,
    enabled: bool,
    host: String,
    port: i32,
    ssh_alias: String,
    username: String,
}

/// GET /api/settings
pub async fn get_settings(state: &AppState) -> AppResult<SettingsResponse> {
    // Language
    let settings_row = sqlx::query_as!(
        AppSettingsRow,
        r#"SELECT language FROM app_settings WHERE id = true"#
    )
    .fetch_one(&state.db)
    .await?;
    let language = parse_language(&settings_row.language);

    // Git systems
    let git_rows = sqlx::query_as!(
        GitSystemConfigRow,
        r#"SELECT type, enabled, host, port, ssh_alias, username
           FROM git_system_configs"#
    )
    .fetch_all(&state.db)
    .await?;

    let mut git_systems = std::collections::HashMap::new();
    for row in git_rows {
        let gtype = match row.r#type.as_str() {
            "gitlab" => GitSystemType::Gitlab,
            "gitea" => GitSystemType::Gitea,
            _ => GitSystemType::Github,
        };
        git_systems.insert(
            row.r#type,
            GitSystemConfig {
                r#type: gtype,
                enabled: row.enabled,
                host: row.host,
                port: row.port,
                ssh_alias: row.ssh_alias,
                username: row.username,
                api_token: None,
            },
        );
    }

    Ok(SettingsResponse {
        settings: AppSettings {
            language,
            git_systems,
        },
    })
}

pub async fn security_status(_state: &AppState) -> AppResult<SecurityStatusResponse> {
    Ok(SecurityStatusResponse {
        redaction_enabled: true,
        filesystem_guard_enabled: true,
        tls_validation_enabled: true,
        secret_sources: crate::agent::security::source_statuses().await,
    })
}

/// PATCH /api/settings
pub async fn update_settings(
    state: &AppState,
    req: UpdateSettingsRequest,
) -> AppResult<SettingsResponse> {
    // Build an audit-log payload capturing what changed.
    let mut after = serde_json::Map::new();

    // Update language if provided.
    if let Some(lang) = req.language {
        let lang_str = match lang {
            Language::En => "en",
            Language::Ko => "ko",
            Language::Zh => "zh",
            Language::Ja => "ja",
        };
        sqlx::query!(
            "UPDATE app_settings SET language = $1 WHERE id = true",
            lang_str
        )
        .execute(&state.db)
        .await?;
        after.insert("language".to_string(), serde_json::json!(lang_str));
    }

    // Update git systems if provided.
    if let Some(git_systems) = req.git_systems {
        let mut changed_systems = Vec::new();
        for (type_str, cfg) in git_systems {
            let t = match cfg.r#type {
                GitSystemType::Github => "github",
                GitSystemType::Gitlab => "gitlab",
                GitSystemType::Gitea => "gitea",
            };
            sqlx::query!(
                r#"UPDATE git_system_configs SET
                     enabled = $2, host = $3, port = $4,
                     ssh_alias = $5, username = $6, api_token = COALESCE($7, api_token)
                   WHERE type = $1"#,
                t,
                cfg.enabled,
                cfg.host,
                cfg.port,
                cfg.ssh_alias,
                cfg.username,
                cfg.api_token.as_deref(),
            )
            .execute(&state.db)
            .await?;
            changed_systems.push(t);
            let _ = type_str;
        }
        after.insert("gitSystems".to_string(), serde_json::json!(changed_systems));
    }

    // Audit-log the settings change (no entity_id for the single-row settings).
    if !after.is_empty() {
        log_audit_safe(
            &state.db,
            "user",
            "user",
            "update",
            "settings",
            None,
            Some(serde_json::json!({ "after": after })),
        )
        .await;
    }

    // Return updated settings.
    get_settings(state).await
}

// ---- helpers ----

fn parse_language(s: &str) -> Language {
    match s {
        "ko" => Language::Ko,
        "zh" => Language::Zh,
        "ja" => Language::Ja,
        _ => Language::En,
    }
}
