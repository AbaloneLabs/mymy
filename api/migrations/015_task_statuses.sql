-- 015: Task custom statuses (categories)
-- Replaces hardcoded CHECK constraint on tasks.status with a flexible
-- user-configurable status table. Supports labels, colors, ordering,
-- and an is_done flag (replaces hardcoded 'done' for completed_at logic).

-- Status definition table
CREATE TABLE IF NOT EXISTS task_statuses (
    slug        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT 'gray',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_done     BOOLEAN NOT NULL DEFAULT FALSE,
    is_system   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the three built-in statuses. These are marked is_system so they
-- cannot be deleted (only edited: label/color/is_done). sort_order
-- establishes the default column order.
INSERT INTO task_statuses (slug, label, color, sort_order, is_done, is_system) VALUES
    ('todo',        'To do',       'gray',  0, FALSE, TRUE),
    ('in_progress', 'In progress', 'blue',  1, FALSE, TRUE),
    ('done',        'Done',        'green', 2, TRUE,  TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Drop the old CHECK constraint so arbitrary slugs are allowed.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

-- Add a FK so status must reference an existing task_statuses row.
-- Keep it deferrable + initially immediate; status values are always
-- present before tasks reference them.
ALTER TABLE tasks
    ADD CONSTRAINT tasks_status_fk
    FOREIGN KEY (status) REFERENCES task_statuses(slug)
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_task_statuses_sort_order ON task_statuses(sort_order);
