-- Provider availability is independent from the lifetime of an agent run.
-- Persisting the next attempt on the run lets a worker release its lease while
-- a provider is unavailable, survive API restarts, and resume the same request
-- without creating a duplicate chat message or losing cancellation ownership.

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS provider_retry_count INTEGER NOT NULL DEFAULT 0
        CHECK (provider_retry_count >= 0);

CREATE INDEX IF NOT EXISTS idx_agent_runs_retry_ready
    ON agent_runs(status, next_attempt_at, created_at)
    WHERE status = 'queued';

COMMENT ON COLUMN agent_runs.next_attempt_at IS
    'Earliest time a queued run may be claimed after a transient provider failure; NULL means immediately eligible.';

COMMENT ON COLUMN agent_runs.provider_retry_count IS
    'Number of durable 30-minute provider retry schedules applied to this run.';
