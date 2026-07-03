-- Native agents managed by mymy.
--
-- These are not Hermes profiles. The profile key scopes chat sessions,
-- prompt files, and future per-agent runtime settings.

CREATE TABLE IF NOT EXISTS native_agents (
    profile      TEXT PRIMARY KEY CHECK (profile ~ '^[A-Za-z0-9_.-]+$' AND profile <> 'default'),
    name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
    role         TEXT NOT NULL DEFAULT 'Agent',
    description  TEXT,
    status       TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('active', 'idle', 'offline')),
    model        TEXT NOT NULL DEFAULT 'unknown' CHECK (model IN ('qwen', 'openai', 'anthropic', 'local', 'unknown')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS native_agents_updated_idx ON native_agents(updated_at DESC);
