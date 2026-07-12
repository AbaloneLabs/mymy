-- Keep the canonical Decision inbox ordering and pending badge bounded as the
-- durable queue grows. Agent/project filtering still joins agent_runs because
-- ownership belongs to the Run rather than being duplicated on each Decision.

CREATE INDEX IF NOT EXISTS idx_decisions_inbox_order
    ON decisions (
        (CASE WHEN status = 'pending' THEN 0 ELSE 1 END),
        (CASE WHEN status = 'pending' AND suspend THEN 0 ELSE 1 END),
        created_at,
        id
    );

CREATE INDEX IF NOT EXISTS idx_decisions_pending_kind_created
    ON decisions (kind, suspend, created_at, id)
    WHERE status = 'pending';
