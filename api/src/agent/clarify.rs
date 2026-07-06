//! Clarifying-question gate for interactive agent turns.
//!
//! Clarify requests are live SSE continuation points. The agent loop waits on
//! a one-shot receiver while the web UI posts the user's answer back to the
//! matching request id.

use std::collections::HashMap;

use chrono::Utc;
use serde::Serialize;
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarifyRequest {
    pub request_id: String,
    pub session_id: Uuid,
    pub question: String,
    pub choices: Vec<String>,
    pub created_at: String,
}

#[derive(Default)]
pub struct ClarifyGate {
    pending: Mutex<HashMap<String, PendingClarify>>,
}

struct PendingClarify {
    session_id: Uuid,
    sender: oneshot::Sender<String>,
}

impl ClarifyGate {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn request(
        &self,
        session_id: Uuid,
        question: impl Into<String>,
        choices: Vec<String>,
    ) -> (ClarifyRequest, oneshot::Receiver<String>) {
        let request_id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .await
            .insert(request_id.clone(), PendingClarify { session_id, sender });
        let request = ClarifyRequest {
            request_id,
            session_id,
            question: question.into(),
            choices,
            created_at: Utc::now().to_rfc3339(),
        };
        (request, receiver)
    }

    pub async fn resolve(&self, session_id: Uuid, request_id: &str, answer: String) -> bool {
        let Some(pending) = self.pending.lock().await.remove(request_id) else {
            return false;
        };
        if pending.session_id != session_id {
            tracing::warn!(
                expected_session_id = %pending.session_id,
                actual_session_id = %session_id,
                request_id,
                "clarify answer session mismatch"
            );
            return false;
        }
        pending.sender.send(answer).is_ok()
    }

    pub async fn cancel(&self, request_id: &str) {
        self.pending.lock().await.remove(request_id);
    }
}

pub fn normalize_choices(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .flat_map(|choice| choice.split('\n'))
                .map(str::trim)
                .filter(|choice| !choice.is_empty())
                .take(4)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choices_are_flattened_and_capped() {
        let choices = normalize_choices(Some(&serde_json::json!([
            "Postgres\nSQLite",
            "MySQL",
            "",
            "DuckDB",
            "Extra"
        ])));
        assert_eq!(choices, vec!["Postgres", "SQLite", "MySQL", "DuckDB"]);
    }

    #[tokio::test]
    async fn resolve_delivers_answer_once() {
        let gate = ClarifyGate::new();
        let session_id = Uuid::new_v4();
        let (request, receiver) = gate
            .request(session_id, "Which DB?", vec!["Postgres".to_string()])
            .await;
        assert!(
            gate.resolve(session_id, &request.request_id, "Postgres".to_string())
                .await
        );
        assert_eq!(receiver.await.unwrap(), "Postgres");
        assert!(
            !gate
                .resolve(session_id, &request.request_id, "SQLite".to_string())
                .await
        );
    }
}
