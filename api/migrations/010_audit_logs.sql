-- Audit logs — append-only record of all data mutations (create/update/delete).
--
-- Captures WHO (user vs agent) did WHAT (action) to WHICH entity (entity_type +
-- entity_id), plus a flexible JSONB `changes` payload. The application layer
-- only INSERTs into this table; there are no UPDATE/DELETE code paths, making
-- it effectively append-only.
--
-- Design notes:
--   * `entity_id` is TEXT (not UUID): settings/pin changes have no entity id.
--   * No FK constraints: audit entries must survive entity deletion so that
--     "deleted" history remains queryable.
--   * `changes` is JSONB: structure varies by action (create -> {after},
--     update -> {before, after}, delete -> {before}).

CREATE TABLE IF NOT EXISTS audit_logs (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type   TEXT         NOT NULL
                 CHECK (actor_type IN ('user', 'agent')),
    actor_id     TEXT         NOT NULL,
    action       TEXT         NOT NULL
                 CHECK (action IN ('create', 'update', 'delete')),
    entity_type  TEXT         NOT NULL,
    entity_id    TEXT,
    changes      JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for query performance (reads dominate; INSERTs only append).
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at  ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_type  ON audit_logs (actor_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs (entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity      ON audit_logs (entity_type, entity_id);
