use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub(super) fn validate_entity_type(value: &str) -> AppResult<()> {
    if matches!(value, "note" | "task" | "knowledge_article") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid entityType: {value}")))
    }
}

pub(super) fn validate_actor_type(value: &str) -> AppResult<()> {
    if matches!(value, "user" | "agent" | "system") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid actorType: {value}")))
    }
}

pub(super) fn parse_uuid(value: &str, field: &str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|err| AppError::BadRequest(format!("invalid {field}: {err}")))
}
