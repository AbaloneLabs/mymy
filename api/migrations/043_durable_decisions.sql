-- Durable user choices, approvals, and non-sensitive input requests.

CREATE TABLE IF NOT EXISTS decisions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    session_id            UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    cron_job_id           TEXT,
    kind                  TEXT NOT NULL CHECK (kind IN ('choice', 'approval', 'input')),
    context               TEXT NOT NULL DEFAULT '',
    reason                TEXT NOT NULL DEFAULT '',
    question              TEXT NOT NULL CHECK (length(trim(question)) > 0),
    choices               JSONB NOT NULL DEFAULT '[]'::jsonb,
    suspend               BOOLEAN NOT NULL DEFAULT true,
    status                TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN (
                                   'pending', 'resolved', 'dismissed', 'expired',
                                   'cancelled', 'superseded'
                               )),
    answer                JSONB,
    dedupe_key            TEXT,
    proposed_action       JSONB,
    proposed_action_hash  TEXT,
    target_version        TEXT,
    expires_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at           TIMESTAMPTZ,
    resolved_by           TEXT,
    CHECK (
        (kind = 'approval' AND proposed_action IS NOT NULL AND proposed_action_hash IS NOT NULL)
        OR kind <> 'approval'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS one_blocking_pending_decision_per_run
    ON decisions(run_id)
    WHERE status = 'pending' AND suspend;

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_decision_per_dedupe_key
    ON decisions(dedupe_key)
    WHERE status = 'pending' AND dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decisions_status_created
    ON decisions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decisions_session_created
    ON decisions(session_id, created_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'run_checklist_items_blocked_decision_fk'
          AND conrelid = 'run_checklist_items'::regclass
    ) THEN
        ALTER TABLE run_checklist_items
            ADD CONSTRAINT run_checklist_items_blocked_decision_fk
            FOREIGN KEY (blocked_decision_id)
            REFERENCES decisions(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION enforce_decision_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'pending'
       AND NEW.status IN ('resolved', 'dismissed', 'expired', 'cancelled', 'superseded') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid decision status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
END
$$;

DROP TRIGGER IF EXISTS trg_decision_status_transition ON decisions;
CREATE TRIGGER trg_decision_status_transition
BEFORE UPDATE OF status ON decisions
FOR EACH ROW
EXECUTE FUNCTION enforce_decision_status_transition();
