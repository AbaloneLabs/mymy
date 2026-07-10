//! ISO 4217 validation and minor-unit conversion shared by finance domains.
//!
//! Transaction amounts are persisted as integers in each currency's minor
//! unit. Keeping scale lookup in one backend module prevents consumers such as
//! Goal KPIs from silently presenting cents, fils, or won as the same unit.

use iso_currency::Currency;

use crate::error::{AppError, AppResult};

pub fn normalize_iso_currency(value: &str) -> AppResult<String> {
    let code = value.trim().to_ascii_uppercase();
    let currency = Currency::from_code(&code).ok_or_else(|| {
        AppError::BadRequest("currency must be a supported ISO 4217 code".to_string())
    })?;
    if currency.exponent().is_none() {
        return Err(AppError::BadRequest(format!(
            "currency {code} has no ISO 4217 minor-unit scale"
        )));
    }
    Ok(code)
}

pub fn minor_units_to_major(amount: i64, code: &str) -> AppResult<f64> {
    let currency = Currency::from_code(code).ok_or_else(|| {
        AppError::Internal(format!(
            "stored currency {code} is not a supported ISO 4217 code"
        ))
    })?;
    let exponent = currency.exponent().ok_or_else(|| {
        AppError::Internal(format!("stored currency {code} has no minor-unit scale"))
    })?;
    Ok(amount as f64 / 10_f64.powi(i32::from(exponent)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_currency_specific_minor_units() {
        assert_eq!(minor_units_to_major(1_234, "USD").unwrap(), 12.34);
        assert_eq!(minor_units_to_major(1_234, "KRW").unwrap(), 1_234.0);
        assert_eq!(minor_units_to_major(1_234, "KWD").unwrap(), 1.234);
    }

    #[test]
    fn rejects_unknown_or_scaleless_currency() {
        assert!(normalize_iso_currency("ABC").is_err());
        assert!(normalize_iso_currency("XAU").is_err());
    }
}
