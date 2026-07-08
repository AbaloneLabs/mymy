//! Investment record services.
//!
//! This module deliberately avoids trade-order language. Positions are current
//! records, valuations are manual snapshots, and cashflows capture dividends,
//! interest, fees, taxes, deposits, withdrawals, or adjustments.

use crate::services::audit::log_audit_safe;
use crate::state::AppState;

mod accounts;
mod assets;
mod cashflows;
mod positions;
mod records;
mod summary;
mod validation;
mod valuations;
mod watchlist;

pub use accounts::{create_account, delete_account, list_accounts, update_account};
pub use assets::{create_asset, delete_asset, list_assets, update_asset};
pub use cashflows::{
    create_cashflow, delete_cashflow, list_cashflows, update_cashflow, InvestmentListQuery,
};
pub use positions::{create_position, delete_position, list_positions, update_position};
pub use summary::{compact_snapshot, summary};
pub use valuations::{
    create_valuation_snapshot, delete_valuation_snapshot, list_valuation_snapshots,
};
pub use watchlist::{create_watchlist_item, delete_watchlist_item, list_watchlist};

async fn audit(state: &AppState, action: &str, entity_type: &str, entity_id: &str) {
    log_audit_safe(
        &state.db,
        "user",
        "user",
        action,
        entity_type,
        Some(entity_id),
        None,
    )
    .await;
}
