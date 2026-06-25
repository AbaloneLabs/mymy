-- 012_omnisearch_fts.sql — extend full-text search to all searchable entities.
--
-- `notes` already has a complete FTS setup (search_tsv + GIN index + trigger,
-- see 007_notes.sql). This migration replicates the same pattern for:
--   - tasks            (title A, description B)
--   - chat_sessions    (title A; title is nullable -> COALESCE)
--   - chat_messages    (content A)  [added for message content search]
--   - calendar_events  (title A, description B)
--   - projects         (name A, description B)
--
-- Uses the 'simple' text-search config for multilingual support (incl. CJK),
-- matching the notes pattern. Each table gets its own trigger function so the
-- field mapping is explicit and independent.

-- ============================================================
-- tasks
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS search_tsv TSVECTOR;

CREATE INDEX IF NOT EXISTS tasks_search_idx ON tasks USING GIN(search_tsv);

CREATE OR REPLACE FUNCTION tasks_search_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_search_tsv_trigger ON tasks;
CREATE TRIGGER tasks_search_tsv_trigger
    BEFORE INSERT OR UPDATE OF title, description ON tasks
    FOR EACH ROW EXECUTE FUNCTION tasks_search_tsv_update();

-- Backfill existing rows.
UPDATE tasks SET search_tsv =
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B');

-- ============================================================
-- chat_sessions (title is nullable)
-- ============================================================
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS search_tsv TSVECTOR;

CREATE INDEX IF NOT EXISTS chat_sessions_search_idx ON chat_sessions USING GIN(search_tsv);

CREATE OR REPLACE FUNCTION chat_sessions_search_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_sessions_search_tsv_trigger ON chat_sessions;
CREATE TRIGGER chat_sessions_search_tsv_trigger
    BEFORE INSERT OR UPDATE OF title ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION chat_sessions_search_tsv_update();

UPDATE chat_sessions SET search_tsv =
    setweight(to_tsvector('simple', coalesce(title, '')), 'A');

-- ============================================================
-- chat_messages (content)
-- ============================================================
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS search_tsv TSVECTOR;

CREATE INDEX IF NOT EXISTS chat_messages_search_idx ON chat_messages USING GIN(search_tsv);

CREATE OR REPLACE FUNCTION chat_messages_search_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv := to_tsvector('simple', coalesce(NEW.content, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_messages_search_tsv_trigger ON chat_messages;
CREATE TRIGGER chat_messages_search_tsv_trigger
    BEFORE INSERT OR UPDATE OF content ON chat_messages
    FOR EACH ROW EXECUTE FUNCTION chat_messages_search_tsv_update();

UPDATE chat_messages SET search_tsv = to_tsvector('simple', coalesce(content, ''));

-- ============================================================
-- calendar_events (title A, description B)
-- ============================================================
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS search_tsv TSVECTOR;

CREATE INDEX IF NOT EXISTS calendar_events_search_idx ON calendar_events USING GIN(search_tsv);

CREATE OR REPLACE FUNCTION calendar_events_search_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calendar_events_search_tsv_trigger ON calendar_events;
CREATE TRIGGER calendar_events_search_tsv_trigger
    BEFORE INSERT OR UPDATE OF title, description ON calendar_events
    FOR EACH ROW EXECUTE FUNCTION calendar_events_search_tsv_update();

UPDATE calendar_events SET search_tsv =
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B');

-- ============================================================
-- projects (name A, description B)
-- ============================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS search_tsv TSVECTOR;

CREATE INDEX IF NOT EXISTS projects_search_idx ON projects USING GIN(search_tsv);

CREATE OR REPLACE FUNCTION projects_search_tsv_update() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_search_tsv_trigger ON projects;
CREATE TRIGGER projects_search_tsv_trigger
    BEFORE INSERT OR UPDATE OF name, description ON projects
    FOR EACH ROW EXECUTE FUNCTION projects_search_tsv_update();

UPDATE projects SET search_tsv =
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B');
