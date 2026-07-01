//! Interactive approval gate for high-risk agent actions.
//!
//! The approval gate is deliberately runtime-owned instead of persisted in the
//! chat database. A pending approval is a live continuation point in an SSE
//! stream: the agent loop waits on a one-shot channel and the HTTP approval
//! endpoint resolves that channel. Persisted records would make stale approval
//! requests look actionable after the loop has already timed out.

use std::collections::{HashMap, HashSet};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

use super::dangerous::{DangerousMatch, Severity};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    Approve,
    Reject,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalRemember {
    #[default]
    Session,
    Permanent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub request_id: String,
    pub session_id: Uuid,
    pub tool_name: String,
    pub command: String,
    pub pattern_key: String,
    pub description: String,
    pub severity: String,
    pub created_at: String,
}

#[derive(Default)]
pub struct ApprovalGate {
    pending: Mutex<HashMap<String, PendingApproval>>,
    session_approvals: Mutex<HashSet<(Uuid, String)>>,
    permanent_approvals: Mutex<HashSet<String>>,
    yolo_sessions: Mutex<HashSet<Uuid>>,
}

struct PendingApproval {
    session_id: Uuid,
    pattern_key: String,
    sender: oneshot::Sender<ApprovalDecision>,
}

impl ApprovalGate {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn is_approved_for_session(&self, session_id: Uuid, pattern_key: &str) -> bool {
        if self.yolo_sessions.lock().await.contains(&session_id) {
            return true;
        }
        let key = pattern_key.to_string();
        if self.permanent_approvals.lock().await.contains(&key) {
            return true;
        }
        self.session_approvals
            .lock()
            .await
            .contains(&(session_id, key))
    }

    pub async fn remember_session_approval(
        &self,
        session_id: Uuid,
        pattern_key: impl Into<String>,
    ) {
        self.session_approvals
            .lock()
            .await
            .insert((session_id, pattern_key.into()));
    }

    pub async fn remember_permanent_approval(&self, pattern_key: impl Into<String>) {
        self.permanent_approvals
            .lock()
            .await
            .insert(pattern_key.into());
    }

    pub async fn set_yolo_mode(&self, session_id: Uuid, enabled: bool) {
        let mut sessions = self.yolo_sessions.lock().await;
        if enabled {
            sessions.insert(session_id);
        } else {
            sessions.remove(&session_id);
        }
    }

    pub async fn request_approval(
        &self,
        session_id: Uuid,
        tool_name: impl Into<String>,
        command: impl Into<String>,
        matched: &DangerousMatch,
    ) -> (ApprovalRequest, oneshot::Receiver<ApprovalDecision>) {
        let request_id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(
            request_id.clone(),
            PendingApproval {
                session_id,
                pattern_key: matched.pattern_key.clone(),
                sender,
            },
        );
        let request = ApprovalRequest {
            request_id,
            session_id,
            tool_name: tool_name.into(),
            command: command.into(),
            pattern_key: matched.pattern_key.clone(),
            description: matched.description.clone(),
            severity: severity_label(matched.severity).to_string(),
            created_at: Utc::now().to_rfc3339(),
        };
        (request, receiver)
    }

    pub async fn resolve(
        &self,
        session_id: Uuid,
        request_id: &str,
        decision: ApprovalDecision,
        remember: ApprovalRemember,
    ) -> bool {
        let Some(pending) = self.pending.lock().await.remove(request_id) else {
            return false;
        };
        if pending.session_id != session_id {
            tracing::warn!(
                expected_session_id = %pending.session_id,
                actual_session_id = %session_id,
                request_id,
                "approval decision session mismatch"
            );
            return false;
        }

        let pattern_key = pending.pattern_key.clone();
        let delivered = pending.sender.send(decision).is_ok();
        if delivered && decision == ApprovalDecision::Approve {
            match remember {
                ApprovalRemember::Session => {
                    self.remember_session_approval(session_id, pattern_key)
                        .await;
                }
                ApprovalRemember::Permanent => {
                    self.remember_permanent_approval(pattern_key).await;
                }
            }
        }
        if !delivered {
            tracing::warn!(
                session_id = %session_id,
                request_id,
                "approval decision arrived after request was closed"
            );
        }
        delivered
    }

    pub async fn cancel(&self, request_id: &str) {
        self.pending.lock().await.remove(request_id);
    }
}

fn severity_label(severity: Severity) -> &'static str {
    match severity {
        Severity::Hardline => "hardline",
        Severity::Dangerous => "dangerous",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn session_approval_is_scoped_to_session() {
        let gate = ApprovalGate::new();
        let session = Uuid::new_v4();
        let other = Uuid::new_v4();

        gate.remember_session_approval(session, "recursive_delete")
            .await;

        assert!(
            gate.is_approved_for_session(session, "recursive_delete")
                .await
        );
        assert!(
            !gate
                .is_approved_for_session(other, "recursive_delete")
                .await
        );
    }

    #[tokio::test]
    async fn request_resolves_waiter_once() {
        let gate = ApprovalGate::new();
        let session = Uuid::new_v4();
        let matched = DangerousMatch {
            pattern_key: "recursive_delete".to_string(),
            description: "recursive delete".to_string(),
            severity: Severity::Dangerous,
        };

        let (request, receiver) = gate
            .request_approval(session, "terminal", "rm -rf target/tmp", &matched)
            .await;

        assert!(
            gate.resolve(
                session,
                &request.request_id,
                ApprovalDecision::Approve,
                ApprovalRemember::Session,
            )
            .await
        );
        assert_eq!(receiver.await.unwrap(), ApprovalDecision::Approve);
        assert!(
            !gate
                .resolve(
                    session,
                    &request.request_id,
                    ApprovalDecision::Reject,
                    ApprovalRemember::Session,
                )
                .await
        );
    }

    #[tokio::test]
    async fn permanent_and_yolo_approvals_are_honored() {
        let gate = ApprovalGate::new();
        let session = Uuid::new_v4();
        let other = Uuid::new_v4();

        gate.remember_permanent_approval("sql_drop").await;
        assert!(gate.is_approved_for_session(other, "sql_drop").await);

        gate.set_yolo_mode(session, true).await;
        assert!(
            gate.is_approved_for_session(session, "never_seen_pattern")
                .await
        );
        gate.set_yolo_mode(session, false).await;
        assert!(
            !gate
                .is_approved_for_session(session, "never_seen_pattern")
                .await
        );
    }
}
