-- Additional runtime credentials for provider-level rotation.
--
-- llm_providers keeps the primary key for backwards compatibility. This table
-- stores optional extra keys per provider so the runtime can pick an available
-- credential without exposing raw key material.

CREATE TABLE IF NOT EXISTS agent_credentials (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id    UUID NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
    label          TEXT NOT NULL,
    encrypted_key  TEXT NOT NULL,
    key_nonce      TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'ok'
                   CHECK (status IN ('ok', 'exhausted', 'dead')),
    reset_at       TIMESTAMPTZ,
    request_count  BIGINT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(provider_id, label)
);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_provider_status
    ON agent_credentials(provider_id, status, request_count);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_reset
    ON agent_credentials(reset_at)
    WHERE status = 'exhausted';
