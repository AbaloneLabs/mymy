-- Durable agent run ownership, event replay, and session input queue.
--
-- HTTP/SSE connections are subscribers rather than execution owners. Runs and
-- queued inputs therefore remain recoverable when a browser or API process
-- disconnects. Event payloads are redacted before insertion by the runtime.

CREATE TABLE IF NOT EXISTS agent_runs (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id               UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    agent_profile            TEXT NOT NULL,
    trigger_type             TEXT NOT NULL
                                 CHECK (trigger_type IN ('chat', 'cron', 'wake', 'delegate')),
    trigger_ref              TEXT,
    parent_run_id            UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
    parent_event_id          UUID,
    delegate_index           INTEGER,
    project_id               UUID REFERENCES projects(id) ON DELETE SET NULL,
    status                   TEXT NOT NULL DEFAULT 'queued'
                                 CHECK (status IN (
                                     'queued', 'running', 'waiting_decision',
                                     'completed', 'failed', 'cancelled'
                                 )),
    objective                TEXT NOT NULL DEFAULT '',
    prompt_version           TEXT NOT NULL,
    tool_schema_fingerprint  TEXT,
    authorization_context    JSONB NOT NULL DEFAULT '{}'::jsonb,
    lease_owner              TEXT,
    lease_epoch              BIGINT NOT NULL DEFAULT 0,
    lease_expires_at         TIMESTAMPTZ,
    cancel_requested_at      TIMESTAMPTZ,
    cancel_requested_by      TEXT,
    next_event_sequence      BIGINT NOT NULL DEFAULT 0,
    started_at               TIMESTAMPTZ,
    heartbeat_at             TIMESTAMPTZ,
    completed_at             TIMESTAMPTZ,
    error_code               TEXT,
    usage                    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (trigger_type = 'delegate' AND parent_run_id IS NOT NULL AND
         parent_event_id IS NOT NULL AND delegate_index IS NOT NULL)
        OR
        (trigger_type <> 'delegate' AND parent_event_id IS NULL AND
         delegate_index IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session_created
    ON agent_runs(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_status_created
    ON agent_runs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_runs_parent
    ON agent_runs(parent_run_id, delegate_index);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_chat_run_per_session
    ON agent_runs(session_id)
    WHERE session_id IS NOT NULL
      AND trigger_type = 'chat'
      AND status IN ('running', 'waiting_decision');

CREATE UNIQUE INDEX IF NOT EXISTS one_delegate_child_per_parent_event_index
    ON agent_runs(parent_event_id, delegate_index)
    WHERE parent_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_run_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    sequence         BIGINT NOT NULL,
    event_type       TEXT NOT NULL,
    payload_version  INTEGER NOT NULL DEFAULT 1,
    visibility       TEXT NOT NULL DEFAULT 'user'
                         CHECK (visibility IN ('user', 'internal', 'audit')),
    idempotency_key  TEXT,
    payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, sequence)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_runs_parent_event_fk'
          AND conrelid = 'agent_runs'::regclass
    ) THEN
        ALTER TABLE agent_runs
            ADD CONSTRAINT agent_runs_parent_event_fk
            FOREIGN KEY (parent_event_id)
            REFERENCES agent_run_events(id)
            ON DELETE CASCADE
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_events_idempotency
    ON agent_run_events(run_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_run_events_replay
    ON agent_run_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS session_run_inputs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id         UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    client_request_id  TEXT NOT NULL,
    target_run_id      UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    kind               TEXT NOT NULL DEFAULT 'message'
                           CHECK (kind IN ('message', 'follow_up')),
    content            TEXT NOT NULL,
    options            JSONB NOT NULL DEFAULT '{}'::jsonb,
    status             TEXT NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued', 'claimed', 'applied', 'cancelled')),
    sequence           BIGSERIAL NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at         TIMESTAMPTZ,
    UNIQUE (session_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_session_run_inputs_queue
    ON session_run_inputs(session_id, status, sequence);

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS run_input_id UUID
        REFERENCES session_run_inputs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS agent_run_id UUID
        REFERENCES agent_runs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS run_message_index INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_run_input
    ON chat_messages(run_input_id)
    WHERE run_input_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_run_projection
    ON chat_messages(agent_run_id, run_message_index)
    WHERE agent_run_id IS NOT NULL AND run_message_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_run_message_outbox (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id             UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    projection_key     TEXT NOT NULL,
    payload            JSONB NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'applied', 'failed')),
    attempts           INTEGER NOT NULL DEFAULT 0,
    last_error_code    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at         TIMESTAMPTZ,
    UNIQUE (run_id, projection_key)
);
