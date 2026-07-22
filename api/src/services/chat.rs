//! Chat domain operations backed by the native Rust agent runtime.
//!
//! Session CRUD remains in PostgreSQL, but message execution no longer calls
//! external command shims. Each send operation resolves the default LLM provider,
//! assembles the native tool registry and prompt, then lets the HTTP handler
//! stream agent-loop events to the browser.

mod prompt_snapshot;
mod provider;
mod repository;
mod skill_invocation;

use std::sync::Arc;

use uuid::Uuid;

use crate::agent::context::{
    context_length_for_model, estimate_message_tokens, estimate_tokens, ContextManager,
};
use crate::agent::loop_engine::{AgentLoop, LoopConfig};
use crate::agent::memory::MemoryStore;
use crate::agent::prompt::{assemble_system_prompt, build_system_prompt_parts, PromptConfig};
use crate::agent::providers::{LlmProvider, Message};
use crate::agent::runtime::{MoaConfig, MoaParticipant};
use crate::agent::skills::SkillRegistry;
use crate::agent::tools::builtin::{
    mcp, register_agent_toolsets, register_all, BuiltinSessionConfig, BuiltinToolConfig,
};
use crate::agent::tools::ToolRegistry;
use crate::error::{AppError, AppResult};
use crate::models::chat::{ChatMessage, SendMessageRequest};
use crate::services::agent_permissions;
use crate::services::drive;
use crate::services::llm_providers;
use crate::services::sandbox_runner::logical_path_for_runner;
use crate::state::AppState;

use self::prompt_snapshot::{fingerprint_tool_schemas, resolve_prompt_snapshot};
use self::provider::{parse_runtime_provider_id, DbRotatingProvider};
pub use self::repository::{
    create_session, delete_session, fetch_session_response, get_messages, list_sessions,
    reconcile_session_deletions, save_agent_messages_for_run, save_run_status_message,
    SessionQuery,
};
use self::repository::{
    derive_title, fetch_message_rows, fetch_session, insert_user_message,
    insert_user_message_for_input, row_is_agent_context, row_to_agent_message,
};
use self::skill_invocation::resolve_skill_invocation;

pub struct PreparedNativeTurn {
    pub messages: Vec<Message>,
    pub agent_message_start: usize,
    pub execution: PreparedExecution,
    pub system_prompt: String,
    pub user_message: ChatMessage,
    pub tool_schema_fingerprint: String,
    pub tool_count: usize,
    pub permission_fingerprint: String,
    pub buffered_output_required: bool,
}

/// Materialize an admitted release-fixture input through the same idempotent
/// repository operation used immediately before production execution. The
/// helper is absent from production builds and lets model-independent load
/// certification exercise message indexing and memory extraction without
/// substituting a fake provider response.
#[cfg(test)]
pub async fn materialize_release_fixture_input(
    state: &AppState,
    session_id: Uuid,
    input_id: Uuid,
    text: &str,
) -> AppResult<()> {
    let (_, inserted) = insert_user_message_for_input(state, session_id, input_id, text).await?;
    if inserted {
        sqlx::query(
            r#"UPDATE chat_sessions SET
                 message_count = message_count + 1,
                 title = COALESCE(NULLIF(title, ''), $2),
                 updated_at = now()
               WHERE id = $1"#,
        )
        .bind(session_id)
        .bind(derive_title(text))
        .execute(&state.db)
        .await?;
    }
    Ok(())
}

pub enum PreparedExecution {
    Agent(Box<AgentLoop>),
    Moa(PreparedMoaTurn),
}

pub struct PreparedMoaTurn {
    pub proposers: Vec<MoaParticipant>,
    pub aggregator: MoaParticipant,
    pub config: MoaConfig,
}

