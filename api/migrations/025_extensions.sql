-- DB-backed native agent extensions.
--
-- Dynamic library loading is intentionally not supported. Extensions are
-- declarative webhook, script, or MCP server configs registered by the user.

CREATE TABLE IF NOT EXISTS extensions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        TEXT NOT NULL CHECK (kind IN ('webhook', 'script', 'mcp_server')),
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    enabled     BOOLEAN NOT NULL DEFAULT true,
    parameters  JSONB NOT NULL DEFAULT '{"type":"object","properties":{}}'::jsonb,
    settings    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extensions_enabled
    ON extensions(enabled);

CREATE INDEX IF NOT EXISTS idx_extensions_kind
    ON extensions(kind);
