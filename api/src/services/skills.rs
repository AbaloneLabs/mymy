//! Native skill and bundle management API.
//!
//! Skill content already lives in the agent data directory because the runtime
//! reads it directly during prompt assembly and tool execution. The HTTP layer
//! intentionally reuses that filesystem-backed registry instead of creating a
//! second database copy, so UI edits and agent invocations operate on the same
//! source of truth.

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::agent::skills::{
    preprocess_skill_content_with_config, BundleRegistry, SkillBundle, SkillInfo, SkillRegistry,
    SkillView, SkillsConfig,
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct SkillsResponse {
    pub skills: Vec<SkillInfo>,
    pub categories: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SkillResponse {
    pub skill: SkillView,
}

#[derive(Debug, Serialize)]
pub struct SkillBundlesResponse {
    pub bundles: Vec<SkillBundle>,
}

#[derive(Debug, Serialize)]
pub struct SkillBundleResponse {
    pub bundle: SkillBundle,
}

#[derive(Debug, Deserialize)]
pub struct SaveSkillBundleRequest {
    pub name: String,
    pub description: String,
    pub skills: Vec<String>,
    #[serde(default)]
    pub instruction: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeleteSkillBundleResponse {
    pub success: bool,
    pub bundle: SkillBundle,
}

#[derive(Debug, Serialize)]
pub struct SkillsConfigResponse {
    pub config: SkillsConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSkillsConfigRequest {
    pub template_vars: Option<bool>,
    pub inline_shell: Option<bool>,
    pub inline_shell_timeout_secs: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreprocessPreviewRequest {
    pub name: String,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PreprocessPreviewResponse {
    pub name: String,
    pub path: String,
    pub content: String,
}

pub async fn list_skills(state: &AppState) -> AppResult<SkillsResponse> {
    let skills = skill_registry(state);
    Ok(SkillsResponse {
        skills: skills
            .list(None)
            .map_err(|err| map_skill_io("skill list failed", err))?,
        categories: skills
            .categories()
            .map_err(|err| map_skill_io("skill categories failed", err))?,
    })
}

pub async fn get_skill(state: &AppState, name: &str) -> AppResult<SkillResponse> {
    let skills = skill_registry(state);
    Ok(SkillResponse {
        skill: skills
            .view(name, None)
            .map_err(|err| map_skill_io("skill view failed", err))?,
    })
}

pub async fn list_bundles(state: &AppState) -> AppResult<SkillBundlesResponse> {
    Ok(SkillBundlesResponse {
        bundles: bundle_registry(state)
            .list()
            .map_err(|err| map_skill_io("bundle list failed", err))?,
    })
}

pub async fn get_bundle(state: &AppState, name: &str) -> AppResult<SkillBundleResponse> {
    let bundle = bundle_registry(state)
        .get(name)
        .map_err(|err| map_skill_io("bundle get failed", err))?
        .ok_or_else(|| AppError::NotFound("bundle not found".to_string()))?;
    Ok(SkillBundleResponse { bundle })
}

pub async fn create_bundle(
    state: &AppState,
    req: SaveSkillBundleRequest,
) -> AppResult<SkillBundlesResponse> {
    let bundle = normalize_bundle(req);
    bundle_registry(state)
        .create_or_update(&bundle)
        .map_err(|err| map_skill_io("bundle save failed", err))?;
    list_bundles(state).await
}

pub async fn update_bundle(
    state: &AppState,
    name: &str,
    req: SaveSkillBundleRequest,
) -> AppResult<SkillBundlesResponse> {
    if req.name != name {
        return Err(AppError::BadRequest(
            "bundle name cannot be changed through update".to_string(),
        ));
    }
    create_bundle(state, req).await
}

pub async fn delete_bundle(state: &AppState, name: &str) -> AppResult<DeleteSkillBundleResponse> {
    let bundle = bundle_registry(state)
        .delete(name)
        .map_err(|err| map_skill_io("bundle delete failed", err))?;
    Ok(DeleteSkillBundleResponse {
        success: true,
        bundle,
    })
}

pub async fn get_config(state: &AppState) -> AppResult<SkillsConfigResponse> {
    Ok(SkillsConfigResponse {
        config: load_config(state)?,
    })
}

pub async fn update_config(
    state: &AppState,
    req: UpdateSkillsConfigRequest,
) -> AppResult<SkillsConfigResponse> {
    let mut config = load_config(state)?;
    if let Some(value) = req.template_vars {
        config.template_vars = value;
    }
    if let Some(value) = req.inline_shell {
        config.inline_shell = value;
    }
    if let Some(value) = req.inline_shell_timeout_secs {
        config.inline_shell_timeout_secs = value.clamp(1, 60);
    }
    write_json_atomic(
        &config_path(state),
        &serde_json::to_string_pretty(&config).map_err(|err| {
            AppError::Internal(format!("skills config serialization failed: {err}"))
        })?,
    )?;
    Ok(SkillsConfigResponse { config })
}

pub async fn preprocess_preview(
    state: &AppState,
    req: PreprocessPreviewRequest,
) -> AppResult<PreprocessPreviewResponse> {
    let skills = skill_registry(state);
    let view = skills
        .view(&req.name, req.file_path.as_deref())
        .map_err(|err| map_skill_io("skill view failed", err))?;
    let skill_dir = skills
        .resolve_skill_dir(&req.name)
        .map_err(|err| map_skill_io("skill resolve failed", err))?;
    let config = load_config(state)?;
    let session_id = req.session_id.unwrap_or_else(|| "preview".to_string());
    let content =
        preprocess_skill_content_with_config(&view.content, &skill_dir, &session_id, &config).await;

    Ok(PreprocessPreviewResponse {
        name: view.name,
        path: view.path,
        content,
    })
}

fn skill_registry(state: &AppState) -> SkillRegistry {
    SkillRegistry::new(state.config.agent_data_dir.join("skills"))
}

fn bundle_registry(state: &AppState) -> BundleRegistry {
    BundleRegistry::new(
        state.config.agent_data_dir.join("skill-bundles"),
        skill_registry(state),
    )
}

fn config_path(state: &AppState) -> std::path::PathBuf {
    state
        .config
        .agent_data_dir
        .join("skills")
        .join(".config.json")
}

pub(crate) fn load_config(state: &AppState) -> AppResult<SkillsConfig> {
    let path = config_path(state);
    if !path.exists() {
        return Ok(SkillsConfig::default());
    }
    let raw =
        fs::read_to_string(&path).map_err(|err| map_skill_io("skills config read failed", err))?;
    serde_json::from_str::<SkillsConfig>(&raw)
        .map_err(|err| AppError::Internal(format!("skills config parse failed: {err}")))
}

fn normalize_bundle(req: SaveSkillBundleRequest) -> SkillBundle {
    SkillBundle {
        name: req.name.trim().to_string(),
        description: req.description.trim().to_string(),
        skills: req
            .skills
            .into_iter()
            .map(|skill| skill.trim().to_string())
            .filter(|skill| !skill.is_empty())
            .collect(),
        instruction: req
            .instruction
            .and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_string())),
    }
}

fn write_json_atomic(path: &Path, content: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| map_skill_io("skills config mkdir failed", err))?;
    }
    let tmp = path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
    fs::write(&tmp, content).map_err(|err| map_skill_io("skills config write failed", err))?;
    fs::rename(&tmp, path).map_err(|err| map_skill_io("skills config move failed", err))?;
    Ok(())
}

fn map_skill_io(context: &str, err: io::Error) -> AppError {
    let message = format!("{context}: {err}");
    match err.kind() {
        io::ErrorKind::AlreadyExists
        | io::ErrorKind::InvalidData
        | io::ErrorKind::InvalidInput
        | io::ErrorKind::PermissionDenied => AppError::BadRequest(message),
        io::ErrorKind::NotFound => AppError::NotFound(message),
        _ => AppError::Internal(message),
    }
}
