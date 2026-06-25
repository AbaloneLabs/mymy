-- 002_seed_defaults.sql — seed default rows
-- Run after 001_init.sql

-- Git system defaults (3 rows: github/gitlab/gitea)
INSERT INTO git_system_configs (type, enabled, host, port, ssh_alias, username) VALUES
    ('github', false, 'github.com', 22, '', ''),
    ('gitlab', false, '', 22, '', 'git'),
    ('gitea',  false, '', 22, '', 'git')
ON CONFLICT (type) DO NOTHING;

-- App settings default row (language = en)
INSERT INTO app_settings (id, language) VALUES (true, 'en')
ON CONFLICT (id) DO NOTHING;

-- NOTE: app_meta (pin_hash) is seeded lazily by the application on first
-- run via GET /api/auth/status, because argon2 hashing must happen in code.
