-- MoA preset definitions for native multi-provider chat turns.
--
-- A preset stores only provider references and orchestration settings. Provider
-- credentials remain in llm_providers / agent_credentials and continue to use
-- the existing encrypted credential rotation path at runtime.

CREATE TABLE IF NOT EXISTS moa_presets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL UNIQUE,
    enabled                 BOOLEAN NOT NULL DEFAULT true,
    proposer_provider_ids   UUID[] NOT NULL DEFAULT '{}',
    aggregator_provider_id  UUID NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
    max_concurrent          INTEGER NOT NULL DEFAULT 3 CHECK (max_concurrent >= 1 AND max_concurrent <= 8),
    aggregation_prompt      TEXT NOT NULL DEFAULT 'Synthesize the proposer outputs into one final answer.',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT moa_presets_non_empty_proposers CHECK (array_length(proposer_provider_ids, 1) >= 1)
);

CREATE INDEX IF NOT EXISTS moa_presets_enabled_idx
    ON moa_presets (enabled);

COMMENT ON TABLE moa_presets IS 'Native MoA preset configurations referencing encrypted LLM providers';
