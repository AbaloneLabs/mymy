//! Knowledge Base / Wiki domain operations.
//!
//! Hierarchy is modeled as a single-table adjacency list. Query/read concerns,
//! mutation/versioning concerns, row mapping, and tree helpers are split so the
//! service facade stays stable while internals remain navigable.

mod hierarchy;
mod mutations;
mod queries;
mod repository;
mod resources;
mod slugs;
mod tree;

pub use mutations::{create, delete, move_node, update};
pub use queries::{get_breadcrumb, get_by_id, get_children, list_flat, list_tree, search};
pub use resources::{
    attach_resource, detach_resource, list_resources, mark_drive_path_broken, reconcile_drive_move,
    reconcile_drive_restore,
};

#[cfg(test)]
mod tests;
