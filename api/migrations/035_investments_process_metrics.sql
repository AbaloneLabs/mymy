-- Investment records and sandbox process metrics.
--
-- Investments are a record-keeping surface, not a trading surface. The schema
-- stores current positions, manual valuation snapshots, cashflows, and
-- watchlist entries without modeling buy/sell orders or broker execution.

CREATE TABLE IF NOT EXISTS investment_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    institution TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'KRW',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investment_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    asset_type TEXT NOT NULL DEFAULT 'stock'
        CHECK (asset_type IN ('stock', 'etf', 'bond', 'fund', 'crypto', 'cash', 'commodity', 'real_estate', 'other')),
    exchange TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'KRW',
    sector TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (symbol, exchange)
);

CREATE TABLE IF NOT EXISTS investment_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES investment_accounts(id) ON DELETE SET NULL,
    asset_id UUID NOT NULL REFERENCES investment_assets(id) ON DELETE RESTRICT,
    quantity_micro BIGINT NOT NULL DEFAULT 0,
    cost_basis_amount BIGINT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'KRW',
    opened_at TIMESTAMPTZ,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investment_positions_account_idx
    ON investment_positions(account_id);
CREATE INDEX IF NOT EXISTS investment_positions_asset_idx
    ON investment_positions(asset_id);

CREATE TABLE IF NOT EXISTS investment_valuation_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id UUID NOT NULL REFERENCES investment_positions(id) ON DELETE CASCADE,
    unit_price_amount BIGINT,
    market_value_amount BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KRW',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS investment_valuation_snapshots_position_idx
    ON investment_valuation_snapshots(position_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS investment_cashflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES investment_accounts(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES investment_assets(id) ON DELETE SET NULL,
    flow_type TEXT NOT NULL
        CHECK (flow_type IN ('dividend', 'interest', 'fee', 'tax', 'deposit', 'withdrawal', 'adjustment', 'other')),
    amount BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KRW',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investment_cashflows_recorded_idx
    ON investment_cashflows(recorded_at DESC);
CREATE INDEX IF NOT EXISTS investment_cashflows_account_idx
    ON investment_cashflows(account_id);
CREATE INDEX IF NOT EXISTS investment_cashflows_asset_idx
    ON investment_cashflows(asset_id);

CREATE TABLE IF NOT EXISTS investment_watchlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES investment_assets(id) ON DELETE CASCADE,
    target_price_amount BIGINT,
    currency TEXT NOT NULL DEFAULT 'KRW',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (asset_id)
);

ALTER TABLE sandbox_processes
    ADD COLUMN IF NOT EXISTS cpu_percent DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS memory_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS memory_limit_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS storage_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS open_ports JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
