CREATE TABLE document_revision_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_path TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
    actor_id TEXT,
    source TEXT NOT NULL,
    operation_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX document_revision_events_operation_key_unique
    ON document_revision_events(operation_key)
    WHERE operation_key IS NOT NULL;

CREATE INDEX document_revision_events_path_fingerprint_idx
    ON document_revision_events(drive_path, fingerprint, created_at DESC);
