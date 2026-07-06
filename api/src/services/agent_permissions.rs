//! Agent tool permission policy.
//!
//! This service is the single source of truth for what an agent may know how
//! to do. Tool schemas and prompt capability summaries are derived from this
//! policy instead of from static defaults, so denied domains are not merely
//! blocked at execution time; they are absent from the model's tool list.

use std::collections::HashMap;

use sqlx::FromRow;

use crate::error::{AppError, AppResult};
use crate::models::agent::{AgentToolAccess, AgentToolDomain, AgentToolPermission};
use crate::state::AppState;

pub const ALL_DOMAINS: &[AgentToolDomain] = &[
    AgentToolDomain::Prompts,
    AgentToolDomain::Memory,
    AgentToolDomain::Sessions,
    AgentToolDomain::Goals,
    AgentToolDomain::Calendar,
    AgentToolDomain::Tasks,
    AgentToolDomain::Knowledge,
    AgentToolDomain::Notes,
    AgentToolDomain::Drive,
    AgentToolDomain::Processes,
    AgentToolDomain::Finance,
    AgentToolDomain::Investments,
    AgentToolDomain::Agents,
];

#[derive(Debug, Clone)]
pub struct AgentPermissionPolicy {
    permissions: HashMap<AgentToolDomain, AgentToolAccess>,
}

#[derive(Debug, FromRow)]
struct PermissionRow {
    domain: String,
    access: String,
}

impl AgentPermissionPolicy {
    pub fn from_permissions(permissions: Vec<AgentToolPermission>) -> Self {
        let mut map = default_permissions();
        for permission in permissions {
            map.insert(permission.domain, permission.access);
        }
        Self { permissions: map }
    }

    pub fn access_for(&self, domain: AgentToolDomain) -> AgentToolAccess {
        self.permissions
            .get(&domain)
            .copied()
            .unwrap_or_else(|| default_access(domain))
    }

    pub fn can_read(&self, domain: AgentToolDomain) -> bool {
        matches!(
            self.access_for(domain),
            AgentToolAccess::Access | AgentToolAccess::ReadOnly
        )
    }

    pub fn can_write(&self, domain: AgentToolDomain) -> bool {
        self.access_for(domain) == AgentToolAccess::Access
    }

    pub fn permissions(&self) -> Vec<AgentToolPermission> {
        ALL_DOMAINS
            .iter()
            .copied()
            .map(|domain| AgentToolPermission {
                domain,
                access: self.access_for(domain),
            })
            .collect()
    }

    pub fn capability_summary(&self) -> String {
        let mut readable = Vec::new();
        let mut writable = Vec::new();
        for domain in ALL_DOMAINS {
            match self.access_for(*domain) {
                AgentToolAccess::Access => writable.push(domain_label(*domain)),
                AgentToolAccess::ReadOnly => readable.push(domain_label(*domain)),
                AgentToolAccess::Denied => {}
            }
        }

        let mut lines = Vec::new();
        if !writable.is_empty() {
            lines.push(format!("Writable domains: {}.", writable.join(", ")));
        }
        if !readable.is_empty() {
            lines.push(format!("Read-only domains: {}.", readable.join(", ")));
        }
        if lines.is_empty() {
            "No app data domains are currently available through tools.".to_string()
        } else {
            lines.join("\n")
        }
    }
}

