//! Route handlers module.

pub mod agent_ops;
pub mod agent_prompts;
pub mod agent_systems;
pub mod agents;
pub mod audit;
pub mod auth;
pub mod calendar;
pub mod chat;
pub mod cron;
pub mod drive;
pub mod extensions;
pub mod goals;
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

use std::sync::Arc;

use axum::routing::get;
use axum::Router;

use crate::state::AppState;

/// Build the complete API router.
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .merge(auth::routes())
        .merge(agent_prompts::routes())
        .merge(agent_systems::routes())
        .merge(agent_ops::routes())
        .merge(agents::routes())
        .merge(projects::routes())
        .merge(drive::routes())
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
        .merge(transactions::routes())
        .merge(audit::routes())
        .merge(versions::routes())
        .route("/api/health", get(health))
}

async fn health() -> &'static str {
    "ok"
}
