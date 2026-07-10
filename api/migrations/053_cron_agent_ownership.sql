-- A scheduled autonomous run must never choose an agent implicitly. Existing
-- unassigned definitions remain visible for repair but are disabled, and the
-- database prevents a future code path from re-enabling them accidentally.

UPDATE cron_jobs
SET enabled = false,
    action_policy = action_policy || jsonb_build_object(
        'disabledReason', 'agent_assignment_required'
    ),
    updated_at = now()
WHERE enabled AND agent_profile IS NULL AND deleted_at IS NULL;

ALTER TABLE cron_jobs DROP CONSTRAINT IF EXISTS cron_jobs_enabled_agent_check;
ALTER TABLE cron_jobs ADD CONSTRAINT cron_jobs_enabled_agent_check
    CHECK (NOT enabled OR agent_profile IS NOT NULL);