pub async fn load_policy(state: &AppState, profile: &str) -> AppResult<AgentPermissionPolicy> {
    ensure_defaults(state, profile).await?;
    let rows = sqlx::query_as::<_, PermissionRow>(
        r#"SELECT domain, access
           FROM native_agent_tool_permissions
           WHERE profile = $1"#,
    )
    .bind(profile)
    .fetch_all(&state.db)
    .await?;

    let permissions = rows
        .into_iter()
        .map(|row| {
            let domain = parse_domain(&row.domain)?;
            let access = parse_access(&row.access)?;
            Ok(AgentToolPermission { domain, access })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(AgentPermissionPolicy::from_permissions(permissions))
}

pub async fn list_permissions(
    state: &AppState,
    profile: &str,
) -> AppResult<Vec<AgentToolPermission>> {
    Ok(load_policy(state, profile).await?.permissions())
}

pub async fn replace_permissions(
    state: &AppState,
    profile: &str,
    permissions: Vec<AgentToolPermission>,
) -> AppResult<Vec<AgentToolPermission>> {
    ensure_defaults(state, profile).await?;
    let mut tx = state.db.begin().await?;
    for permission in permissions {
        sqlx::query(
            r#"INSERT INTO native_agent_tool_permissions (profile, domain, access)
               VALUES ($1, $2, $3)
               ON CONFLICT (profile, domain) DO UPDATE
               SET access = EXCLUDED.access, updated_at = now()"#,
        )
        .bind(profile)
        .bind(domain_slug(permission.domain))
        .bind(access_slug(permission.access))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    list_permissions(state, profile).await
}

pub async fn ensure_defaults(state: &AppState, profile: &str) -> AppResult<()> {
    for domain in ALL_DOMAINS {
        sqlx::query(
            r#"INSERT INTO native_agent_tool_permissions (profile, domain, access)
               VALUES ($1, $2, $3)
               ON CONFLICT (profile, domain) DO NOTHING"#,
        )
        .bind(profile)
        .bind(domain_slug(*domain))
        .bind(access_slug(default_access(*domain)))
        .execute(&state.db)
        .await?;
    }
    Ok(())
}

fn default_permissions() -> HashMap<AgentToolDomain, AgentToolAccess> {
    ALL_DOMAINS
        .iter()
        .copied()
        .map(|domain| (domain, default_access(domain)))
        .collect()
}

fn default_access(domain: AgentToolDomain) -> AgentToolAccess {
    match domain {
        AgentToolDomain::Agents | AgentToolDomain::Sessions => AgentToolAccess::ReadOnly,
        _ => AgentToolAccess::Access,
    }
}

pub fn domain_slug(domain: AgentToolDomain) -> &'static str {
    match domain {
        AgentToolDomain::Prompts => "prompts",
        AgentToolDomain::Memory => "memory",
        AgentToolDomain::Sessions => "sessions",
        AgentToolDomain::Goals => "goals",
        AgentToolDomain::Calendar => "calendar",
        AgentToolDomain::Tasks => "tasks",
        AgentToolDomain::Knowledge => "knowledge",
        AgentToolDomain::Notes => "notes",
        AgentToolDomain::Drive => "drive",
        AgentToolDomain::Processes => "processes",
        AgentToolDomain::Finance => "finance",
        AgentToolDomain::Investments => "investments",
        AgentToolDomain::Agents => "agents",
    }
}

pub fn access_slug(access: AgentToolAccess) -> &'static str {
    match access {
        AgentToolAccess::Access => "access",
        AgentToolAccess::ReadOnly => "read_only",
        AgentToolAccess::Denied => "denied",
    }
}

pub fn parse_domain(value: &str) -> AppResult<AgentToolDomain> {
    match value {
        "prompts" => Ok(AgentToolDomain::Prompts),
        "memory" => Ok(AgentToolDomain::Memory),
        "sessions" => Ok(AgentToolDomain::Sessions),
        "goals" => Ok(AgentToolDomain::Goals),
        "calendar" => Ok(AgentToolDomain::Calendar),
        "tasks" => Ok(AgentToolDomain::Tasks),
        "knowledge" => Ok(AgentToolDomain::Knowledge),
        "notes" => Ok(AgentToolDomain::Notes),
        "drive" => Ok(AgentToolDomain::Drive),
        "processes" => Ok(AgentToolDomain::Processes),
        "finance" => Ok(AgentToolDomain::Finance),
        "investments" => Ok(AgentToolDomain::Investments),
        "agents" => Ok(AgentToolDomain::Agents),
        _ => Err(AppError::BadRequest(format!(
            "unknown agent tool permission domain: {value}"
        ))),
    }
}

pub fn parse_access(value: &str) -> AppResult<AgentToolAccess> {
    match value {
        "access" => Ok(AgentToolAccess::Access),
        "read_only" => Ok(AgentToolAccess::ReadOnly),
        "denied" => Ok(AgentToolAccess::Denied),
        _ => Err(AppError::BadRequest(format!(
            "unknown agent tool permission access: {value}"
        ))),
    }
}

fn domain_label(domain: AgentToolDomain) -> &'static str {
    match domain {
        AgentToolDomain::Prompts => "prompts",
        AgentToolDomain::Memory => "memory",
        AgentToolDomain::Sessions => "sessions",
        AgentToolDomain::Goals => "goals",
        AgentToolDomain::Calendar => "calendar",
        AgentToolDomain::Tasks => "tasks",
        AgentToolDomain::Knowledge => "knowledge",
        AgentToolDomain::Notes => "notes",
        AgentToolDomain::Drive => "drive",
        AgentToolDomain::Processes => "processes",
        AgentToolDomain::Finance => "finance",
        AgentToolDomain::Investments => "investments",
        AgentToolDomain::Agents => "agents",
    }
}
