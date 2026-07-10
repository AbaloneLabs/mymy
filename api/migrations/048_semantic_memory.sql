-- Semantic recall is opt-in and local-only by default. Sensitivity categories
-- remain excluded until the user enables each category explicitly.

CREATE TABLE IF NOT EXISTS memory_embedding_settings (
    agent_profile       TEXT PRIMARY KEY REFERENCES native_agents(profile) ON DELETE CASCADE,
    enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    provider            TEXT NOT NULL DEFAULT 'local_feature_hash_v1'
                        CHECK (provider IN ('local_feature_hash_v1')),
    include_private     BOOLEAN NOT NULL DEFAULT FALSE,
    include_financial   BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agent_memories
    ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;
