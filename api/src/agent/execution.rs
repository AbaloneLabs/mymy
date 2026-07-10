//! Identity and policy context shared by every durable agent execution.
//!
//! HTTP requests, scheduler ticks, and delegated children all enter the same
//! runtime contract. The types here intentionally contain no transport state:
//! a reconnecting subscriber cannot change ownership, while a lease epoch and
//! cancellation token can be carried down to every tool invocation.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::agent::providers::Message;
use crate::agent::tools::ToolCapability;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionTrigger {
    Chat,
    Cron {
        job_id: String,
    },
    Wake,
    Delegate {
        parent_run_id: Uuid,
        parent_event_id: Uuid,
        delegate_index: u32,
    },
}

impl SessionTrigger {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Cron { .. } => "cron",
            Self::Wake => "wake",
            Self::Delegate { .. } => "delegate",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationContext {
    #[serde(default)]
    pub explicit_user_action: bool,
    #[serde(default)]
    pub approval_ceiling: Value,
    #[serde(default)]
    pub budget: Value,
}

#[derive(Clone, Default)]
pub struct RunCancellation {
    token: CancellationToken,
}

impl std::fmt::Debug for RunCancellation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RunCancellation")
            .field("cancelled", &self.is_cancelled())
            .finish()
    }
}

impl RunCancellation {
    pub fn new() -> Self {
        Self {
            token: CancellationToken::new(),
        }
    }

    pub fn cancel(&self) {
        self.token.cancel();
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }

    pub async fn cancelled(&self) {
        self.token.cancelled().await;
    }
}

#[derive(Clone)]
pub struct ToolExecutionContext {
    pub run_id: Uuid,
    pub session_id: Option<Uuid>,
    pub agent_profile: String,
    pub trigger: SessionTrigger,
    pub project_id: Option<Uuid>,
    pub authorization: AuthorizationContext,
    pub invocation_id: String,
    pub lease_epoch: i64,
    pub cancellation: RunCancellation,
    pub guard: Option<Arc<dyn ToolExecutionGuard>>,
    pub progress: Option<Arc<dyn RunProgressStore>>,
    pub decisions: Option<Arc<dyn DecisionCoordinator>>,
}

#[async_trait::async_trait]
pub trait ToolExecutionGuard: Send + Sync {
    async fn validate(
        &self,
        context: &ToolExecutionContext,
        tool_name: &str,
        toolset: &str,
        capability: &ToolCapability,
        arguments: &Value,
    ) -> Result<(), String>;
}

#[async_trait::async_trait]
pub trait RunProgressStore: Send + Sync {
    async fn completion_reminder(
        &self,
        context: &ToolExecutionContext,
    ) -> Result<Option<String>, String>;

    async fn create_checkpoint(
        &self,
        context: &ToolExecutionContext,
        messages: &[Message],
    ) -> Result<String, String>;
}

#[derive(Debug, Clone)]
pub struct DurableDecision {
    pub id: Uuid,
    pub session_id: Option<Uuid>,
    pub question: String,
    pub choices: Vec<String>,
    pub created_at: String,
}

#[async_trait::async_trait]
pub trait DecisionCoordinator: Send + Sync {
    async fn create_choice(
        &self,
        context: &ToolExecutionContext,
        question: &str,
        choices: &[String],
        messages: &[Message],
    ) -> Result<DurableDecision, String>;

    async fn create_approval(
        &self,
        context: &ToolExecutionContext,
        question: &str,
        proposed_action: Value,
        target_version: Option<String>,
        messages: &[Message],
    ) -> Result<DurableDecision, String>;
}

impl ToolExecutionContext {
    pub fn for_invocation(&self, provider_call_id: &str) -> Self {
        let mut context = self.clone();
        context.invocation_id =
            format!("{}:{}:{}", self.run_id, self.lease_epoch, provider_call_id);
        context
    }
}
