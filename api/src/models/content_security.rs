//! Public content-admission and quarantine models.
//!
//! These models intentionally contain only bounded, policy-defined fields.
//! Detector diagnostics, remote URLs, archive entry names, and storage paths
//! are never part of the public contract because they may contain
//! attacker-controlled or deployment-sensitive data.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContentOrigin {
    UserEdit,
    UserUpload,
    AgentGenerated,
    AgentDownload,
    S3Download,
    ConnectorImport,
    EditorOutput,
}

impl ContentOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UserEdit => "user_edit",
            Self::UserUpload => "user_upload",
            Self::AgentGenerated => "agent_generated",
            Self::AgentDownload => "agent_download",
            Self::S3Download => "s3_download",
            Self::ConnectorImport => "connector_import",
            Self::EditorOutput => "editor_output",
        }
    }

    pub fn is_external(self) -> bool {
        matches!(
            self,
            Self::UserUpload | Self::AgentDownload | Self::S3Download | Self::ConnectorImport
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContentSafetyVerdict {
    Pass,
    Restricted,
    ReviewRequired,
    Reject,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Notice,
    Suspicious,
    Dangerous,
    Invalid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum FindingCode {
    AmbiguousFilename,
    DoubleExtension,
    DeclaredTypeMismatch,
    ExecutableContent,
    ScriptContent,
    UnknownContentType,
    RestrictedFormat,
    ArchiveActiveContent,
    OoxmlMacro,
    OoxmlActiveX,
    OoxmlOleEmbedding,
    OoxmlExternalRelationship,
    OoxmlSvgContent,
    ArchiveResourceLimit,
    InvalidArchiveStructure,
    InvalidDocumentStructure,
    InvalidMediaStructure,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentSafetyFinding {
    pub code: FindingCode,
    pub severity: FindingSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentSafetyReport {
    pub normalized_name: String,
    pub detected_type: String,
    pub verdict: ContentSafetyVerdict,
    pub findings: Vec<ContentSafetyFinding>,
    pub policy_version: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineItem {
    pub id: String,
    pub desired_path: String,
    pub normalized_name: String,
    pub detected_type: String,
    pub origin: ContentOrigin,
    pub actor_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_label: Option<String>,
    pub size: u64,
    pub findings: Vec<ContentSafetyFinding>,
    pub policy_version: String,
    pub status: String,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineListResponse {
    pub items: Vec<QuarantineItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuarantineListQuery {
    #[serde(default = "default_pending_status")]
    pub status: String,
    pub cursor: Option<String>,
}

fn default_pending_status() -> String {
    "pending".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveQuarantineRequest {
    pub expected_version: i64,
    pub idempotency_key: String,
    /// Optional explicit save-as destination used after a target conflict.
    pub destination_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteQuarantineRequest {
    pub expected_version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineDecisionResponse {
    pub id: String,
    pub status: String,
    pub version: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub committed_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}
