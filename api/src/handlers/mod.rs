//! Route handlers module.

pub mod agent_ops;
pub mod agent_systems;
pub mod agents;
pub mod audit;
pub mod auth;
pub mod calendar;
pub mod chat;
pub mod goals;
pub mod knowledge;
pub mod notes;
pub mod projects;
pub mod search;
pub mod settings;
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
        .merge(agent_systems::routes())
        .merge(agent_ops::routes())
        .merge(agents::routes())
        .merge(projects::routes())
        .merge(chat::routes())
        .merge(settings::routes())
        .merge(calendar::routes())
        .merge(notes::routes())
        .merge(knowledge::routes())
        .merge(search::routes())
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
