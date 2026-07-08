use crate::agent::security::{scan_for_threats, ThreatScope};
use crate::error::{AppError, AppResult};

pub(super) fn ensure_cron_prompt_safe(prompt: &str) -> AppResult<()> {
    let findings = scan_for_threats(prompt, ThreatScope::Strict);
    if findings.is_empty() {
        return Ok(());
    }
    let ids = findings
        .into_iter()
        .map(|finding| finding.pattern_id)
        .collect::<Vec<_>>()
        .join(", ");
    Err(AppError::BadRequest(format!(
        "cron prompt blocked by security scan: {ids}"
    )))
}

pub(super) fn ensure_assembled_cron_prompt_safe(prompt: &str) -> AppResult<()> {
    let findings = scan_for_threats(prompt, ThreatScope::Context);
    if findings.is_empty() {
        return Ok(());
    }
    let ids = findings
        .into_iter()
        .map(|finding| finding.pattern_id)
        .collect::<Vec<_>>()
        .join(", ");
    Err(AppError::BadRequest(format!(
        "assembled cron prompt blocked by security scan: {ids}"
    )))
}

pub(super) fn validate_skill_names(skills: &[String]) -> AppResult<()> {
    for skill in skills {
        let skill = skill.trim();
        if skill.is_empty()
            || skill.contains('/')
            || skill.contains('\\')
            || skill.contains("..")
            || skill.chars().count() > 64
        {
            return Err(AppError::BadRequest(format!(
                "invalid skill reference: {skill}"
            )));
        }
    }
    Ok(())
}

pub(super) fn validate_context_refs(context_from: Option<&[String]>) -> AppResult<()> {
    let Some(refs) = context_from else {
        return Ok(());
    };
    for reference in refs {
        let value = reference.trim();
        if value.is_empty()
            || value.contains('/')
            || value.contains('\\')
            || value.contains("..")
            || value.chars().count() > 128
        {
            return Err(AppError::BadRequest(format!(
                "invalid context_from reference: {value}"
            )));
        }
    }
    Ok(())
}

pub(super) fn normalize_names(values: Vec<String>) -> Vec<String> {
    let mut names = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

pub(super) fn normalize_context_refs(values: Option<Vec<String>>) -> Option<Vec<String>> {
    let refs = normalize_names(values.unwrap_or_default());
    (!refs.is_empty()).then_some(refs)
}
