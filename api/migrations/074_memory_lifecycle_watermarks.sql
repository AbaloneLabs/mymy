-- A Run must not dispatch with recalled evidence that was corrected, forgotten,
-- or invalidated after prompt assembly. The per-profile watermark changes only
-- for content/lifecycle mutations; recall counters and embedding maintenance do
-- not make an otherwise valid prompt stale.

CREATE TABLE memory_lifecycle_watermarks (
    agent_profile TEXT PRIMARY KEY REFERENCES native_agents(profile) ON DELETE CASCADE,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO memory_lifecycle_watermarks (agent_profile)
SELECT profile FROM native_agents
ON CONFLICT DO NOTHING;

CREATE FUNCTION advance_memory_lifecycle_watermark()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_profile TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        affected_profile := OLD.agent_profile;
    ELSE
        affected_profile := NEW.agent_profile;
    END IF;
    INSERT INTO memory_lifecycle_watermarks (agent_profile, revision, updated_at)
    VALUES (affected_profile, 1, now())
    ON CONFLICT (agent_profile) DO UPDATE
    SET revision = memory_lifecycle_watermarks.revision + 1,
        updated_at = now();
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER agent_memories_lifecycle_inserted
AFTER INSERT ON agent_memories
FOR EACH ROW
EXECUTE FUNCTION advance_memory_lifecycle_watermark();

CREATE TRIGGER agent_memories_lifecycle_updated
AFTER UPDATE ON agent_memories
FOR EACH ROW
WHEN (
    OLD.content_revision IS DISTINCT FROM NEW.content_revision OR
    OLD.lifecycle_revision IS DISTINCT FROM NEW.lifecycle_revision OR
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD.valid_from IS DISTINCT FROM NEW.valid_from OR
    OLD.valid_until IS DISTINCT FROM NEW.valid_until OR
    OLD.superseded_by IS DISTINCT FROM NEW.superseded_by OR
    OLD.source_session_id IS DISTINCT FROM NEW.source_session_id OR
    OLD.source_message_start IS DISTINCT FROM NEW.source_message_start OR
    OLD.source_message_end IS DISTINCT FROM NEW.source_message_end OR
    OLD.scope_kind IS DISTINCT FROM NEW.scope_kind OR
    OLD.scope_id IS DISTINCT FROM NEW.scope_id
)
EXECUTE FUNCTION advance_memory_lifecycle_watermark();

CREATE TRIGGER agent_memories_lifecycle_deleted
AFTER DELETE ON agent_memories
FOR EACH ROW
EXECUTE FUNCTION advance_memory_lifecycle_watermark();

ALTER TABLE run_memory_context_manifests
    ADD COLUMN memory_lifecycle_revision BIGINT NOT NULL DEFAULT 1
        CHECK (memory_lifecycle_revision > 0);
