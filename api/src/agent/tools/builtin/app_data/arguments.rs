//! Typed argument decoding for app-data tools.
//!
//! Schemas are provider-facing, while service DTOs are application-facing.
//! This module is the only translation layer between the two and returns
//! stable invalid-argument errors before execution can begin.

use serde::de::DeserializeOwned;
use serde_json::Value;
use uuid::Uuid;

use crate::agent::tools::ToolError;
use crate::models::knowledge::KnowledgeTreeQuery;
use crate::services::calendar::EventQuery;
use crate::services::chat::SessionQuery;
use crate::services::goals::GoalQuery;
use crate::services::investments::InvestmentListQuery;
use crate::services::notes::NoteQuery;
use crate::services::transactions::TransactionQuery;

pub(super) fn typed<T: DeserializeOwned>(args: &Value) -> Result<T, ToolError> {
    serde_json::from_value(args.clone())
        .map_err(|err| ToolError::InvalidArgs(format!("invalid arguments: {err}")))
}

pub(super) fn typed_data<T: DeserializeOwned>(args: &Value) -> Result<T, ToolError> {
    let data = args
        .get("data")
        .ok_or_else(|| ToolError::InvalidArgs("missing data".to_string()))?;
    serde_json::from_value(data.clone())
        .map_err(|err| ToolError::InvalidArgs(format!("invalid data: {err}")))
}

pub(super) fn typed_session_query(args: &Value) -> Result<SessionQuery, ToolError> {
    Ok(SessionQuery {
        project_id: string_field(args, "projectId"),
        scope: string_field(args, "scope"),
        profile: string_field(args, "profile"),
    })
}

pub(super) fn typed_goal_query(args: &Value) -> Result<GoalQuery, ToolError> {
    Ok(GoalQuery {
        status: string_field(args, "status"),
        r#type: string_field(args, "type"),
        period: string_field(args, "period"),
    })
}

pub(super) fn typed_event_query(args: &Value) -> Result<EventQuery, ToolError> {
    Ok(EventQuery {
        project_id: string_field(args, "projectId"),
        from: string_field(args, "from"),
        to: string_field(args, "to"),
    })
}

pub(super) fn typed_note_query(args: &Value) -> Result<NoteQuery, ToolError> {
    Ok(NoteQuery {
        project_id: string_field(args, "projectId"),
        scope: string_field(args, "scope"),
    })
}

pub(super) fn typed_knowledge_tree_query(args: &Value) -> Result<KnowledgeTreeQuery, ToolError> {
    Ok(KnowledgeTreeQuery {
        project_id: string_field(args, "projectId"),
    })
}

pub(super) fn typed_transaction_query(args: &Value) -> Result<TransactionQuery, ToolError> {
    Ok(TransactionQuery {
        project_id: string_field(args, "projectId"),
        scope: string_field(args, "scope"),
        r#type: string_field(args, "type"),
        from: string_field(args, "from"),
        to: string_field(args, "to"),
        category: string_field(args, "category"),
        status: string_field(args, "status"),
    })
}

pub(super) fn typed_investment_list_query(args: &Value) -> Result<InvestmentListQuery, ToolError> {
    Ok(InvestmentListQuery {
        limit: args.get("limit").and_then(Value::as_i64),
        scope: string_field(args, "scope"),
        project_id: string_field(args, "projectId"),
    })
}

pub(super) fn uuid_arg(args: &Value, key: &str) -> Result<Uuid, ToolError> {
    Uuid::parse_str(required_str(args, key)?)
        .map_err(|err| ToolError::InvalidArgs(format!("invalid {key}: {err}")))
}

pub(super) fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ToolError::InvalidArgs(format!("missing {key}")))
}

pub(super) fn string_field(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn required_profile(profile: &Option<String>) -> Result<&str, ToolError> {
    profile
        .as_deref()
        .ok_or_else(|| ToolError::Unavailable("agent profile is not configured".to_string()))
}
