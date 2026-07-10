-- Quarantine legacy no-agent cron definitions before the scheduler starts.
--
-- The original JSON is retained for explicit user review and export, but it is
-- never returned by list endpoints or handed back to the scheduler. Historical
-- cron_results remain unchanged so an incident review does not lose evidence.

CREATE TABLE IF NOT EXISTS quarantined_cron_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_job_id       TEXT NOT NULL,
    definition_fingerprint TEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL,
    original_definition JSONB NOT NULL,
    was_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    quarantine_reason   TEXT NOT NULL,
    quarantined_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quarantined_cron_jobs_quarantined_at
    ON quarantined_cron_jobs(quarantined_at DESC);

CREATE INDEX IF NOT EXISTS idx_quarantined_cron_jobs_legacy_job_id
    ON quarantined_cron_jobs(legacy_job_id);

ALTER TABLE cron_results
    DROP CONSTRAINT IF EXISTS cron_results_status_check;

ALTER TABLE cron_results
    ADD CONSTRAINT cron_results_status_check
    CHECK (status IN ('success', 'error', 'silent', 'blocked_security_review'));
