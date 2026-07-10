-- Finance key results use an explicit, single-currency aggregation contract.
-- Structured columns provide validation and project referential integrity;
-- a deleted project makes the definition visibly broken instead of silently
-- widening it to General or All.

ALTER TABLE key_results
    ADD COLUMN IF NOT EXISTS finance_metric TEXT
        CHECK (finance_metric IN ('income', 'expense', 'net')),
    ADD COLUMN IF NOT EXISTS finance_currency TEXT,
    ADD COLUMN IF NOT EXISTS finance_scope TEXT
        CHECK (finance_scope IN ('all', 'general', 'project')),
    ADD COLUMN IF NOT EXISTS finance_project_id UUID
        REFERENCES projects(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS finance_status TEXT
        CHECK (finance_status IN ('all', 'cleared', 'pending')),
    ADD COLUMN IF NOT EXISTS finance_from TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS finance_to TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS finance_category TEXT;

ALTER TABLE key_results DROP CONSTRAINT IF EXISTS key_results_finance_definition_check;
ALTER TABLE key_results ADD CONSTRAINT key_results_finance_definition_check CHECK (
    kpi_type <> 'finance'
    OR finance_metric IS NULL
    OR (
        finance_currency IS NOT NULL
        AND length(finance_currency) = 3
        AND finance_currency = upper(finance_currency)
        AND finance_scope IS NOT NULL
        AND finance_status IS NOT NULL
        AND (finance_from IS NULL OR finance_to IS NULL OR finance_from < finance_to)
    )
);

CREATE INDEX IF NOT EXISTS key_results_finance_project_idx
    ON key_results(finance_project_id)
    WHERE kpi_type = 'finance';
