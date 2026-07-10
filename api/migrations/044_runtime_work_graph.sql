-- Preserve task identity and connect durable runs to workspace work without
-- inferring relationships from broad list reads.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS tasks_live_project_idx
    ON tasks(project_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS task_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID NOT NULL,
    run_id              UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    operation           TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    snapshot            JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_history_task_idx
    ON task_history(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_task_links (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    task_id             UUID REFERENCES tasks(id) ON DELETE SET NULL,
    task_identity       UUID NOT NULL,
    link_kind           TEXT NOT NULL
                        CHECK (link_kind IN ('explicit', 'mutation', 'reference')),
    operation           TEXT,
    title_snapshot      TEXT NOT NULL,
    project_id_snapshot UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, task_identity, link_kind, operation)
);

CREATE INDEX IF NOT EXISTS run_task_links_task_idx
    ON run_task_links(task_identity, created_at DESC);
CREATE INDEX IF NOT EXISTS run_task_links_run_idx
    ON run_task_links(run_id, created_at DESC);
