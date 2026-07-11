ALTER TABLE drive_sync_jobs
    ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0),
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS drive_sync_jobs_retry_idx
    ON drive_sync_jobs(provider, status, next_attempt_at, lease_expires_at, created_at);
