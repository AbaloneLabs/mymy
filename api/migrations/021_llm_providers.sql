-- LLM provider configurations for the native agent runtime.
--
-- This table replaces the external Hermes CLI connection model
-- (agent_system_instances) with direct LLM API connections. Each row
-- stores a complete provider config: base_url, API format, model, and
-- an AES-256-GCM encrypted API key.
--
-- The API key is encrypted at rest using a key derived from the user's
-- PIN via HKDF (see services::llm_providers::crypto). The DB stores only
-- the ciphertext + nonce; the plaintext key never touches disk.

CREATE TABLE IF NOT EXISTS llm_providers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Human-readable label shown in the UI (e.g. "My OpenAI").
    label           TEXT NOT NULL,
    -- Wire format: 'openai', 'anthropic', or 'auto'.
    api_format      TEXT NOT NULL DEFAULT 'auto',
    -- Provider base URL (e.g. 'https://api.openai.com/v1').
    base_url        TEXT NOT NULL,
    -- AES-256-GCM encrypted API key (hex-encoded).
    encrypted_key   TEXT NOT NULL,
    -- Nonce used for AES-GCM encryption (hex-encoded, 12 bytes).
    key_nonce       TEXT NOT NULL,
    -- Model identifier to use for completions (e.g. 'gpt-4o').
    model           TEXT NOT NULL,
    -- Maximum output tokens per completion.
    max_tokens      INTEGER NOT NULL DEFAULT 16384,
    -- Whether this provider is enabled for use.
    enabled         BOOLEAN NOT NULL DEFAULT true,
    -- Whether this is the default provider for new conversations.
    is_default      BOOLEAN NOT NULL DEFAULT false,
    -- Preset name if created from a preset (e.g. 'openai'), NULL for custom.
    preset          TEXT,
    -- Timestamps.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one default provider at a time.
CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_single_default
    ON llm_providers (is_default) WHERE is_default = true;

-- Helpful for listing enabled providers.
CREATE INDEX IF NOT EXISTS llm_providers_enabled_idx
    ON llm_providers (enabled);

COMMENT ON TABLE llm_providers IS 'LLM provider configs for the native agent runtime (Phase 1)';
