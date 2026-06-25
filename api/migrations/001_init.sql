-- 001_init.sql — mymy core schema
-- Tables: app_meta, agent_system_instances, git_system_configs, app_settings

-- Enable pgvector extension (optional, for future semantic search)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- app_meta: single-row app state (PIN hash)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_meta (
    id              BOOLEAN PRIMARY KEY DEFAULT true CONSTRAINT single_row CHECK (id),
    pin_hash        TEXT NOT NULL,
    initialized_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- agent_system_instances: registered Hermes/OpenClaw instances
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_system_instances (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                TEXT NOT NULL CHECK (type IN ('hermes', 'openclaw')),
    label               TEXT NOT NULL,
    enabled             BOOLEAN NOT NULL DEFAULT true,
    source              TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
    connection          TEXT NOT NULL CHECK (connection IN ('local', 'remote')),
    cli_path            TEXT,
    profile_dir         TEXT,
    host                TEXT,
    port                INTEGER DEFAULT 22,
    ssh_user            TEXT,
    remote_cli_path     TEXT,
    remote_profile_dir  TEXT,
    detected_agents     INTEGER,
    status              TEXT DEFAULT 'pending' CHECK (status IN ('connected', 'disconnected', 'pending')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_system_instances_type ON agent_system_instances(type);

-- ============================================================
-- git_system_configs: one row per git system (github/gitlab/gitea)
-- ============================================================
CREATE TABLE IF NOT EXISTS git_system_configs (
    type        TEXT PRIMARY KEY CHECK (type IN ('github', 'gitlab', 'gitea')),
    enabled     BOOLEAN NOT NULL DEFAULT false,
    host        TEXT NOT NULL DEFAULT '',
    port        INTEGER NOT NULL DEFAULT 22,
    ssh_alias   TEXT NOT NULL DEFAULT '',
    username    TEXT NOT NULL DEFAULT '',
    api_token   TEXT
);

-- ============================================================
-- app_settings: single-row general settings
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
    id          BOOLEAN PRIMARY KEY DEFAULT true CONSTRAINT single_row CHECK (id),
    language    TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ko', 'zh', 'ja'))
);
