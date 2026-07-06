//! Chat model — chat sessions and messages for agent conversations.
//!
//! See: web/src/types/index.ts (ChatSession, ChatMessage interfaces)

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::agent::clarify::ClarifyRequest;
use crate::agent::providers::types::{FinishReason, ToolCall, Usage};

/// Message role for persisted native agent chat messages.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    #[serde(alias = "agent")]
    Assistant,
    Tool,
    System,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallDto {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

impl From<&ToolCall> for ToolCallDto {
    fn from(call: &ToolCall) -> Self {
        Self {
            id: call.id.clone(),
            name: call.name.clone(),
            arguments: call.arguments.clone(),
        }
    }
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
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatSseEvent {
    UserMessage {
        message: Box<ChatMessage>,
    },
    TextDelta {
        content: String,
    },
    ReasoningDelta {
        content: String,
    },
    ToolCallStart {
        call_id: String,
        tool_name: String,
        arguments: String,
    },
    ToolCallFinish {
        call_id: String,
        result: String,
        error: Option<String>,
    },
    Clarify {
        request: ClarifyRequest,
    },
    TurnCompleted {
        finish_reason: FinishReason,
        usage: Usage,
    },
    ContextCompressing,
    Done {
        assistant_message: Option<Box<ChatMessage>>,
        session: Box<ChatSession>,
        total_api_calls: u32,
        total_tool_calls: u32,
    },
    Error {
        message: String,
    },
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
    #[serde(default)]
    pub profile: Option<String>,
}

/// Payload for sending a message to a chat session.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub text: String,
    #[serde(default)]
    pub use_moa: bool,
    #[serde(default)]
    pub moa_preset_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ClarifyAnswerRequest {
    pub answer: String,
}

#[derive(Debug, Serialize)]
pub struct ClarifyAnswerResponse {
    pub success: bool,
}

#[derive(Debug, Serialize)]
pub struct DeleteResponse {
    pub success: bool,
}
