-- Separate semantic Decisions, durable answer delivery, and visible Run status.
--
-- Historical approval rows remain in the decisions table as audit provenance,
-- but they are no longer pending user work and cannot authorize execution.

UPDATE decisions
SET status = 'superseded',
    resolved_at = COALESCE(resolved_at, now()),
    resolved_by = COALESCE(resolved_by, 'system')
WHERE kind = 'approval' AND status = 'pending';

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS decision_inbox_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS decision_delivered_revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE agent_runs
    ADD CONSTRAINT agent_runs_decision_revision_order
    CHECK (decision_delivered_revision <= decision_inbox_revision) NOT VALID;

ALTER TABLE agent_runs
    VALIDATE CONSTRAINT agent_runs_decision_revision_order;

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS run_status_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_run_status
    ON chat_messages(agent_run_id, run_status_key)
    WHERE agent_run_id IS NOT NULL AND run_status_key IS NOT NULL;

-- Every cron definition receives its own visible conversation. Existing
-- occurrence-level sessions remain as history, while all future occurrences
-- converge on this stable per-job session.
DO $$
DECLARE
    job RECORD;
    stable_session_id UUID;
BEGIN
    FOR job IN
        SELECT id, title, agent_profile, project_id, created_at, deleted_at
        FROM cron_jobs
        WHERE agent_profile IS NOT NULL
        ORDER BY created_at, id
    LOOP
        stable_session_id := gen_random_uuid();
        INSERT INTO chat_sessions
            (id, project_id, agent_id, profile, title, status, message_count,
             automation_result_only, created_at, updated_at)
        VALUES
            (stable_session_id, job.project_id, 'native-' || job.agent_profile,
             job.agent_profile, 'Cron: ' || left(job.title, 220), 'active', 0,
             false, job.created_at, now());
        IF job.deleted_at IS NOT NULL THEN
            UPDATE chat_sessions
            SET status = 'archived', updated_at = now()
            WHERE id = stable_session_id;
        END IF;
        UPDATE cron_jobs
        SET session_policy = 'reuse', reuse_session_id = stable_session_id,
            updated_at = now()
        WHERE id = job.id;
    END LOOP;
END;
$$;

ALTER TABLE cron_jobs DROP CONSTRAINT IF EXISTS cron_jobs_session_policy_check;
ALTER TABLE cron_jobs
    ADD CONSTRAINT cron_jobs_session_policy_check
    CHECK (session_policy = 'reuse');

CREATE UNIQUE INDEX IF NOT EXISTS one_session_per_cron_job
    ON cron_jobs(reuse_session_id)
    WHERE reuse_session_id IS NOT NULL;
