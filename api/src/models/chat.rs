//! Chat model — chat sessions and messages for agent conversations.
//!
//! See: web/src/types/index.ts (ChatSession, ChatMessage interfaces)

use serde::{Deserialize, Serialize};

/// Message role: user or agent.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Agent,
}

/// Session status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Active,
    Archived,
}

/// A chat session (conversation thread).
///
/// `project_id` is optional to support general (non-project) conversations.
/// Serialized as camelCase to match the frontend `ChatSession` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hermes_session_id: Option<String>,
    pub agent_id: String,
    pub profile: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub status: SessionStatus,
    pub message_count: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// A single chat message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: MessageRole,
    pub content: String,
    pub created_at: String,
}

// ============================================================
// Response wrappers
// ============================================================

#[derive(Debug, Serialize)]
pub struct ChatSessionsResponse {
    pub sessions: Vec<ChatSession>,
}

#[derive(Debug, Serialize)]
pub struct ChatSessionResponse {
    pub session: ChatSession,
}

#[derive(Debug, Serialize)]
pub struct ChatMessagesResponse {
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageResponse {
    pub user_message: ChatMessage,
    pub agent_message: ChatMessage,
    pub session: ChatSession,
}

// ============================================================
// Request payloads
// ============================================================

/// Payload for creating a new chat session.
///
/// `project_id` is optional to support general (non-project) conversations.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default = "default_profile")]
    pub profile: String,
}

fn default_profile() -> String {
    "default".to_string()
}

/// Payload for sending a message to a chat session.
#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteResponse {
    pub success: bool,
}
