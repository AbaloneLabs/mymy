-- Proactive discovery is opt-in, budgeted, and proposal-oriented. Candidate
-- state is durable so a restart cannot repeatedly surface the same issue.

CREATE TABLE IF NOT EXISTS proactive_settings (
    agent_profile       TEXT PRIMARY KEY REFERENCES native_agents(profile) ON DELETE CASCADE,
    enabled             BOOLEAN NOT NULL DEFAULT false,
    quiet_start_hour    SMALLINT NOT NULL DEFAULT 22 CHECK (quiet_start_hour BETWEEN 0 AND 23),
    quiet_end_hour      SMALLINT NOT NULL DEFAULT 7 CHECK (quiet_end_hour BETWEEN 0 AND 23),
    daily_run_budget    INTEGER NOT NULL DEFAULT 3 CHECK (daily_run_budget BETWEEN 0 AND 100),
    max_tool_calls      INTEGER NOT NULL DEFAULT 20 CHECK (max_tool_calls BETWEEN 1 AND 500),
    max_runtime_seconds INTEGER NOT NULL DEFAULT 300 CHECK (max_runtime_seconds BETWEEN 10 AND 3600),
    cooldown_hours      INTEGER NOT NULL DEFAULT 24 CHECK (cooldown_hours BETWEEN 1 AND 720),
    idle_fallback_days  INTEGER NOT NULL DEFAULT 7 CHECK (idle_fallback_days BETWEEN 1 AND 365),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meaningful_activity (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_profile       TEXT REFERENCES native_agents(profile) ON DELETE CASCADE,
    project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
    activity_type       TEXT NOT NULL CHECK (activity_type IN
                        ('user_message', 'decision_resolved', 'task_mutation',
                         'productive_run')),
    source_id           TEXT NOT NULL,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (activity_type, source_id)
);

CREATE INDEX IF NOT EXISTS meaningful_activity_lookup_idx
    ON meaningful_activity(agent_profile, project_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS proactive_candidates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_profile       TEXT NOT NULL REFERENCES native_agents(profile) ON DELETE CASCADE,
    project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
    task_id             UUID REFERENCES tasks(id) ON DELETE SET NULL,
    fingerprint         TEXT NOT NULL,
    kind                TEXT NOT NULL CHECK (kind IN ('overdue_task', 'idle_review')),
    reason              TEXT NOT NULL,
    score               DOUBLE PRECISION NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'discovered'
                        CHECK (status IN ('discovered', 'approved', 'ignored',
                                         'spawned', 'expired')),
    run_id              UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    cooldown_until      TIMESTAMPTZ,
    discovered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ,
    UNIQUE (agent_profile, fingerprint)
);

CREATE INDEX IF NOT EXISTS proactive_candidates_status_idx
    ON proactive_candidates(agent_profile, status, score DESC, discovered_at);
