-- 018_refactoring_query_indexes.sql — indexes for common list/filter paths.
--
-- These are repository-local DB optimizations only. They do not add external
-- infrastructure or change application behavior.

-- Tasks: project/status filters plus status-board lookups.
CREATE INDEX IF NOT EXISTS tasks_project_status_idx
    ON tasks(project_id, status);

CREATE INDEX IF NOT EXISTS tasks_status_created_idx
    ON tasks(status, created_at DESC);

-- Notes: project lists sort pinned first, then recently updated.
CREATE INDEX IF NOT EXISTS notes_project_pinned_updated_idx
    ON notes(project_id, pinned DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS notes_pinned_updated_idx
    ON notes(pinned DESC, updated_at DESC);

-- Calendar: month window by project is the dominant calendar view.
CREATE INDEX IF NOT EXISTS calendar_events_project_start_idx
    ON calendar_events(project_id, start_date);

-- Transactions: finance lists and summaries filter by project/type/status/date.
CREATE INDEX IF NOT EXISTS transactions_project_date_idx
    ON transactions(project_id, date DESC);

CREATE INDEX IF NOT EXISTS transactions_project_type_status_date_idx
    ON transactions(project_id, type, status, date DESC);

-- Goals: filtered list views with newest-first ordering.
CREATE INDEX IF NOT EXISTS goals_status_created_idx
    ON goals(status, created_at DESC);

CREATE INDEX IF NOT EXISTS goals_type_status_created_idx
    ON goals(type, status, created_at DESC);

-- Goal/task joins are bidirectional in practice.
CREATE INDEX IF NOT EXISTS goal_tasks_task_idx
    ON goal_tasks(task_id);

-- Chat: session lists are filtered by project/profile and sorted newest first.
CREATE INDEX IF NOT EXISTS chat_sessions_project_profile_created_idx
    ON chat_sessions(project_id, profile, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_sessions_profile_created_idx
    ON chat_sessions(profile, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx
    ON chat_messages(session_id, created_at ASC);

-- Knowledge: tree views filter by parent/status and sort by manual order.
CREATE INDEX IF NOT EXISTS ka_parent_sort_title_idx
    ON knowledge_articles(parent_id, sort_order ASC, title ASC);

CREATE INDEX IF NOT EXISTS ka_status_sort_title_idx
    ON knowledge_articles(status, sort_order ASC, title ASC);

-- Task statuses: UI always reads statuses in display order.
CREATE INDEX IF NOT EXISTS task_statuses_sort_slug_idx
    ON task_statuses(sort_order ASC, slug ASC);