/// Allocate optional prompt context only after reserving the authoritative
/// current request, recent conversation tail, tool contracts, and output
/// capacity. Whole blocks are selected so trust labels and Unicode text are
/// never cut in half merely to satisfy an estimate.
fn select_optional_context_blocks(
    model: &str,
    max_output_tokens: u32,
    tool_schemas: &[crate::agent::providers::ToolSchema],
    required_context_blocks: &[String],
    recent_message_tokens: u32,
    current_user_text: &str,
    optional_blocks: Vec<(&'static str, String)>,
) -> AppResult<(Vec<String>, bool)> {
    let context_length = context_length_for_model(model);
    let reserved_output = max_output_tokens.min(context_length / 2);
    let prompt_budget = context_length
        .saturating_mul(85)
        .saturating_div(100)
        .saturating_sub(reserved_output);
    let schema_tokens = serde_json::to_string(tool_schemas)
        .map(|value| estimate_tokens(&value))
        .unwrap_or(prompt_budget);
    let required_tokens = 2_048_u32
        .saturating_add(schema_tokens)
        .saturating_add(recent_message_tokens)
        .saturating_add(estimate_tokens(current_user_text))
        .saturating_add(estimate_tokens(&required_context_blocks.join("\n\n")));
    if required_tokens >= prompt_budget {
        return Err(AppError::PayloadTooLarge(
            "required prompt context exceeds the model budget; reduce workspace instructions or select a larger-context model"
                .to_string(),
        ));
    }
    let mut remaining = prompt_budget - required_tokens;
    let mut selected = Vec::new();
    let mut dropped_recall = false;
    for (kind, block) in optional_blocks {
        let tokens = estimate_tokens(&block);
        if tokens <= remaining {
            remaining -= tokens;
            selected.push(block);
        } else if kind == "automatic_recall" {
            dropped_recall = true;
        }
    }
    Ok((selected, dropped_recall))
}

pub async fn prepare_native_turn_for_input(
    state: &AppState,
    run_id: Uuid,
    id: Uuid,
    run_input_id: Uuid,
    req: SendMessageRequest,
) -> AppResult<PreparedNativeTurn> {
    prepare_native_turn_internal(state, Some(run_id), id, Some(run_input_id), req).await
}

async fn prepare_native_turn_internal(
    state: &AppState,
    run_id: Option<Uuid>,
    id: Uuid,
    run_input_id: Option<Uuid>,
    req: SendMessageRequest,
) -> AppResult<PreparedNativeTurn> {
    let text = req.text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::BadRequest("message text cannot be empty".into()));
    }

    let session = fetch_session(state, id).await?;
    let use_moa = req.use_moa;
    let moa_runtime = if use_moa {
        Some(crate::services::moa::resolve_runtime_preset(state, req.moa_preset_id).await?)
    } else {
        None
    };
    let default_runtime = if moa_runtime.is_none() {
        let provider_id = llm_providers::resolve_default_provider_id(state).await?;
        Some((
            provider_id,
            llm_providers::resolve_runtime_config(state, provider_id).await?,
        ))
    } else {
        None
    };

    let workspace =
        drive::resolve_agent_drive_workspace(state, &session.profile, session.project_id).await?;
    let working_dir = workspace.working_dir;
    let allowed_roots = workspace.allowed_roots;
    let permission_policy = agent_permissions::load_policy(state, &session.profile).await?;
    let mut registry = ToolRegistry::new();
    let extension_settings_key = state.encryption_key.read().await.as_ref().copied();
    let builtin_config = BuiltinToolConfig::for_session(BuiltinSessionConfig {
        working_dir: working_dir.clone(),
        allowed_roots: allowed_roots.clone(),
        agent_data_dir: state.config.agent_data_dir.clone(),
        session_id: id,
        agent_profile: session.profile.clone(),
        project_id: session.project_id,
        sandbox_runner_url: state.config.sandbox_runner_url.clone(),
        sandbox_preview_host: state.config.sandbox_preview_host.clone(),
        db: state.db.clone(),
        extension_settings_key,
        app_state: Arc::new(state.clone()),
        permission_policy: permission_policy.clone(),
    });
    register_all(&mut registry, &builtin_config);
    crate::services::extensions::register_runtime_extensions(&mut registry, state).await?;
    if let Err(err) = mcp::register_dynamic_tools(&mut registry, &builtin_config).await {
        tracing::warn!(error = %err, "MCP dynamic tool registration failed");
    }
    register_agent_toolsets(&mut registry, &permission_policy);
    registry.validate_catalog().map_err(|error| {
        if error.tool == "<catalog>" {
            AppError::ServiceUnavailable(
                "The enabled tool catalog exceeds the supported provider limit. Disable optional integrations before retrying."
                    .to_string(),
            )
        } else {
            AppError::Internal(format!("built-in tool catalog invalid: {error}"))
        }
    })?;
    let tool_schemas_for_prompt = if use_moa {
        Vec::new()
    } else {
        registry.schemas()
    };
    let available_tool_names = tool_schemas_for_prompt
        .iter()
        .map(|schema| schema.function.name.clone())
        .collect::<Vec<_>>();
    let tool_capabilities_for_prompt = if use_moa {
        Vec::new()
    } else {
        registry.capability_snapshot()
    };
    let tool_capability_summary = (!use_moa).then(|| registry.capability_prompt_summary());
    let tool_schema_fingerprint =
        fingerprint_tool_schemas(&tool_schemas_for_prompt, &tool_capabilities_for_prompt)?;
    let tool_count = tool_schemas_for_prompt.len();
    let registry = Arc::new(registry);
    let memory_dir = state.config.agent_data_dir.join("memory");
    let memory_snapshot = MemoryStore::load(memory_dir)
        .ok()
        .map(|store| store.snapshot().clone());
    let skill_index = SkillRegistry::new(state.config.agent_data_dir.join("skills"))
        .system_prompt_index()
        .ok();
    let mut context_blocks = Vec::new();
    if let Some(index) = skill_index.filter(|index| !index.trim().is_empty()) {
        context_blocks.push(index);
    }
    context_blocks.push(format!(
        "DRIVE.md:\nPrivate workspace: /drive/agents/{}\nShared workspace: /drive/shared\nUse relative paths for private files, for example report.md or notes/plan.md. Use /drive/shared/... only for shared files. Do not include /drive/agents/{} in private file tool paths.\nThe runtime current directory is {}.",
        session.profile,
        session.profile,
        logical_path_for_runner(&working_dir)
    ));
    context_blocks.push(format!(
        "Available app data domains:\n{}",
        permission_policy.capability_summary()
    ));
    if let Some(summary) = tool_capability_summary.filter(|value| !value.is_empty()) {
        context_blocks.push(format!(
            "Tool capability policy (runtime-enforced metadata):\n{summary}"
        ));
    }

    let model = moa_runtime
        .as_ref()
        .map(|preset| preset.aggregator_provider.model.clone())
        .or_else(|| {
            default_runtime
                .as_ref()
                .map(|(_, config)| config.model.clone())
        })
        .unwrap_or_else(|| "unknown".to_string());
    let max_output_tokens = default_runtime
        .as_ref()
        .map(|(_, config)| config.max_tokens)
        .unwrap_or(16_384);
    let rows = fetch_message_rows(state, id).await?;
    let mut optional_blocks = Vec::new();
    if let Some(snapshot) = memory_snapshot {
        if !snapshot.user.trim().is_empty() {
            optional_blocks.push(("curated_user", format!("USER.md:\n{}", snapshot.user)));
        }
        if !snapshot.memory.trim().is_empty() {
            optional_blocks.push(("curated_memory", format!("MEMORY.md:\n{}", snapshot.memory)));
        }
    }
    if permission_policy.can_read(crate::models::agent::AgentToolDomain::Memory) {
        if let Some(run_id) = run_id {
            match crate::services::runtime_memory::automatic_recall_for_run(
                state,
                run_id,
                &session.profile,
                session.project_id,
                &text,
            )
            .await
            {
                Ok(Some(recall)) => {
                    metrics::histogram!("mymy_memory_recall_selected_count")
                        .record(recall.selected_count as f64);
                    metrics::histogram!("mymy_memory_recall_estimated_tokens")
                        .record(recall.estimated_tokens as f64);
                    optional_blocks.push(("automatic_recall", recall.prompt_block));
                }
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(%run_id, error = %error, "automatic memory recall degraded to empty context");
                }
            }
        }
    }
    let recent_message_tokens = rows
        .iter()
        .rev()
        .filter(|row| row_is_agent_context(row))
        .take(20)
        .map(row_to_agent_message)
        .map(|message| estimate_message_tokens(&message))
        .sum();
    let (volatile_blocks, dropped_recall) = select_optional_context_blocks(
        &model,
        max_output_tokens,
        &tool_schemas_for_prompt,
        &context_blocks,
        recent_message_tokens,
        &text,
        optional_blocks,
    )?;
    if dropped_recall {
        if let Some(run_id) = run_id {
            crate::services::runtime_memory::mark_recall_context_dropped(
                state,
                run_id,
                "global_context_budget",
            )
            .await?;
        }
    }
    let buffered_output_required = !volatile_blocks.is_empty();
    let prompt_parts = build_system_prompt_parts(&PromptConfig {
        soul_md_path: Some(drive::agent_soul_md_path(
            &state.config.agent_data_dir,
            &session.profile,
        )),
        agents_md_path: Some(drive::agent_agents_md_path(
            &state.config.agent_data_dir,
            &session.profile,
        )),
        working_dir,
        memory_md_path: None,
        user_md_path: None,
        available_tool_names,
        model,
        system_message: (!context_blocks.is_empty()).then(|| context_blocks.join("\n\n")),
        volatile_system_message: (!volatile_blocks.is_empty())
            .then(|| volatile_blocks.join("\n\n")),
    });
    let prompt_parts =
        resolve_prompt_snapshot(state, &session, &prompt_parts, &tool_schema_fingerprint).await?;
    let system_prompt = assemble_system_prompt(&prompt_parts);

    let mut messages = rows
        .iter()
        .filter(|row| row_is_agent_context(row))
        .map(row_to_agent_message)
        .collect::<Vec<_>>();
    let agent_user_text = resolve_skill_invocation(state, &text, id).await?;

    let (user_message, inserted) = match run_input_id {
        Some(input_id) => insert_user_message_for_input(state, id, input_id, &text).await?,
        None => (insert_user_message(state, id, &text).await?, true),
    };
    if inserted {
        messages.push(Message::user(agent_user_text));
    }
    let agent_message_start = messages.len();

    if inserted {
        let title = derive_title(&text);
        sqlx::query!(
            r#"UPDATE chat_sessions SET
                 message_count = message_count + 1,
                 title = COALESCE(NULLIF(title, ''), $2),
                 updated_at = now()
               WHERE id = $1"#,
            id,
            title,
        )
        .execute(&state.db)
        .await?;
    }

    let execution = if let Some(runtime) = moa_runtime {
        let proposers = runtime
            .proposer_providers
            .iter()
            .map(|provider| {
                Ok(MoaParticipant {
                    label: format!("{} ({})", provider.label, provider.model),
                    provider: Arc::new(DbRotatingProvider {
                        state: state.clone(),
                        provider_id: parse_runtime_provider_id(&provider.id)?,
                    }),
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        let aggregator = MoaParticipant {
            label: format!(
                "{} ({})",
                runtime.aggregator_provider.label, runtime.aggregator_provider.model
            ),
            provider: Arc::new(DbRotatingProvider {
                state: state.clone(),
                provider_id: parse_runtime_provider_id(&runtime.aggregator_provider.id)?,
            }),
        };
        PreparedExecution::Moa(PreparedMoaTurn {
            proposers,
            aggregator,
            config: MoaConfig {
                max_concurrent: runtime.max_concurrent,
                aggregation_prompt: runtime.aggregation_prompt,
            },
        })
    } else {
        let (provider_id, provider_config) = default_runtime
            .ok_or_else(|| AppError::Internal("default provider resolution missing".into()))?;
        let provider: Arc<dyn LlmProvider> = Arc::new(DbRotatingProvider {
            state: state.clone(),
            provider_id,
        });
        let context_manager =
            ContextManager::for_model(&provider_config.model, provider_config.max_tokens);
        let agent_loop = AgentLoop::new(
            provider,
            registry,
            LoopConfig::default(),
            Some(context_manager),
        )
        .with_clarify_gate(id, state.clarify_gate.clone())
        .with_todo_path(
            state
                .config
                .agent_data_dir
                .join("todos")
                .join(format!("{id}.json")),
        );
        PreparedExecution::Agent(Box::new(agent_loop))
    };

    tracing::info!(
        session_id = %id,
        profile = %session.profile,
        moa = use_moa,
        "prepared native chat turn"
    );

    Ok(PreparedNativeTurn {
        messages,
        agent_message_start,
        execution,
        system_prompt,
        user_message,
        tool_schema_fingerprint,
        tool_count,
        permission_fingerprint: permission_policy.fingerprint(),
        buffered_output_required,
    })
}

#[cfg(test)]
mod context_budget_tests {
    use super::*;

    #[test]
    fn optional_recall_is_dropped_as_a_whole_block_when_budget_is_exhausted() {
        let (selected, dropped_recall) = select_optional_context_blocks(
            "gpt-4o",
            16_384,
            &[],
            &[],
            0,
            "current request",
            vec![("automatic_recall", "기억".repeat(300_000))],
        )
        .unwrap();

        assert!(selected.is_empty());
        assert!(dropped_recall);
    }

    #[test]
    fn required_current_context_is_never_silently_truncated() {
        let error = select_optional_context_blocks(
            "gpt-4",
            4_096,
            &[],
            &[],
            0,
            &"required".repeat(20_000),
            Vec::new(),
        )
        .unwrap_err();

        assert!(matches!(error, AppError::PayloadTooLarge(_)));
    }
}
