-- 001_init.sql — mymy core schema
-- Tables: app_meta, git_system_configs, app_settings

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
