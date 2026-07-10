-- Durable run checklist and structured compaction checkpoints.
--
-- A run checklist is private execution state. It is deliberately separate
-- from workspace tasks, which are user-facing long-lived work records.

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS legacy_todo_imported_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS run_checklist_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id               UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    item_key             TEXT NOT NULL,
    content              TEXT NOT NULL CHECK (length(trim(content)) > 0),
    status               TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN (
                                 'pending', 'in_progress', 'blocked',
                                 'completed', 'cancelled'
                             )),
    position             INTEGER NOT NULL,
    blocked_decision_id  UUID,
    verification_event_id UUID REFERENCES agent_run_events(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, item_key),
    UNIQUE (run_id, position)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_in_progress_checklist_item_per_run
    ON run_checklist_items(run_id)
    WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_run_checklist_items_run_position
    ON run_checklist_items(run_id, position);

CREATE TABLE IF NOT EXISTS agent_run_checkpoints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id         UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    sequence       INTEGER NOT NULL,
    objective      TEXT NOT NULL,
    constraints    JSONB NOT NULL DEFAULT '[]'::jsonb,
    decisions      JSONB NOT NULL DEFAULT '[]'::jsonb,
    pending_work   JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary        TEXT NOT NULL DEFAULT '',
    resume_input   TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_checkpoints_latest
    ON agent_run_checkpoints(run_id, sequence DESC);
