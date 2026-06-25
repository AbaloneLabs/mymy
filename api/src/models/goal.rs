//! Goal / OKR models — mirrors frontend `Goal` / `KeyResult`.
//!
//! See: web/src/types/index.ts (Goal, KeyResult interfaces)
//!
//! All id/timestamp fields are `String` (serialized from DB `Uuid`/`timestamptz`
//! in the handler's `row_to_goal`), matching the notes/tasks pattern.
//!
//! `progress` is computed on-demand by the backend (average of key-result
//! progress) and is not stored in the DB.

use serde::{Deserialize, Serialize};

/// A key result (quantitative metric) belonging to a goal.
///
/// Serialized as camelCase to match the frontend `KeyResult` interface.
/// `progress` is computed: `min(100, current_value / target_value * 100)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyResult {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub kpi_type: String,
    pub target_value: f64,
    pub current_value: f64,
    pub unit: String,
    /// 0-100, computed from current/target. Capped at 100.
    pub progress: f64,
    pub created_at: String,
    pub updated_at: String,
}

/// A goal / OKR objective as exposed over the API.
///
/// Serialized as camelCase to match the frontend `Goal` interface.
/// `keyResults` is populated on detail fetches; `progress` is the average
/// of the key results' progress (0 if there are none).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub title: String,
    pub description: String,
    /// "quarterly" | "annual" | "monthly"
    pub r#type: String,
    /// Free-form period label, e.g. "2026-Q3", "2026", "2026-06".
    pub period: String,
    /// "active" | "completed" | "archived"
    pub status: String,
    /// 0-100, average of key results' progress. Computed by the backend.
    pub progress: f64,
    /// Present on detail fetches (GET /api/goals/{id}); omitted on list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_results: Option<Vec<KeyResult>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalsResponse {
    pub goals: Vec<Goal>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalResponse {
    pub goal: Goal,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyResultResponse {
    pub key_result: KeyResult,
}

/// Payload for creating a new goal.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalRequest {
    pub title: String,
    pub description: Option<String>,
    pub r#type: Option<String>,
    pub period: Option<String>,
    pub status: Option<String>,
}

/// Payload for patching a goal (all fields optional, COALESCE patch).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGoalRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub r#type: Option<String>,
    pub period: Option<String>,
    pub status: Option<String>,
}

/// Payload for creating a new key result under a goal.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKeyResultRequest {
    pub title: String,
    pub kpi_type: Option<String>,
    pub target_value: Option<f64>,
    pub current_value: Option<f64>,
    pub unit: Option<String>,
}

/// Payload for patching a key result (all fields optional, COALESCE patch).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKeyResultRequest {
    pub title: Option<String>,
    pub kpi_type: Option<String>,
    pub target_value: Option<f64>,
    pub current_value: Option<f64>,
    pub unit: Option<String>,
}
