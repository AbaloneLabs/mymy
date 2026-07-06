-- Native agent chat message fidelity.
--
-- The native agent loop needs to replay assistant tool calls and tool results,
-- so messages gain structured tool metadata.

ALTER TABLE chat_messages
    DROP CONSTRAINT IF EXISTS chat_messages_role_check;

UPDATE chat_messages
SET role = 'assistant'
WHERE role = 'agent';

ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_role_check
    CHECK (role IN ('user', 'assistant', 'tool', 'system'));

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS tool_calls JSONB,
    ADD COLUMN IF NOT EXISTS tool_call_id TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB;
