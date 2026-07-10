use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "knowledge_tree",
        "knowledge_read",
        "List the knowledge tree.",
        filter_schema(&["projectId"]),
        state,
        AppAction::KnowledgeTree,
    );
    register_tool(
        registry,
        "knowledge_search",
        "knowledge_read",
        "Search knowledge articles.",
        serde_json::json!({"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}),
        state,
        AppAction::KnowledgeSearch,
    );
    register_tool(
        registry,
        "knowledge_get",
        "knowledge_read",
        "Get a knowledge node by id.",
        id_schema("Knowledge node id."),
        state,
        AppAction::KnowledgeGet,
    );
    register_tool(
        registry,
        "knowledge_list",
        "knowledge_read",
        "List knowledge nodes with optional filters.",
        filter_schema(&["status", "nodeType", "parentId", "projectId"]),
        state,
        AppAction::KnowledgeList,
    );
    register_tool(
        registry,
        "knowledge_create",
        "knowledge_write",
        "Create a knowledge article or category.",
        passthrough_schema(),
        state,
        AppAction::KnowledgeCreate,
    );
    register_tool(
        registry,
        "knowledge_update",
        "knowledge_write",
        "Update a knowledge node by id.",
        id_body_schema("Knowledge node id."),
        state,
        AppAction::KnowledgeUpdate,
    );
    register_tool(
        registry,
        "knowledge_move",
        "knowledge_write",
        "Move a knowledge node by id.",
        id_body_schema("Knowledge node id."),
        state,
        AppAction::KnowledgeMove,
    );
    register_tool(
        registry,
        "knowledge_delete",
        "knowledge_write",
        "Delete a knowledge node by id.",
        id_schema("Knowledge node id."),
        state,
        AppAction::KnowledgeDelete,
    );
    register_tool(
        registry,
        "knowledge_resource_list",
        "knowledge_read",
        "List Drive documents attached to a knowledge node, including broken-link state.",
        serde_json::json!({
            "type":"object",
            "properties":{"knowledgeId":{"type":"string"}},
            "required":["knowledgeId"]
        }),
        state,
        AppAction::KnowledgeResourceList,
    );
    register_tool(
        registry,
        "knowledge_resource_attach",
        "knowledge_write",
        "Attach an existing markdown, docx, xlsx, or pptx Drive file to a knowledge node without copying it.",
        serde_json::json!({
            "type":"object",
            "properties":{
                "knowledgeId":{"type":"string"},
                "resourceRef":{"type":"string","description":"Existing /drive/... file path."},
                "title":{"type":"string"},
                "sortOrder":{"type":"integer"}
            },
            "required":["knowledgeId","resourceRef"]
        }),
        state,
        AppAction::KnowledgeResourceAttach,
    );
    register_tool(
        registry,
        "knowledge_resource_detach",
        "knowledge_write",
        "Detach a Drive document reference from a knowledge node without deleting the file.",
        serde_json::json!({
            "type":"object",
            "properties":{
                "knowledgeId":{"type":"string"},
                "resourceId":{"type":"string"}
            },
            "required":["knowledgeId","resourceId"]
        }),
        state,
        AppAction::KnowledgeResourceDetach,
    );
}
