-- Investment account ownership is project-optional. Positions and account
-- cashflows inherit scope through account_id; assets remain global reference
-- data and are intentionally not duplicated per project.

ALTER TABLE investment_accounts
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS investment_accounts_project_idx
    ON investment_accounts(project_id, name);
