use super::*;

pub(super) fn register(registry: &mut ToolRegistry, state: &Arc<AppState>) {
    register_tool(
        registry,
        "investment_summary",
        "investments_read",
        "Return manual investment summary.",
        serde_json::json!({"type":"object","properties":{}}),
        state,
        AppAction::InvestmentSummary,
    );
    register_tool(
        registry,
        "investment_account_list",
        "investments_read",
        "List investment accounts.",
        empty_schema(),
        state,
        AppAction::InvestmentAccountList,
    );
    register_tool(
        registry,
        "investment_account_create",
        "investments_write",
        "Create an investment account.",
        passthrough_schema(),
        state,
        AppAction::InvestmentAccountCreate,
    );
    register_tool(
        registry,
        "investment_account_update",
        "investments_write",
        "Update an investment account by id.",
        id_body_schema("Investment account id."),
        state,
        AppAction::InvestmentAccountUpdate,
    );
    register_tool(
        registry,
        "investment_account_delete",
        "investments_write",
        "Delete an investment account by id.",
        id_schema("Investment account id."),
        state,
        AppAction::InvestmentAccountDelete,
    );
    register_tool(
        registry,
        "investment_asset_list",
        "investments_read",
        "List investment assets.",
        empty_schema(),
        state,
        AppAction::InvestmentAssetList,
    );
    register_tool(
        registry,
        "investment_asset_create",
        "investments_write",
        "Create an investment asset.",
        passthrough_schema(),
        state,
        AppAction::InvestmentAssetCreate,
    );
    register_tool(
        registry,
        "investment_asset_update",
        "investments_write",
        "Update an investment asset by id.",
        id_body_schema("Investment asset id."),
        state,
        AppAction::InvestmentAssetUpdate,
    );
    register_tool(
        registry,
        "investment_asset_delete",
        "investments_write",
        "Delete an investment asset by id.",
        id_schema("Investment asset id."),
        state,
        AppAction::InvestmentAssetDelete,
    );
    register_tool(
        registry,
        "investment_position_list",
        "investments_read",
        "List investment positions.",
        empty_schema(),
        state,
        AppAction::InvestmentPositionList,
    );
    register_tool(
        registry,
        "investment_position_create",
        "investments_write",
        "Create an investment position.",
        passthrough_schema(),
        state,
        AppAction::InvestmentPositionCreate,
    );
    register_tool(
        registry,
        "investment_position_update",
        "investments_write",
        "Update an investment position by id.",
        id_body_schema("Investment position id."),
        state,
        AppAction::InvestmentPositionUpdate,
    );
    register_tool(
        registry,
        "investment_position_delete",
        "investments_write",
        "Delete an investment position by id.",
        id_schema("Investment position id."),
        state,
        AppAction::InvestmentPositionDelete,
    );
    register_tool(
        registry,
        "investment_valuation_list",
        "investments_read",
        "List valuation snapshots.",
        filter_schema(&["positionId"]),
        state,
        AppAction::InvestmentValuationList,
    );
    register_tool(
        registry,
        "investment_valuation_create",
        "investments_write",
        "Create a valuation snapshot.",
        passthrough_schema(),
        state,
        AppAction::InvestmentValuationCreate,
    );
    register_tool(
        registry,
        "investment_valuation_delete",
        "investments_write",
        "Delete a valuation snapshot by id.",
        id_schema("Valuation snapshot id."),
        state,
        AppAction::InvestmentValuationDelete,
    );
    register_tool(
        registry,
        "investment_cashflow_list",
        "investments_read",
        "List investment cashflows.",
        serde_json::json!({"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":500}}}),
        state,
        AppAction::InvestmentCashflowList,
    );
    register_tool(
        registry,
        "investment_cashflow_create",
        "investments_write",
        "Create an investment cashflow.",
        passthrough_schema(),
        state,
        AppAction::InvestmentCashflowCreate,
    );
    register_tool(
        registry,
        "investment_cashflow_update",
        "investments_write",
        "Update an investment cashflow by id.",
        id_body_schema("Investment cashflow id."),
        state,
        AppAction::InvestmentCashflowUpdate,
    );
    register_tool(
        registry,
        "investment_cashflow_delete",
        "investments_write",
        "Delete an investment cashflow by id.",
        id_schema("Investment cashflow id."),
        state,
        AppAction::InvestmentCashflowDelete,
    );
    register_tool(
        registry,
        "investment_watchlist_list",
        "investments_read",
        "List investment watchlist items.",
        empty_schema(),
        state,
        AppAction::InvestmentWatchlistList,
    );
    register_tool(
        registry,
        "investment_watchlist_create",
        "investments_write",
        "Create or update a watchlist item.",
        passthrough_schema(),
        state,
        AppAction::InvestmentWatchlistCreate,
    );
    register_tool(
        registry,
        "investment_watchlist_delete",
        "investments_write",
        "Delete a watchlist item by id.",
        id_schema("Watchlist item id."),
        state,
        AppAction::InvestmentWatchlistDelete,
    );
}
