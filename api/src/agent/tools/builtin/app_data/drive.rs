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
        serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"A /drive/... logical path."},"content":{"type":"string","description":"Complete UTF-8 content to write."},"expectedFingerprint":{"type":"string","description":"Fingerprint returned by drive_read; required for existing files."},"artifactTitle":{"type":"string","maxLength":200,"description":"Optional user-facing title only for a newly created, user-meaningful output."},"artifactType":{"type":"string","enum":["document","report","image","archive","attachment","export"],"description":"Artifact category required with artifactTitle; omit for routine files."}},"required":["path","content"]}),
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
        serde_json::json!({
            "type":"object",
            "properties":{
                "path":{"type":"string","description":"Existing /drive/... logical path to move to Trash."},
                "expectedLifecycleRevision":{"type":"string","description":"Optional lifecycle revision returned by a current lifecycle read; stale values are rejected."}
            },
            "required":["path"]
        }),
        state,
        AppAction::DriveDelete,
    );
    register_tool(
        registry,
        "drive_restore",
        "drive_write",
        "Restore a Drive trash entry by id.",
        serde_json::json!({
            "type":"object",
            "properties":{
                "id":{"type":"string","description":"Trash entry UUID from the current Trash list."},
                "expectedLifecycleRevision":{"type":"string","description":"Lifecycle revision from the current Trash entry; stale values are rejected."}
            },
            "required":["id"]
        }),
        state,
        AppAction::DriveRestore,
    );
}
