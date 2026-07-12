-- Agent deletion cascades through memory rows after the owning profile has
-- left `native_agents`. The memory DELETE trigger must not recreate a
-- watermark for that disappearing owner: doing so violates its foreign key
-- and rolls back otherwise valid agent cleanup.

CREATE OR REPLACE FUNCTION advance_memory_lifecycle_watermark()
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

    IF EXISTS (
        SELECT 1 FROM native_agents WHERE profile = affected_profile
    ) THEN
        INSERT INTO memory_lifecycle_watermarks (agent_profile, revision, updated_at)
        VALUES (affected_profile, 1, now())
        ON CONFLICT (agent_profile) DO UPDATE
        SET revision = memory_lifecycle_watermarks.revision + 1,
            updated_at = now();
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
