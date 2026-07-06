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
}
