-- Goals / OKR tracking — strategic layer connecting tasks (execution) and
-- finance (results). Mirrors the notes/tasks pattern for consistency.
--
-- Model:
--   * Goal (Objective)  — qualitative direction (quarterly/annual/monthly)
--   * KeyResult (KR)     — quantitative, measurable metric per goal
--   * goal_tasks         — many-to-many link between goals and tasks
--
-- KPI types:
--   manual           — user enters current_value directly
--   task_completion  — current_value derived from linked tasks completion ratio
--   finance          — TODO(backend): aggregate from transactions table

CREATE TABLE IF NOT EXISTS goals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    type         TEXT NOT NULL DEFAULT 'quarterly'
                 CHECK (type IN ('quarterly', 'annual', 'monthly')),
    period       TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'completed', 'archived')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT goals_title_nonempty CHECK (length(btrim(title)) > 0)
);

CREATE TABLE IF NOT EXISTS key_results (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id       UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    kpi_type      TEXT NOT NULL DEFAULT 'manual'
                  CHECK (kpi_type IN ('manual', 'task_completion', 'finance')),
    target_value  DOUBLE PRECISION NOT NULL DEFAULT 100
                  CHECK (target_value > 0),
    current_value DOUBLE PRECISION NOT NULL DEFAULT 0
                  CHECK (current_value >= 0),
    unit          TEXT NOT NULL DEFAULT '%',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT key_results_title_nonempty CHECK (length(btrim(title)) > 0)
);

-- Junction: many-to-many between goals and tasks.
-- A task may contribute to multiple goals and vice versa.
CREATE TABLE IF NOT EXISTS goal_tasks (
    goal_id    UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (goal_id, task_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS goals_type_idx     ON goals(type);
CREATE INDEX IF NOT EXISTS goals_status_idx   ON goals(status);
CREATE INDEX IF NOT EXISTS goals_period_idx   ON goals(period);
CREATE INDEX IF NOT EXISTS key_results_goal_idx ON key_results(goal_id);
