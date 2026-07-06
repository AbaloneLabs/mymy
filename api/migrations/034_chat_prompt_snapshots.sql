-- 034_chat_prompt_snapshots.sql — stable chat prompt snapshots
-- Keeps session-stable prompt layers and tool schema fingerprints on the
-- session row so repeated turns can preserve a byte-stable provider prefix.

ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS system_prompt_stable TEXT,
    ADD COLUMN IF NOT EXISTS system_prompt_context TEXT,
    ADD COLUMN IF NOT EXISTS system_prompt_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS tool_schema_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS prompt_snapshot_created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS prompt_snapshot_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS chat_sessions_prompt_fingerprint_idx
    ON chat_sessions(system_prompt_fingerprint);
