-- Session deletion is a durable fenced operation. The operation row survives
-- the chat-session cascade so a retry or worker can distinguish an unknown
-- session from a deletion that already completed.

CREATE TABLE session_deletion_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN (
        'fenced', 'waiting_for_runs', 'waiting_for_saves', 'completed', 'failed'
    )),
    last_error_code TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    fenced_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX session_deletion_operations_pending_idx
    ON session_deletion_operations(updated_at, session_id)
    WHERE state NOT IN ('completed', 'failed');
