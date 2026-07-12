-- A durable deletion fence prevents new queued input from racing a session
-- delete after the server has verified that all Runs are terminal.

ALTER TABLE chat_sessions
    ADD COLUMN deleting_at TIMESTAMPTZ;

CREATE INDEX chat_sessions_deleting_idx
    ON chat_sessions(deleting_at)
    WHERE deleting_at IS NOT NULL;
