-- Drive-backed sandbox runtime metadata.
--
-- Agent and project records now have stable drive paths. The filesystem is
-- reconciled by the API service layer and, later, by the Firecracker runner.

ALTER TABLE native_agents
    ADD COLUMN IF NOT EXISTS drive_path TEXT,
    ADD COLUMN IF NOT EXISTS sandbox_uid INTEGER,
    ADD COLUMN IF NOT EXISTS sandbox_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (sandbox_status IN ('pending', 'ready', 'reconciling', 'failed'));

UPDATE native_agents
SET drive_path = '/drive/agents/' || profile
WHERE drive_path IS NULL OR trim(drive_path) = '';

ALTER TABLE native_agents
    ALTER COLUMN drive_path SET NOT NULL;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS drive_slug TEXT,
    ADD COLUMN IF NOT EXISTS drive_path TEXT;

UPDATE projects
SET drive_slug = COALESCE(
        NULLIF(
            lower(
                regexp_replace(
                    trim(regexp_replace(name, '[^A-Za-z0-9]+', '-', 'g')),
                    '(^-+|-+$)',
                    '',
                    'g'
                )
            ),
            ''
        ),
        'project'
    ) || '-' || substring(id::text, 1, 8)
WHERE drive_slug IS NULL OR trim(drive_slug) = '';

UPDATE projects
SET drive_path = '/drive/projects/' || drive_slug
WHERE drive_path IS NULL OR trim(drive_path) = '';

ALTER TABLE projects
    ALTER COLUMN drive_slug SET NOT NULL,
    ALTER COLUMN drive_path SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS projects_drive_slug_idx ON projects(drive_slug);

CREATE TABLE IF NOT EXISTS agent_project_memberships (
    agent_profile TEXT NOT NULL REFERENCES native_agents(profile) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'owner')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_profile, project_id)
);

CREATE TABLE IF NOT EXISTS sandbox_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_profile TEXT NOT NULL REFERENCES native_agents(profile) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    command TEXT NOT NULL,
    cwd TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('starting', 'running', 'exited', 'failed', 'stopped')),
    pid INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at TIMESTAMPTZ,
    exit_code INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS sandbox_processes_agent_idx
    ON sandbox_processes(agent_profile, started_at DESC);

CREATE TABLE IF NOT EXISTS preview_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_profile TEXT NOT NULL REFERENCES native_agents(profile) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    process_id UUID REFERENCES sandbox_processes(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    target_url TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    visibility TEXT NOT NULL DEFAULT 'session'
        CHECK (visibility IN ('session', 'public')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'stopped', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS preview_endpoints_agent_idx
    ON preview_endpoints(agent_profile, created_at DESC);

CREATE TABLE IF NOT EXISTS drive_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL CHECK (provider IN ('local_vm', 's3')),
    drive_path TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('upload', 'download', 'delete')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'failed', 'done')),
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drive_sync_jobs_status_idx
    ON drive_sync_jobs(status, created_at);
