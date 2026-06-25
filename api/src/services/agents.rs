//! Agents service.

use crate::error::AppResult;
use crate::models::agent::{Agent, AgentsResponse};
use crate::services::hermes;
use crate::state::AppState;

pub async fn list_agents(state: &AppState) -> AppResult<AgentsResponse> {
    let instances = sqlx::query!(
        r#"SELECT id, type, connection, cli_path, profile_dir
           FROM agent_system_instances
           WHERE type = 'hermes' AND enabled = true"#
    )
    .fetch_all(&state.db)
    .await?;

    let mut agents: Vec<Agent> = Vec::new();

    for inst in instances {
        if inst.connection == "local" {
            let result = hermes::discover_local_hermes();
            agents.extend(result.agents);
        }
    }

    if agents.is_empty() {
        let result = hermes::discover_local_hermes();
        agents.extend(result.agents);
    }

    Ok(AgentsResponse { agents })
}
