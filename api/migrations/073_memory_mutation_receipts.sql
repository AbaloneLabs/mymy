-- Memory correction and forget operations can commit before an HTTP/tool
-- response is delivered. Purpose-bound receipts make retries observe the
-- committed revision, while deletion watermarks keep derived stores and
-- backup replay from resurrecting forgotten content.

CREATE TABLE memory_mutation_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('correct', 'forget')),
    source_memory_id UUID NOT NULL REFERENCES agent_memories(id),
    result_memory_id UUID NOT NULL REFERENCES agent_memories(id),
    agent_profile TEXT NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    committed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX memory_mutation_receipts_source_idx
    ON memory_mutation_receipts(source_memory_id, committed_at DESC);

CREATE TABLE memory_deletion_watermarks (
    memory_id UUID PRIMARY KEY,
    agent_profile TEXT NOT NULL,
    project_id UUID,
    scope_kind TEXT NOT NULL,
    scope_id TEXT,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    receipt_id UUID NOT NULL REFERENCES memory_mutation_receipts(id),
    CHECK (
        (scope_kind = 'user_global' AND scope_id IS NULL) OR
        (scope_kind <> 'user_global' AND scope_id IS NOT NULL)
    )
);

CREATE INDEX memory_deletion_watermarks_scope_idx
    ON memory_deletion_watermarks(agent_profile, project_id, deleted_at DESC);
