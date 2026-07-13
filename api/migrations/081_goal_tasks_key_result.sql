-- KR-level task linking: allows a task to be attributed to a specific Key
-- Result, not just a goal. This makes the `task_completion` KPI type work --
-- progress is computed from tasks linked directly to the KR.
--
-- The column is nullable for backward compatibility: existing goal-level
-- links (where key_result_id IS NULL) remain valid.

ALTER TABLE goal_tasks
    ADD COLUMN IF NOT EXISTS key_result_id UUID REFERENCES key_results(id) ON DELETE CASCADE;

-- Prevent duplicate KR-scoped links. Scoped to non-null key_result_id so
-- that goal-level legacy links (key_result_id IS NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS goal_tasks_kr_task_uniq
    ON goal_tasks(key_result_id, task_id)
    WHERE key_result_id IS NOT NULL;

-- Fast lookup of tasks belonging to a specific KR.
CREATE INDEX IF NOT EXISTS goal_tasks_kr_idx
    ON goal_tasks(key_result_id)
    WHERE key_result_id IS NOT NULL;
