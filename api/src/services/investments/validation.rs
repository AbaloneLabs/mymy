use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub(super) const ASSET_TYPES: &[&str] = &[
    "stock",
    "etf",
    "bond",
    "fund",
    "crypto",
    "cash",
    "commodity",
    "real_estate",
    "other",
];

pub(super) const CASHFLOW_TYPES: &[&str] = &[
    "dividend",
    "interest",
    "fee",
    "tax",
    "deposit",
    "withdrawal",
    "adjustment",
    "other",
];

pub(super) fn validate_required(value: String, field: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(format!("{field} is required")));
    }
    if trimmed.chars().count() > 160 {
        return Err(AppError::BadRequest(format!("{field} is too long")));
    }
    Ok(trimmed.to_string())
}

pub(super) fn clean_optional(value: Option<String>) -> Option<String> {
    value.map(|value| value.trim().chars().take(4_000).collect())
}

pub(super) fn normalize_currency(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or("KRW").trim();
    if trimmed.is_empty() {
        return "KRW".to_string();
    }
    trimmed.chars().take(12).collect::<String>().to_uppercase()
}

pub(super) fn normalize_choice(
    value: Option<&str>,
    allowed: &[&str],
    field: &str,
    default_value: &str,
) -> AppResult<String> {
    let normalized = value.unwrap_or(default_value).trim().to_lowercase();
    if allowed.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(AppError::BadRequest(format!(
            "invalid {field}: {normalized}"
        )))
    }
}

pub(super) fn validate_positive(value: i64, field: &str) -> AppResult<()> {
    if value > 0 {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("{field} must be positive")))
    }
}

pub(super) fn validate_nonnegative(value: i64, field: &str) -> AppResult<()> {
    if value >= 0 {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("{field} cannot be negative")))
    }
}

pub(super) fn parse_uuid(value: &str, field: &str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|err| AppError::BadRequest(format!("invalid {field}: {err}")))
}

pub(super) fn parse_optional_uuid(value: Option<&str>, field: &str) -> AppResult<Option<Uuid>> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| parse_uuid(value, field))
        .transpose()
}

pub(super) fn parse_ts(value: Option<&str>, field: &str) -> AppResult<Option<DateTime<Utc>>> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|value| value.with_timezone(&Utc))
                .map_err(|err| AppError::BadRequest(format!("invalid {field}: {err}")))
        })
        .transpose()
}
