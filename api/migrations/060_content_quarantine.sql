CREATE TABLE IF NOT EXISTS content_quarantine_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    desired_path TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    detected_type TEXT NOT NULL,
    origin_kind TEXT NOT NULL CHECK (
        origin_kind IN (
            'user_edit', 'user_upload', 'agent_generated', 'agent_download',
            's3_download', 'connector_import', 'editor_output'
        )
    ),
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'provider', 'system')),
    actor_id TEXT,
    agent_run_id UUID,
    provider_ref TEXT,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    size BIGINT NOT NULL CHECK (size >= 0),
    storage_key UUID NOT NULL UNIQUE,
    findings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array'),
    policy_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approving', 'approved', 'deleted', 'expired', 'rejected')
    ),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    approval_idempotency_key TEXT,
    committed_fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    decided_at TIMESTAMPTZ,
    decided_by TEXT
);

CREATE INDEX IF NOT EXISTS content_quarantine_pending_idx
    ON content_quarantine_items(status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS content_quarantine_desired_path_idx
    ON content_quarantine_items(desired_path, status);

ALTER TABLE drive_sync_jobs
    ADD COLUMN IF NOT EXISTS quarantine_id UUID
        REFERENCES content_quarantine_items(id) ON DELETE SET NULL;

ALTER TABLE drive_sync_jobs
    DROP CONSTRAINT IF EXISTS drive_sync_jobs_status_check;

ALTER TABLE drive_sync_jobs
    ADD CONSTRAINT drive_sync_jobs_status_check
        CHECK (status IN ('pending', 'running', 'failed', 'done', 'quarantined'));

CREATE INDEX IF NOT EXISTS drive_sync_jobs_quarantine_idx
    ON drive_sync_jobs(quarantine_id)
    WHERE quarantine_id IS NOT NULL;
