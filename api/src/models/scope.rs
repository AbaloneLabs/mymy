//! Explicit workspace scope contracts shared by query and patch models.

use serde::{Deserialize, Deserializer};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceScope {
    General,
    Project(Uuid),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeFilter {
    All,
    General,
    Project(Uuid),
}

impl ScopeFilter {
    pub fn parse(scope: Option<&str>, project_id: Option<&str>) -> AppResult<Self> {
        let project = project_id
            .filter(|value| !value.trim().is_empty())
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|err| AppError::BadRequest(format!("invalid projectId: {err}")))?;
        match (scope, project) {
            (None, Some(project)) | (Some("project"), Some(project)) => Ok(Self::Project(project)),
            (None, None) | (Some("all"), None) => Ok(Self::All),
            (Some("general"), None) => Ok(Self::General),
            (Some("project"), None) => Err(AppError::BadRequest(
                "scope=project requires projectId".to_string(),
            )),
            (Some("all" | "general"), Some(_)) => Err(AppError::BadRequest(
                "projectId cannot be combined with scope=all or scope=general".to_string(),
            )),
            (Some(other), _) => Err(AppError::BadRequest(format!(
                "invalid scope filter: {other}"
            ))),
        }
    }

    pub fn kind(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::General => "general",
            Self::Project(_) => "project",
        }
    }

    pub fn project_id(self) -> Option<Uuid> {
        match self {
            Self::Project(id) => Some(id),
            Self::All | Self::General => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum PatchField<T> {
    #[default]
    Missing,
    Null,
    Value(T),
}

impl<'de, T> Deserialize<'de> for PatchField<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match Option::<T>::deserialize(deserializer)? {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

impl PatchField<String> {
    pub fn workspace_scope(&self) -> AppResult<Option<WorkspaceScope>> {
        match self {
            Self::Missing => Ok(None),
            Self::Null => Ok(Some(WorkspaceScope::General)),
            Self::Value(value) if value.trim().is_empty() => Ok(Some(WorkspaceScope::General)),
            Self::Value(value) => Uuid::parse_str(value)
                .map(WorkspaceScope::Project)
                .map(Some)
                .map_err(|err| AppError::BadRequest(format!("invalid projectId: {err}"))),
        }
    }
}
