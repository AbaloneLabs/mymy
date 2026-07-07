//! Route handlers module.

pub mod agent_prompts;
pub mod agents;
pub mod audit;
pub mod auth;
pub mod calendar;
pub mod chat;
pub mod cron;
pub mod document_editor;
pub mod drive;
pub mod editor_settings;
pub mod extensions;
pub mod goals;
pub mod investments;
pub mod journey;
pub mod knowledge;
pub mod llm_providers;
pub mod mcp;
pub mod media;
pub mod moa;
pub mod notes;
pub mod previews;
pub mod projects;
pub mod sandbox;
pub mod search;
pub mod settings;
pub mod skills;
pub mod task_statuses;
pub mod tasks;
pub mod transactions;
pub mod versions;
pub mod web_viewer;

use std::sync::Arc;

use axum::routing::get;
use axum::Router;

use crate::state::AppState;

/// Build the complete API router.
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .merge(auth::routes())
        .merge(agent_prompts::routes())
        .merge(agents::routes())
        .merge(projects::routes())
        .merge(drive::routes())
        .merge(document_editor::routes())
        .merge(editor_settings::routes())
        .merge(sandbox::routes())
        .merge(chat::routes())
        .merge(cron::routes())
        .merge(extensions::routes())
        .merge(settings::routes())
        .merge(calendar::routes())
        .merge(notes::routes())
        .merge(previews::routes())
        .merge(knowledge::routes())
        .merge(journey::routes())
        .merge(llm_providers::routes())
        .merge(media::routes())
        .merge(mcp::routes())
        .merge(moa::routes())
        .merge(search::routes())
        .merge(skills::routes())
        .merge(tasks::routes())
        .merge(task_statuses::routes())
        .merge(goals::routes())
        .merge(investments::routes())
        .merge(transactions::routes())
        .merge(audit::routes())
        .merge(versions::routes())
        .merge(web_viewer::routes())
        .route("/api/health", get(health))
}

async fn health() -> &'static str {
    "ok"
}
