use crate::error::{AppError, AppResult};

pub(super) fn validate_goal_type(t: &str) -> AppResult<()> {
    if matches!(t, "quarterly" | "annual" | "monthly") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid goal type: {t}")))
    }
}

pub(super) fn validate_goal_status(s: &str) -> AppResult<()> {
    if matches!(s, "active" | "completed" | "archived") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid goal status: {s}")))
    }
}

pub(super) fn validate_kpi_type(k: &str) -> AppResult<()> {
    if matches!(k, "manual" | "task_completion" | "finance") {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("invalid kpiType: {k}")))
    }
}

pub(super) fn validate_target_value(v: f64) -> AppResult<()> {
    if v > 0.0 {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "targetValue must be positive".to_string(),
        ))
    }
}

pub(super) fn validate_current_value(v: f64) -> AppResult<()> {
    if v >= 0.0 {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "currentValue must be non-negative".to_string(),
        ))
    }
}
