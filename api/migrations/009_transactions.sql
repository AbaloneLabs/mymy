-- Transactions (income/expense tracking), project-scoped (nullable project_id
-- for general transactions). Foundation for tax/payment/expense-sync features.
--
-- Amount is stored as an integer in the *minor unit* of the currency
-- (e.g. KRW: 1 won, USD: 1 cent). This avoids floating-point rounding errors
-- and matches how Stripe and most payment APIs represent money. The amount
-- is always positive; the sign is derived from `type` (income/expense).

CREATE TABLE IF NOT EXISTS transactions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
    type         TEXT NOT NULL
                 CHECK (type IN ('income', 'expense')),
    amount       BIGINT NOT NULL
                 CHECK (amount > 0),
    currency     TEXT NOT NULL DEFAULT 'KRW',
    category     TEXT NOT NULL DEFAULT 'uncategorized',
    date         TIMESTAMPTZ NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'cleared'
                 CHECK (status IN ('pending', 'cleared')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS transactions_project_idx ON transactions(project_id);
CREATE INDEX IF NOT EXISTS transactions_type_idx    ON transactions(type);
CREATE INDEX IF NOT EXISTS transactions_date_idx    ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions(category);
