-- 003_projects.sql — projects table
-- Projects are the right-side workspace units on the dashboard.

-- ============================================================
-- projects: workspace units (optionally linked to a git remote)
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    git_remote  TEXT,
    git_system  TEXT CHECK (git_system IN ('github', 'gitlab', 'gitea')),
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);
