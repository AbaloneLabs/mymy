-- Native cron result delivery.
--
-- Jobs are stored in the agent data directory so the cron tool and HTTP API
-- share one mutable job file. Results are persisted in PostgreSQL because they
-- are user-visible application records and need stable query semantics.

CREATE TABLE IF NOT EXISTS cron_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      TEXT NOT NULL,
    job_title   TEXT NOT NULL,
    mode        TEXT NOT NULL CHECK (mode IN ('agent', 'no_agent')),
    status      TEXT NOT NULL CHECK (status IN ('success', 'error', 'silent')),
    output      TEXT NOT NULL DEFAULT '',
    output_path TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_results_job_created
    ON cron_results(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cron_results_created
    ON cron_results(created_at DESC);
