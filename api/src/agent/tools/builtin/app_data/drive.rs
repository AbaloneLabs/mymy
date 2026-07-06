use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "drive_list",
        "drive_read",
        "List Drive entries at a /drive/... path.",
        path_schema(false),
        state,
        AppAction::DriveList,
    );
    register_tool(
        registry,
        "drive_read",
        "drive_read",
        "Read a text file from Drive by /drive/... path.",
        path_schema(true),
        state,
        AppAction::DriveRead,
    );
    register_tool(
        registry,
        "drive_write",
        "drive_write",
        "Write a text file to Drive by /drive/... path.",
        serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"A /drive/... logical path."},"content":{"type":"string"}},"required":["path","content"]}),
        state,
        AppAction::DriveWrite,
    );
    register_tool(
        registry,
        "drive_mkdir",
        "drive_write",
        "Create a Drive folder by /drive/... path.",
        path_schema(true),
        state,
        AppAction::DriveMkdir,
    );
    register_tool(
        registry,
        "drive_delete",
        "drive_write",
        "Move a Drive path to trash.",
        path_schema(true),
        state,
        AppAction::DriveDelete,
    );
    register_tool(
        registry,
        "drive_restore",
        "drive_write",
        "Restore a Drive trash entry by id.",
        id_schema("Trash entry id."),
        state,
        AppAction::DriveRestore,
    );
}
