-- DB-owned scheduler definitions and occurrence claims. Job definitions are
-- independent from AgentRun instances so schedule control never cancels an
-- already visible run implicitly.

ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS automation_result_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE session_run_inputs DROP CONSTRAINT IF EXISTS session_run_inputs_kind_check;
ALTER TABLE session_run_inputs
    ADD CONSTRAINT session_run_inputs_kind_check
    CHECK (kind IN ('message', 'follow_up', 'cron', 'wake'));

CREATE UNIQUE INDEX IF NOT EXISTS one_active_primary_run_per_session
    ON agent_runs(session_id)
    WHERE session_id IS NOT NULL
      AND trigger_type IN ('chat', 'cron', 'wake')
      AND status IN ('running', 'waiting_decision');

CREATE TABLE IF NOT EXISTS cron_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id           TEXT UNIQUE,
    title               TEXT NOT NULL CHECK (length(btrim(title)) > 0),
    prompt              TEXT NOT NULL CHECK (length(btrim(prompt)) > 0),
    schedule            JSONB NOT NULL,
    schedule_text       TEXT NOT NULL,
    timezone            TEXT NOT NULL DEFAULT 'UTC',
    enabled             BOOLEAN NOT NULL DEFAULT true,
    next_run_at         TIMESTAMPTZ NOT NULL,
    run_count           INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
    max_runs            INTEGER CHECK (max_runs > 0),
    skills              JSONB NOT NULL DEFAULT '[]'::jsonb,
    context_from        JSONB,
    wake_agent          BOOLEAN NOT NULL DEFAULT true,
    agent_profile       TEXT REFERENCES native_agents(profile) ON DELETE SET NULL,
    project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
    session_policy      TEXT NOT NULL DEFAULT 'new'
                        CHECK (session_policy IN ('new', 'reuse', 'result_only')),
    reuse_session_id    UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    catch_up_policy     TEXT NOT NULL DEFAULT 'latest'
                        CHECK (catch_up_policy IN ('skip', 'latest', 'all')),
    retry_policy        TEXT NOT NULL DEFAULT 'safe'
                        CHECK (retry_policy IN ('none', 'safe')),
    action_policy       JSONB NOT NULL DEFAULT '{}'::jsonb,
    budget              JSONB NOT NULL DEFAULT '{}'::jsonb,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cron_jobs_due_idx
    ON cron_jobs(next_run_at) WHERE enabled AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION disable_cron_jobs_for_deleted_project()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE cron_jobs
    SET enabled = false,
        action_policy = action_policy || jsonb_build_object('disabledReason', 'project_deleted'),
        updated_at = now()
    WHERE project_id = OLD.id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cron_jobs_project_delete_guard ON projects;
CREATE TRIGGER cron_jobs_project_delete_guard
BEFORE DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION disable_cron_jobs_for_deleted_project();

CREATE OR REPLACE FUNCTION disable_cron_jobs_for_deleted_agent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE cron_jobs
    SET enabled = false,
        action_policy = action_policy || jsonb_build_object('disabledReason', 'agent_deleted'),
        updated_at = now()
    WHERE agent_profile = OLD.profile;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cron_jobs_agent_delete_guard ON native_agents;
CREATE TRIGGER cron_jobs_agent_delete_guard
BEFORE DELETE ON native_agents
FOR EACH ROW EXECUTE FUNCTION disable_cron_jobs_for_deleted_agent();

CREATE TABLE IF NOT EXISTS cron_occurrences (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    scheduled_for       TIMESTAMPTZ NOT NULL,
    occurrence_key      TEXT NOT NULL UNIQUE,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'enqueued', 'claimed',
                                         'waiting_decision', 'completed',
                                         'failed', 'cancelled', 'skipped')),
    run_id              UUID UNIQUE REFERENCES agent_runs(id) ON DELETE SET NULL,
    skip_reason         JSONB,
    attempts            INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    job_snapshot        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    UNIQUE (job_id, scheduled_for)
);

ALTER TABLE cron_occurrences
    ADD COLUMN IF NOT EXISTS job_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS cron_occurrences_job_created_idx
    ON cron_occurrences(job_id, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS runtime_migrations (
    key                 TEXT PRIMARY KEY,
    completed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    details             JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE cron_results
    ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS occurrence_id UUID REFERENCES cron_occurrences(id) ON DELETE SET NULL;

ALTER TABLE cron_results DROP CONSTRAINT IF EXISTS cron_results_status_check;
ALTER TABLE cron_results ADD CONSTRAINT cron_results_status_check
    CHECK (status IN ('success', 'error', 'silent', 'cancelled',
                      'skipped', 'blocked_security_review'));

CREATE UNIQUE INDEX IF NOT EXISTS cron_results_occurrence_unique
    ON cron_results(occurrence_id) WHERE occurrence_id IS NOT NULL;
