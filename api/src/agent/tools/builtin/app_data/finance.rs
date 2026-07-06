use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "transaction_list",
        "finance_read",
        "List manual finance transactions.",
        filter_schema(&["projectId", "type", "from", "to", "category", "status"]),
        state,
        AppAction::TransactionList,
    );
    register_tool(
        registry,
        "transaction_summary",
        "finance_read",
        "Summarize manual finance transactions.",
        filter_schema(&["projectId", "type", "from", "to", "category", "status"]),
        state,
        AppAction::TransactionSummary,
    );
    register_tool(
        registry,
        "transaction_create",
        "finance_write",
        "Create a manual finance transaction.",
        passthrough_schema(),
        state,
        AppAction::TransactionCreate,
    );
    register_tool(
        registry,
        "transaction_update",
        "finance_write",
        "Update a manual finance transaction by id.",
        id_body_schema("Transaction id."),
        state,
        AppAction::TransactionUpdate,
    );
    register_tool(
        registry,
        "transaction_delete",
        "finance_write",
        "Delete a manual finance transaction by id.",
        id_schema("Transaction id."),
        state,
        AppAction::TransactionDelete,
    );
}
