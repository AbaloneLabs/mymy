-- Optional per-agent LLM selection with durable run provenance.
--
-- Absence of a settings row deliberately means inheritance from the single
-- global default provider. A partial row can override only the provider or
-- only the model, which lets several agents share one endpoint and credential
-- pool while selecting different models without duplicating provider records.

CREATE TABLE IF NOT EXISTS agent_llm_settings (
    agent_profile TEXT PRIMARY KEY
        REFERENCES native_agents(profile) ON DELETE CASCADE,
    provider_id UUID
        REFERENCES llm_providers(id) ON DELETE RESTRICT,
    model TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (provider_id IS NOT NULL OR model IS NOT NULL),
    CHECK (model IS NULL OR length(trim(model)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_llm_settings_provider
    ON agent_llm_settings(provider_id)
    WHERE provider_id IS NOT NULL;

-- Run snapshots intentionally keep scalar provenance instead of foreign keys.
-- Historical records must remain explainable after a provider is removed, and
-- an already-started retry must never silently switch to the current default.
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS llm_provider_id UUID,
    ADD COLUMN IF NOT EXISTS llm_provider_label TEXT,
    ADD COLUMN IF NOT EXISTS llm_model TEXT,
    ADD COLUMN IF NOT EXISTS llm_selection_source TEXT;

ALTER TABLE agent_runs
    ADD CONSTRAINT agent_runs_llm_selection_source_check
    CHECK (
        llm_selection_source IS NULL
        OR llm_selection_source IN ('global_default', 'agent_override', 'moa')
    ) NOT VALID;

ALTER TABLE agent_runs
    VALIDATE CONSTRAINT agent_runs_llm_selection_source_check;
