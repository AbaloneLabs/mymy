//! Drive-backed workspace management.
//!
//! The API speaks logical `/drive/...` paths while storage stays under the
//! configured agent data directory. Path, content, workspace, file operation,
//! trash, and sync concerns are split so storage policy remains centralized.

mod content;
mod operations;
mod paths;
mod sync;
mod trash;
mod workspace;

pub use content::{document_package, mime_type_for_path};
pub(crate) use operations::write_file_bytes_unlocked;
pub use operations::{
    blob_path, create_folder, list, move_path, read_file, upload_file, write_file_conditionally,
};
pub use paths::{
    agent_agents_md_path, agent_soul_md_path, logical_agent_file_path, logical_agent_path,
    logical_project_path, normalize_logical_drive_path, physical_drive_root_from_roots,
    physical_path_for_logical_drive_path, resolve_drive_path, AGENTS_MD_FILE, DRIVE_PREFIX,
    SOUL_MD_FILE,
};
pub(crate) use sync::document_sync_status;
pub use sync::{list_sync_jobs, physical_path_for_sync, s3_object_key};
pub use trash::{delete_path, list_trash, purge_trash, restore_trash};
pub use workspace::{
    archive_agent_workspace, ensure_agent_workspace, ensure_project_workspace, project_drive_slug,
    provider_status, resolve_agent_drive_workspace, AgentDriveWorkspace,
};

#[cfg(test)]
mod tests;
